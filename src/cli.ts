#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { getConfig, refreshAwsCredentialEnv, type GlobalOptions } from "./config.js";
import { createCredentialRefreshError, credentialErrorMessage, isCredentialError } from "./credentials.js";
import {
  confirm,
  fileSize,
  isTextKey,
  localPathFor,
  metadataPathFor,
  openEditor,
  readLocalFile,
  runDiff,
  safePathFor,
  writeFileEnsured,
} from "./file.js";
import {
  createS3Client,
  DEFAULT_LIST_OBJECT_LIMIT,
  downloadObject,
  headObject,
  listObjects,
  uploadObject,
  type ObjectMetadata,
} from "./s3.js";

type ParsedArgs = {
  command?: string;
  args: string[];
  options: GlobalOptions;
};

type CliDependencies = {
  getConfig: typeof getConfig;
  createS3Client: typeof createS3Client;
  refreshAwsCredentialEnv: typeof refreshAwsCredentialEnv;
  downloadObject: typeof downloadObject;
  headObject: typeof headObject;
  listObjects: typeof listObjects;
  uploadObject: typeof uploadObject;
  log: (message: string) => void;
  warn: (message: string) => void;
};

const defaultDependencies: CliDependencies = {
  getConfig,
  createS3Client,
  refreshAwsCredentialEnv,
  downloadObject,
  headObject,
  listObjects,
  uploadObject,
  log: (message) => console.log(message),
  warn: (message) => console.warn(message),
};

function usage(): string {
  return `
S3 File Manager

Usage:
  npm run s3 -- list [prefix]
  npm run s3 -- get <key> [--out <path>]
  npm run s3 -- show <key>
  npm run s3 -- diff <key>
  npm run s3 -- put <key> [--file <path>] [--yes]
  npm run s3 -- edit <key> [--yes]
  npm run s3 -- head <key>

Global options:
  --env <path>       Load env file. Defaults to .env.local then .env.
  --bucket <name>    Override S3_BUCKET.
  --endpoint <url>   Override S3_ENDPOINT.
  --region <name>    Override AWS_REGION.
  --workdir <path>   Override S3_TOOL_WORKDIR.
  --yes              Skip upload confirmation.
`.trim();
}

export function parseArgs(argv: string[]): ParsedArgs {
  const args: string[] = [];
  const options: GlobalOptions = { yes: false };

  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    const next = () => {
      const nextValue = argv[++i];
      if (!nextValue) throw new Error(`${value} requires a value.`);
      return nextValue;
    };

    switch (value) {
      case "--env":
        options.envFile = next();
        break;
      case "--bucket":
        options.bucket = next();
        break;
      case "--endpoint":
        options.endpoint = next();
        break;
      case "--region":
        options.region = next();
        break;
      case "--workdir":
        options.workDir = next();
        break;
      case "--yes":
      case "-y":
        options.yes = true;
        break;
      case "--help":
      case "-h":
        args.push("help");
        break;
      default:
        args.push(value);
        break;
    }
  }

  const [command, ...rest] = args;
  return { command, args: rest, options };
}

function optionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value) throw new Error(`${name} requires a value.`);
  args.splice(index, 2);
  return value;
}

