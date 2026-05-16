import test from "node:test";
import assert from "node:assert/strict";
import { isCredentialError } from "./credentials.js";

test("isCredentialError detects expired AWS token errors", () => {
  assert.equal(isCredentialError({ name: "ExpiredToken" }), true);
  assert.equal(isCredentialError({ message: "Your session has expired. Please reauthenticate." }), true);
  assert.equal(isCredentialError({ $metadata: { httpStatusCode: 401 } }), true);
});

test("isCredentialError ignores regular S3 errors", () => {
  assert.equal(isCredentialError({ name: "NoSuchKey", $metadata: { httpStatusCode: 404 } }), false);
  assert.equal(isCredentialError(new Error("network failed")), false);
});
