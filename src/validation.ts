export const MAX_WEB_OBJECT_BYTES = 5 * 1024 * 1024;

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

export function isOverWebObjectLimit(contentLength: number | undefined): boolean {
  return contentLength != null && contentLength > MAX_WEB_OBJECT_BYTES;
}

export function webObjectLimitLabel(): string {
  return `${MAX_WEB_OBJECT_BYTES / 1024 / 1024} MiB`;
}
