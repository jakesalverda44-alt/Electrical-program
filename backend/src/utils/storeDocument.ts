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
import { mimeTypeForFilename } from './upload';

export const CATEGORY_TO_FOLDER: Record<string, string> = {
  plans:          'drive_plans_folder_id',
  permit:         'drive_plans_folder_id',
  contract:       'drive_contracts_folder_id',
  invoice:        'drive_contracts_folder_id',
  proposal:       'drive_estimates_folder_id',
  takeoff:        'drive_estimates_folder_id',
  // Phase 3 Task 6 — the composed BidData filed alongside the docx/xlsx so
  // the desktop APT_Bid_System and the CRM stay interchangeable.
  bid_data:       'drive_estimates_folder_id',
  cost_breakdown: 'drive_estimates_folder_id',
  prebid_takeoff: 'drive_estimates_folder_id',
  prebid_scope:   'drive_estimates_folder_id',
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
  /**
   * FIX-3 (post-review) — mark this row as having passed the bid-standard
   * verify gate (`verifyBid.ts`) before being filed. Set ONLY by the Phase 3
   * generate-* routes (generate-docx, generate-takeoff-xlsx,
   * generate-prebid-package), and only after their own gate has passed —
   * every other caller of storeDocument (manual uploads, import-bid,
   * notify-team attachments, etc.) leaves this at its default `false`.
   * draft-proposal (the Outlook draft that attaches this document — see
   * routes/bids.ts) only ever considers gate_passed=true rows, so a
   * document that was never verified — including one filed under
   * category='proposal' by something other than generate-docx — can never
   * reach a GC.
   */
  gatePassed?: boolean;
  /** Takeoff accuracy fix round 1 / B5 — the analysis run a generated GC /
   *  pre-bid document was composed from; only a document from the CURRENT
   *  run is ever attached to an email. */
  takeoffRunId?: string | null;
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

  // SAFETY: under test, never touch real cloud storage — always take the
  // base64-in-row path. Same class of guard as graphMailer's email mute: a
  // full-suite run from a checkout with real Cloudinary/Drive creds in .env
  // was uploading test artifacts to production storage (found 2026-09-03).
  const cloudMuted = process.env.NODE_ENV === 'test' || process.env.CLOUD_STORAGE_DISABLED === 'true';

  // The client's declared multipart Content-Type for the upload is attacker-controlled
  // and must never be persisted or handed to a storage provider — derive the type
  // from the filename extension instead (audit: Security #6, High).
  const safeMimeType = mimeTypeForFilename(file.originalname);

  const driveFolderId = !cloudMuted && linkedId ? await resolveDriveFolder(linkedId, div, category) : null;

  let storageUrl: string | null = null;
  if (!cloudMuted && isCloudStorageConfigured()) {
    try {
      storageUrl = await uploadToCloud(file.buffer, file.originalname, safeMimeType);
    } catch (err) {
      logger.warn({ err }, '[cloudStorage] upload rejected — using Drive/DB fallback');
    }
  }

  let driveFileId: string | null = null;
  if (driveFolderId) {
    try {
      driveFileId = await uploadFile(displayName, safeMimeType, file.buffer, driveFolderId);
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
                            file_size, file_type, uploaded_by, storage_url, file_data, gate_passed, takeoff_run_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING id, linked_id, linked_name, div, name, display_name, category, file_size,
               file_type, storage_url, uploaded_by, created_at, gate_passed`,
    [linkedId || null, linkedName || null, div, file.originalname, displayName, category,
     file.size, safeMimeType, uploadedBy, storageUrl || null, fileData, !!input.gatePassed, input.takeoffRunId ?? null]
  );
  return rows[0];
}
