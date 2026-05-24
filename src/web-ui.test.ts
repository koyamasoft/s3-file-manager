import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";

const objects = [
  { key: "manual.pdf", size: 1200, sizeLabel: "1.2 KiB", lastModified: "2026-05-24T00:00:00.000Z" },
  { key: "report.txt", size: 42, sizeLabel: "42 B", lastModified: "2026-05-24T00:01:00.000Z" },
  { key: "images/logo.png", size: 2048, sizeLabel: "2.0 KiB", lastModified: "2026-05-24T00:02:00.000Z" },
];

async function loadWebApp() {
  const root = process.cwd();
  const html = readFileSync(join(root, "src/web/index.html"), "utf8");
  const dom = new JSDOM(html, {
    url: "http://127.0.0.1:5174/",
    pretendToBeVisual: true,
  });
  const copied: string[] = [];

  Object.assign(globalThis, {
    document: dom.window.document,
    window: dom.window,
    fetch: async (input: string | URL) => {
      const url = new URL(String(input), dom.window.location.href);
      if (url.pathname === "/api/config") {
        return jsonResponse({
          bucket: "my-bucket",
          region: "ap-northeast-1",
          endpoint: null,
          forcePathStyle: false,
          isAwsS3: true,
          allowWrite: true,
          allowCreateBucket: false,
          credentialRefreshes: 0,
          csrfToken: "test-token",
        });
      }
      if (url.pathname === "/api/buckets") {
        return jsonResponse({ buckets: [{ name: "my-bucket", creationDate: null }] });
      }
      if (url.pathname === "/api/list") {
        return jsonResponse({
          isTruncated: false,
          nextContinuationToken: null,
          limit: 1000,
          objects,
        });
      }
      if (url.pathname === "/api/object") {
        const key = url.searchParams.get("key") ?? "";
        return jsonResponse({
          metadata: {
            key,
            etag: "\"etag\"",
            contentType: key.endsWith(".pdf") ? "application/pdf" : "text/plain; charset=utf-8",
            contentLength: 12,
            lastModified: "2026-05-24T00:00:00.000Z",
          },
          text: !key.endsWith(".pdf"),
          content: key.endsWith(".pdf") ? null : "hello",
        });
      }
      throw new Error(`Unexpected fetch: ${url.pathname}`);
    },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      clipboard: {
        writeText: async (value: string) => {
          copied.push(value);
        },
      },
    },
  });
  dom.window.confirm = () => true;

  const appUrl = `${pathToFileURL(join(root, "src/web/app.js")).href}?t=${Date.now()}-${Math.random()}`;
  await import(appUrl);
  await waitFor(() => dom.window.document.querySelector("#objectCount")?.textContent === "3");
  return { dom, copied };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function waitFor(check: () => boolean): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("Timed out waiting for Web UI state.");
}

test("Web UI filters the loaded object list locally", async () => {
  const { dom } = await loadWebApp();
  const input = dom.window.document.querySelector<HTMLInputElement>("#objectFilterInput");
  assert.ok(input);

  input.value = "report";
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));

  assert.equal(dom.window.document.querySelector("#objectCount")?.textContent, "1/3");
  assert.match(dom.window.document.querySelector("#objectList")?.textContent ?? "", /report\.txt/);
  assert.doesNotMatch(dom.window.document.querySelector("#objectList")?.textContent ?? "", /manual\.pdf/);
});

test("Web UI previews PDFs through /api/raw iframe", async () => {
  const { dom } = await loadWebApp();
  const manualButton = [...dom.window.document.querySelectorAll<HTMLButtonElement>("#objectList button")]
    .find((button) => button.textContent?.includes("manual.pdf"));
  assert.ok(manualButton);

  manualButton.click();
  await waitFor(() => !!dom.window.document.querySelector(".pdf-preview"));

  const frame = dom.window.document.querySelector<HTMLIFrameElement>(".pdf-preview");
  assert.ok(frame);
  assert.equal(frame.title, "manual.pdf");
  assert.match(frame.src, /\/api\/raw\?/);
  assert.match(frame.src, /key=manual\.pdf/);
});

test("Web UI copies selected object key, S3 URI, and download URL", async () => {
  const { dom, copied } = await loadWebApp();
  const reportButton = [...dom.window.document.querySelectorAll<HTMLButtonElement>("#objectList button")]
    .find((button) => button.textContent?.includes("report.txt"));
  assert.ok(reportButton);

  reportButton.click();
  await waitFor(() => dom.window.document.querySelector("#selectedKey")?.textContent === "report.txt");

  dom.window.document.querySelector<HTMLButtonElement>("#copyKeyButton")?.click();
  dom.window.document.querySelector<HTMLButtonElement>("#copyS3UriButton")?.click();
  dom.window.document.querySelector<HTMLButtonElement>("#copyDownloadUrlButton")?.click();
  await waitFor(() => copied.length === 3);

  assert.deepEqual(copied, [
    "report.txt",
    "s3://my-bucket/report.txt",
    "http://127.0.0.1:5174/api/download?bucket=my-bucket&key=report.txt",
  ]);
});
