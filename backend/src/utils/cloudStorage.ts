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

/** Upload a file buffer to Cloudinary. Returns the secure URL, or null on failure. */
export async function uploadToCloud(
  buffer: Buffer,
  filename: string,
  mimeType: string,
): Promise<string | null> {
  if (!isCloudStorageConfigured()) return null;
  configure();

  return new Promise((resolve) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'raw',
        folder: 'crm-documents',
        use_filename: true,
        unique_filename: true,
        type: 'upload',
        // Preserve original filename in the public_id slug
        public_id: `crm-documents/${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`,
      },
      (err, result) => {
        if (err) {
          console.error('[cloudStorage] Upload failed:', err);
          resolve(null);
        } else {
          resolve(result?.secure_url ?? null);
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
    // Extract public_id from the URL: everything after /upload/ and before the extension
    const match = storageUrl.match(/\/upload\/(?:v\d+\/)?(.+)$/);
    if (!match) return;
    const publicId = match[1].replace(/\.[^/.]+$/, '');
    await cloudinary.uploader.destroy(publicId, { resource_type: 'raw' });
  } catch (err) {
    console.error('[cloudStorage] Delete failed:', err);
  }
}
