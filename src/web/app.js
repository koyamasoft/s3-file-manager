const state = {
  config: null,
  buckets: [],
  selectedBucket: null,
  objects: [],
  listTruncated: false,
  listLimit: 1000,
  listContinuationToken: null,
  loadingMore: false,
  selectedKey: null,
  metadata: null,
  originalContent: "",
  currentContentType: null,
  isNew: false,
  isEnvMode: false,
  envRows: [],
  canUseEnvMode: false,
  csrfToken: null,
  allowWrite: false,
  allowCreateBucket: false,
  wideEditor: false,
  dragDepth: 0,
  uploadProgress: null,
};

const elements = {
  connectionLabel: document.querySelector("#connectionLabel"),
  newBucketButton: document.querySelector("#newBucketButton"),
  newButton: document.querySelector("#newButton"),
  uploadFileButton: document.querySelector("#uploadFileButton"),
  uploadFileInput: document.querySelector("#uploadFileInput"),
  refreshButton: document.querySelector("#refreshButton"),
  prefixForm: document.querySelector("#prefixForm"),
  bucketSearchInput: document.querySelector("#bucketSearchInput"),
  bucketSuggestions: document.querySelector("#bucketSuggestions"),
  prefixInput: document.querySelector("#prefixInput"),
  prefixSuggestions: document.querySelector("#prefixSuggestions"),
  objectFilterInput: document.querySelector("#objectFilterInput"),
  objectCount: document.querySelector("#objectCount"),
  objectList: document.querySelector("#objectList"),
  loadMoreRow: document.querySelector("#loadMoreRow"),
  loadMoreButton: document.querySelector("#loadMoreButton"),
  selectedKey: document.querySelector("#selectedKey"),
  modeBadge: document.querySelector("#modeBadge"),
  warningBanner: document.querySelector("#warningBanner"),
  editor: document.querySelector("#editor"),
  envPane: document.querySelector("#envPane"),
  envRows: document.querySelector("#envRows"),
  addEnvRowButton: document.querySelector("#addEnvRowButton"),
  previewPane: document.querySelector("#previewPane"),
  writeModeButton: document.querySelector("#writeModeButton"),
  wideEditorButton: document.querySelector("#wideEditorButton"),
  toggleEnvModeButton: document.querySelector("#toggleEnvModeButton"),
  copyKeyButton: document.querySelector("#copyKeyButton"),
  copyS3UriButton: document.querySelector("#copyS3UriButton"),
  copyDownloadUrlButton: document.querySelector("#copyDownloadUrlButton"),
  copyObjectButton: document.querySelector("#copyObjectButton"),
  downloadButton: document.querySelector("#downloadButton"),
  saveButton: document.querySelector("#saveButton"),
  diffButton: document.querySelector("#diffButton"),
  diffPane: document.querySelector("#diffPane"),
  diffOutput: document.querySelector("#diffOutput"),
  closeDiffButton: document.querySelector("#closeDiffButton"),
  uploadProgress: document.querySelector("#uploadProgress"),
  toast: document.querySelector("#toast"),
  metaBucket: document.querySelector("#metaBucket"),
  contentTypeSelect: document.querySelector("#contentTypeSelect"),
  contentTypeInput: document.querySelector("#contentTypeInput"),
  metaSize: document.querySelector("#metaSize"),
  metaEtag: document.querySelector("#metaEtag"),
  metaLastModified: document.querySelector("#metaLastModified"),
};

function formatBytes(bytes) {
  if (bytes == null) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

function showToast(message, type = "info") {
  elements.toast.textContent = message;
  elements.toast.classList.toggle("error", type === "error");
  elements.toast.classList.remove("hidden");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    elements.toast.classList.add("hidden");
  }, 3200);
}

async function requestJson(url, options) {
  const method = (options?.method ?? "GET").toUpperCase();
  const headers = new Headers(options?.headers ?? {});
  if (method !== "GET" && state.csrfToken) {
    headers.set("X-S3FM-CSRF", state.csrfToken);
  }

  const response = await fetch(url, { ...options, headers });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(json.error || `HTTP ${response.status}`);
    error.status = response.status;
    error.payload = json;
    throw error;
  }
  return json;
}

function setWarning(message) {
  elements.warningBanner.textContent = message || "";
  elements.warningBanner.classList.toggle("hidden", !message);
}

function updateConnectionLabel() {
  elements.connectionLabel.textContent = `${state.selectedBucket ?? "バケット未選択"} · ${state.config?.endpoint ?? "AWS S3"}`;
}

function updateEditorLayout() {
  document.body.classList.toggle("wide-editor", state.wideEditor);
  elements.wideEditorButton.textContent = state.wideEditor ? "標準幅" : "拡大";
  elements.wideEditorButton.classList.toggle("active", state.wideEditor);
}

function updateDownloadButton() {
  if (!state.selectedBucket || !state.selectedKey || state.isNew) {
    elements.downloadButton.classList.add("hidden");
    elements.downloadButton.removeAttribute("href");
    elements.downloadButton.removeAttribute("download");
    elements.copyDownloadUrlButton.disabled = true;
  } else {
    const params = new URLSearchParams({
      bucket: state.selectedBucket,
      key: state.selectedKey,
    });
    const name = state.selectedKey.split("/").filter(Boolean).pop() || "object";
    elements.downloadButton.href = `/api/download?${params.toString()}`;
    elements.downloadButton.download = name;
    elements.downloadButton.classList.remove("hidden");
    elements.copyDownloadUrlButton.disabled = false;
  }

  const hasObjectKey = !!state.selectedBucket && !!state.selectedKey;
  elements.copyKeyButton.disabled = !hasObjectKey;
  elements.copyS3UriButton.disabled = !hasObjectKey;
  elements.copyObjectButton.disabled = !state.allowWrite || !hasObjectKey || state.isNew;
}

