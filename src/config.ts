import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export type ToolConfig = {
  region: string;
  bucket?: string;
  endpoint?: string;
  forcePathStyle: boolean;
  workDir: string;
  editor: string;
};

export type GlobalOptions = {
  envFile?: string;
  bucket?: string;
  endpoint?: string;
  region?: string;
  workDir?: string;
  yes: boolean;
};

function parseEnvLine(line: string): [string, string] | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const equals = trimmed.indexOf("=");
  if (equals < 1) return null;

  const key = trimmed.slice(0, equals).trim();
  let value = trimmed.slice(equals + 1).trim();
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return [key, value];
}

export function loadEnvFile(envFile?: string): void {
  loadEnvValues(envFile, false);
}

function loadEnvValues(envFile: string | undefined, overwrite: boolean, keys?: Set<string>): void {
  const candidates = envFile ? [envFile] : [".env.local", ".env"];
  for (const candidate of candidates) {
    const path = resolve(candidate);
    if (!existsSync(path)) continue;

    const content = readFileSync(path, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const parsed = parseEnvLine(line);
      if (!parsed) continue;
      const [key, value] = parsed;
      if (keys && !keys.has(key)) continue;
      if (overwrite) {
        process.env[key] = value;
      } else {
        process.env[key] ??= value;
      }
    }
    if (envFile) return;
  }
}

export function refreshAwsCredentialEnv(envFile?: string): void {
  loadEnvValues(envFile, true, new Set([
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "AWS_PROFILE",
    "AWS_REGION",
    "AWS_DEFAULT_REGION",
  ]));
}

function envBool(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export function getConfig(options: GlobalOptions, requireBucket = true): ToolConfig {
  loadEnvFile(options.envFile);

  const bucket = options.bucket ?? process.env.S3_BUCKET;
  if (requireBucket && !bucket) {
    throw new Error("S3_BUCKET is required. Set it in .env or pass --bucket.");
  }

  const endpoint = options.endpoint ?? process.env.S3_ENDPOINT;
  return {
    region: options.region ?? process.env.AWS_REGION ?? "ap-northeast-1",
    bucket,
    endpoint: endpoint || undefined,
    forcePathStyle: envBool("S3_FORCE_PATH_STYLE", !!endpoint),
    workDir: options.workDir ?? process.env.S3_TOOL_WORKDIR ?? ".s3-work",
    editor: process.env.EDITOR ?? "vi",
  };
}
