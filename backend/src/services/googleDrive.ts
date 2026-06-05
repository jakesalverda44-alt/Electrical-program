import { google } from 'googleapis';
import { Readable } from 'stream';

const GC_RELATIONSHIPS_ROOT          = '1TuBiAIXefVdtsmEBWIThdpjKZ081viZQ';
export const ACTIVE_PROJECTS_ROOT    = '1Zn6eCS4QNf55G6hYRuffjmDgIqcY7fJI';
export const COMPLETED_PROJECTS_ROOT = '1sKlj94D7kofCxK9Nxv50TLQNNlzxUJre';
export const GENERATOR_PROPOSALS_FOLDER = '1FnUR5HJw3HunDBQR2I0-1ktk76L_GQih';

export const SUBFOLDER_NAMES = [
  'Plans & Specs',
  'Estimates & Scope Extractions',
  'Submittals',
  'RFIs',
  'Change Orders',
  'Photos',
  'Contract & Invoices',
];

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
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/drive.file'],
    });
    return google.drive({ version: 'v3', auth });
  } catch (err) {
    console.error('[drive] Failed to initialize Drive client:', err);
    return null;
  }
}

export async function getOrCreateGcFolder(gcName: string): Promise<string | null> {
  const drive = getDriveClient();
  if (!drive) return null;
  try {
    const q = `name = ${JSON.stringify(gcName)} and mimeType = 'application/vnd.google-apps.folder' and '${GC_RELATIONSHIPS_ROOT}' in parents and trashed = false`;
    const { data } = await drive.files.list({ q, fields: 'files(id)', pageSize: 1 });
    if (data.files?.length) return data.files[0].id!;

    const { data: created } = await drive.files.create({
      requestBody: { name: gcName, mimeType: 'application/vnd.google-apps.folder', parents: [GC_RELATIONSHIPS_ROOT] },
      fields: 'id',
    });
    return created.id ?? null;
  } catch (err) {
    console.error('[drive] getOrCreateGcFolder failed:', err);
    return null;
  }
}

export async function createJobFolder(jobName: string, gcName: string): Promise<string | null> {
  const drive = getDriveClient();
  if (!drive) return null;
  try {
    const name = `${jobName} — ${gcName}`;
    const { data } = await drive.files.create({
      requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [ACTIVE_PROJECTS_ROOT] },
      fields: 'id',
    });
    return data.id ?? null;
  } catch (err) {
    console.error('[drive] createJobFolder failed:', err);
    return null;
  }
}

export async function createSubfolders(parentId: string): Promise<Record<string, string>> {
  const drive = getDriveClient();
  if (!drive) return {};
  const result: Record<string, string> = {};
  for (const name of SUBFOLDER_NAMES) {
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

export async function uploadFile(
  name: string,
  mimeType: string,
  content: Buffer | string,
  parentId: string,
): Promise<string | null> {
  const drive = getDriveClient();
  if (!drive) return null;
  try {
    const body = typeof content === 'string' ? Readable.from([content]) : Readable.from([content]);
    const { data } = await drive.files.create({
      requestBody: { name, mimeType, parents: [parentId] },
      media: { mimeType, body },
      fields: 'id',
    });
    return data.id ?? null;
  } catch (err) {
    console.error(`[drive] uploadFile "${name}" failed:`, err);
    return null;
  }
}

export async function moveFolder(
  fileId: string,
  fromParentId: string,
  toParentId: string,
): Promise<void> {
  const drive = getDriveClient();
  if (!drive) return;
  try {
    await drive.files.update({
      fileId,
      addParents: toParentId,
      removeParents: fromParentId,
      fields: 'id, parents',
    });
  } catch (err) {
    console.error(`[drive] moveFolder "${fileId}" failed:`, err);
  }
}
