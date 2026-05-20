import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import { createRequestHandler, parseArgs as parseServerArgs, type ServerOptions } from "./server.js";
import type { ToolConfig } from "./config.js";
import type { ObjectMetadata } from "./s3.js";
import { MAX_WEB_OBJECT_BYTES } from "./validation.js";

type TestResponse = {
  statusCode: number;
  body: string;
  headers: Record<string, string | string[] | undefined>;
  json: Record<string, unknown>;
};

type RawTestResponse = Omit<TestResponse, "json">;

type TestRequestOptions = {
  method?: string;
  host?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
};

const baseConfig: ToolConfig = {
  region: "ap-northeast-1",
  bucket: undefined,
  endpoint: undefined,
  forcePathStyle: false,
  workDir: ".s3-work",
  editor: "vi",
};

function baseOptions(): ServerOptions {
  return {
    yes: false,
    port: 0,
    allowWrite: false,
    allowCreateBucket: false,
  };
}

function fakeClient() {
  return { destroy() {} };
}

function metadata(key: string, etag = "\"current\""): ObjectMetadata {
  return {
    key,
    etag,
    contentType: "text/plain",
    contentLength: 5,
    lastModified: "2026-05-20T00:00:00.000Z",
  };
}

function missingObjectError(): Error {
  return Object.assign(new Error("not found"), {
    name: "NoSuchKey",
    $metadata: { httpStatusCode: 404 },
  });
}

function writeHeaders(port: number): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-S3FM-CSRF": "test-token",
    Origin: `http://127.0.0.1:${port}`,
  };
}

async function startTestServer(
  options: ServerOptions,
  parameters: Parameters<typeof createRequestHandler>[0],
): Promise<{ server: Server; port: number }> {
  const server = createServer(createRequestHandler(parameters));
  await new Promise<void>((resolveListen) => {
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const port = (server.address() as AddressInfo).port;
  options.port = port;
  return { server, port };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolveClose();
    });
  });
}

async function requestJson(
  port: number,
  path: string,
  options: TestRequestOptions = {},
): Promise<TestResponse> {
  const response = await requestRaw(port, path, options);
  return {
    ...response,
    json: JSON.parse(response.body) as Record<string, unknown>,
  };
}

async function requestRaw(
  port: number,
  path: string,
  options: TestRequestOptions = {},
): Promise<RawTestResponse> {
  const body = options.body ?? "";
  const bodyLength = typeof body === "string" ? Buffer.byteLength(body) : body.byteLength;
  return await new Promise<RawTestResponse>((resolveRequest, reject) => {
    const request = httpRequest({
      hostname: "127.0.0.1",
      port,
      path,
      method: options.method ?? "GET",
      headers: {
        Host: options.host ?? `127.0.0.1:${port}`,
        ...(bodyLength > 0 && { "Content-Length": String(bodyLength) }),
        ...options.headers,
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        resolveRequest({
          statusCode: response.statusCode ?? 0,
          body,
          headers: response.headers,
        });
      });
    });
    request.on("error", reject);
    if (bodyLength > 0) request.write(body);
    request.end();
  });
}

test("server rejects untrusted Host headers before serving API responses", async () => {
  const options = baseOptions();
  const { server, port } = await startTestServer(options, {
    options,
    config: baseConfig,
    csrfToken: "test-token",
    dependencies: {
      createS3Client: () => fakeClient() as never,
    },
  });

  try {
    const allowed = await requestJson(port, "/api/config");
    assert.equal(allowed.statusCode, 200);

    const evilHost = await requestJson(port, "/api/config", { host: `evil.example:${port}` });
    assert.equal(evilHost.statusCode, 403);
    assert.equal(evilHost.json.error, "Forbidden host.");

    const confusingHost = await requestJson(port, "/api/config", { host: `evil@localhost:${port}` });
    assert.equal(confusingHost.statusCode, 403);
    assert.equal(confusingHost.json.error, "Forbidden host.");
  } finally {
    await closeServer(server);
  }
});

