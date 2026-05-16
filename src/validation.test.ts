import test from "node:test";
import assert from "node:assert/strict";
import { isOverWebObjectLimit, isValidBucketName, MAX_WEB_OBJECT_BYTES } from "./validation.js";

test("isValidBucketName accepts common S3 bucket names", () => {
  assert.equal(isValidBucketName("my-bucket"), true);
  assert.equal(isValidBucketName("my.bucket.123"), true);
});

test("isValidBucketName rejects invalid or risky bucket names", () => {
  assert.equal(isValidBucketName("ABucket"), false);
  assert.equal(isValidBucketName("ab"), false);
  assert.equal(isValidBucketName("bucket..name"), false);
  assert.equal(isValidBucketName("bucket.-name"), false);
  assert.equal(isValidBucketName("bucket-.name"), false);
  assert.equal(isValidBucketName("192.168.0.1"), false);
});

test("isOverWebObjectLimit detects objects above the Web UI limit", () => {
  assert.equal(isOverWebObjectLimit(undefined), false);
  assert.equal(isOverWebObjectLimit(MAX_WEB_OBJECT_BYTES), false);
  assert.equal(isOverWebObjectLimit(MAX_WEB_OBJECT_BYTES + 1), true);
});