function formatBytes(bytes?: number): string {
  if (bytes == null) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

function printMetadata(metadata: ObjectMetadata, log: (message: string) => void = console.log): void {
  log(`Key: ${metadata.key}`);
  log(`Content-Type: ${metadata.contentType ?? "-"}`);
  log(`Size: ${formatBytes(metadata.contentLength)}`);
  log(`ETag: ${metadata.etag ?? "-"}`);
  log(`LastModified: ${metadata.lastModified ?? "-"}`);
}

function saveMetadata(workDir: string, metadata: ObjectMetadata): void {
  const metadataPath = metadataPathFor(workDir, metadata.key);
  writeFileEnsured(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
}

function readSavedMetadata(workDir: string, key: string): ObjectMetadata | null {
  const metadataPath = metadataPathFor(workDir, key);
  if (!existsSync(metadataPath)) return null;
  return JSON.parse(readFileSync(metadataPath, "utf8")) as ObjectMetadata;
}

async function ensureDownloaded(
  withFreshS3: <T>(operation: () => Promise<T>) => Promise<T>,
  getClient: () => ReturnType<typeof createS3Client>,
  download: typeof downloadObject,
  bucket: string,
  workDir: string,
  key: string,
): Promise<{ path: string; metadata: ObjectMetadata }> {
  const { body, metadata } = await withFreshS3(() => download(getClient(), bucket, key));
  const path = localPathFor(workDir, key);
  writeFileEnsured(path, body);
  saveMetadata(workDir, metadata);
  return { path, metadata };
}

async function uploadWithChecks(
  withFreshS3: <T>(operation: () => Promise<T>) => Promise<T>,
  getClient: () => ReturnType<typeof createS3Client>,
  head: typeof headObject,
  upload: typeof uploadObject,
  log: (message: string) => void,
  warn: (message: string) => void,
  bucket: string,
  workDir: string,
  key: string,
  localPath: string,
  yes: boolean,
): Promise<void> {
  const saved = readSavedMetadata(workDir, key);
  if (saved?.etag) {
    const current = await withFreshS3(() => head(getClient(), bucket, key)).catch(() => null);
    if (current?.etag && current.etag !== saved.etag) {
      warn(`Warning: remote ETag changed since download.`);
      warn(`Downloaded: ${saved.etag}`);
      warn(`Current:    ${current.etag}`);
    }
  }

  log(`Upload target: s3://${bucket}/${key}`);
  log(`Local file: ${localPath}`);
  log(`Size: ${formatBytes(fileSize(localPath))}`);

  if (!yes && !(await confirm("Upload this file?"))) {
    log("Canceled.");
    return;
  }

  await withFreshS3(() => upload(getClient(), bucket, key, readLocalFile(localPath)));
  const metadata = await withFreshS3(() => head(getClient(), bucket, key));
  saveMetadata(workDir, metadata);
  log("Uploaded.");
}

export async function runCli(
  argv: string[],
  dependencies: Partial<CliDependencies> = {},
): Promise<void> {
  const deps: CliDependencies = { ...defaultDependencies, ...dependencies };
  const parsed = parseArgs(argv);
  if (!parsed.command || parsed.command === "help") {
    deps.log(usage());
    return;
  }

  const config = deps.getConfig(parsed.options);
  if (!config.bucket) {
    throw new Error("S3_BUCKET is required. Set it in .env or pass --bucket.");
  }
  const bucket = config.bucket;
  let client = deps.createS3Client(config);
  let credentialRefreshes = 0;
  async function withFreshS3<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (!isCredentialError(error)) throw error;

      credentialRefreshes += 1;
      client.destroy();
      deps.refreshAwsCredentialEnv(parsed.options.envFile);
      client = deps.createS3Client(config);
      deps.warn(`AWS credentials were refreshed. Retry count: ${credentialRefreshes}`);
      try {
        return await operation();
      } catch (retryError) {
        if (!isCredentialError(retryError)) throw retryError;
        deps.warn(`AWS credential refresh retry failed: ${credentialErrorMessage(retryError)}`);
        throw createCredentialRefreshError(retryError, credentialRefreshes);
      }
    }
  }
  const getClient = () => client;
  const commandArgs = [...parsed.args];

  switch (parsed.command) {
    case "list": {
      const prefix = commandArgs[0] ?? "";
      const { objects, isTruncated } = await withFreshS3(() => deps.listObjects(client, bucket, prefix));
      if (objects.length === 0) {
        deps.log("(no objects)");
        return;
      }
      for (const object of objects) {
        deps.log(`${object.Key}\t${formatBytes(object.Size)}\t${object.LastModified?.toISOString() ?? "-"}`);
      }
      if (isTruncated) {
        deps.warn(`List truncated at ${DEFAULT_LIST_OBJECT_LIMIT} objects. Narrow the prefix to see more.`);
      }
      return;
    }

    case "head": {
      const key = commandArgs[0];
      if (!key) throw new Error("head requires <key>.");
      printMetadata(await withFreshS3(() => deps.headObject(client, bucket, key)), deps.log);
      return;
    }

    case "get": {
      const out = optionValue(commandArgs, "--out");
      const key = commandArgs[0];
      if (!key) throw new Error("get requires <key>.");
      const { body, metadata } = await withFreshS3(() => deps.downloadObject(client, bucket, key));
      const path = out ?? localPathFor(config.workDir, key);
      writeFileEnsured(path, body);
      saveMetadata(config.workDir, metadata);
      deps.log(`Downloaded: ${path}`);
      printMetadata(metadata, deps.log);
      return;
    }

    case "show": {
      const key = commandArgs[0];
      if (!key) throw new Error("show requires <key>.");
      const { body, metadata } = await withFreshS3(() => deps.downloadObject(client, bucket, key));
      saveMetadata(config.workDir, metadata);
      if (!isTextKey(key, metadata.contentType)) {
        printMetadata(metadata, deps.log);
        deps.log("Binary-like object; content display skipped.");
        return;
      }
      deps.log(Buffer.from(body).toString("utf8"));
      return;
    }

    case "diff": {
      const key = commandArgs[0];
      if (!key) throw new Error("diff requires <key>.");
      const localPath = localPathFor(config.workDir, key);
      if (!existsSync(localPath)) {
        throw new Error(`Local file does not exist. Run get first: ${localPath}`);
      }
      const remotePath = join(config.workDir, "remote", basename(key));
      const { body } = await withFreshS3(() => deps.downloadObject(client, bucket, key));
      writeFileEnsured(remotePath, body);
      runDiff(remotePath, localPath);
      return;
    }

    case "put": {
      const file = optionValue(commandArgs, "--file");
      const key = commandArgs[0];
      if (!key) throw new Error("put requires <key>.");
      const localPath = file ?? localPathFor(config.workDir, key);
      if (!existsSync(localPath)) throw new Error(`Local file does not exist: ${localPath}`);
      await uploadWithChecks(
        withFreshS3,
        getClient,
        deps.headObject,
        deps.uploadObject,
        deps.log,
        deps.warn,
        bucket,
        config.workDir,
        key,
        localPath,
        parsed.options.yes,
      );
      return;
    }

    case "edit": {
      const key = commandArgs[0];
      if (!key) throw new Error("edit requires <key>.");
      const { path, metadata } = await ensureDownloaded(
        withFreshS3,
        getClient,
        deps.downloadObject,
        bucket,
        config.workDir,
        key,
      );
      if (!isTextKey(key, metadata.contentType)) {
        printMetadata(metadata, deps.log);
        throw new Error("Refusing to edit binary-like object.");
      }

      const beforePath = safePathFor(config.workDir, "before", key);
      writeFileEnsured(beforePath, readLocalFile(path));
      openEditor(config.editor, path);
      const diffStatus = runDiff(beforePath, path);
      if (diffStatus === 0) {
        console.log("No changes.");
        return;
      }
      await uploadWithChecks(
        withFreshS3,
        getClient,
        deps.headObject,
        deps.uploadObject,
        deps.log,
        deps.warn,
        bucket,
        config.workDir,
        key,
        path,
        parsed.options.yes,
      );
      return;
    }

    default:
      throw new Error(`Unknown command: ${parsed.command}\n\n${usage()}`);
  }
}

async function main(): Promise<void> {
  await runCli(process.argv.slice(2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