function renderUploadProgress() {
  const progress = state.uploadProgress;
  if (!progress) {
    elements.uploadProgress.classList.add("hidden");
    elements.uploadProgress.replaceChildren();
    return;
  }

  const count = document.createElement("span");
  count.textContent = `アップロード ${progress.done}/${progress.total}`;

  const detail = document.createElement("span");
  detail.textContent = `成功 ${progress.uploaded} / 衝突 ${progress.conflicts} / 失敗 ${progress.failures}`;

  const bar = document.createElement("div");
  bar.className = "upload-progress-bar";
  const value = document.createElement("span");
  value.style.width = `${progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0}%`;
  bar.append(value);

  const children = [count, detail, bar];
  const details = progress.details ?? [];
  if (details.length > 0) {
    const detailBox = document.createElement("details");
    detailBox.className = "upload-detail";
    detailBox.open = progress.done >= progress.total;

    const summary = document.createElement("summary");
    summary.textContent = `詳細 ${details.length}件`;

    const list = document.createElement("ul");
    const visibleDetails = details.slice(0, 20);
    for (const item of visibleDetails) {
      const row = document.createElement("li");
      const type = item.type === "conflict" ? "衝突" : "失敗";
      row.textContent = `${type}: ${item.key}${item.message ? ` (${item.message})` : ""}`;
      list.append(row);
    }
    if (details.length > visibleDetails.length) {
      const omitted = document.createElement("li");
      omitted.className = "upload-detail-muted";
      omitted.textContent = `ほか ${details.length - visibleDetails.length}件`;
      list.append(omitted);
    }
    detailBox.append(summary, list);
    children.push(detailBox);
  }

  elements.uploadProgress.replaceChildren(...children);
  elements.uploadProgress.classList.remove("hidden");
}

function updateWriteControls() {
  const canSaveSelection = !!state.selectedKey &&
    (state.isNew || !!state.metadata) &&
    elements.previewPane.classList.contains("hidden");
  elements.newButton.disabled = !state.allowWrite;
  elements.uploadFileButton.disabled = !state.allowWrite;
  elements.newBucketButton.disabled = !state.allowCreateBucket;
  elements.saveButton.disabled = !state.allowWrite || !canSaveSelection;
  elements.addEnvRowButton.disabled = !state.allowWrite;
  elements.contentTypeSelect.disabled = !state.allowWrite || !canSaveSelection;
  elements.contentTypeInput.disabled = !state.allowWrite || !canSaveSelection;
  elements.writeModeButton.textContent = state.allowWrite ? "保存 ON" : "保存 OFF";
  elements.writeModeButton.classList.toggle("active", state.allowWrite);

  if (!elements.editor.classList.contains("hidden")) {
    elements.editor.disabled = !state.allowWrite || (!state.selectedKey && !state.isNew);
  }

  if (!elements.envPane.classList.contains("hidden")) {
    renderEnvRows();
  }
  updateDownloadButton();
}

function setContentTypeControl(contentType) {
  const value = contentType ?? "";
  const hasOption = [...elements.contentTypeSelect.options].some((option) => option.value === value);
  elements.contentTypeSelect.value = hasOption ? value : value ? "__custom__" : "";
  elements.contentTypeInput.value = value;
  elements.contentTypeInput.classList.toggle("hidden", elements.contentTypeSelect.value !== "__custom__");
}

function updateContentType(value) {
  const normalized = value.trim();
  state.currentContentType = normalized || null;
  elements.contentTypeInput.value = normalized;
  elements.contentTypeSelect.value = normalized &&
    [...elements.contentTypeSelect.options].some((option) => option.value === normalized)
    ? normalized
    : normalized ? "__custom__" : "";
  elements.contentTypeInput.classList.toggle("hidden", elements.contentTypeSelect.value !== "__custom__");
}

function setMetadata(metadata) {
  elements.metaBucket.textContent = state.selectedBucket ?? "-";
  setContentTypeControl(state.currentContentType ?? metadata?.contentType ?? "");
  elements.metaSize.textContent = formatBytes(metadata?.contentLength);
  elements.metaEtag.textContent = metadata?.etag ?? "-";
  elements.metaLastModified.textContent = metadata?.lastModified ?? "-";
  updateWriteControls();
}

function currentPrefix() {
  return elements.prefixInput.value.trim().replace(/^\/+/, "");
}

function parentPrefix(prefix) {
  const normalized = prefix.replace(/\/+$/, "");
  const index = normalized.lastIndexOf("/");
  return index === -1 ? "" : `${normalized.slice(0, index)}/`;
}

function currentObjectFilter() {
  return elements.objectFilterInput.value.trim().toLowerCase();
}

function visibleObjectRows() {
  const prefix = currentPrefix();
  const query = currentObjectFilter();
  return state.objects.filter((object) => {
    if (object.key === prefix) return false;
    if (!query) return true;
    return object.key.toLowerCase().includes(query);
  });
}

function childPrefixes() {
  const prefix = currentPrefix();
  const names = new Set();

  for (const object of visibleObjectRows()) {
    if (!object.key.startsWith(prefix)) continue;
    const rest = object.key.slice(prefix.length);
    const slash = rest.indexOf("/");
    if (slash !== -1) {
      names.add(`${prefix}${rest.slice(0, slash + 1)}`);
    }
  }

  return [...names].sort((a, b) => a.localeCompare(b));
}

function directObjects() {
  const prefix = currentPrefix();
  const folders = new Set(childPrefixes());
  return visibleObjectRows().filter((object) => {
    if (!object.key.startsWith(prefix)) return false;
    const rest = object.key.slice(prefix.length);
    return !rest.includes("/") && !folders.has(object.key);
  });
}

function appendObjectButton({ className = "", label, meta, active = false, onClick }) {
  const item = document.createElement("li");
  const button = document.createElement("button");
  button.type = "button";
  if (className) button.className = className;
  button.classList.toggle("active", active);

  const key = document.createElement("span");
  key.className = "object-key";
  key.textContent = label;

  const detail = document.createElement("span");
  detail.className = "object-meta";
  detail.textContent = meta;

  button.append(key, detail);
  button.addEventListener("click", onClick);
  item.append(button);
  elements.objectList.append(item);
}

