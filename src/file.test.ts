import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { safePathFor } from "./file.js";

test("safePathFor keeps object keys inside the work directory", () => {
  const workDir = mkdtempSync(join(tmpdir(), "s3fm-path-"));
  assert.equal(
    safePathFor(workDir, "objects", "logs/app.env"),
    join(workDir, "objects", "logs/app.env"),
  );
});

test("safePathFor rejects traversal outside the work directory", () => {
  const workDir = mkdtempSync(join(tmpdir(), "s3fm-path-"));
  assert.throws(() => safePathFor(workDir, "objects", "../secret.txt"));
  assert.throws(() => safePathFor(workDir, "objects", "/tmp/secret.txt"));
});
