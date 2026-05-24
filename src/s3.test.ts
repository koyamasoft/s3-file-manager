import test from "node:test";
import assert from "node:assert/strict";
import { copyObject, listObjects } from "./s3.js";

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