function renderObjectList() {
  const folders = childPrefixes();
  const objects = directObjects();
  const count = objects.length + folders.length;
  const filter = currentObjectFilter();
  const suffix = state.listTruncated ? "+" : "";
  elements.objectCount.textContent = filter ? `${count}/${state.objects.length}${suffix}` : `${count}${suffix}`;
  elements.objectList.replaceChildren();

  if (currentPrefix()) {
    appendObjectButton({
      className: "prefix-up",
      label: "../",
      meta: "親Prefixへ移動",
      onClick: () => selectPrefix(parentPrefix(currentPrefix())),
    });
  }

  for (const prefix of folders) {
    appendObjectButton({
      className: "prefix-folder",
      label: prefix.slice(currentPrefix().length),
      meta: prefix,
      onClick: () => selectPrefix(prefix),
    });
  }

  for (const object of objects) {
    appendObjectButton({
      label: object.key,
      meta: `${object.sizeLabel} · ${object.lastModified ?? "-"}`,
      active: object.key === state.selectedKey,
      onClick: () => {
        openObject(object.key).catch((error) => showToast(error.message, "error"));
      },
    });
  }

  if (filter && count === 0) {
    const item = document.createElement("li");
    item.className = "object-list-empty";
    item.textContent = "一致する object はありません。";
    elements.objectList.append(item);
  }

  elements.loadMoreRow.classList.toggle("hidden", !state.listContinuationToken);
  elements.loadMoreButton.disabled = state.loadingMore;
  elements.loadMoreButton.textContent = state.loadingMore ? "読み込み中..." : "さらに読み込む";
}

function bucketNames() {
  const names = state.buckets.length > 0
    ? state.buckets.map((bucket) => bucket.name)
    : state.config.bucket ? [state.config.bucket] : [];
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

function filteredBucketNames() {
  const query = elements.bucketSearchInput.value.trim().toLowerCase();
  if (!query) return bucketNames();
  return bucketNames().filter((name) => name.toLowerCase().includes(query));
}

function renderBucketSuggestions(show = false) {
  elements.bucketSuggestions.replaceChildren();
  const names = filteredBucketNames();

  if (!show || names.length === 0) {
    elements.bucketSuggestions.classList.add("hidden");
    return;
  }

  for (const name of names.slice(0, 20)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "bucket-suggestion";
    button.textContent = name;
    button.classList.toggle("active", name === state.selectedBucket);
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      selectBucket(name);
    });
    elements.bucketSuggestions.append(button);
  }

  elements.bucketSuggestions.classList.remove("hidden");
}

function prefixNames() {
  const names = new Set();
  for (const object of state.objects) {
    const parts = object.key.split("/");
    let prefix = "";
    for (let i = 0; i < parts.length - 1; i += 1) {
      prefix += `${parts[i]}/`;
      names.add(prefix);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

function filteredPrefixNames() {
  const query = elements.prefixInput.value.trim().toLowerCase();
  if (!query) return prefixNames();
  return prefixNames().filter((name) => name.toLowerCase().includes(query));
}

function renderPrefixSuggestions(show = false) {
  elements.prefixSuggestions.replaceChildren();
  const names = filteredPrefixNames();

  if (!show || names.length === 0) {
    elements.prefixSuggestions.classList.add("hidden");
    return;
  }

  for (const name of names.slice(0, 20)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "suggestion";
    button.textContent = name;
    button.classList.toggle("active", name === elements.prefixInput.value.trim());
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      selectPrefix(name);
    });
    elements.prefixSuggestions.append(button);
  }

  elements.prefixSuggestions.classList.remove("hidden");
}

async function selectPrefix(prefix) {
  elements.prefixInput.value = prefix;
  renderPrefixSuggestions(false);
  try {
    await loadObjects();
    showToast(`Prefixを切り替えました: ${prefix || "(empty)"}`);
  } catch (error) {
    showToast(error.message, "error");
  }
}

function renderBucketSearch() {
  elements.bucketSearchInput.value = state.selectedBucket ?? "";
  renderBucketSuggestions(false);
}

async function selectBucket(bucket) {
  state.selectedBucket = bucket;
  elements.bucketSearchInput.value = bucket;
  renderBucketSuggestions(false);
  updateConnectionLabel();
  clearSelection();
  try {
    await loadObjects();
    showToast(`バケットを切り替えました: ${state.selectedBucket}`);
  } catch (error) {
    showToast(error.message, "error");
  }
}

function setMode(mode) {
  elements.modeBadge.className = "badge";
  if (mode === "env") {
    elements.modeBadge.textContent = state.isNew ? "新規 env" : "env";
    elements.modeBadge.classList.add("editable");
  } else if (mode === "text") {
    elements.modeBadge.textContent = state.isNew ? "新規" : "編集可能";
    elements.modeBadge.classList.add("editable");
  } else if (mode === "binary") {
    elements.modeBadge.textContent = "プレビュー";
    elements.modeBadge.classList.add("binary");
  } else {
    elements.modeBadge.textContent = "未選択";
  }
}

function updateEnvModeButton() {
  elements.toggleEnvModeButton.disabled = !state.canUseEnvMode;
  elements.toggleEnvModeButton.textContent = state.isEnvMode ? "テキスト編集" : "env編集";
}

function isEnvKey(key) {
  const name = key.split("/").pop()?.toLowerCase() ?? "";
  return name === ".env" || name.startsWith(".env.") || name.endsWith(".env");
}

function contentTypeForKey(key) {
  const extension = key.toLowerCase().match(/(\.[a-z0-9]+)$/)?.[1] ?? "";
  const types = {
    ".css": "text/css; charset=utf-8",
    ".csv": "text/csv; charset=utf-8",
    ".env": "text/plain; charset=utf-8",
    ".gif": "image/gif",
    ".geojson": "application/geo+json; charset=utf-8",
    ".gz": "application/gzip",
    ".html": "text/html; charset=utf-8",
    ".ico": "image/x-icon",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".jsonl": "application/x-ndjson; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".ndjson": "application/x-ndjson; charset=utf-8",
    ".parquet": "application/vnd.apache.parquet",
    ".pdf": "application/pdf",
    ".svg": "image/svg+xml",
    ".txt": "text/plain; charset=utf-8",
    ".xml": "application/xml; charset=utf-8",
    ".yaml": "application/yaml; charset=utf-8",
    ".yml": "application/yaml; charset=utf-8",
    ".avif": "image/avif",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".zip": "application/zip",
  };
  return types[extension] ?? "text/plain; charset=utf-8";
}

function unquoteEnvValue(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    return trimmed.slice(1, -1).replace(/\\([\\nrt"])/g, (_, escaped) => {
      if (escaped === "n") return "\n";
      if (escaped === "r") return "\r";
      if (escaped === "t") return "\t";
      return escaped;
    });
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  return value;
}

function parseEnvContent(content) {
  if (!content) return [];
  return content.split(/\r?\n/).map((line) => {
    const body = line.trimStart().startsWith("export ") ? line.trimStart().slice("export ".length) : line;
    const equals = body.indexOf("=");
    if (equals <= 0) return { type: "raw", raw: line };

    const key = body.slice(0, equals).trim();
    if (!key || key.startsWith("#")) return { type: "raw", raw: line };

    return { type: "entry", key, value: unquoteEnvValue(body.slice(equals + 1)) };
  });
}

function formatEnvValue(value) {
  if (/^[A-Za-z0-9_./:@+-]*$/.test(value)) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\n/g, "\\n")}"`;
}

