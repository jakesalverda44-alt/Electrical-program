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

/**
 * Upload a file buffer to Cloudinary.
 * Returns the secure URL on success.
 * Throws if Cloudinary is configured but the upload fails.
 * Returns null if Cloudinary is not configured (caller falls back to DB).
 */
export async function uploadToCloud(
  buffer: Buffer,
  filename: string,
  mimeType: string,
): Promise<string | null> {
  if (!isCloudStorageConfigured()) return null;
  configure();

  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'raw',
        folder: 'crm-documents',
        use_filename: true,
        unique_filename: true,
      },
      (error, result) => {
        if (error) {
          console.error('[cloudStorage] Cloudinary upload error:', JSON.stringify(error));
          reject(new Error(`Cloudinary upload failed: ${error.message}`));
        } else if (!result?.secure_url) {
          reject(new Error('Cloudinary returned no URL'));
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
