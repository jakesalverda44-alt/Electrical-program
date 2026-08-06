import { describe, it, expect, beforeEach, vi } from 'vitest';

const files = {
  create: vi.fn().mockResolvedValue({ data: { id: 'new-id' } }),
  update: vi.fn().mockResolvedValue({ data: { id: 'moved-id', parents: ['p'] } }),
  get: vi.fn().mockResolvedValue({ data: { parents: ['old-parent'], mimeType: 'application/pdf', name: 'f.pdf' } }),
  list: vi.fn().mockResolvedValue({ data: { files: [] } }),
};

vi.mock('googleapis', () => ({
  google: {
    auth: { GoogleAuth: class { } },
    drive: () => ({ files }),
  },
}));

/**
 * Every folder the app writes to lives in a Shared Drive. Without `supportsAllDrives`
 * the Drive API treats a create as a My Drive create, which a service account cannot
 * do — it fails with `storageQuotaExceeded: Service Accounts do not have storage
 * quota`. Listings additionally need `includeItemsFromAllDrives` or they come back
 * empty. These are easy to drop when adding a call, so assert them on every one.
 */
describe('googleDrive shared-drive support', () => {
  beforeEach(() => {
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: 'x@y.iam.gserviceaccount.com' });
    for (const fn of Object.values(files)) fn.mockClear();
  });

  it('uploadFile sends supportsAllDrives', async () => {
    const { uploadFile } = await import('./googleDrive');
    await uploadFile('a.pdf', 'application/pdf', Buffer.from('x'), 'parent-1');
    expect(files.create.mock.calls[0][0]).toMatchObject({ supportsAllDrives: true });
  });

  it('folder creation and lookup send the shared-drive params', async () => {
    const { ensureSubfolder } = await import('./googleDrive');
    await ensureSubfolder('Permit', 'parent-1');
    expect(files.list.mock.calls[0][0]).toMatchObject({
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    expect(files.create.mock.calls[0][0]).toMatchObject({ supportsAllDrives: true });
  });

  it('listFolderFiles sends supportsAllDrives and includeItemsFromAllDrives', async () => {
    const { listFolderFiles } = await import('./googleDrive');
    await listFolderFiles('folder-1');
    expect(files.list.mock.calls[0][0]).toMatchObject({
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
  });

  it('renameFolder sends supportsAllDrives', async () => {
    const { renameFolder } = await import('./googleDrive');
    await renameFolder('folder-1', 'New Name');
    expect(files.update.mock.calls[0][0]).toMatchObject({ supportsAllDrives: true });
  });

  it('moving a job between stages sends supportsAllDrives on both the get and the update', async () => {
    files.list.mockResolvedValueOnce({ data: { files: [{ id: 'gc-folder' }] } });
    const { moveJobToStage } = await import('./googleDrive');
    await moveJobToStage('job-1', 'Some GC', 'dest-root');
    expect(files.get.mock.calls[0][0]).toMatchObject({ supportsAllDrives: true });
    expect(files.update.mock.calls[0][0]).toMatchObject({ supportsAllDrives: true });
  });

  it('getFileMedia sends supportsAllDrives on the metadata and media reads', async () => {
    const { getFileMedia } = await import('./googleDrive');
    await getFileMedia('file-1');
    expect(files.get.mock.calls[0][0]).toMatchObject({ supportsAllDrives: true });
    expect(files.get.mock.calls[1][0]).toMatchObject({ supportsAllDrives: true, alt: 'media' });
  });

  it('createSubfolders sends supportsAllDrives for each subfolder', async () => {
    const { createSubfolders } = await import('./googleDrive');
    await createSubfolders('parent-1', ['Plans', 'Photos']);
    expect(files.create).toHaveBeenCalledTimes(2);
    for (const call of files.create.mock.calls) {
      expect(call[0]).toMatchObject({ supportsAllDrives: true });
    }
  });

  it('createJobFolder sends supportsAllDrives on the GC folder and the job folder', async () => {
    const { createJobFolder } = await import('./googleDrive');
    await createJobFolder('Job A', 'Some GC', 'root-1');
    expect(files.create).toHaveBeenCalledTimes(2);
    for (const call of files.create.mock.calls) {
      expect(call[0]).toMatchObject({ supportsAllDrives: true });
    }
  });
});
