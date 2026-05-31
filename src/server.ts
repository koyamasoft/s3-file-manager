#!/usr/bin/env node
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { basename, extname, isAbsolute, relative, resolve } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getConfig, refreshAwsCredentialEnv, type GlobalOptions, type ToolConfig } from "./config.js";
import { createCredentialRefreshError, credentialErrorMessage, isCredentialError } from "./credentials.js";
import { isTextKey } from "./file.js";
import {
  copyObject,
  createBucket,
  DEFAULT_LIST_OBJECT_LIMIT,
  bucketRegionFromError,
  createS3Client,
  downloadObject,
  getBucketRegion,
  getObjectForDownload,
  headObject,
  listBuckets,
  listObjects,
  uploadObject,
} from "./s3.js";
import {
  assertValidContentType,
  assertValidBucketName,
  isOverWebObjectLimit,
  webObjectLimitLabel,
} from "./validation.js";

export type ServerOptions = GlobalOptions & {
  port: number;
  allowWrite: boolean;
  allowCreateBucket: boolean;
};

type ServerDependencies = {
  createS3Client: typeof createS3Client;
  refreshAwsCredentialEnv: typeof refreshAwsCredentialEnv;
  copyObject: typeof copyObject;
  createBucket: typeof createBucket;
  downloadObject: typeof downloadObject;
  getBucketRegion: typeof getBucketRegion;
  getObjectForDownload: typeof getObjectForDownload;
  headObject: typeof headObject;
  listBuckets: typeof listBuckets;
  listObjects: typeof listObjects;
  uploadObject: typeof uploadObject;
  warn: (message: string) => void;
};

type JsonValue =
  | null
  | string
  | number
  | boolean
  | JsonValue[]
  | { [key: string]: JsonValue };

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const defaultDependencies: ServerDependencies = {
  createS3Client,
  refreshAwsCredentialEnv,
  copyObject,
  createBucket,
  downloadObject,
  getBucketRegion,
  getObjectForDownload,
  headObject,
  listBuckets,
  listObjects,
  uploadObject,
  warn: (message) => console.warn(message),
};

export function parseArgs(argv: string[]): ServerOptions {
  const options: ServerOptions = { yes: false, port: 5174, allowWrite: false, allowCreateBucket: false };

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
      case "--port":
        options.port = Number(next());
        if (!Number.isInteger(options.port) || options.port <= 0) {
          throw new Error("--port requires a positive integer.");
        }
        break;
      case "--allow-write":
        options.allowWrite = true;
        break;
      case "--allow-create-bucket":
        options.allowCreateBucket = true;
        break;
      default:
        throw new Error(`Unknown option: ${value}`);
    }
  }

  return options;
}

function webRoot(): string {
  const distDir = fileURLToPath(new URL(".", import.meta.url));
  const fromProjectRoot = resolve(process.cwd(), "src/web");
  if (existsSync(fromProjectRoot)) return fromProjectRoot;
  return resolve(distDir, "../src/web");
}

function sendJson(response: ServerResponse, status: number, body: JsonValue): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

function sendError(response: ServerResponse, status: number, error: unknown, config?: ToolConfig): void {
  const statusCode = typeof (error as { statusCode?: unknown })?.statusCode === "number"
    ? (error as { statusCode: number }).statusCode
    : status;
  const bucketRegion = config?.endpoint ? undefined : bucketRegionFromError(error);
  sendJson(response, statusCode, {
    error: error instanceof Error ? error.message : String(error),
    ...(bucketRegion && bucketRegion !== config?.region && {
      code: "BucketRegionMismatch",
      bucketRegion,
      currentRegion: config?.region ?? null,
    }),
  });
}

function readRequestBody(request: IncomingMessage): Promise<string> {
  return readRequestBuffer(request).then((body) => body.toString("utf8"));
}

