import { google } from 'googleapis';
import { Readable } from 'stream';

export const ESTIMATING_ACTIVE_BIDS_ROOT    = '1hB2rjfRI40sTVgfzAMTu1Pb5APsDVxgy';
export const ESTIMATING_SUBMITTED_BIDS_ROOT = '1jiu8eGDMZSmpCABQRaAk8VufHOpaNzjJ';
export const ACTIVE_PROJECTS_ROOT           = '1Zn6eCS4QNf55G6hYRuffjmDgIqcY7fJI';
export const COMPLETED_PROJECTS_ROOT        = '1sKlj94D7kofCxK9Nxv50TLQNNlzxUJre';
export const GENERATOR_PROPOSALS_FOLDER     = '1FnUR5HJw3HunDBQR2I0-1ktk76L_GQih';
export const ACTIVE_GENERATOR_JOBS_ROOT     = '1PhG-nYeRMxCwYpiRsmSS6NkzW-aaJx8k';
export const COMPLETED_GENERATOR_JOBS_ROOT  = '1-H8fn_ZdZgsu0W-8GKAbZ-nSp83ftaGC';

export const GEN_SUBFOLDER_NAMES = ['Engineering', 'Permit', 'Contract', 'Invoices', 'Photos'];
export const BID_SUBFOLDER_NAMES = ['Plans', 'Bid Proposals'];
export const AWARD_SUBFOLDER_NAMES = ['Submittals', 'RFIs', 'Change Orders', 'Photos', 'Contract & Invoices'];
export const SUBFOLDER_NAMES = [...BID_SUBFOLDER_NAMES, ...AWARD_SUBFOLDER_NAMES];

function getCredentials(): Record<string, unknown> | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    console.error('[drive] GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON — Drive integration disabled');
    return null;
  }
}

function getDriveClient() {
  const credentials = getCredentials();
  if (!credentials) return null;
  try {
    const subject = process.env.GOOGLE_IMPERSONATE_EMAIL || undefined;
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/drive'],
      clientOptions: subject ? { subject } : undefined,
    });
    return google.drive({ version: 'v3', auth });
  } catch (err) {
    console.error('[drive] Failed to initialize Drive client:', err);
    return null;
  }
}

export function jobFolderName(name: string, loc?: string | null): string {
  const cleanLoc = (loc || '').trim();
  return cleanLoc && cleanLoc !== '—' ? `${name} — ${cleanLoc}` : name;
}

export async function renameFolder(folderId: string, newName: string): Promise<void> {
  const drive = getDriveClient();
  if (!drive) return;
  await drive.files.update({ fileId: folderId, requestBody: { name: newName }, fields: 'id' });
}

async function getOrCreateSubfolder(name: string, parentId: string): Promise<string | null> {
  const drive = getDriveClient();
  if (!drive) return null;
  const q = `name = ${JSON.stringify(name)} and mimeType = 'application/vnd.google-apps.folder' and '${parentId}' in parents and trashed = false`;
  const { data } = await drive.files.list({ q, fields: 'files(id)', pageSize: 1 });
  if (data.files?.length) return data.files[0].id!;
  const { data: created } = await drive.files.create({
    requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
    fields: 'id',
  });
  return created.id ?? null;
}

export async function createJobFolder(
  jobName: string,
  gcName: string,
  rootId: string,
): Promise<string | null> {
  const drive = getDriveClient();
  if (!drive) return null;
  const gcFolderId = await getOrCreateSubfolder(gcName, rootId);
  if (!gcFolderId) return null;
  const { data } = await drive.files.create({
    requestBody: { name: jobName, mimeType: 'application/vnd.google-apps.folder', parents: [gcFolderId] },
    fields: 'id',
  });
  return data.id ?? null;
}

export async function createCustomerFolder(customerName: string, rootId: string): Promise<string | null> {
  const drive = getDriveClient();
  if (!drive) return null;
  return getOrCreateSubfolder(customerName, rootId);
}

/** Find or create a named subfolder under parentId. Public wrapper for lazy folder creation. */
export async function ensureSubfolder(name: string, parentId: string): Promise<string | null> {
  return getOrCreateSubfolder(name, parentId);
}

/**
 * Stream a Drive file's bytes for proxying (image previews / downloads).
 * Returns null if Drive is not configured or the file is inaccessible.
 */
export async function getFileMedia(fileId: string): Promise<{ stream: Readable; mimeType: string; name: string } | null> {
  const drive = getDriveClient();
  if (!drive) return null;
  try {
    const meta = await drive.files.get({ fileId, fields: 'mimeType, name' });
    const resp = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });
    return {
      stream: resp.data as unknown as Readable,
      mimeType: (meta.data.mimeType as string) || 'application/octet-stream',
      name: (meta.data.name as string) || 'file',
    };
  } catch (err) {
    console.error('[drive] getFileMedia failed:', err);
    return null;
  }
}

export async function createSubfolders(parentId: string, names: string[] = SUBFOLDER_NAMES): Promise<Record<string, string>> {
  const drive = getDriveClient();
  if (!drive) return {};
  const result: Record<string, string> = {};
  for (const name of names) {
    try {
      const { data } = await drive.files.create({
        requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
        fields: 'id',
      });
      if (data.id) result[name] = data.id;
    } catch (err) {
      console.error(`[drive] createSubfolders failed for "${name}":`, err);
    }
  }
  return result;
}

async function moveToParent(fileId: string, newParentId: string): Promise<void> {
  const drive = getDriveClient();
  if (!drive) return;
  try {
    const { data } = await drive.files.get({ fileId, fields: 'parents' });
    const currentParents = (data.parents ?? []).join(',');
    await drive.files.update({
      fileId,
      addParents: newParentId,
      removeParents: currentParents || undefined,
      fields: 'id, parents',
    });
  } catch (err) {
    console.error(`[drive] moveToParent "${fileId}" → "${newParentId}" failed:`, err);
    throw err;
  }
}

export async function moveJobToStage(
  jobFolderId: string,
  gcName: string,
  destRootId: string,
): Promise<void> {
  const drive = getDriveClient();
  if (!drive) return;
  const gcSubfolderId = await getOrCreateSubfolder(gcName, destRootId);
  if (!gcSubfolderId) return;
  await moveToParent(jobFolderId, gcSubfolderId);
}

/** List files in a Drive folder. Returns empty array if Drive not configured or on error. */
export async function listFolderFiles(folderId: string): Promise<{
  id: string; name: string; mimeType: string;
  webViewLink?: string; thumbnailLink?: string; size?: string; createdTime?: string;
}[]> {
  const drive = getDriveClient();
  if (!drive) return [];
  try {
    const { data } = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'files(id,name,mimeType,webViewLink,thumbnailLink,size,createdTime)',
      orderBy: 'createdTime desc',
      pageSize: 100,
    });
    return (data.files ?? []) as { id: string; name: string; mimeType: string; webViewLink?: string; thumbnailLink?: string; size?: string; createdTime?: string; }[];
  } catch (err) {
    console.error('[drive] listFolderFiles failed:', err);
    return [];
  }
}

export async function uploadFile(
  name: string,
  mimeType: string,
  content: Buffer | string,
  parentId: string,
): Promise<string | null> {
  const drive = getDriveClient();
  if (!drive) return null;
  const body = Readable.from([content]);
  const { data } = await drive.files.create({
    requestBody: { name, mimeType, parents: [parentId] },
    media: { mimeType, body },
    fields: 'id',
  });
  return data.id ?? null;
}
