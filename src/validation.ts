export const MAX_WEB_OBJECT_BYTES = 5 * 1024 * 1024;
const MAX_CONTENT_TYPE_LENGTH = 200;
const MIME_TOKEN = "[A-Za-z0-9!#$&^_.+-]+";
const CONTENT_TYPE_PATTERN = new RegExp(
  `^${MIME_TOKEN}/${MIME_TOKEN}(?:\\s*;\\s*${MIME_TOKEN}=[^;\\r\\n]+)*$`,
);

export function isValidBucketName(name: string): boolean {
  return /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(name) &&
    !name.includes("..") &&
    !name.includes(".-") &&
    !name.includes("-.") &&
    !/^\d+\.\d+\.\d+\.\d+$/.test(name);
}

export function assertValidBucketName(name: string): void {
  if (!isValidBucketName(name)) {
    throw Object.assign(
      new Error("Bucket name must be 3-63 characters using lowercase letters, numbers, dots, or hyphens."),
      { statusCode: 400 },
    );
  }
}

export function isValidContentType(contentType: string): boolean {
  const value = contentType.trim();
  return value.length > 0 &&
    value.length <= MAX_CONTENT_TYPE_LENGTH &&
    CONTENT_TYPE_PATTERN.test(value);
}

export function assertValidContentType(contentType: string | undefined): void {
  if (contentType == null || contentType === "") return;
  if (!isValidContentType(contentType)) {
    throw Object.assign(
      new Error("Content-Type must be a valid MIME type."),
      { statusCode: 400 },
    );
  }
}

export function isOverWebObjectLimit(contentLength: number | undefined): boolean {
  return contentLength != null && contentLength > MAX_WEB_OBJECT_BYTES;
}

export function webObjectLimitLabel(): string {
  return `${MAX_WEB_OBJECT_BYTES / 1024 / 1024} MiB`;
}
