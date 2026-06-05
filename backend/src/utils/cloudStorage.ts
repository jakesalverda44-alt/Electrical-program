import { v2 as cloudinary } from 'cloudinary';
import { Readable } from 'stream';

export function isCloudStorageConfigured(): boolean {
  return !!(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  );
}

function configure() {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

/** Error from a cloud upload, carrying an HTTP status for the global handler. */
class CloudUploadError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = 'CloudUploadError';
    this.status = status;
  }
}

const CHUNK_SIZE = 6 * 1024 * 1024; // 6MB — above Cloudinary's 5MB chunk minimum

/**
 * Upload a file buffer to Cloudinary using chunked upload (handles large files).
 * Returns the secure URL on success.
 * Throws a CloudUploadError (with HTTP status) if configured but the upload fails.
 * Returns null if Cloudinary is not configured (caller falls back to DB).
 */
export async function uploadToCloud(
  buffer: Buffer,
  filename: string,
  _mimeType: string,
): Promise<string | null> {
  if (!isCloudStorageConfigured()) return null;
  configure();

  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_chunked_stream(
      {
        resource_type: 'raw',
        folder: 'crm-documents',
        use_filename: true,
        unique_filename: true,
        chunk_size: CHUNK_SIZE,
      },
      (error, result) => {
        if (error) {
          const raw = String((error as { message?: string })?.message || error);
          console.error('[cloudStorage] Cloudinary upload error:', JSON.stringify(error));
          const tooLarge = /too large|maximum is|file size|exceeds/i.test(raw);
          reject(tooLarge
            ? new CloudUploadError(
                'File exceeds the cloud storage size limit for this account. ' +
                'Upload a smaller file or raise the Cloudinary plan limit.',
                413,
              )
            : new CloudUploadError(`Cloud upload failed: ${raw}`));
        } else if (!result?.secure_url) {
          reject(new CloudUploadError('Cloud storage returned no URL'));
        } else {
          console.log(`[cloudStorage] Uploaded "${safeName}" → ${result.secure_url}`);
          resolve(result.secure_url);
        }
      },
    );
    Readable.from(buffer).pipe(stream);
  });
}

/** Delete a file from Cloudinary by its secure URL. Fire-and-forget safe. */
export async function deleteFromCloud(storageUrl: string): Promise<void> {
  if (!isCloudStorageConfigured() || !storageUrl) return;
  configure();
  try {
    const match = storageUrl.match(/\/upload\/(?:v\d+\/)?(.+)$/);
    if (!match) return;
    const publicId = match[1].replace(/\.[^/.]+$/, '');
    await cloudinary.uploader.destroy(publicId, { resource_type: 'raw' });
  } catch (err) {
    console.error('[cloudStorage] Delete failed:', err);
  }
}