function serializeEnvRows() {
  return state.envRows
    .map((row) => {
      if (row.type === "raw") return row.raw;
      const key = row.key.trim();
      if (!key) return "";
      return `${key}=${formatEnvValue(row.value)}`;
    })
    .join("\n");
}

function getCurrentContent() {
  return state.isEnvMode ? serializeEnvRows() : elements.editor.value;
}

function renderEnvRows() {
  elements.envRows.replaceChildren();

  state.envRows.forEach((row, index) => {
    const wrapper = document.createElement("div");
    wrapper.className = row.type === "raw" ? "env-row raw" : "env-row";

    if (row.type === "raw") {
      const raw = document.createElement("div");
      raw.className = "env-raw-line";
      raw.textContent = row.raw || "(blank line)";
      wrapper.append(raw);
    } else {
      const key = document.createElement("input");
      key.type = "text";
      key.placeholder = "KEY";
      key.value = row.key;
      key.disabled = !state.allowWrite;
      key.addEventListener("input", () => {
        row.key = key.value;
      });

      const value = document.createElement("input");
      value.type = "text";
      value.placeholder = "value";
      value.value = row.value;
      value.disabled = !state.allowWrite;
      value.addEventListener("input", () => {
        row.value = value.value;
      });

      wrapper.append(key, value);
    }

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "icon-button danger-button";
    remove.title = "削除";
    remove.setAttribute("aria-label", "削除");
    remove.textContent = "×";
    remove.disabled = !state.allowWrite;
    remove.addEventListener("click", () => {
      state.envRows.splice(index, 1);
      renderEnvRows();
    });
    wrapper.append(remove);

    elements.envRows.append(wrapper);
  });
}

function showTextEditor(content) {
  state.isEnvMode = false;
  state.envRows = [];
  elements.editor.value = content;
  elements.editor.disabled = !state.allowWrite;
  elements.editor.classList.remove("hidden");
  elements.envPane.classList.add("hidden");
  elements.previewPane.classList.add("hidden");
  updateEnvModeButton();
  updateWriteControls();
}

function showEnvEditor(content) {
  state.isEnvMode = true;
  state.envRows = parseEnvContent(content);
  elements.editor.value = "";
  elements.editor.disabled = true;
  elements.editor.classList.add("hidden");
  elements.previewPane.classList.add("hidden");
  elements.envPane.classList.remove("hidden");
  renderEnvRows();
  updateEnvModeButton();
  updateWriteControls();
}

function isPreviewImageType(contentType) {
  const normalized = contentType.toLowerCase().split(";")[0].trim();
  return ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(normalized);
}

function isPreviewPdfType(key, contentType) {
  const normalized = contentType.toLowerCase().split(";")[0].trim();
  return normalized === "application/pdf" || key.toLowerCase().endsWith(".pdf");
}

function renderPreview(key, metadata) {
  elements.previewPane.replaceChildren();
  const contentType = metadata?.contentType ?? "";
  const params = new URLSearchParams({
    bucket: state.selectedBucket,
    key,
    t: String(Date.now()),
  });

  if (isPreviewImageType(contentType)) {
    const image = document.createElement("img");
    image.alt = key;
    image.src = `/api/raw?${params.toString()}`;
    elements.previewPane.append(image);
    return;
  }

  if (isPreviewPdfType(key, contentType)) {
    const frame = document.createElement("iframe");
    frame.className = "pdf-preview";
    frame.title = key;
    frame.src = `/api/raw?${params.toString()}`;
    elements.previewPane.append(frame);
    return;
  }

  const note = document.createElement("div");
  note.className = "binary-note";
  note.textContent = "このオブジェクトはブラウザ編集の対象外です。";
  elements.previewPane.append(note);
}

function diffLines(before, after) {
  const a = before.split("\n");
  const b = after.split("\n");

  if (a.length * b.length > 1_000_000) {
    return simpleDiffLines(a, b);
  }

  const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));

  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const rows = [];
  let i = 0;
  let j = 0;

  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      rows.push(`  ${a[i]}`);
      i += 1;
      j += 1;
    } else if (i < a.length && (j >= b.length || dp[i + 1][j] >= dp[i][j + 1])) {
      rows.push(`- ${a[i]}`);
      i += 1;
    } else if (j < b.length) {
      rows.push(`+ ${b[j]}`);
      j += 1;
    }
  }

  return rows.join("\n");
}

function simpleDiffLines(a, b) {
  const rows = [];
  const max = Math.max(a.length, b.length);

  for (let i = 0; i < max; i += 1) {
    if (a[i] === b[i]) {
      rows.push(`  ${a[i] ?? ""}`);
    } else {
      if (a[i] !== undefined) rows.push(`- ${a[i]}`);
      if (b[i] !== undefined) rows.push(`+ ${b[i]}`);
    }
  }

  return rows.join("\n");
}

async function loadConfig() {
  state.config = await requestJson("/api/config");
  state.selectedBucket = state.config.bucket ?? null;
  state.csrfToken = state.config.csrfToken ?? null;
  state.allowWrite = !!state.config.allowWrite;
  state.allowCreateBucket = !!state.config.allowCreateBucket;
  updateConnectionLabel();
  updateWriteControls();
  if (state.config.isAwsS3) {
    setWarning("AWS S3 に接続しています。アップロード前に対象キーを確認してください。");
  }
  if (!state.allowWrite) {
    showToast("読み取り専用です。画面右上の「保存 OFF」から保存を有効にできます。");
  }
}

