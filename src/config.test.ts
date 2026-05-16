import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chdir, cwd } from "node:process";
import { loadEnvFile, refreshAwsCredentialEnv } from "./config.js";

const AWS_KEYS = [
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_PROFILE",
  "AWS_REGION",
  "AWS_DEFAULT_REGION",
];

function clearAwsEnv(): void {
  for (const key of AWS_KEYS) {
    delete process.env[key];
  }
}

test("refreshAwsCredentialEnv replaces env-file credentials and removes deleted managed keys", () => {
  const originalCwd = cwd();
  const dir = mkdtempSync(join(tmpdir(), "s3fm-env-"));

  try {
    clearAwsEnv();
    chdir(dir);
    writeFileSync(".env", [
      "AWS_ACCESS_KEY_ID=first",
      "AWS_SECRET_ACCESS_KEY=secret",
      "AWS_SESSION_TOKEN=old-token",
      "",
    ].join("\n"));

    loadEnvFile();
    assert.equal(process.env.AWS_ACCESS_KEY_ID, "first");
    assert.equal(process.env.AWS_SESSION_TOKEN, "old-token");

    writeFileSync(".env", [
      "AWS_ACCESS_KEY_ID=second",
      "AWS_SECRET_ACCESS_KEY=secret",
      "",
    ].join("\n"));

    refreshAwsCredentialEnv();
    assert.equal(process.env.AWS_ACCESS_KEY_ID, "second");
    assert.equal(process.env.AWS_SECRET_ACCESS_KEY, "secret");
    assert.equal(process.env.AWS_SESSION_TOKEN, undefined);
  } finally {
    chdir(originalCwd);
    clearAwsEnv();
  }
});
