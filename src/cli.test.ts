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