async function loadBuckets() {
  try {
    const data = await requestJson("/api/buckets");
    state.buckets = data.buckets;
    if (!state.selectedBucket && state.buckets.length > 0) {
      state.selectedBucket = state.buckets[0].name;
    }
  } catch (error) {
    state.buckets = [];
    showToast(`バケット一覧を取得できませんでした: ${error.message}`, "error");
  }
  renderBucketSearch();
  updateConnectionLabel();
}

async function loadObjects({ append = false } = {}) {
  const prefix = currentPrefix();
  if (!state.selectedBucket) {
    state.objects = [];
    state.listTruncated = false;
    state.listContinuationToken = null;
    renderObjectList();
    throw new Error("バケットを選択してください。");
  }
  const params = new URLSearchParams({
    bucket: state.selectedBucket,
    prefix,
  });
  if (append && state.listContinuationToken) {
    params.set("continuationToken", state.listContinuationToken);
  }
  const data = await requestJson(`/api/list?${params.toString()}`);
  state.objects = append ? [...state.objects, ...data.objects] : data.objects;
  state.listTruncated = !!data.isTruncated;
  state.listLimit = data.limit ?? 1000;
  state.listContinuationToken = data.nextContinuationToken ?? null;
  renderObjectList();
  renderPrefixSuggestions(false);
  if (!append && state.listTruncated) {
    showToast(`${state.listLimit}件まで表示しています。続きは「さらに読み込む」から表示できます。`);
  }
}

async function loadMoreObjects() {
  if (!state.listContinuationToken || state.loadingMore) return;
  state.loadingMore = true;
  renderObjectList();
  try {
    await loadObjects({ append: true });
  } finally {
    state.loadingMore = false;
    renderObjectList();
  }
}

function clearSelection() {
  state.selectedKey = null;
  state.metadata = null;
  state.originalContent = "";
  state.currentContentType = null;
  state.isNew = false;
  state.isEnvMode = false;
  state.envRows = [];
  state.canUseEnvMode = false;
  elements.selectedKey.textContent = "ファイルを選択";
  elements.editor.value = "";
  elements.editor.disabled = true;
  elements.editor.classList.remove("hidden");
  elements.envPane.classList.add("hidden");
  elements.envRows.replaceChildren();
  elements.previewPane.classList.add("hidden");
  elements.previewPane.replaceChildren();
  elements.saveButton.disabled = true;
  elements.diffButton.disabled = true;
  elements.toggleEnvModeButton.disabled = true;
  updateDownloadButton();
  hideDiff();
  setMetadata(null);
  setMode(null);
  updateWriteControls();
}

async function openObject(key) {
  state.isNew = false;
  state.isEnvMode = false;
  state.envRows = [];
  state.canUseEnvMode = isEnvKey(key);
  state.selectedKey = key;
  elements.selectedKey.textContent = key;
  updateDownloadButton();
  elements.editor.value = "読み込み中...";
  elements.editor.disabled = true;
  elements.saveButton.disabled = true;
  elements.diffButton.disabled = true;
  elements.toggleEnvModeButton.disabled = !state.canUseEnvMode;
  hideDiff();
  elements.previewPane.classList.add("hidden");
  elements.envPane.classList.add("hidden");
  elements.editor.classList.remove("hidden");
  renderObjectList();

  const params = new URLSearchParams({
    bucket: state.selectedBucket,
    key,
  });
  const data = await requestJson(`/api/object?${params.toString()}`);
  state.metadata = data.metadata;
  state.currentContentType = data.metadata?.contentType ?? null;
  setMetadata(state.metadata);
  updateDownloadButton();

  if (data.text) {
    state.originalContent = data.content ?? "";
    if (isEnvKey(key)) {
      showEnvEditor(state.originalContent);
      setMode("env");
    } else {
      showTextEditor(state.originalContent);
      setMode("text");
    }
    elements.saveButton.disabled = !state.allowWrite;
    elements.diffButton.disabled = false;
    updateEnvModeButton();
    return;
  }

  state.originalContent = "";
  state.isEnvMode = false;
  state.canUseEnvMode = false;
  elements.editor.classList.add("hidden");
  elements.envPane.classList.add("hidden");
  elements.previewPane.classList.remove("hidden");
  renderPreview(key, state.metadata);
  setMode("binary");
  updateEnvModeButton();
  updateWriteControls();
}

