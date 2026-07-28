// Single implementation of "persist an uploaded file and record it in `documents`",
// shared by the Documents hub and by any route that receives a file as a side effect
// of doing something else (bid import, etc.) so an upload never ends up parsed but
// unsaved.
//
// Storage order is Cloudinary → Google Drive → base64 in the row itself, so a file is
// always retrievable even with no external storage configured.
import { pool } from '../db/pool';
import { logger } from './logger';
import { uploadFile, ensureSubfolder } from '../services/googleDrive';
import { uploadToCloud, isCloudStorageConfigured } from './cloudStorage';

export const CATEGORY_TO_FOLDER: Record<string, string> = {
  plans:          'drive_plans_folder_id',
  permit:         'drive_plans_folder_id',
  contract:       'drive_contracts_folder_id',
  invoice:        'drive_contracts_folder_id',
  proposal:       'drive_estimates_folder_id',
  takeoff:        'drive_estimates_folder_id',
  cost_breakdown: 'drive_estimates_folder_id',
  change_order:   'drive_change_orders_folder_id',
  submittal:      'drive_submittals_folder_id',
  rfi:            'drive_rfis_folder_id',
  photo:          'drive_photos_folder_id',
};

// Generator proposals use a different (flatter) folder layout than electrical bids.
export const GEN_CATEGORY_TO_FOLDER: Record<string, string> = {
  photo:          'drive_photos_folder_id',
  contract:       'drive_contract_folder_id',
  invoice:        'drive_invoices_folder_id',
  permit:         'drive_permit_folder_id',
  engineering:    'drive_engineering_folder_id',
  sizer_report:   'drive_engineering_folder_id',
  survey:         'drive_engineering_folder_id',
  labeled_survey: 'drive_engineering_folder_id',
  site_checklist: 'drive_engineering_folder_id',
};

export interface StoreDocumentInput {
  file: Express.Multer.File;
  linkedId?: string | null;
  linkedName?: string | null;
  div?: string;
  category?: string;
  displayName?: string | null;
  uploadedBy: string;
  /** Replace any existing document in this category for this record instead of stacking duplicates. */
  replaceExisting?: boolean;
}

async function resolveDriveFolder(linkedId: string, div: string, category: string): Promise<string | null> {
  if (div === 'elec') {
    const folderColumn = CATEGORY_TO_FOLDER[category];
    const cols = folderColumn ? `${folderColumn} AS sub_folder_id, drive_job_folder_id` : `drive_job_folder_id`;
    const { rows } = await pool.query(`SELECT ${cols} FROM bids WHERE id=$1`, [linkedId]);
    return rows[0]?.sub_folder_id || rows[0]?.drive_job_folder_id || null;
  }
  if (div === 'gen') {
    const folderColumn = GEN_CATEGORY_TO_FOLDER[category];
    const cols = folderColumn ? `${folderColumn} AS sub_folder_id, drive_job_folder_id` : `drive_job_folder_id`;
    const { rows } = await pool.query(`SELECT ${cols} FROM generator_proposals WHERE id=$1`, [linkedId]);
    let folderId: string | null = rows[0]?.sub_folder_id || null;
    // Photos folder may not exist yet on older gen jobs — lazily create it.
    if (!folderId && category === 'photo' && rows[0]?.drive_job_folder_id) {
      folderId = await ensureSubfolder('Photos', rows[0].drive_job_folder_id);
      if (folderId) {
        await pool.query(`UPDATE generator_proposals SET drive_photos_folder_id=$1 WHERE id=$2`, [folderId, linkedId]);
      }
    }
    return folderId || rows[0]?.drive_job_folder_id || null;
  }
  return null;
}

export async function storeDocument(input: StoreDocumentInput) {
  const { file, linkedId, linkedName, uploadedBy, replaceExisting } = input;
  const div = input.div || 'general';
  const category = input.category || 'other';
  const displayName = input.displayName?.trim() || file.originalname;

  const driveFolderId = linkedId ? await resolveDriveFolder(linkedId, div, category) : null;

  let storageUrl: string | null = null;
  if (isCloudStorageConfigured()) {
    try {
      storageUrl = await uploadToCloud(file.buffer, file.originalname, file.mimetype);
    } catch (err) {
      logger.warn({ err }, '[cloudStorage] upload rejected — using Drive/DB fallback');
    }
  }

  let driveFileId: string | null = null;
  if (driveFolderId) {
    try {
      driveFileId = await uploadFile(displayName, file.mimetype || 'application/octet-stream', file.buffer, driveFolderId);
    } catch (err) {
      logger.error({ err }, '[drive] upload failed');
    }
  }

  let fileData: string | null = null;
  if (!storageUrl) {
    if (driveFileId) storageUrl = `https://drive.google.com/file/d/${driveFileId}/view`;
    else fileData = file.buffer.toString('base64');
  }

  if (replaceExisting && linkedId) {
    await pool.query('DELETE FROM documents WHERE linked_id=$1 AND category=$2', [linkedId, category]);
  }

  const { rows } = await pool.query(
    `INSERT INTO documents (linked_id, linked_name, div, name, display_name, category,
                            file_size, file_type, uploaded_by, storage_url, file_data)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING id, linked_id, linked_name, div, name, display_name, category, file_size,
               file_type, storage_url, uploaded_by, created_at`,
    [linkedId || null, linkedName || null, div, file.originalname, displayName, category,
     file.size, file.mimetype || '', uploadedBy, storageUrl || null, fileData]
  );
  return rows[0];
}
