#!/usr/bin/env node
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getConfig, type GlobalOptions } from "./config.js";
import { isTextKey } from "./file.js";
import {
  createBucket,
  createS3Client,
  downloadObject,
  headObject,
  listBuckets,
  listObjects,
  uploadObject,
} from "./s3.js";

type ServerOptions = GlobalOptions & {
  port: number;
  allowWrite: boolean;
  allowCreateBucket: boolean;
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

function parseArgs(argv: string[]): ServerOptions {
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

function sendError(response: ServerResponse, status: number, error: unknown): void {
  sendJson(response, status, {
    error: error instanceof Error ? error.message : String(error),
  });
}

function readRequestBody(request: IncomingMessage): Promise<string> {
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
    request.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
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

  if (!filePath.startsWith(root) || !existsSync(filePath)) {
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

function validateWriteRequest(request: IncomingMessage, port: number, csrfToken: string): boolean {
  const method = request.method ?? "GET";
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;

  const secFetchSite = headerValue(request, "sec-fetch-site");
  if (secFetchSite && secFetchSite !== "same-origin" && secFetchSite !== "none") return false;

  return isAllowedLocalOrigin(headerValue(request, "origin"), port) &&
    sameToken(headerValue(request, "x-s3fm-csrf"), csrfToken);
}

function isInlinePreviewContentType(contentType: string | undefined): boolean {
  const normalized = contentType?.toLowerCase().split(";")[0].trim();
  return normalized === "image/jpeg" ||
    normalized === "image/png" ||
    normalized === "image/webp" ||
    normalized === "image/gif";
}

function attachmentName(key: string): string {
  return basename(key).replace(/["\\\r\n]/g, "_") || "object";
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const config = getConfig(options, false);
  const client = createS3Client(config);
  const csrfToken = randomBytes(32).toString("hex");

  const server = createServer(async (request, response) => {
    const host = request.headers.host ?? "127.0.0.1";
    const requestUrl = new URL(request.url ?? "/", `http://${host}`);

    try {
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
        sendJson(response, 200, {
          bucket: config.bucket ?? null,
          region: config.region,
          endpoint: config.endpoint ?? null,
          forcePathStyle: config.forcePathStyle,
          isAwsS3: !config.endpoint,
          allowWrite: options.allowWrite,
          allowCreateBucket: options.allowCreateBucket,
          csrfToken,
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
          await createBucket(client, bucket, config.region, !!config.endpoint);
          sendJson(response, 200, { bucket });
          return;
        }

        const buckets = await listBuckets(client);
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
        const bucket = bucketFromRequest(requestUrl, config.bucket ?? "");
        if (!bucket) throw new Error("bucket is required.");
        const objects = await listObjects(client, bucket, prefix);
        sendJson(response, 200, {
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

        const { body, metadata } = await downloadObject(client, bucket, key);
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

        const { body, metadata } = await downloadObject(client, bucket, key);
        const contentType = metadata.contentType ?? "application/octet-stream";
        const inlinePreview = isInlinePreviewContentType(contentType);
        response.writeHead(200, {
          "Content-Type": inlinePreview ? contentType : "application/octet-stream",
          "Content-Disposition": inlinePreview ? "inline" : `attachment; filename="${attachmentName(key)}"`,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        });
        response.end(Buffer.from(body));
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

        const bucket = parsed.bucket || config.bucket;
        if (!bucket) throw new Error("bucket is required.");
        const current = await headObject(client, bucket, parsed.key).catch((error: unknown) => {
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

        await uploadObject(
          client,
          bucket,
          parsed.key,
          Buffer.from(parsed.content, "utf8"),
          parsed.contentType ?? current?.contentType,
        );
        const metadata = await headObject(client, bucket, parsed.key);
        sendJson(response, 200, { metadata });
        return;
      }

      if (requestUrl.pathname.startsWith("/api/")) {
        sendJson(response, 404, { error: "API not found." });
        return;
      }

      serveStatic(requestUrl, response);
    } catch (error) {
      sendError(response, 500, error);
    }
  });

  server.listen(options.port, "127.0.0.1", () => {
    console.log(`S3 File Manager Web UI: http://127.0.0.1:${options.port}`);
    console.log(`Bucket: ${config.bucket ?? "(select in Web UI)"}`);
    console.log(`Endpoint: ${config.endpoint ?? "AWS S3"}`);
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
