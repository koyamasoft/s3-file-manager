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

type LoadWebAppOptions = {
  fetchHandler?: (url: URL, init?: RequestInit) => Response | null | undefined | Promise<Response | null | undefined>;
  confirmResponses?: boolean[];
  promptResponses?: string[];
  waitForObjects?: boolean;
};

async function loadWebApp(options: LoadWebAppOptions = {}) {
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
    fetch: async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input), dom.window.location.href);
      const handled = await options.fetchHandler?.(url, init);
      if (handled) return handled;

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
  dom.window.confirm = () => options.confirmResponses?.shift() ?? true;
  dom.window.prompt = () => options.promptResponses?.shift() ?? "";

  const appUrl = `${pathToFileURL(join(root, "src/web/app.js")).href}?t=${Date.now()}-${Math.random()}`;
  await import(appUrl);
  if (options.waitForObjects !== false) {
    await waitFor(() => dom.window.document.querySelector("#objectCount")?.textContent === "3");
  }
  return { dom, copied };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
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

test("Web UI does not select the first bucket on initial load", async () => {
  let listRequests = 0;
  const { dom } = await loadWebApp({
    waitForObjects: false,
    fetchHandler: (url) => {
      if (url.pathname === "/api/config") {
        return jsonResponse({
          bucket: null,
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
        return jsonResponse({
          buckets: [
            { name: "first-bucket", creationDate: null },
            { name: "second-bucket", creationDate: null },
          ],
        });
      }
      if (url.pathname === "/api/list") {
        listRequests += 1;
      }
      return null;
    },
  });

  await waitFor(() => dom.window.document.querySelector("#toast")?.textContent === "バケットを選択してください。");

  assert.equal(dom.window.document.querySelector("#connectionLabel")?.textContent, "バケット未選択 · AWS S3");
  assert.equal((dom.window.document.querySelector<HTMLInputElement>("#bucketSearchInput")?.value), "");
  assert.equal(listRequests, 0);
});

test("Web UI shows all bucket suggestions when many buckets are available", async () => {
  const buckets = Array.from({ length: 25 }, (_, index) => ({
    name: `bucket-${String(index + 1).padStart(2, "0")}`,
    creationDate: null,
  }));
  const { dom } = await loadWebApp({
    waitForObjects: false,
    fetchHandler: (url) => {
      if (url.pathname === "/api/config") {
        return jsonResponse({
          bucket: null,
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
        return jsonResponse({ buckets });
      }
      return null;
    },
  });

  await waitFor(() => dom.window.document.querySelector("#toast")?.textContent === "バケットを選択してください。");

  const input = dom.window.document.querySelector<HTMLInputElement>("#bucketSearchInput");
  assert.ok(input);
  input.dispatchEvent(new dom.window.Event("focus", { bubbles: true }));

  const suggestions = dom.window.document.querySelectorAll("#bucketSuggestions .bucket-suggestion");
  assert.equal(suggestions.length, 25);
  assert.equal(suggestions[24]?.textContent, "bucket-25");
});

test("Web UI stores favorite buckets and sorts them first", async () => {
  const { dom } = await loadWebApp({
    waitForObjects: false,
    fetchHandler: (url) => {
      if (url.pathname === "/api/config") {
        return jsonResponse({
          bucket: null,
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
        return jsonResponse({
          buckets: [
            { name: "alpha-bucket", creationDate: null },
            { name: "zeta-bucket", creationDate: null },
          ],
        });
      }
      return null;
    },
  });

  await waitFor(() => dom.window.document.querySelector("#toast")?.textContent === "バケットを選択してください。");

  const input = dom.window.document.querySelector<HTMLInputElement>("#bucketSearchInput");
  assert.ok(input);
  input.dispatchEvent(new dom.window.Event("focus", { bubbles: true }));

  const zetaRow = [...dom.window.document.querySelectorAll<HTMLElement>("#bucketSuggestions .bucket-suggestion-row")]
    .find((row) => row.textContent?.includes("zeta-bucket"));
  assert.ok(zetaRow);
  zetaRow.querySelector<HTMLButtonElement>(".favorite-button")?.click();

  const suggestions = [...dom.window.document.querySelectorAll<HTMLButtonElement>("#bucketSuggestions .bucket-suggestion")];
  assert.equal(suggestions[0]?.textContent, "zeta-bucket");
  assert.deepEqual(JSON.parse(dom.window.localStorage.getItem("s3fm.favoriteBuckets") ?? "[]"), ["zeta-bucket"]);
});

test("Web UI clears prefix, filter, and objects when switching buckets", async () => {
  const listRequests: string[] = [];
  const { dom } = await loadWebApp({
    fetchHandler: (url) => {
      if (url.pathname === "/api/buckets") {
        return jsonResponse({
          buckets: [
            { name: "my-bucket", creationDate: null },
            { name: "next-bucket", creationDate: null },
          ],
        });
      }
      if (url.pathname === "/api/list") {
        listRequests.push(`${url.searchParams.get("bucket")}:${url.searchParams.get("prefix") ?? ""}`);
        if (url.searchParams.get("bucket") === "next-bucket") {
          return jsonResponse({
            isTruncated: false,
            nextContinuationToken: null,
            limit: 1000,
            objects: [
              { key: "fresh.txt", size: 5, sizeLabel: "5 B", lastModified: "2026-05-24T00:03:00.000Z" },
            ],
          });
        }
      }
      return null;
    },
  });

  const prefix = dom.window.document.querySelector<HTMLInputElement>("#prefixInput");
  const filter = dom.window.document.querySelector<HTMLInputElement>("#objectFilterInput");
  const bucket = dom.window.document.querySelector<HTMLInputElement>("#bucketSearchInput");
  assert.ok(prefix);
  assert.ok(filter);
  assert.ok(bucket);

  prefix.value = "";
  filter.value = "report";
  filter.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  assert.equal(dom.window.document.querySelector("#objectCount")?.textContent, "1/3");

  bucket.value = "next";
  bucket.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  const nextBucket = [...dom.window.document.querySelectorAll<HTMLButtonElement>("#bucketSuggestions .bucket-suggestion")]
    .find((button) => button.textContent === "next-bucket");
  assert.ok(nextBucket);
  nextBucket.dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true }));

  await waitFor(() => dom.window.document.querySelector("#objectList")?.textContent?.includes("fresh.txt") ?? false);

  assert.equal(prefix.value, "");
  assert.equal(filter.value, "");
  assert.deepEqual(listRequests.at(-1), "next-bucket:");
  assert.equal(dom.window.document.querySelector("#objectCount")?.textContent, "1");
  assert.doesNotMatch(dom.window.document.querySelector("#objectList")?.textContent ?? "", /report\.txt/);
});

test("Web UI stores favorite objects and sorts them first", async () => {
  const { dom } = await loadWebApp();

  const reportRow = [...dom.window.document.querySelectorAll<HTMLElement>("#objectList .favorite-row")]
    .find((row) => row.textContent?.includes("report.txt"));
  assert.ok(reportRow);
  reportRow.querySelector<HTMLButtonElement>(".favorite-button")?.click();

  const rows = [...dom.window.document.querySelectorAll<HTMLElement>("#objectList .favorite-row")];
  assert.match(rows[0]?.textContent ?? "", /report\.txt/);
  assert.deepEqual(
    JSON.parse(dom.window.localStorage.getItem("s3fm.favoriteObjects") ?? "{}"),
    { "my-bucket": ["report.txt"] },
  );
});

test("Web UI pins favorite objects from deeper prefixes", async () => {
  const { dom } = await loadWebApp();

  const logoButton = [...dom.window.document.querySelectorAll<HTMLButtonElement>("#objectList .prefix-folder")]
    .find((button) => button.textContent?.includes("images/"));
  assert.ok(logoButton);
  logoButton.click();
  await waitFor(() => dom.window.document.querySelector("#objectList")?.textContent?.includes("logo.png") ?? false);

  const logoRow = [...dom.window.document.querySelectorAll<HTMLElement>("#objectList .favorite-row")]
    .find((row) => row.textContent?.includes("images/logo.png"));
  assert.ok(logoRow);
  logoRow.querySelector<HTMLButtonElement>(".favorite-button")?.click();

  const upButton = dom.window.document.querySelector<HTMLButtonElement>("#objectList .prefix-up");
  assert.ok(upButton);
  upButton.click();

  await waitFor(() => dom.window.document.querySelector("#objectList .favorite-pinned")?.textContent?.includes("images/logo.png") ?? false);

  const firstRow = dom.window.document.querySelector<HTMLElement>("#objectList .favorite-row");
  assert.match(firstRow?.textContent ?? "", /images\/logo\.png/);
});

test("Web UI lists favorites and removes them from the manager", async () => {
  const { dom } = await loadWebApp();

  const bucketInput = dom.window.document.querySelector<HTMLInputElement>("#bucketSearchInput");
  assert.ok(bucketInput);
  bucketInput.dispatchEvent(new dom.window.Event("focus", { bubbles: true }));
  const bucketRow = dom.window.document.querySelector<HTMLElement>("#bucketSuggestions .bucket-suggestion-row");
  assert.ok(bucketRow);
  bucketRow.querySelector<HTMLButtonElement>(".favorite-button")?.click();

  const reportRow = [...dom.window.document.querySelectorAll<HTMLElement>("#objectList .favorite-row")]
    .find((row) => row.textContent?.includes("report.txt"));
  assert.ok(reportRow);
  reportRow.querySelector<HTMLButtonElement>(".favorite-button")?.click();

  await waitFor(() => dom.window.document.querySelector("#favoriteList")?.textContent?.includes("report.txt") ?? false);

  const favoriteList = dom.window.document.querySelector("#favoriteList");
  assert.match(favoriteList?.textContent ?? "", /my-bucket/);
  assert.match(favoriteList?.textContent ?? "", /report\.txt/);

  const removeButtons = [...dom.window.document.querySelectorAll<HTMLButtonElement>("#favoriteList .favorite-list-remove")];
  assert.equal(removeButtons.length, 2);
  removeButtons[1]?.click();

  assert.doesNotMatch(dom.window.document.querySelector("#favoriteList")?.textContent ?? "", /report\.txt/);
  assert.deepEqual(JSON.parse(dom.window.localStorage.getItem("s3fm.favoriteObjects") ?? "{}"), {});
});

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

test("Web UI shows upload conflict and failure details", async () => {
  const { dom } = await loadWebApp({
    confirmResponses: [true, false],
    fetchHandler: (url) => {
      if (url.pathname !== "/api/upload") return null;

      const key = url.searchParams.get("key");
      if (key === "ok.txt") {
        return jsonResponse({
          metadata: {
            key,
            etag: "\"ok\"",
            contentType: "text/plain; charset=utf-8",
            contentLength: 2,
            lastModified: "2026-05-24T00:03:00.000Z",
          },
        });
      }
      if (key === "exists.txt") {
        return jsonResponse({ error: "Object already exists." }, 409);
      }
      return jsonResponse({ error: "broken upload" }, 500);
    },
  });
  const input = dom.window.document.querySelector<HTMLInputElement>("#uploadFileInput");
  assert.ok(input);

  Object.defineProperty(input, "files", {
    configurable: true,
    value: [
      new dom.window.File(["ok"], "ok.txt", { type: "text/plain" }),
      new dom.window.File(["exists"], "exists.txt", { type: "text/plain" }),
      new dom.window.File(["ng"], "ng.txt", { type: "text/plain" }),
    ],
  });
  input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));

  await waitFor(() => dom.window.document.querySelector("#uploadProgress")?.textContent?.includes("失敗 1") ?? false);

  const progressText = dom.window.document.querySelector("#uploadProgress")?.textContent ?? "";
  assert.match(progressText, /詳細 2件/);
  assert.match(progressText, /衝突: exists\.txt/);
  assert.match(progressText, /失敗: ng\.txt \(broken upload\)/);
});

test("Web UI copies the selected object to another key", async () => {
  const copyRequests: unknown[] = [];
  const { dom } = await loadWebApp({
    promptResponses: ["reports/report-copy.txt"],
    fetchHandler: async (url, init) => {
      if (url.pathname !== "/api/copy") return null;

      copyRequests.push(JSON.parse(String(init?.body)));
      return jsonResponse({
        metadata: {
          key: "reports/report-copy.txt",
          etag: "\"copied\"",
          contentType: "text/plain; charset=utf-8",
          contentLength: 12,
          lastModified: "2026-05-24T00:04:00.000Z",
        },
      });
    },
  });
  const reportButton = [...dom.window.document.querySelectorAll<HTMLButtonElement>("#objectList button")]
    .find((button) => button.textContent?.includes("report.txt"));
  assert.ok(reportButton);

  reportButton.click();
  await waitFor(() => dom.window.document.querySelector("#selectedKey")?.textContent === "report.txt");
  dom.window.document.querySelector<HTMLButtonElement>("#copyObjectButton")?.click();

  await waitFor(() => dom.window.document.querySelector("#selectedKey")?.textContent === "reports/report-copy.txt");
  assert.deepEqual(copyRequests, [{
    bucket: "my-bucket",
    sourceKey: "report.txt",
    targetKey: "reports/report-copy.txt",
    force: false,
  }]);
});
