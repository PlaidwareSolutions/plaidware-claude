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

// ---------------------------------------------------------------------------
// Files in an item's Attachments section (Jira's Attach)
// ---------------------------------------------------------------------------

export const FILE_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Accepted extensions → the Content-Type we store. The type comes from this
 * table, never the browser; images are still checked by their bytes. Nothing
 * here is served inline except those images (the route sends the rest as a
 * download), so a file can't run in the app's origin.
 */
export const FILE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
  txt: "text/plain",
  log: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  xml: "application/xml",
  zip: "application/zip",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  mp4: "video/mp4",
  mov: "video/quicktime",
};

/** The `accept` attribute for the file picker. */
export const FILE_ACCEPT = Object.keys(FILE_TYPES).map((e) => `.${e}`).join(",");

export function fileExtension(name: string): string {
  const m = /.([A-Za-z0-9]{1,8})$/.exec(name.trim());
  return m ? m[1].toLowerCase() : "";
}

/** The stored type for an attached file, or why it's refused. */
export function fileAttachmentType(name: string, bytes: Uint8Array): { type: string } | { problem: string } {
  if (bytes.byteLength === 0) return { problem: "That file is empty" };
  if (bytes.byteLength > FILE_MAX_BYTES) return { problem: `Files can be up to ${FILE_MAX_BYTES / 1024 / 1024} MB` };
  const type = FILE_TYPES[fileExtension(name)];
  if (!type) return { problem: "That file type can't be attached (images, PDF, Office, text, CSV, JSON, ZIP or video)" };
  // An image must really be the image it says it is: the route shows images inline.
  if (type.startsWith("image/") && sniffImageType(bytes) !== type) return { problem: "That image file is damaged or not what its name says" };
  return { type };
}

/** Shown inline (thumbnail, preview) only for images we verified. */
export function isInlineImage(contentType: string): boolean {
  return (ATTACHMENT_TYPES as readonly string[]).includes(contentType);
}

/** "2.4 MB", "830 KB", "12 B". */
export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(n >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}
