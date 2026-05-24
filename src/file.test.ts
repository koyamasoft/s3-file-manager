import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contentTypeFor, isTextKey, safePathFor } from "./file.js";

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

test("contentTypeFor detects common upload file types", () => {
  assert.equal(contentTypeFor("data/events.ndjson"), "application/x-ndjson; charset=utf-8");
  assert.equal(contentTypeFor("data/features.geojson"), "application/geo+json; charset=utf-8");
  assert.equal(contentTypeFor("docs/manual.pdf"), "application/pdf");
  assert.equal(contentTypeFor("assets/icon.svg"), "image/svg+xml");
  assert.equal(contentTypeFor("assets/photo.avif"), "image/avif");
  assert.equal(contentTypeFor("archive/export.zip"), "application/zip");
  assert.equal(contentTypeFor("archive/export.gz"), "application/gzip");
  assert.equal(contentTypeFor("tables/events.parquet"), "application/vnd.apache.parquet");
});

test("isTextKey treats newline-delimited JSON as editable text", () => {
  assert.equal(isTextKey("events.jsonl"), true);
  assert.equal(isTextKey("events.ndjson"), true);
  assert.equal(isTextKey("features.geojson"), true);
});
