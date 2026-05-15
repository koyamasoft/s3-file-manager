import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const TEXT_EXTENSIONS = new Set([
  ".css",
  ".csv",
  ".env",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
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
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".yaml": "application/yaml; charset=utf-8",
  ".yml": "application/yaml; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
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

export function localPathFor(workDir: string, key: string): string {
  return join(workDir, "objects", key);
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