async function saveObject(force = false) {
  if (!state.selectedKey || (!state.metadata && !state.isNew)) return;
  if (!state.allowWrite) {
    showToast("読み取り専用です。画面右上の「保存 OFF」から保存を有効にしてください。", "error");
    return;
  }

  const body = {
    key: state.selectedKey,
    bucket: state.selectedBucket,
    content: getCurrentContent(),
    etag: state.metadata?.etag,
    contentType: state.currentContentType || undefined,
    create: state.isNew,
    force,
  };

  try {
    const result = await requestJson("/api/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    state.metadata = result.metadata;
    state.currentContentType = result.metadata?.contentType ?? state.currentContentType;
    state.isNew = false;
    state.originalContent = getCurrentContent();
    setMetadata(state.metadata);
    setMode(state.isEnvMode ? "env" : "text");
    await loadObjects();
    showToast("アップロードしました。");
  } catch (error) {
    if (error.status === 409) {
      const overwrite = window.confirm(state.isNew
        ? "同じキーのオブジェクトが既にあります。上書きしますか？"
        : "S3側のオブジェクトが変更されています。上書きしますか？");
      if (overwrite) await saveObject(true);
      return;
    }
    throw error;
  }
}

function normalizeNewKey(input, prefix) {
  const key = input.trim().replace(/^\/+/, "");
  if (!key) return "";
  if (!prefix) return key;
  const normalizedPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;
  return key.startsWith(normalizedPrefix) ? key : `${normalizedPrefix}${key}`;
}

function initialUploadKey(file) {
  return normalizeNewKey(file.name || "upload.bin", currentPrefix());
}

function defaultCopyKey(key) {
  const parts = key.split("/");
  const name = parts.pop() || "object";
  parts.push(`copy-${name}`);
  return parts.join("/");
}

function uploadTargetLabel() {
  const prefix = currentPrefix();
  return prefix || "(root)";
}

function makeDownloadUrl(key) {
  const params = new URLSearchParams({
    bucket: state.selectedBucket,
    key,
  });
  return `${window.location.origin}/api/download?${params.toString()}`;
}

async function copyText(value, label) {
  if (!value) return;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.append(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    showToast(`${label}をコピーしました。`);
  } catch (error) {
    showToast(`${label}をコピーできませんでした: ${error.message}`, "error");
  }
}

async function copySelectedObject(force = false, targetKey = null) {
  if (!state.allowWrite) {
    showToast("読み取り専用です。画面右上の「保存 OFF」から保存を有効にしてください。", "error");
    return;
  }
  if (!state.selectedBucket || !state.selectedKey || state.isNew) return;

  const nextKey = targetKey ?? normalizeNewKey(
    window.prompt("コピー先のキーを入力してください。", defaultCopyKey(state.selectedKey)) ?? "",
    "",
  );
  if (!nextKey) return;
  if (nextKey === state.selectedKey) {
    showToast("コピー元とコピー先の key が同じです。", "error");
    return;
  }

  try {
    const result = await requestJson("/api/copy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bucket: state.selectedBucket,
        sourceKey: state.selectedKey,
        targetKey: nextKey,
        force,
      }),
    });
    await loadObjects();
    await openObject(result.metadata?.key ?? nextKey);
    showToast("オブジェクトを複製しました。");
  } catch (error) {
    if (error.status === 409) {
      const overwrite = window.confirm("コピー先のオブジェクトが既にあります。上書きしますか？");
      if (overwrite) await copySelectedObject(true, nextKey);
      return;
    }
    throw error;
  }
}

async function uploadFileToKey(file, targetKey, { force = false } = {}) {
  const params = new URLSearchParams({
    bucket: state.selectedBucket,
    key: targetKey,
  });
  if (force) params.set("force", "true");

  const headers = {};
  if (file.type) headers["Content-Type"] = file.type;

  const result = await requestJson(`/api/upload?${params.toString()}`, {
    method: "POST",
    headers,
    body: file,
  });

  return result.metadata;
}

async function openUploadedObject(targetKey, metadata, file) {
  state.selectedKey = targetKey;
  state.metadata = metadata;
  state.currentContentType = metadata?.contentType ?? file.type ?? null;
  state.isNew = false;
  await loadObjects();
  try {
    await openObject(targetKey);
  } catch (error) {
    clearSelection();
    showToast(`アップロードしましたが表示できません: ${error.message}`, "error");
  }
}

async function uploadLocalFile(file, force = false, key = null) {
  if (!state.allowWrite) {
    showToast("読み取り専用です。画面右上の「保存 OFF」から保存を有効にしてください。", "error");
    return;
  }
  if (!state.selectedBucket) {
    showToast("バケットを選択してください。", "error");
    return;
  }

  const targetKey = key ?? normalizeNewKey(
    window.prompt("アップロード先のキーを入力してください。", initialUploadKey(file)) ?? "",
    currentPrefix(),
  );
  if (!targetKey) return;

  try {
    const metadata = await uploadFileToKey(file, targetKey, { force });
    showToast("ローカルファイルをアップロードしました。");
    await openUploadedObject(targetKey, metadata, file);
  } catch (error) {
    if (error.status === 409) {
      const overwrite = window.confirm("同じキーのオブジェクトが既にあります。上書きしますか？");
      if (overwrite) await uploadLocalFile(file, true, targetKey);
      return;
    }
    throw error;
  }
}

function updateUploadProgress(values) {
  state.uploadProgress = { ...state.uploadProgress, ...values };
  renderUploadProgress();
}

function uploadErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function uploadIssueDetails(conflicts, failures) {
  return [
    ...conflicts.map((item) => ({
      type: "conflict",
      key: item.key,
      message: "同じキーが既にあります",
    })),
    ...failures.map((item) => ({
      type: "failure",
      key: item.key,
      message: uploadErrorMessage(item.error),
    })),
  ];
}

function syncUploadIssueDetails(conflicts, failures) {
  updateUploadProgress({ details: uploadIssueDetails(conflicts, failures) });
}

function finishUploadProgress(delay = 3200) {
  window.clearTimeout(finishUploadProgress.timer);
  finishUploadProgress.timer = window.setTimeout(() => {
    state.uploadProgress = null;
    renderUploadProgress();
  }, delay);
}

