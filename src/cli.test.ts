import test from "node:test";
import assert from "node:assert/strict";
import { runCli } from "./cli.js";
import type { ToolConfig } from "./config.js";

const config: ToolConfig = {
  region: "ap-northeast-1",
  bucket: "my-bucket",
  endpoint: undefined,
  forcePathStyle: false,
  workDir: ".s3-work",
  editor: "vi",
};

function fakeClient() {
  return { destroy() {} };
}

test("CLI list prints objects and warns when the default list limit is reached", async () => {
  const logs: string[] = [];
  const warnings: string[] = [];
  let captured: unknown[] | null = null;

  await runCli(["list", "logs/"], {
    getConfig: () => config,
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
    log: (message) => logs.push(message),
    warn: (message) => warnings.push(message),
  });

  assert.deepEqual(captured, ["my-bucket", "logs/", undefined, undefined]);
  assert.deepEqual(logs, ["logs/1.txt\t42 B\t2026-05-20T00:00:00.000Z"]);
  assert.deepEqual(warnings, ["List truncated at 1000 objects. Narrow the prefix to see more."]);
});

test("CLI copy copies an object and saves copied metadata", async () => {
  const logs: string[] = [];
  const warnings: string[] = [];
  const copied: unknown[] = [];
  const headCalls: string[] = [];

  await runCli(["copy", "docs/source.txt", "docs/copy.txt", "--yes"], {
    getConfig: () => config,
    createS3Client: () => fakeClient() as never,
    headObject: async (_client, _bucket, key) => {
      headCalls.push(key);
      if (key === "docs/copy.txt" && copied.length === 0) {
        return Promise.reject(Object.assign(new Error("not found"), {
          name: "NoSuchKey",
          $metadata: { httpStatusCode: 404 },
        }));
      }
      return {
        key,
        etag: key === "docs/source.txt" ? "\"source\"" : "\"copied\"",
        contentType: "text/plain",
        contentLength: key === "docs/source.txt" ? 12 : 13,
        lastModified: "2026-05-24T00:00:00.000Z",
      };
    },
    copyObject: async (_client, bucket, sourceKey, targetKey) => {
      copied.push([bucket, sourceKey, targetKey]);
    },
    log: (message) => logs.push(message),
    warn: (message) => warnings.push(message),
  });

  assert.deepEqual(headCalls, ["docs/source.txt", "docs/copy.txt", "docs/copy.txt"]);
  assert.deepEqual(copied, [["my-bucket", "docs/source.txt", "docs/copy.txt"]]);
  assert.deepEqual(warnings, []);
  assert.deepEqual(logs, [
    "Copy source: s3://my-bucket/docs/source.txt",
    "Copy target: s3://my-bucket/docs/copy.txt",
    "Source size: 12 B",
    "Copied.",
    "Key: docs/copy.txt",
    "Content-Type: text/plain",
    "Size: 13 B",
    "ETag: \"copied\"",
    "LastModified: 2026-05-24T00:00:00.000Z",
  ]);
});

test("CLI copy rejects a missing source object", async () => {
  await assert.rejects(
    () => runCli(["copy", "docs/missing.txt", "docs/copy.txt", "--yes"], {
      getConfig: () => config,
      createS3Client: () => fakeClient() as never,
      headObject: async () => Promise.reject(Object.assign(new Error("not found"), {
        name: "NoSuchKey",
        $metadata: { httpStatusCode: 404 },
      })),
      copyObject: async () => {
        assert.fail("copyObject should not be called.");
      },
    }),
    /Source object does not exist: docs\/missing\.txt/,
  );
});
