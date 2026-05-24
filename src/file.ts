import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const TEXT_EXTENSIONS = new Set([
  ".css",
  ".csv",
  ".env",
  ".geojson",
  ".html",
  ".js",
  ".json",
  ".jsonl",
  ".jsx",
  ".md",
  ".mjs",
  ".ndjson",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".env": "text/plain; charset=utf-8",
  ".gif": "image/gif",
  ".geojson": "application/geo+json; charset=utf-8",
  ".gz": "application/gzip",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jsonl": "application/x-ndjson; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".ndjson": "application/x-ndjson; charset=utf-8",
  ".parquet": "application/vnd.apache.parquet",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".yaml": "application/yaml; charset=utf-8",
  ".yml": "application/yaml; charset=utf-8",
  ".avif": "image/avif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".pdf": "application/pdf",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".zip": "application/zip",
};

export function extensionOf(path: string): string {
  const match = path.toLowerCase().match(/(\.[a-z0-9]+)$/);
  return match?.[1] ?? "";
}

export function isTextKey(key: string, contentType?: string): boolean {
  if (contentType?.startsWith("text/")) return true;
  if (contentType?.includes("json") || contentType?.includes("xml") || contentType?.includes("yaml")) {
    return true;
  }
  return TEXT_EXTENSIONS.has(extensionOf(key));
}

export function contentTypeFor(path: string): string {
  return CONTENT_TYPES[extensionOf(path)] ?? "application/octet-stream";
}

export function safePathFor(workDir: string, scope: string, key: string): string {
  const root = resolve(workDir, scope);
  const path = resolve(root, key);
  const relativePath = relative(root, path);

  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`S3 key cannot be written outside the work directory: ${key}`);
  }

  return path;
}

export function localPathFor(workDir: string, key: string): string {
  return safePathFor(workDir, "objects", key);
}

export function metadataPathFor(workDir: string, key: string): string {
  const digest = createHash("sha256").update(key).digest("hex");
  return join(workDir, "metadata", `${digest}.json`);
}

export function ensureParent(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

export function writeFileEnsured(path: string, data: Uint8Array | string): void {
  ensureParent(path);
  writeFileSync(path, data);
}

export function readLocalFile(path: string): Buffer {
  return readFileSync(path);
}

export function fileSize(path: string): number {
  return statSync(path).size;
}

export function openEditor(editor: string, path: string): void {
  const [command, ...baseArgs] = editor.split(/\s+/).filter(Boolean);
  const result = spawnSync(command, [...baseArgs, path], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Editor exited with status ${result.status ?? "unknown"}.`);
  }
}

export function runDiff(beforePath: string, afterPath: string): number {
  const result = spawnSync("git", ["diff", "--no-index", "--", beforePath, afterPath], {
    stdio: "inherit",
  });
  return result.status ?? 1;
}

export async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(`${question} [y/N] `);
    return ["y", "yes"].includes(answer.trim().toLowerCase());
  } finally {
    rl.close();
  }
}
