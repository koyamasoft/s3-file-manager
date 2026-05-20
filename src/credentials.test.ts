import test from "node:test";
import assert from "node:assert/strict";
import { createCredentialRefreshError, isCredentialError } from "./credentials.js";

test("isCredentialError detects expired AWS token errors", () => {
  assert.equal(isCredentialError({ name: "ExpiredToken" }), true);
  assert.equal(isCredentialError({ message: "Your session has expired. Please reauthenticate." }), true);
  assert.equal(isCredentialError({ $metadata: { httpStatusCode: 401 } }), true);
});

test("isCredentialError ignores regular S3 errors", () => {
  assert.equal(isCredentialError({ name: "NoSuchKey", $metadata: { httpStatusCode: 404 } }), false);
  assert.equal(isCredentialError(new Error("network failed")), false);
});

test("createCredentialRefreshError explains when process restart may be required", () => {
  const error = createCredentialRefreshError(new Error("Your session has expired."), 2);

  assert.equal(error.statusCode, 401);
  assert.match(error.message, /could not be refreshed inside this running process/);
  assert.match(error.message, /restart this S3 File Manager process/);
  assert.match(error.message, /Retry count: 2/);
});