test("server parses Web UI startup options", () => {
  assert.deepEqual(parseServerArgs([
    "--allow-write",
    "--allow-create-bucket",
    "--port",
    "7777",
    "--bucket",
    "my-bucket",
  ]), {
    yes: false,
    port: 7777,
    allowWrite: true,
    allowCreateBucket: true,
    bucket: "my-bucket",
  });

  assert.throws(
    () => parseServerArgs(["--port", "not-a-number"]),
    /--port requires a positive integer/,
  );
  assert.throws(
    () => parseServerArgs(["--unknown"]),
    /Unknown option: --unknown/,
  );
});

test("server requires CSRF token for write-mode changes", async () => {
  const options = baseOptions();
  const { server, port } = await startTestServer(options, {
    options,
    config: baseConfig,
    csrfToken: "test-token",
    dependencies: {
      createS3Client: () => fakeClient() as never,
    },
  });

  try {
    const body = JSON.stringify({ allowWrite: true });
    const missingToken = await requestJson(port, "/api/write-mode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    assert.equal(missingToken.statusCode, 403);
    assert.equal(missingToken.json.error, "Forbidden.");

    const wrongToken = await requestJson(port, "/api/write-mode", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-S3FM-CSRF": "wrong-token",
      },
      body,
    });
    assert.equal(wrongToken.statusCode, 403);
    assert.equal(wrongToken.json.error, "Forbidden.");

    const validToken = await requestJson(port, "/api/write-mode", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-S3FM-CSRF": "test-token",
      },
      body,
    });
    assert.equal(validToken.statusCode, 200);
    assert.equal(validToken.json.allowWrite, true);
  } finally {
    await closeServer(server);
  }
});

test("server checks local Origin for write requests", async () => {
  const options = baseOptions();
  const { server, port } = await startTestServer(options, {
    options,
    config: baseConfig,
    csrfToken: "test-token",
    dependencies: {
      createS3Client: () => fakeClient() as never,
    },
  });

  try {
    const body = JSON.stringify({ allowWrite: true });
    const evilOrigin = await requestJson(port, "/api/write-mode", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-S3FM-CSRF": "test-token",
        Origin: "http://evil.example",
      },
      body,
    });
    assert.equal(evilOrigin.statusCode, 403);
    assert.equal(evilOrigin.json.error, "Forbidden.");

    const localOrigin = await requestJson(port, "/api/write-mode", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-S3FM-CSRF": "test-token",
        Origin: `http://127.0.0.1:${port}`,
      },
      body,
    });
    assert.equal(localOrigin.statusCode, 200);
    assert.equal(localOrigin.json.allowWrite, true);
  } finally {
    await closeServer(server);
  }
});

test("server checks Sec-Fetch-Site for write requests", async () => {
  const options = baseOptions();
  const { server, port } = await startTestServer(options, {
    options,
    config: baseConfig,
    csrfToken: "test-token",
    dependencies: {
      createS3Client: () => fakeClient() as never,
    },
  });

  try {
    const body = JSON.stringify({ allowWrite: true });
    const crossSite = await requestJson(port, "/api/write-mode", {
      method: "POST",
      headers: {
        ...writeHeaders(port),
        "Sec-Fetch-Site": "cross-site",
      },
      body,
    });
    assert.equal(crossSite.statusCode, 403);
    assert.equal(crossSite.json.error, "Forbidden.");

    const sameOrigin = await requestJson(port, "/api/write-mode", {
      method: "POST",
      headers: {
        ...writeHeaders(port),
        "Sec-Fetch-Site": "same-origin",
      },
      body,
    });
    assert.equal(sameOrigin.statusCode, 200);
    assert.equal(sameOrigin.json.allowWrite, true);

    const none = await requestJson(port, "/api/write-mode", {
      method: "POST",
      headers: {
        ...writeHeaders(port),
        "Sec-Fetch-Site": "none",
      },
      body: JSON.stringify({ allowWrite: false }),
    });
    assert.equal(none.statusCode, 200);
    assert.equal(none.json.allowWrite, false);
  } finally {
    await closeServer(server);
  }
});

test("server rejects /api/save when writing is disabled", async () => {
  const options = baseOptions();
  let uploads = 0;
  const { server, port } = await startTestServer(options, {
    options,
    config: { ...baseConfig, bucket: "my-bucket" },
    csrfToken: "test-token",
    dependencies: {
      createS3Client: () => fakeClient() as never,
      uploadObject: async () => {
        uploads += 1;
      },
    },
  });

  try {
    const response = await requestJson(port, "/api/save", {
      method: "POST",
      headers: writeHeaders(port),
      body: JSON.stringify({ key: "notes/readme.txt", content: "hello", etag: "\"current\"" }),
    });

    assert.equal(response.statusCode, 403);
    assert.equal(response.json.error, "Writing is disabled. Start with --allow-write to enable uploads.");
    assert.equal(uploads, 0);
  } finally {
    await closeServer(server);
  }
});

