import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createRequestHandler, type ServerOptions } from "./server.js";
import type { ToolConfig } from "./config.js";

type TestResponse = {
  statusCode: number;
  body: string;
  json: Record<string, unknown>;
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

async function requestJson(port: number, path: string, host?: string): Promise<TestResponse> {
  return await new Promise<TestResponse>((resolveRequest, reject) => {
    const request = httpRequest({
      hostname: "127.0.0.1",
      port,
      path,
      method: "GET",
      headers: {
        Host: host ?? `127.0.0.1:${port}`,
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        resolveRequest({
          statusCode: response.statusCode ?? 0,
          body,
          json: JSON.parse(body) as Record<string, unknown>,
        });
      });
    });
    request.on("error", reject);
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

    const evilHost = await requestJson(port, "/api/config", `evil.example:${port}`);
    assert.equal(evilHost.statusCode, 403);
    assert.equal(evilHost.json.error, "Forbidden host.");

    const confusingHost = await requestJson(port, "/api/config", `evil@localhost:${port}`);
    assert.equal(confusingHost.statusCode, 403);
    assert.equal(confusingHost.json.error, "Forbidden host.");
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