async function uploadMultipleFiles(files, { direct = false } = {}) {
  if (!state.allowWrite) {
    showToast("読み取り専用です。画面右上の「保存 OFF」から保存を有効にしてください。", "error");
    return;
  }
  if (!state.selectedBucket) {
    showToast("バケットを選択してください。", "error");
    return;
  }
  if (files.length === 0) return;
  if (files.length === 1 && !direct) {
    await uploadLocalFile(files[0]);
    return;
  }

  const targetKeys = files.map((file) => initialUploadKey(file));
  const confirmMessage = files.length === 1
    ? `${targetKeys[0]} にアップロードしますか？`
    : `${files.length}件のファイルを ${uploadTargetLabel()} にアップロードしますか？`;
  if (!window.confirm(confirmMessage)) return;

  const uploaded = [];
  const conflicts = [];
  const failures = [];
  state.uploadProgress = {
    total: files.length,
    done: 0,
    uploaded: 0,
    conflicts: 0,
    failures: 0,
    details: [],
  };
  renderUploadProgress();

  for (const [index, file] of files.entries()) {
    const targetKey = targetKeys[index];
    try {
      const metadata = await uploadFileToKey(file, targetKey);
      uploaded.push({ file, key: targetKey, metadata });
      updateUploadProgress({ uploaded: uploaded.length });
    } catch (error) {
      if (error.status === 409) {
        conflicts.push({ file, key: targetKey });
        updateUploadProgress({ conflicts: conflicts.length });
      } else {
        failures.push({ file, key: targetKey, error });
        updateUploadProgress({ failures: failures.length });
      }
      syncUploadIssueDetails(conflicts, failures);
    } finally {
      updateUploadProgress({ done: index + 1 });
    }
  }

  if (conflicts.length > 0 && window.confirm(`${conflicts.length}件は同じキーが既にあります。衝突分だけ上書きしますか？`)) {
    const overwriteTargets = conflicts.splice(0);
    updateUploadProgress({
      total: files.length + overwriteTargets.length,
      conflicts: conflicts.length,
    });
    syncUploadIssueDetails(conflicts, failures);
    for (const item of overwriteTargets) {
      try {
        const metadata = await uploadFileToKey(item.file, item.key, { force: true });
        uploaded.push({ ...item, metadata });
        updateUploadProgress({ uploaded: uploaded.length });
      } catch (error) {
        failures.push({ ...item, error });
        updateUploadProgress({ failures: failures.length });
        syncUploadIssueDetails(conflicts, failures);
      } finally {
        updateUploadProgress({ done: state.uploadProgress.done + 1 });
      }
    }
  }

  await loadObjects();
  const skipped = conflicts.length;
  const message = `アップロード完了: 成功 ${uploaded.length}件 / 衝突スキップ ${skipped}件 / 失敗 ${failures.length}件`;
  showToast(message, failures.length > 0 ? "error" : "info");
  finishUploadProgress();
  if (uploaded.length > 0) {
    const last = uploaded[uploaded.length - 1];
    await openUploadedObject(last.key, last.metadata, last.file);
  }
}

function createNewObject() {
  if (!state.allowWrite) {
    showToast("読み取り専用です。画面右上の「保存 OFF」から保存を有効にしてください。", "error");
    return;
  }
  if (!state.selectedBucket) {
    showToast("バケットを選択してください。", "error");
    return;
  }

  const prefix = elements.prefixInput.value.trim().replace(/^\/+/, "");
  const initial = prefix ? `${prefix.endsWith("/") ? prefix : `${prefix}/`}new-file.txt` : "new-file.txt";
  const key = normalizeNewKey(window.prompt("新規ファイルのキーを入力してください。", initial) ?? "", prefix);
  if (!key) return;

  state.selectedKey = key;
  state.metadata = null;
  state.originalContent = "";
  state.currentContentType = contentTypeForKey(key);
  state.isNew = true;
  state.isEnvMode = false;
  state.envRows = [];
  state.canUseEnvMode = isEnvKey(key);
  elements.selectedKey.textContent = key;
  updateDownloadButton();
  if (isEnvKey(key)) {
    showEnvEditor("");
    setMode("env");
  } else {
    showTextEditor("");
    setMode("text");
  }
  elements.previewPane.replaceChildren();
  elements.saveButton.disabled = !state.allowWrite;
  elements.diffButton.disabled = false;
  elements.toggleEnvModeButton.disabled = !state.canUseEnvMode;
  hideDiff();
  setMetadata({
    contentType: state.currentContentType,
    contentLength: 0,
  });
  renderObjectList();
  if (!state.isEnvMode) elements.editor.focus();
}

function toggleEnvMode() {
  if (!state.canUseEnvMode) return;

  if (state.isEnvMode) {
    showTextEditor(serializeEnvRows());
    setMode("text");
  } else {
    showEnvEditor(elements.editor.value);
    setMode("env");
  }
}

function isValidBucketName(name) {
  return /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(name) &&
    !name.includes("..") &&
    !name.includes(".-") &&
    !name.includes("-.") &&
    !/^\d+\.\d+\.\d+\.\d+$/.test(name);
}

async function createNewBucket() {
  if (!state.allowCreateBucket) {
    showToast("バケット作成は無効です。--allow-create-bucket を付けて起動してください。", "error");
    return;
  }

  const input = window.prompt("新規バケット名を入力してください。");
  const bucket = input?.trim();
  if (!bucket) return;

  if (!isValidBucketName(bucket)) {
    showToast("バケット名は小文字英数字、ハイフン、ドットで3-63文字にしてください。", "error");
    return;
  }

  if (!window.confirm(`バケットを作成しますか？\n${bucket}`)) return;

  await requestJson("/api/buckets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bucket }),
  });

  state.selectedBucket = bucket;
  updateConnectionLabel();
  await loadBuckets();
  renderBucketSearch();
  clearSelection();
  await loadObjects();
  updateConnectionLabel();
  showToast(`バケットを作成しました: ${bucket}`);
}

function showDiff() {
  const diff = diffLines(state.originalContent, getCurrentContent());
  elements.diffOutput.textContent = diff.trim() ? diff : "変更はありません。";
  elements.diffPane.classList.remove("hidden");
  elements.diffButton.textContent = "差分を閉じる";
}

function hideDiff() {
  elements.diffPane.classList.add("hidden");
  elements.diffButton.textContent = "差分";
}

function toggleDiff() {
  if (elements.diffPane.classList.contains("hidden")) {
    showDiff();
  } else {
    hideDiff();
  }
}

async function setWriteMode(allowWrite) {
  const result = await requestJson("/api/write-mode", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ allowWrite }),
  });
  state.allowWrite = !!result.allowWrite;
  updateWriteControls();
  showToast(state.allowWrite ? "保存を有効にしました。" : "読み取り専用に切り替えました。");
}

function dataTransferHasFiles(event) {
  return [...(event.dataTransfer?.types ?? [])].includes("Files");
}

function droppedFiles(event) {
  return [...(event.dataTransfer?.files ?? [])].filter((file) => file.size > 0 || file.name);
}

function setDragActive(active) {
  document.body.classList.toggle("drag-upload-active", active);
}

async function boot() {
  try {
    await loadConfig();
    await loadBuckets();
    await loadObjects();
  } catch (error) {
    showToast(error.message, "error");
  }
}

elements.prefixForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  renderPrefixSuggestions(false);
  try {
    await loadObjects();
  } catch (error) {
    showToast(error.message, "error");
  }
});

elements.prefixInput.addEventListener("focus", () => {
  renderPrefixSuggestions(true);
});

elements.prefixInput.addEventListener("input", () => {
  renderPrefixSuggestions(true);
});

