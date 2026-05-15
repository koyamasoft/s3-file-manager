#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { getConfig, type GlobalOptions } from "./config.js";
import {
  confirm,
  fileSize,
  isTextKey,
  localPathFor,
  metadataPathFor,
  openEditor,
  readLocalFile,
  runDiff,
  writeFileEnsured,
} from "./file.js";
import {
  createS3Client,
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

function parseArgs(argv: string[]): ParsedArgs {
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

function printMetadata(metadata: ObjectMetadata): void {
  console.log(`Key: ${metadata.key}`);
  console.log(`Content-Type: ${metadata.contentType ?? "-"}`);
  console.log(`Size: ${formatBytes(metadata.contentLength)}`);
  console.log(`ETag: ${metadata.etag ?? "-"}`);
  console.log(`LastModified: ${metadata.lastModified ?? "-"}`);
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
  client: ReturnType<typeof createS3Client>,
  bucket: string,
  workDir: string,
  key: string,
): Promise<{ path: string; metadata: ObjectMetadata }> {
  const { body, metadata } = await downloadObject(client, bucket, key);
  const path = localPathFor(workDir, key);
  writeFileEnsured(path, body);
  saveMetadata(workDir, metadata);
  return { path, metadata };
}

async function uploadWithChecks(
  client: ReturnType<typeof createS3Client>,
  bucket: string,
  workDir: string,
  key: string,
  localPath: string,
  yes: boolean,
): Promise<void> {
  const saved = readSavedMetadata(workDir, key);
  if (saved?.etag) {
    const current = await headObject(client, bucket, key).catch(() => null);
    if (current?.etag && current.etag !== saved.etag) {
      console.warn(`Warning: remote ETag changed since download.`);
      console.warn(`Downloaded: ${saved.etag}`);
      console.warn(`Current:    ${current.etag}`);
    }
  }

  console.log(`Upload target: s3://${bucket}/${key}`);
  console.log(`Local file: ${localPath}`);
  console.log(`Size: ${formatBytes(fileSize(localPath))}`);

  if (!yes && !(await confirm("Upload this file?"))) {
    console.log("Canceled.");
    return;
  }

  await uploadObject(client, bucket, key, readLocalFile(localPath));
  const metadata = await headObject(client, bucket, key);
  saveMetadata(workDir, metadata);
  console.log("Uploaded.");
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.command || parsed.command === "help") {
    console.log(usage());
    return;
  }

  const config = getConfig(parsed.options);
  if (!config.bucket) {
    throw new Error("S3_BUCKET is required. Set it in .env or pass --bucket.");
  }
  const client = createS3Client(config);
  const commandArgs = [...parsed.args];

  switch (parsed.command) {
    case "list": {
      const prefix = commandArgs[0] ?? "";
      const objects = await listObjects(client, config.bucket, prefix);
      if (objects.length === 0) {
        console.log("(no objects)");
        return;
      }
      for (const object of objects) {
        console.log(`${object.Key}\t${formatBytes(object.Size)}\t${object.LastModified?.toISOString() ?? "-"}`);
      }
      return;
    }

    case "head": {
      const key = commandArgs[0];
      if (!key) throw new Error("head requires <key>.");
      printMetadata(await headObject(client, config.bucket, key));
      return;
    }

    case "get": {
      const out = optionValue(commandArgs, "--out");
      const key = commandArgs[0];
      if (!key) throw new Error("get requires <key>.");
      const { body, metadata } = await downloadObject(client, config.bucket, key);
      const path = out ?? localPathFor(config.workDir, key);
      writeFileEnsured(path, body);
      saveMetadata(config.workDir, metadata);
      console.log(`Downloaded: ${path}`);
      printMetadata(metadata);
      return;
    }

    case "show": {
      const key = commandArgs[0];
      if (!key) throw new Error("show requires <key>.");
      const { body, metadata } = await downloadObject(client, config.bucket, key);
      saveMetadata(config.workDir, metadata);
      if (!isTextKey(key, metadata.contentType)) {
        printMetadata(metadata);
        console.log("Binary-like object; content display skipped.");
        return;
      }
      console.log(Buffer.from(body).toString("utf8"));
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
      const { body } = await downloadObject(client, config.bucket, key);
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
      await uploadWithChecks(client, config.bucket, config.workDir, key, localPath, parsed.options.yes);
      return;
    }

    case "edit": {
      const key = commandArgs[0];
      if (!key) throw new Error("edit requires <key>.");
      const { path, metadata } = await ensureDownloaded(client, config.bucket, config.workDir, key);
      if (!isTextKey(key, metadata.contentType)) {
        printMetadata(metadata);
        throw new Error("Refusing to edit binary-like object.");
      }

      const beforePath = join(config.workDir, "before", key);
      writeFileEnsured(beforePath, readLocalFile(path));
      openEditor(config.editor, path);
      const diffStatus = runDiff(beforePath, path);
      if (diffStatus === 0) {
        console.log("No changes.");
        return;
      }
      await uploadWithChecks(client, config.bucket, config.workDir, key, path, parsed.options.yes);
      return;
    }

    default:
      throw new Error(`Unknown command: ${parsed.command}\n\n${usage()}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