function readRequestBuffer(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      size += chunk.length;
      if (size > 10 * 1024 * 1024) {
        request.destroy(new Error("Request body is too large."));
      }
    });
    request.on("end", () => resolveBody(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function formatObjectSize(size?: number): string {
  if (size == null) return "-";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`;
  return `${(size / 1024 / 1024).toFixed(1)} MiB`;
}

function bucketFromRequest(requestUrl: URL, fallback: string): string {
  return requestUrl.searchParams.get("bucket") || fallback;
}

function serveStatic(requestUrl: URL, response: ServerResponse): void {
  const root = webRoot();
  const rawPath = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const filePath = resolve(root, `.${decodeURIComponent(rawPath)}`);
  const relativePath = relative(root, filePath);

  if (relativePath.startsWith("..") || isAbsolute(relativePath) || !existsSync(filePath)) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  const ext = extname(filePath);
  response.writeHead(200, {
    "Content-Type": MIME_TYPES[ext] ?? "application/octet-stream",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(readFileSync(filePath));
}

function headerValue(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function sameToken(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function isAllowedLocalOrigin(origin: string | undefined, port: number): boolean {
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    const hostAllowed = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
    const portAllowed = parsed.port === String(port);
    return parsed.protocol === "http:" && hostAllowed && portAllowed;
  } catch {
    return false;
  }
}

function isAllowedHost(host: string | undefined, port: number): boolean {
  if (!host) return false;
  if (/[@/\\\s]/.test(host)) return false;
  try {
    const parsed = new URL(`http://${host}`);
    const hostAllowed = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
    const portAllowed = parsed.port === String(port);
    return hostAllowed && portAllowed;
  } catch {
    return false;
  }
}

function validateWriteRequest(request: IncomingMessage, port: number, csrfToken: string): boolean {
  const method = request.method ?? "GET";
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;

  const secFetchSite = headerValue(request, "sec-fetch-site");
  if (secFetchSite && secFetchSite !== "same-origin" && secFetchSite !== "none") return false;

  return isAllowedLocalOrigin(headerValue(request, "origin"), port) &&
    sameToken(headerValue(request, "x-s3fm-csrf"), csrfToken);
}

function isInlinePreviewContentType(contentType: string | undefined, key = ""): boolean {
  const normalized = contentType?.toLowerCase().split(";")[0].trim();
  return normalized === "image/jpeg" ||
    normalized === "image/png" ||
    normalized === "image/webp" ||
    normalized === "image/gif" ||
    normalized === "application/pdf" ||
    extname(key).toLowerCase() === ".pdf";
}

function attachmentName(key: string): string {
  return basename(key).replace(/[^\x20-\x7e]|["\\\r\n]/g, "_") || "object";
}

function contentDispositionAttachment(key: string): string {
  const fallback = attachmentName(key);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(basename(key) || "object")}`;
}

function assertValidRegion(region: string): void {
  if (!/^[a-z]{2}(?:-[a-z0-9]+)+-\d$/.test(region)) {
    throw Object.assign(new Error("region must be a valid AWS region name."), { statusCode: 400 });
  }
}

function assertWebObjectSize(contentLength: number | undefined, key: string): void {
  if (isOverWebObjectLimit(contentLength)) {
    throw Object.assign(
      new Error(`Object is too large for Web UI preview/editing: ${key}. Limit: ${webObjectLimitLabel()}.`),
      { statusCode: 413 },
    );
  }
}

async function existingObjectOrNull(
  operation: () => Promise<Awaited<ReturnType<typeof headObject>>>,
): Promise<Awaited<ReturnType<typeof headObject>> | null> {
  return await operation().catch((error: unknown) => {
    const namedError = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (
      namedError.name === "NotFound" ||
      namedError.name === "NoSuchKey" ||
      namedError.$metadata?.httpStatusCode === 404
    ) {
      return null;
    }
    throw error;
  });
}

function streamObjectBody(body: NonNullable<Awaited<ReturnType<typeof getObjectForDownload>>["Body"]>, response: ServerResponse): void {
  if ("pipe" in body && typeof body.pipe === "function") {
    body.pipe(response);
    return;
  }

  const webStream = body.transformToWebStream();
  Readable.fromWeb(webStream as Parameters<typeof Readable.fromWeb>[0]).pipe(response);
}

export function createRequestHandler({
  options,
  config,
  csrfToken = randomBytes(32).toString("hex"),
  dependencies = {},
}: {
  options: ServerOptions;
  config: ToolConfig;
  csrfToken?: string;
  dependencies?: Partial<ServerDependencies>;
}): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  const deps: ServerDependencies = { ...defaultDependencies, ...dependencies };
  let client = deps.createS3Client(config);
  let credentialRefreshes = 0;
  let clientResets = 0;

  function resetS3Client(): void {
    client.destroy();
    deps.refreshAwsCredentialEnv(options.envFile);
    client = deps.createS3Client(config);
    clientResets += 1;
  }

  async function withFreshS3<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (!isCredentialError(error)) throw error;

      credentialRefreshes += 1;
      resetS3Client();
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

  return async (request, response) => {
    try {
      if (!isAllowedHost(request.headers.host, options.port)) {
        sendJson(response, 403, { error: "Forbidden host." });
        return;
      }

      const host = request.headers.host ?? "127.0.0.1";
      const requestUrl = new URL(request.url ?? "/", `http://${host}`);

      if (request.method === "OPTIONS") {
        response.writeHead(204, {
          Allow: "GET, HEAD, POST, OPTIONS",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        });
        response.end();
        return;
      }

      if (!validateWriteRequest(request, options.port, csrfToken)) {
        sendJson(response, 403, { error: "Forbidden." });
        return;
      }

      if (requestUrl.pathname === "/api/config") {
        resetS3Client();
        sendJson(response, 200, {
          bucket: config.bucket ?? null,
          region: config.region,
          endpoint: config.endpoint ?? null,
          forcePathStyle: config.forcePathStyle,
          isAwsS3: !config.endpoint,
          allowWrite: options.allowWrite,
          allowCreateBucket: options.allowCreateBucket,
          credentialRefreshes,
          clientResets,
          csrfToken,
        });
        return;
      }

      if (requestUrl.pathname === "/api/region") {
        if (request.method !== "POST") {
          response.writeHead(405, { Allow: "POST" });
          response.end();
          return;
        }

        const rawBody = await readRequestBody(request);
        const parsed = JSON.parse(rawBody) as { region?: string };
        const region = parsed.region?.trim();
        if (!region) throw new Error("region is required.");
        assertValidRegion(region);
        config.region = region;
        resetS3Client();
        sendJson(response, 200, { region: config.region });
        return;
      }

      if (requestUrl.pathname === "/api/bucket-region") {
        const bucket = bucketFromRequest(requestUrl, config.bucket ?? "");
        if (!bucket) throw new Error("bucket is required.");
        assertValidBucketName(bucket);
        const region = config.endpoint
          ? config.region
          : await withFreshS3(() => deps.getBucketRegion(client, bucket));
        sendJson(response, 200, {
          bucket,
          region,
          currentRegion: config.region,
        });
        return;
      }

      if (requestUrl.pathname === "/api/buckets") {
        if (request.method === "POST") {
          if (!options.allowCreateBucket) {
            sendJson(response, 403, { error: "Bucket creation is disabled. Start with --allow-create-bucket to enable it." });
            return;
          }
          const rawBody = await readRequestBody(request);
          const parsed = JSON.parse(rawBody) as { bucket?: string };
          const bucket = parsed.bucket?.trim();
          if (!bucket) throw new Error("bucket is required.");
          assertValidBucketName(bucket);
          await withFreshS3(() => deps.createBucket(client, bucket, config.region, !!config.endpoint));
          sendJson(response, 200, { bucket });
          return;
        }

        const buckets = await withFreshS3(() => deps.listBuckets(client));
        sendJson(response, 200, {
          buckets: buckets.map((bucket) => ({
            name: bucket.Name ?? "",
            creationDate: bucket.CreationDate?.toISOString() ?? null,
          })).filter((bucket) => bucket.name),
        });
        return;
      }

      if (requestUrl.pathname === "/api/write-mode") {
        if (request.method !== "POST") {
          response.writeHead(405, { Allow: "POST" });
          response.end();
          return;
        }

        const rawBody = await readRequestBody(request);
        const parsed = JSON.parse(rawBody) as { allowWrite?: boolean };
        if (typeof parsed.allowWrite !== "boolean") {
          throw new Error("allowWrite is required.");
        }

        options.allowWrite = parsed.allowWrite;
        sendJson(response, 200, { allowWrite: options.allowWrite });
        return;
      }

      if (requestUrl.pathname === "/api/list") {
        const prefix = requestUrl.searchParams.get("prefix") ?? "";
        const continuationToken = requestUrl.searchParams.get("continuationToken") ?? undefined;
        const bucket = bucketFromRequest(requestUrl, config.bucket ?? "");
        if (!bucket) throw new Error("bucket is required.");
        const { objects, isTruncated, nextContinuationToken } = await withFreshS3(() =>
          deps.listObjects(client, bucket, prefix, DEFAULT_LIST_OBJECT_LIMIT, continuationToken)
        );
        sendJson(response, 200, {
          isTruncated,
          nextContinuationToken: nextContinuationToken ?? null,
          limit: DEFAULT_LIST_OBJECT_LIMIT,
          objects: objects.map((object) => ({
            key: object.Key ?? "",
            size: object.Size ?? 0,
            sizeLabel: formatObjectSize(object.Size),
            lastModified: object.LastModified?.toISOString() ?? null,
          })),
        });
        return;
      }

      if (requestUrl.pathname === "/api/object") {
        const key = requestUrl.searchParams.get("key");
        if (!key) throw new Error("key is required.");
        const bucket = bucketFromRequest(requestUrl, config.bucket ?? "");
        if (!bucket) throw new Error("bucket is required.");

        const metadataBeforeDownload = await withFreshS3(() => deps.headObject(client, bucket, key));
        assertWebObjectSize(metadataBeforeDownload.contentLength, key);
        const { body, metadata } = await withFreshS3(() => deps.downloadObject(client, bucket, key));
        assertWebObjectSize(body.byteLength, key);
        const text = isTextKey(key, metadata.contentType);
        sendJson(response, 200, {
          metadata,
          text,
          content: text ? Buffer.from(body).toString("utf8") : null,
        });
        return;
      }

      if (requestUrl.pathname === "/api/raw") {
        const key = requestUrl.searchParams.get("key");
        if (!key) throw new Error("key is required.");
        const bucket = bucketFromRequest(requestUrl, config.bucket ?? "");
        if (!bucket) throw new Error("bucket is required.");

        const metadataBeforeDownload = await withFreshS3(() => deps.headObject(client, bucket, key));
        assertWebObjectSize(metadataBeforeDownload.contentLength, key);
        const { body, metadata } = await withFreshS3(() => deps.downloadObject(client, bucket, key));
        assertWebObjectSize(body.byteLength, key);
        const normalizedContentType = metadata.contentType?.toLowerCase().split(";")[0].trim();
        const contentType = extname(key).toLowerCase() === ".pdf" &&
          (!normalizedContentType || !normalizedContentType.startsWith("image/"))
          ? "application/pdf"
          : metadata.contentType ?? "application/octet-stream";
        const inlinePreview = isInlinePreviewContentType(contentType, key);
        response.writeHead(200, {
          "Content-Type": inlinePreview ? contentType : "application/octet-stream",
          "Content-Disposition": inlinePreview ? "inline" : contentDispositionAttachment(key),
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        });
        response.end(Buffer.from(body));
        return;
      }

      if (requestUrl.pathname === "/api/download") {
        const key = requestUrl.searchParams.get("key");
        if (!key) throw new Error("key is required.");
        const bucket = bucketFromRequest(requestUrl, config.bucket ?? "");
        if (!bucket) throw new Error("bucket is required.");

        const result = await withFreshS3(() => deps.getObjectForDownload(client, bucket, key));
        if (!result.Body) throw new Error(`Object has no body: ${key}`);
        response.writeHead(200, {
          "Content-Type": result.ContentType ?? "application/octet-stream",
          "Content-Disposition": contentDispositionAttachment(key),
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          ...(result.ContentLength != null && { "Content-Length": String(result.ContentLength) }),
        });
        streamObjectBody(result.Body, response);
        return;
      }

      if (requestUrl.pathname === "/api/upload") {
        if (request.method !== "POST") {
          response.writeHead(405, { Allow: "POST" });
          response.end();
          return;
        }
        if (!options.allowWrite) {
          sendJson(response, 403, { error: "Writing is disabled. Start with --allow-write to enable uploads." });
          return;
        }

        const key = requestUrl.searchParams.get("key")?.trim().replace(/^\/+/, "");
        if (!key) throw new Error("key is required.");
        const bucket = bucketFromRequest(requestUrl, config.bucket ?? "");
        if (!bucket) throw new Error("bucket is required.");
        const force = requestUrl.searchParams.get("force") === "true" || requestUrl.searchParams.get("force") === "1";
        const contentType = headerValue(request, "content-type") || undefined;
        assertValidContentType(contentType);

        const current = await existingObjectOrNull(() => withFreshS3(() => deps.headObject(client, bucket, key)));
        if (current && !force) {
          sendJson(response, 409, {
            error: "Object already exists.",
            current,
          });
          return;
        }

        const body = await readRequestBuffer(request);
        await withFreshS3(() => deps.uploadObject(client, bucket, key, body, contentType));
        const metadata = await withFreshS3(() => deps.headObject(client, bucket, key));
        sendJson(response, 200, { metadata });
        return;
      }

      if (requestUrl.pathname === "/api/copy") {
        if (request.method !== "POST") {
          response.writeHead(405, { Allow: "POST" });
          response.end();
          return;
        }
        if (!options.allowWrite) {
          sendJson(response, 403, { error: "Writing is disabled. Start with --allow-write to enable object copy." });
          return;
        }

        const rawBody = await readRequestBody(request);
        const parsed = JSON.parse(rawBody) as {
          sourceKey?: string;
          targetKey?: string;
          bucket?: string;
          force?: boolean;
        };
        const sourceKey = parsed.sourceKey?.trim().replace(/^\/+/, "");
        const targetKey = parsed.targetKey?.trim().replace(/^\/+/, "");
        if (!sourceKey) throw new Error("sourceKey is required.");
        if (!targetKey) throw new Error("targetKey is required.");
        const bucket = parsed.bucket || config.bucket;
        if (!bucket) throw new Error("bucket is required.");

        const source = await existingObjectOrNull(() => withFreshS3(() => deps.headObject(client, bucket, sourceKey)));
        if (!source) {
          sendJson(response, 404, { error: "Source object does not exist." });
          return;
        }

        const current = await existingObjectOrNull(() => withFreshS3(() => deps.headObject(client, bucket, targetKey)));
        if (current && !parsed.force) {
          sendJson(response, 409, {
            error: "Object already exists.",
            current,
          });
          return;
        }

        await withFreshS3(() => deps.copyObject(client, bucket, sourceKey, targetKey));
        const metadata = await withFreshS3(() => deps.headObject(client, bucket, targetKey));
        sendJson(response, 200, { metadata });
        return;
      }

      if (requestUrl.pathname === "/api/save") {
        if (request.method !== "POST") {
          response.writeHead(405, { Allow: "POST" });
          response.end();
          return;
        }
        if (!options.allowWrite) {
          sendJson(response, 403, { error: "Writing is disabled. Start with --allow-write to enable uploads." });
          return;
        }

        const rawBody = await readRequestBody(request);
        const parsed = JSON.parse(rawBody) as {
          key?: string;
          content?: string;
          etag?: string;
          force?: boolean;
          contentType?: string;
          bucket?: string;
          create?: boolean;
        };
        if (!parsed.key) throw new Error("key is required.");
        if (typeof parsed.content !== "string") throw new Error("content is required.");
        assertValidContentType(parsed.contentType);

        const key = parsed.key;
        const content = parsed.content;
        const bucket = parsed.bucket || config.bucket;
        if (!bucket) throw new Error("bucket is required.");
        const current = await existingObjectOrNull(() => withFreshS3(() => deps.headObject(client, bucket, key)));

        if (parsed.create && current && !parsed.force) {
          sendJson(response, 409, {
            error: "Object already exists.",
            current,
          });
          return;
        }

        if (!parsed.create && !current) {
          sendJson(response, 404, { error: "Object does not exist." });
          return;
        }

        if (!parsed.force && parsed.etag && current?.etag && parsed.etag !== current.etag) {
          sendJson(response, 409, {
            error: "Remote object changed after it was opened.",
            current,
          });
          return;
        }

        await withFreshS3(() =>
          deps.uploadObject(
            client,
            bucket,
            key,
            Buffer.from(content, "utf8"),
            parsed.contentType ?? current?.contentType,
          ),
        );
        const metadata = await withFreshS3(() => deps.headObject(client, bucket, key));
        sendJson(response, 200, { metadata });
        return;
      }

      if (requestUrl.pathname.startsWith("/api/")) {
        sendJson(response, 404, { error: "API not found." });
        return;
      }

      serveStatic(requestUrl, response);
    } catch (error) {
      sendError(response, 500, error, config);
    }
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const config = getConfig(options, false);
  const server = createServer(createRequestHandler({ options, config }));

  server.listen(options.port, "127.0.0.1", () => {
    console.log(`S3 File Manager Web UI: http://127.0.0.1:${options.port}`);
    console.log(`Bucket: ${config.bucket ?? "(select in Web UI)"}`);
    console.log(`Endpoint: ${config.endpoint ?? "AWS S3"}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
