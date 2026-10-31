/**
 * Image upload rules for work attachments. The type comes from the file's own
 * bytes, never from the browser's claim, and SVG is not accepted (it can
 * carry script). Pure: shared by the upload action, the editor and tests.
 */

export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const ATTACHMENT_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
export type AttachmentType = (typeof ATTACHMENT_TYPES)[number];

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((x, i) => b[at + i] === x);

export function sniffImageType(b: Uint8Array): AttachmentType | null {
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(b, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(b, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  return null;
}

/** Why an upload is refused, or null when it's fine. */
export function attachmentProblem(size: number, type: AttachmentType | null): string | null {
  if (size === 0) return "That file is empty";
  if (size > ATTACHMENT_MAX_BYTES) return `Images can be up to ${ATTACHMENT_MAX_BYTES / 1024 / 1024} MB`;
  if (!type) return "Only PNG, JPEG, GIF or WebP images can be added";
  return null;
}
