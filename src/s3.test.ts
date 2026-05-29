import test from "node:test";
import assert from "node:assert/strict";
import { copyObject, createS3Client, listObjects } from "./s3.js";

test("createS3Client follows AWS S3 region redirects for buckets in other regions", () => {
  const client = createS3Client({
    region: "ap-northeast-1",
    forcePathStyle: false,
    workDir: ".s3-work",
    editor: "vi",
  });

  assert.equal(client.config.followRegionRedirects, true);
  client.destroy();
});

test("createS3Client does not enable region redirects for custom endpoints", () => {
  const client = createS3Client({
    region: "ap-northeast-1",
    endpoint: "http://127.0.0.1:9000",
    forcePathStyle: true,
    workDir: ".s3-work",
    editor: "vi",
  });

  assert.equal(client.config.followRegionRedirects, false);
  client.destroy();
});

test("listObjects stops at the requested limit and reports truncation", async () => {
  const calls: unknown[] = [];
  const client = {
    async send(command: { input: unknown }) {
      calls.push(command.input);
      return {
        Contents: [
          { Key: "logs/1.txt" },
          { Key: "logs/2.txt" },
        ],
        NextContinuationToken: "next-page",
      };
    },
  };

  const result = await listObjects(client as never, "bucket", "logs/", 2);

  assert.equal(result.objects.length, 2);
  assert.equal(result.isTruncated, true);
  assert.equal(result.nextContinuationToken, "next-page");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    Bucket: "bucket",
    Prefix: "logs/",
    ContinuationToken: undefined,
    MaxKeys: 2,
  });
});

test("listObjects requests the page after a continuation token", async () => {
  const calls: unknown[] = [];
  const client = {
    async send(command: { input: unknown }) {
      calls.push(command.input);
      return {
        Contents: [{ Key: "logs/2.txt" }],
      };
    },
  };

  const result = await listObjects(client as never, "bucket", "logs/", 1000, "next-page");

  assert.deepEqual(result.objects.map((object) => object.Key), ["logs/2.txt"]);
  assert.equal(result.isTruncated, false);
  assert.equal(result.nextContinuationToken, undefined);
  assert.deepEqual(calls[0], {
    Bucket: "bucket",
    Prefix: "logs/",
    ContinuationToken: "next-page",
    MaxKeys: 1000,
  });
});

test("copyObject URL-encodes CopySource and writes to the target key", async () => {
  const calls: unknown[] = [];
  const client = {
    async send(command: { input: unknown }) {
      calls.push(command.input);
      return {};
    },
  };

  await copyObject(client as never, "my-bucket", "docs/日本語 file.pdf", "docs/copy.pdf");

  assert.deepEqual(calls, [{
    Bucket: "my-bucket",
    Key: "docs/copy.pdf",
    CopySource: "my-bucket/docs/%E6%97%A5%E6%9C%AC%E8%AA%9E%20file.pdf",
  }]);
});
