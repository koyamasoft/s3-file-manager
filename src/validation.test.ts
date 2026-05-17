import test from "node:test";
import assert from "node:assert/strict";
import {
  assertValidContentType,
  isOverWebObjectLimit,
  isValidBucketName,
  isValidContentType,
  MAX_WEB_OBJECT_BYTES,
} from "./validation.js";

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

test("isValidContentType accepts MIME types and simple parameters", () => {
  assert.equal(isValidContentType("application/json"), true);
  assert.equal(isValidContentType("text/plain; charset=utf-8"), true);
  assert.equal(isValidContentType("image/svg+xml"), true);
});

test("isValidContentType rejects invalid or risky values", () => {
  assert.equal(isValidContentType("text"), false);
  assert.equal(isValidContentType("text/plain\r\nx-test: injected"), false);
  assert.equal(isValidContentType("text/plain; charset="), false);
  assert.equal(isValidContentType("a".repeat(201)), false);
});

test("assertValidContentType allows empty values and rejects invalid values", () => {
  assert.doesNotThrow(() => assertValidContentType(undefined));
  assert.doesNotThrow(() => assertValidContentType(""));
  assert.throws(() => assertValidContentType("not-a-mime-type"), /Content-Type/);
});