test("server rejects /api/save when the remote ETag changed", async () => {
  const options = { ...baseOptions(), allowWrite: true };
  let uploads = 0;
  const { server, port } = await startTestServer(options, {
    options,
    config: { ...baseConfig, bucket: "my-bucket" },
    csrfToken: "test-token",
    dependencies: {
      createS3Client: () => fakeClient() as never,
      headObject: async (_client, _bucket, key) => metadata(key, "\"remote\""),
      uploadObject: async () => {
        uploads += 1;
      },
    },
  });

  try {
    const response = await requestJson(port, "/api/save", {
      method: "POST",
      headers: writeHeaders(port),
      body: JSON.stringify({ key: "notes/readme.txt", content: "hello", etag: "\"opened\"" }),
    });

    assert.equal(response.statusCode, 409);
    assert.equal(response.json.error, "Remote object changed after it was opened.");
    assert.deepEqual(response.json.current, metadata("notes/readme.txt", "\"remote\""));
    assert.equal(uploads, 0);
  } finally {
    await closeServer(server);
  }
});

test("server rejects create saves when the object already exists", async () => {
  const options = { ...baseOptions(), allowWrite: true };
  let uploads = 0;
  const { server, port } = await startTestServer(options, {
    options,
    config: { ...baseConfig, bucket: "my-bucket" },
    csrfToken: "test-token",
    dependencies: {
      createS3Client: () => fakeClient() as never,
      headObject: async (_client, _bucket, key) => metadata(key),
      uploadObject: async () => {
        uploads += 1;
      },
    },
  });

  try {
    const response = await requestJson(port, "/api/save", {
      method: "POST",
      headers: writeHeaders(port),
      body: JSON.stringify({ key: "notes/new.txt", content: "hello", create: true }),
    });

    assert.equal(response.statusCode, 409);
    assert.equal(response.json.error, "Object already exists.");
    assert.deepEqual(response.json.current, metadata("notes/new.txt"));
    assert.equal(uploads, 0);
  } finally {
    await closeServer(server);
  }
});

