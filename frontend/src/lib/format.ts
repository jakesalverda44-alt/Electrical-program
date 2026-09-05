// Single source of truth for the file-size formatter (audit ux #14 / code
// review). 4 places each defined their own near-identical `fmtSize`.

/** Human file size: '512 B', '48 KB', '1.2 MB'. Returns '' for a falsy size. */
export function fmtSize(bytes: number | null | undefined): string {
  if (!bytes) return '';
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  if (bytes >= 1024) return Math.round(bytes / 1024) + ' KB';
  return bytes + ' B';
}