elements.prefixInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    const [first] = filteredPrefixNames();
    if (first && first !== elements.prefixInput.value.trim()) {
      event.preventDefault();
      selectPrefix(first);
    }
  } else if (event.key === "Escape") {
    renderPrefixSuggestions(false);
  }
});

elements.prefixInput.addEventListener("blur", () => {
  window.setTimeout(() => {
    renderPrefixSuggestions(false);
  }, 120);
});

elements.objectFilterInput.addEventListener("input", () => {
  renderObjectList();
});

elements.objectFilterInput.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    elements.objectFilterInput.value = "";
    renderObjectList();
  }
});

elements.bucketSearchInput.addEventListener("focus", () => {
  elements.bucketSearchInput.select();
  renderBucketSuggestions(true);
});

elements.bucketSearchInput.addEventListener("input", () => {
  renderBucketSuggestions(true);
});

elements.bucketSearchInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    const [first] = filteredBucketNames();
    if (first) selectBucket(first);
  } else if (event.key === "Escape") {
    elements.bucketSearchInput.value = state.selectedBucket ?? "";
    renderBucketSuggestions(false);
  }
});

elements.bucketSearchInput.addEventListener("blur", () => {
  window.setTimeout(() => {
    elements.bucketSearchInput.value = state.selectedBucket ?? "";
    renderBucketSuggestions(false);
  }, 120);
});

elements.refreshButton.addEventListener("click", async () => {
  try {
    await loadObjects();
    showToast("一覧を更新しました。");
  } catch (error) {
    showToast(error.message, "error");
  }
});

elements.loadMoreButton.addEventListener("click", async () => {
  try {
    await loadMoreObjects();
  } catch (error) {
    showToast(error.message, "error");
  }
});

elements.copyKeyButton.addEventListener("click", () => {
  copyText(state.selectedKey, "key");
});

elements.copyS3UriButton.addEventListener("click", () => {
  if (!state.selectedBucket || !state.selectedKey) return;
  copyText(`s3://${state.selectedBucket}/${state.selectedKey}`, "S3 URI");
});

elements.copyDownloadUrlButton.addEventListener("click", () => {
  if (!state.selectedKey || state.isNew) return;
  copyText(makeDownloadUrl(state.selectedKey), "download URL");
});

elements.copyObjectButton.addEventListener("click", async () => {
  try {
    await copySelectedObject();
  } catch (error) {
    showToast(error.message, "error");
  }
});

elements.newButton.addEventListener("click", createNewObject);
elements.uploadFileButton.addEventListener("click", () => {
  if (!state.allowWrite) {
    showToast("読み取り専用です。画面右上の「保存 OFF」から保存を有効にしてください。", "error");
    return;
  }
  if (!state.selectedBucket) {
    showToast("バケットを選択してください。", "error");
    return;
  }
  elements.uploadFileInput.click();
});
elements.uploadFileInput.addEventListener("change", () => {
  const files = [...(elements.uploadFileInput.files ?? [])];
  elements.uploadFileInput.value = "";
  uploadMultipleFiles(files).catch((error) => showToast(error.message, "error"));
});

document.addEventListener("dragenter", (event) => {
  if (!dataTransferHasFiles(event)) return;
  event.preventDefault();
  state.dragDepth += 1;
  setDragActive(true);
});

document.addEventListener("dragover", (event) => {
  if (!dataTransferHasFiles(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = state.allowWrite && state.selectedBucket ? "copy" : "none";
});

document.addEventListener("dragleave", (event) => {
  if (!dataTransferHasFiles(event)) return;
  state.dragDepth = Math.max(0, state.dragDepth - 1);
  if (state.dragDepth === 0) setDragActive(false);
});

document.addEventListener("drop", (event) => {
  if (!dataTransferHasFiles(event)) return;
  event.preventDefault();
  state.dragDepth = 0;
  setDragActive(false);

  if (!state.allowWrite) {
    showToast("読み取り専用です。画面右上の「保存 OFF」から保存を有効にしてください。", "error");
    return;
  }
  if (!state.selectedBucket) {
    showToast("バケットを選択してください。", "error");
    return;
  }

  const files = droppedFiles(event);
  uploadMultipleFiles(files, { direct: true }).catch((error) => showToast(error.message, "error"));
});
elements.newBucketButton.addEventListener("click", async () => {
  try {
    await createNewBucket();
  } catch (error) {
    showToast(error.message, "error");
  }
});

elements.addEnvRowButton.addEventListener("click", () => {
  if (!state.allowWrite) return;
  state.envRows.push({ type: "entry", key: "", value: "" });
  renderEnvRows();
});

elements.writeModeButton.addEventListener("click", async () => {
  const nextAllowWrite = !state.allowWrite;
  if (nextAllowWrite && !window.confirm("このWeb UIからS3への保存を有効にしますか？")) return;
  if (!nextAllowWrite && getCurrentContent() !== state.originalContent && !window.confirm("未保存の編集があります。読み取り専用に切り替えますか？")) return;

  try {
    await setWriteMode(nextAllowWrite);
  } catch (error) {
    showToast(error.message, "error");
  }
});

elements.wideEditorButton.addEventListener("click", () => {
  state.wideEditor = !state.wideEditor;
  updateEditorLayout();
});

elements.toggleEnvModeButton.addEventListener("click", toggleEnvMode);

elements.contentTypeSelect.addEventListener("change", () => {
  if (elements.contentTypeSelect.value === "__custom__") {
    elements.contentTypeInput.classList.remove("hidden");
    elements.contentTypeInput.focus();
    state.currentContentType = elements.contentTypeInput.value.trim() || null;
    return;
  }
  updateContentType(elements.contentTypeSelect.value);
});

elements.contentTypeInput.addEventListener("input", () => {
  updateContentType(elements.contentTypeInput.value);
});

elements.saveButton.addEventListener("click", async () => {
  if (!window.confirm("この内容をS3へアップロードしますか？")) return;
  try {
    await saveObject(false);
  } catch (error) {
    showToast(error.message, "error");
  }
});

elements.diffButton.addEventListener("click", toggleDiff);
elements.closeDiffButton.addEventListener("click", hideDiff);

boot();
updateEditorLayout();