test("server rejects invalid Content-Type on /api/save before uploading", async () => {
  const options = { ...baseOptions(), allowWrite: true };
  let heads = 0;
  let uploads = 0;
  const { server, port } = await startTestServer(options, {
    options,
    config: { ...baseConfig, bucket: "my-bucket" },
    csrfToken: "test-token",
    dependencies: {
      createS3Client: () => fakeClient() as never,
      headObject: async (_client, _bucket, key) => {
        heads += 1;
        return metadata(key);
      },
      uploadObject: async () => {
        uploads += 1;
      },
    },
  });

  try {
    const response = await requestJson(port, "/api/save", {
      method: "POST",
      headers: writeHeaders(port),
      body: JSON.stringify({
        key: "notes/readme.txt",
        content: "hello",
        contentType: "text/plain\r\nx-injected: yes",
      }),
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json.error, "Content-Type must be a valid MIME type.");
    assert.equal(heads, 0);
    assert.equal(uploads, 0);
  } finally {
    await closeServer(server);
  }
});

test("server uploads local file bytes through /api/upload", async () => {
  const options = { ...baseOptions(), allowWrite: true };
  let heads = 0;
  const uploaded: unknown[] = [];
  const { server, port } = await startTestServer(options, {
    options,
    config: { ...baseConfig, bucket: "my-bucket" },
    csrfToken: "test-token",
    dependencies: {
      createS3Client: () => fakeClient() as never,
      headObject: async (_client, _bucket, key) => {
        heads += 1;
        if (heads === 1) throw missingObjectError();
        return metadata(key, "\"uploaded\"");
      },
      uploadObject: async (_client, bucket, key, body, contentType) => {
        uploaded.push([bucket, key, body.toString("utf8"), contentType]);
      },
    },
  });

  try {
    const response = await requestJson(port, "/api/upload?bucket=my-bucket&key=notes%2Fupload.txt", {
      method: "POST",
      headers: {
        ...writeHeaders(port),
        "Content-Type": "text/plain",
      },
      body: Buffer.from("hello upload"),
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(uploaded, [["my-bucket", "notes/upload.txt", "hello upload", "text/plain"]]);
    assert.deepEqual(response.json.metadata, metadata("notes/upload.txt", "\"uploaded\""));
  } finally {
    await closeServer(server);
  }
});

test("server preserves binary bytes and normalizes leading slashes on /api/upload keys", async () => {
  const options = { ...baseOptions(), allowWrite: true };
  let heads = 0;
  const uploaded: unknown[] = [];
  const { server, port } = await startTestServer(options, {
    options,
    config: { ...baseConfig, bucket: "my-bucket" },
    csrfToken: "test-token",
    dependencies: {
      createS3Client: () => fakeClient() as never,
      headObject: async (_client, _bucket, key) => {
        heads += 1;
        if (heads === 1) throw missingObjectError();
        return metadata(key, "\"uploaded\"");
      },
      uploadObject: async (_client, bucket, key, body, contentType) => {
        uploaded.push([bucket, key, [...body], contentType]);
      },
    },
  });

  try {
    const body = Buffer.from([0, 1, 2, 127, 128, 255]);
    const response = await requestJson(port, "/api/upload?bucket=my-bucket&key=%2Fimages%2Fraw.bin", {
      method: "POST",
      headers: {
        ...writeHeaders(port),
        "Content-Type": "application/octet-stream",
      },
      body,
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(uploaded, [["my-bucket", "images/raw.bin", [0, 1, 2, 127, 128, 255], "application/octet-stream"]]);
    assert.deepEqual(response.json.metadata, metadata("images/raw.bin", "\"uploaded\""));
  } finally {
    await closeServer(server);
  }
});

test("server requires CSRF and local request context for /api/upload", async () => {
  const options = { ...baseOptions(), allowWrite: true };
  let heads = 0;
  let uploads = 0;
  const { server, port } = await startTestServer(options, {
    options,
    config: { ...baseConfig, bucket: "my-bucket" },
    csrfToken: "test-token",
    dependencies: {
      createS3Client: () => fakeClient() as never,
      headObject: async (_client, _bucket, key) => {
        heads += 1;
        return metadata(key);
      },
      uploadObject: async () => {
        uploads += 1;
      },
    },
  });

  try {
    const missingToken = await requestJson(port, "/api/upload?key=notes%2Fupload.txt", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: Buffer.from("hello"),
    });
    assert.equal(missingToken.statusCode, 403);
    assert.equal(missingToken.json.error, "Forbidden.");

    const wrongOrigin = await requestJson(port, "/api/upload?key=notes%2Fupload.txt", {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        "X-S3FM-CSRF": "test-token",
        Origin: "http://evil.example",
      },
      body: Buffer.from("hello"),
    });
    assert.equal(wrongOrigin.statusCode, 403);
    assert.equal(wrongOrigin.json.error, "Forbidden.");

    const crossSite = await requestJson(port, "/api/upload?key=notes%2Fupload.txt", {
      method: "POST",
      headers: {
        ...writeHeaders(port),
        "Sec-Fetch-Site": "cross-site",
      },
      body: Buffer.from("hello"),
    });
    assert.equal(crossSite.statusCode, 403);
    assert.equal(crossSite.json.error, "Forbidden.");

    assert.equal(heads, 0);
    assert.equal(uploads, 0);
  } finally {
    await closeServer(server);
  }
});

test("server rejects /api/upload when writing is disabled", async () => {
  const options = baseOptions();
  let uploads = 0;
  const { server, port } = await startTestServer(options, {
    options,
    config: { ...baseConfig, bucket: "my-bucket" },
    csrfToken: "test-token",
    dependencies: {
      createS3Client: () => fakeClient() as never,
      uploadObject: async () => {
        uploads += 1;
      },
    },
  });

  try {
    const response = await requestJson(port, "/api/upload?key=notes%2Fupload.txt", {
      method: "POST",
      headers: writeHeaders(port),
      body: Buffer.from("hello"),
    });

    assert.equal(response.statusCode, 403);
    assert.equal(response.json.error, "Writing is disabled. Start with --allow-write to enable uploads.");
    assert.equal(uploads, 0);
  } finally {
    await closeServer(server);
  }
});

test("server rejects /api/upload when object exists unless forced", async () => {
  const options = { ...baseOptions(), allowWrite: true };
  const uploaded: unknown[] = [];
  const { server, port } = await startTestServer(options, {
    options,
    config: { ...baseConfig, bucket: "my-bucket" },
    csrfToken: "test-token",
    dependencies: {
      createS3Client: () => fakeClient() as never,
      headObject: async (_client, _bucket, key) => metadata(key),
      uploadObject: async (_client, bucket, key, body, contentType) => {
        uploaded.push([bucket, key, body.toString("utf8"), contentType]);
      },
    },
  });

  try {
    const conflict = await requestJson(port, "/api/upload?key=notes%2Fupload.txt", {
      method: "POST",
      headers: writeHeaders(port),
      body: Buffer.from("hello"),
    });

    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.json.error, "Object already exists.");
    assert.deepEqual(uploaded, []);

    const forced = await requestJson(port, "/api/upload?key=notes%2Fupload.txt&force=true", {
      method: "POST",
      headers: {
        ...writeHeaders(port),
        "Content-Type": "application/octet-stream",
      },
      body: Buffer.from("hello"),
    });

    assert.equal(forced.statusCode, 200);
    assert.deepEqual(uploaded, [["my-bucket", "notes/upload.txt", "hello", "application/octet-stream"]]);
  } finally {
    await closeServer(server);
  }
});

test("server rejects invalid Content-Type on /api/upload before reading the body", async () => {
  const options = { ...baseOptions(), allowWrite: true };
  let heads = 0;
  let uploads = 0;
  const { server, port } = await startTestServer(options, {
    options,
    config: { ...baseConfig, bucket: "my-bucket" },
    csrfToken: "test-token",
    dependencies: {
      createS3Client: () => fakeClient() as never,
      headObject: async (_client, _bucket, key) => {
        heads += 1;
        return metadata(key);
      },
      uploadObject: async () => {
        uploads += 1;
      },
    },
  });

  try {
    const response = await requestJson(port, "/api/upload?key=notes%2Fupload.txt", {
      method: "POST",
      headers: {
        ...writeHeaders(port),
        "Content-Type": "not-a-mime-type",
      },
      body: Buffer.from("hello"),
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json.error, "Content-Type must be a valid MIME type.");
    assert.equal(heads, 0);
    assert.equal(uploads, 0);
  } finally {
    await closeServer(server);
  }
});

test("server rejects request bodies over the write request limit", async () => {
  const options = baseOptions();
  const { server, port } = await startTestServer(options, {
    options,
    config: baseConfig,
    csrfToken: "test-token",
    dependencies: {
      createS3Client: () => fakeClient() as never,
    },
  });

  try {
    await assert.rejects(
      () => requestRaw(port, "/api/write-mode", {
        method: "POST",
        headers: writeHeaders(port),
        body: "x".repeat(10 * 1024 * 1024 + 1),
      }),
      /socket hang up|ECONNRESET|Request body is too large/,
    );
  } finally {
    await closeServer(server);
  }
});

test("server allows forced /api/save over an ETag mismatch", async () => {
  const options = { ...baseOptions(), allowWrite: true };
  const uploaded: unknown[] = [];
  const { server, port } = await startTestServer(options, {
    options,
    config: { ...baseConfig, bucket: "my-bucket" },
    csrfToken: "test-token",
    dependencies: {
      createS3Client: () => fakeClient() as never,
      headObject: async (_client, _bucket, key) => metadata(key, "\"remote\""),
      uploadObject: async (_client, bucket, key, body, contentType) => {
        uploaded.push([bucket, key, body.toString("utf8"), contentType]);
      },
    },
  });

  try {
    const response = await requestJson(port, "/api/save", {
      method: "POST",
      headers: writeHeaders(port),
      body: JSON.stringify({
        key: "notes/readme.txt",
        content: "hello",
        etag: "\"opened\"",
        force: true,
        contentType: "text/markdown",
      }),
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(uploaded, [["my-bucket", "notes/readme.txt", "hello", "text/markdown"]]);
    assert.deepEqual(response.json.metadata, metadata("notes/readme.txt", "\"remote\""));
  } finally {
    await closeServer(server);
  }
});

test("server allows forced create saves over an existing object", async () => {
  const options = { ...baseOptions(), allowWrite: true };
  let uploads = 0;
  const { server, port } = await startTestServer(options, {
    options,
    config: { ...baseConfig, bucket: "my-bucket" },
    csrfToken: "test-token",
    dependencies: {
      createS3Client: () => fakeClient() as never,
      headObject: async (_client, _bucket, key) => metadata(key),
      uploadObject: async () => {
        uploads += 1;
      },
    },
  });

  try {
    const response = await requestJson(port, "/api/save", {
      method: "POST",
      headers: writeHeaders(port),
      body: JSON.stringify({
        key: "notes/new.txt",
        content: "hello",
        create: true,
        force: true,
      }),
    });

    assert.equal(response.statusCode, 200);
    assert.equal(uploads, 1);
    assert.deepEqual(response.json.metadata, metadata("notes/new.txt"));
  } finally {
    await closeServer(server);
  }
});

test("server rejects oversized objects from /api/object and /api/raw before downloading", async () => {
  const options = baseOptions();
  let downloads = 0;
  const { server, port } = await startTestServer(options, {
    options,
    config: { ...baseConfig, bucket: "my-bucket" },
    csrfToken: "test-token",
    dependencies: {
      createS3Client: () => fakeClient() as never,
      headObject: async (_client, _bucket, key) => ({
        ...metadata(key),
        contentLength: MAX_WEB_OBJECT_BYTES + 1,
      }),
      downloadObject: async () => {
        downloads += 1;
        return { body: Buffer.from("too late"), metadata: metadata("large.txt") };
      },
    },
  });

  try {
    const objectResponse = await requestJson(port, "/api/object?key=large.txt");
    assert.equal(objectResponse.statusCode, 413);
    assert.match(String(objectResponse.json.error), /Object is too large/);

    const rawResponse = await requestJson(port, "/api/raw?key=large.txt");
    assert.equal(rawResponse.statusCode, 413);
    assert.match(String(rawResponse.json.error), /Object is too large/);

    assert.equal(downloads, 0);
  } finally {
    await closeServer(server);
  }
});

test("server returns text content from /api/object only for editable object types", async () => {
  const options = baseOptions();
  const downloads: string[] = [];
  const { server, port } = await startTestServer(options, {
    options,
    config: { ...baseConfig, bucket: "my-bucket" },
    csrfToken: "test-token",
    dependencies: {
      createS3Client: () => fakeClient() as never,
      headObject: async (_client, _bucket, key) => metadata(key),
      downloadObject: async (_client, _bucket, key) => {
        downloads.push(key);
        const contentType = key.endsWith(".png") ? "image/png" : "application/json";
        return {
          body: Buffer.from(key.endsWith(".png") ? "png-bytes" : "{\"ok\":true}"),
          metadata: { ...metadata(key), contentType },
        };
      },
    },
  });

  try {
    const textResponse = await requestJson(port, "/api/object?key=data.json");
    assert.equal(textResponse.statusCode, 200);
    assert.equal(textResponse.json.text, true);
    assert.equal(textResponse.json.content, "{\"ok\":true}");

    const binaryResponse = await requestJson(port, "/api/object?key=image.png");
    assert.equal(binaryResponse.statusCode, 200);
    assert.equal(binaryResponse.json.text, false);
    assert.equal(binaryResponse.json.content, null);

    assert.deepEqual(downloads, ["data.json", "image.png"]);
  } finally {
    await closeServer(server);
  }
});

test("server chooses inline or attachment disposition for /api/raw by content type", async () => {
  const options = baseOptions();
  const { server, port } = await startTestServer(options, {
    options,
    config: { ...baseConfig, bucket: "my-bucket" },
    csrfToken: "test-token",
    dependencies: {
      createS3Client: () => fakeClient() as never,
      headObject: async (_client, _bucket, key) => metadata(key),
      downloadObject: async (_client, _bucket, key) => ({
        body: Buffer.from(key.endsWith(".png") ? "png-bytes" : "text"),
        metadata: {
          ...metadata(key),
          contentType: key.endsWith(".png") ? "image/png" : "text/plain",
        },
      }),
    },
  });

  try {
    const inline = await requestRaw(port, "/api/raw?key=image.png");
    assert.equal(inline.statusCode, 200);
    assert.equal(inline.headers["content-type"], "image/png");
    assert.equal(inline.headers["content-disposition"], "inline");

    const attachment = await requestRaw(port, "/api/raw?key=note.txt");
    assert.equal(attachment.statusCode, 200);
    assert.equal(attachment.headers["content-type"], "application/octet-stream");
    assert.equal(attachment.headers["content-disposition"], "attachment; filename=\"note.txt\"");
  } finally {
    await closeServer(server);
  }
});

test("server guards bucket creation by option and bucket name validation", async () => {
  const disabledOptions = baseOptions();
  let disabledCreates = 0;
  const disabled = await startTestServer(disabledOptions, {
    options: disabledOptions,
    config: baseConfig,
    csrfToken: "test-token",
    dependencies: {
      createS3Client: () => fakeClient() as never,
      createBucket: async () => {
        disabledCreates += 1;
      },
    },
  });

  try {
    const disabledResponse = await requestJson(disabled.port, "/api/buckets", {
      method: "POST",
      headers: writeHeaders(disabled.port),
      body: JSON.stringify({ bucket: "valid-bucket" }),
    });

    assert.equal(disabledResponse.statusCode, 403);
    assert.equal(
      disabledResponse.json.error,
      "Bucket creation is disabled. Start with --allow-create-bucket to enable it.",
    );
    assert.equal(disabledCreates, 0);
  } finally {
    await closeServer(disabled.server);
  }

  const enabledOptions = { ...baseOptions(), allowCreateBucket: true };
  const created: unknown[] = [];
  const enabled = await startTestServer(enabledOptions, {
    options: enabledOptions,
    config: { ...baseConfig, endpoint: "http://127.0.0.1:9000" },
    csrfToken: "test-token",
    dependencies: {
      createS3Client: () => fakeClient() as never,
      createBucket: async (_client, bucket, region, isCustomEndpoint) => {
        created.push([bucket, region, isCustomEndpoint]);
      },
    },
  });

  try {
    const invalidResponse = await requestJson(enabled.port, "/api/buckets", {
      method: "POST",
      headers: writeHeaders(enabled.port),
      body: JSON.stringify({ bucket: "Bad_Bucket" }),
    });

    assert.equal(invalidResponse.statusCode, 400);
    assert.match(String(invalidResponse.json.error), /Bucket name must be/);
    assert.deepEqual(created, []);

    const validResponse = await requestJson(enabled.port, "/api/buckets", {
      method: "POST",
      headers: writeHeaders(enabled.port),
      body: JSON.stringify({ bucket: "  valid-bucket  " }),
    });

    assert.equal(validResponse.statusCode, 200);
    assert.equal(validResponse.json.bucket, "valid-bucket");
    assert.deepEqual(created, [["valid-bucket", "ap-northeast-1", true]]);
  } finally {
    await closeServer(enabled.server);
  }
});

test("server handles missing objects correctly on /api/save", async () => {
  const options = { ...baseOptions(), allowWrite: true };
  const uploaded: unknown[] = [];
  let headCalls = 0;
  const { server, port } = await startTestServer(options, {
    options,
    config: { ...baseConfig, bucket: "my-bucket" },
    csrfToken: "test-token",
    dependencies: {
      createS3Client: () => fakeClient() as never,
      headObject: async (_client, _bucket, key) => {
        headCalls += 1;
        if (headCalls === 1) throw missingObjectError();
        if (headCalls === 2) throw missingObjectError();
        return metadata(key, "\"created\"");
      },
      uploadObject: async (_client, bucket, key, body, contentType) => {
        uploaded.push([bucket, key, body.toString("utf8"), contentType]);
      },
    },
  });

  try {
    const missingUpdate = await requestJson(port, "/api/save", {
      method: "POST",
      headers: writeHeaders(port),
      body: JSON.stringify({ key: "notes/missing.txt", content: "hello" }),
    });

    assert.equal(missingUpdate.statusCode, 404);
    assert.equal(missingUpdate.json.error, "Object does not exist.");
    assert.deepEqual(uploaded, []);

    const createResponse = await requestJson(port, "/api/save", {
      method: "POST",
      headers: writeHeaders(port),
      body: JSON.stringify({ key: "notes/missing.txt", content: "hello", create: true }),
    });

    assert.equal(createResponse.statusCode, 200);
    assert.deepEqual(uploaded, [["my-bucket", "notes/missing.txt", "hello", undefined]]);
    assert.deepEqual(createResponse.json.metadata, metadata("notes/missing.txt", "\"created\""));
  } finally {
    await closeServer(server);
  }
});

test("server sanitizes attachment filenames on /api/download", async () => {
  const options = baseOptions();
  const { server, port } = await startTestServer(options, {
    options,
    config: { ...baseConfig, bucket: "my-bucket" },
    csrfToken: "test-token",
    dependencies: {
      createS3Client: () => fakeClient() as never,
      getObjectForDownload: async () => ({
        Body: Readable.from(["hello"]),
        ContentLength: 5,
        ContentType: "text/plain",
      }) as never,
    },
  });

  try {
    const key = "folder/bad\"\\\r\nname.txt";
    const response = await requestRaw(port, `/api/download?key=${encodeURIComponent(key)}`);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body, "hello");
    assert.equal(response.headers["content-disposition"], "attachment; filename=\"bad____name.txt\"; filename*=UTF-8''bad____name.txt");
    assert.equal(response.headers["x-content-type-options"], "nosniff");
  } finally {
    await closeServer(server);
  }
});

test("server rejects static file path traversal", async () => {
  const options = baseOptions();
  const { server, port } = await startTestServer(options, {
    options,
    config: baseConfig,
    csrfToken: "test-token",
    dependencies: {
      createS3Client: () => fakeClient() as never,
    },
  });

  try {
    const response = await requestRaw(port, "/..%2Fpackage.json");

    assert.equal(response.statusCode, 404);
    assert.equal(response.body, "Not found");
  } finally {
    await closeServer(server);
  }
});

test("server passes continuationToken through /api/list and returns next token", async () => {
  const options = baseOptions();
  let captured: unknown[] | null = null;
  const { server, port } = await startTestServer(options, {
    options,
    config: baseConfig,
    csrfToken: "test-token",
    dependencies: {
      createS3Client: () => fakeClient() as never,
      listObjects: async (_client, bucket, prefix, limit, continuationToken) => {
        captured = [bucket, prefix, limit, continuationToken];
        return {
          objects: [
            { Key: "logs/1.txt", Size: 42, LastModified: new Date("2026-05-20T00:00:00.000Z") },
          ],
          isTruncated: true,
          nextContinuationToken: "next-page",
        };
      },
    },
  });

  try {
    const response = await requestJson(
      port,
      "/api/list?bucket=my-bucket&prefix=logs/&continuationToken=current-page",
    );

    assert.equal(response.statusCode, 200);
    assert.deepEqual(captured, ["my-bucket", "logs/", 1000, "current-page"]);
    assert.equal(response.json.isTruncated, true);
    assert.equal(response.json.nextContinuationToken, "next-page");
    assert.equal(response.json.limit, 1000);
    assert.deepEqual(response.json.objects, [
      {
        key: "logs/1.txt",
        size: 42,
        sizeLabel: "42 B",
        lastModified: "2026-05-20T00:00:00.000Z",
      },
    ]);
  } finally {
    await closeServer(server);
  }
});

test("server returns restart guidance when credential refresh retry also fails", async () => {
  const options = baseOptions();
  let refreshes = 0;
  let clients = 0;
  const { server, port } = await startTestServer(options, {
    options,
    config: baseConfig,
    csrfToken: "test-token",
    dependencies: {
      createS3Client: () => {
        clients += 1;
        return fakeClient() as never;
      },
      refreshAwsCredentialEnv: () => {
        refreshes += 1;
      },
      listBuckets: async () => {
        throw new Error("Your session has expired. Please reauthenticate.");
      },
      warn: () => {},
    },
  });

  try {
    const response = await requestJson(port, "/api/buckets");

    assert.equal(response.statusCode, 401);
    assert.equal(refreshes, 1);
    assert.equal(clients, 2);
    assert.match(String(response.json.error), /could not be refreshed inside this running process/);
    assert.match(String(response.json.error), /restart this S3 File Manager process/);
  } finally {
    await closeServer(server);
  }
});
