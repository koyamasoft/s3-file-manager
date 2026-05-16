const state = {
  config: null,
  buckets: [],
  selectedBucket: null,
  objects: [],
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
};

const elements = {
  connectionLabel: document.querySelector("#connectionLabel"),
  newBucketButton: document.querySelector("#newBucketButton"),
  newButton: document.querySelector("#newButton"),
  refreshButton: document.querySelector("#refreshButton"),
  prefixForm: document.querySelector("#prefixForm"),
  bucketSearchInput: document.querySelector("#bucketSearchInput"),
  bucketSuggestions: document.querySelector("#bucketSuggestions"),
  prefixInput: document.querySelector("#prefixInput"),
  prefixSuggestions: document.querySelector("#prefixSuggestions"),
  objectCount: document.querySelector("#objectCount"),
  objectList: document.querySelector("#objectList"),
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
  saveButton: document.querySelector("#saveButton"),
  diffButton: document.querySelector("#diffButton"),
  diffPane: document.querySelector("#diffPane"),
  diffOutput: document.querySelector("#diffOutput"),
  closeDiffButton: document.querySelector("#closeDiffButton"),
  toast: document.querySelector("#toast"),
  metaBucket: document.querySelector("#metaBucket"),
  metaContentType: document.querySelector("#metaContentType"),
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

function updateWriteControls() {
  elements.newButton.disabled = !state.allowWrite;
  elements.newBucketButton.disabled = !state.allowCreateBucket;
  elements.saveButton.disabled = !state.allowWrite || !state.selectedKey || (!state.metadata && !state.isNew);
  elements.addEnvRowButton.disabled = !state.allowWrite;
  elements.writeModeButton.textContent = state.allowWrite ? "保存 ON" : "保存 OFF";
  elements.writeModeButton.classList.toggle("active", state.allowWrite);

  if (!elements.editor.classList.contains("hidden")) {
    elements.editor.disabled = !state.allowWrite || (!state.selectedKey && !state.isNew);
  }

  if (!elements.envPane.classList.contains("hidden")) {
    renderEnvRows();
  }
}

function setMetadata(metadata) {
  elements.metaBucket.textContent = state.selectedBucket ?? "-";
  elements.metaContentType.textContent = metadata?.contentType ?? "-";
  elements.metaSize.textContent = formatBytes(metadata?.contentLength);
  elements.metaEtag.textContent = metadata?.etag ?? "-";
  elements.metaLastModified.textContent = metadata?.lastModified ?? "-";
}

function renderObjectList() {
  elements.objectCount.textContent = String(state.objects.length);
  elements.objectList.replaceChildren();

  for (const object of state.objects) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.classList.toggle("active", object.key === state.selectedKey);

    const key = document.createElement("span");
    key.className = "object-key";
    key.textContent = object.key;

    const meta = document.createElement("span");
    meta.className = "object-meta";
    meta.textContent = `${object.sizeLabel} · ${object.lastModified ?? "-"}`;

    button.append(key, meta);
    button.addEventListener("click", () => openObject(object.key));
    item.append(button);
    elements.objectList.append(item);
  }
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
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".xml": "application/xml; charset=utf-8",
    ".yaml": "application/yaml; charset=utf-8",
    ".yml": "application/yaml; charset=utf-8",
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

function renderPreview(key, metadata) {
  elements.previewPane.replaceChildren();
  const contentType = metadata?.contentType ?? "";

  if (isPreviewImageType(contentType)) {
    const image = document.createElement("img");
    image.alt = key;
    const params = new URLSearchParams({
      bucket: state.selectedBucket,
      key,
      t: String(Date.now()),
    });
    image.src = `/api/raw?${params.toString()}`;
    elements.previewPane.append(image);
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

async function loadObjects() {
  const prefix = elements.prefixInput.value.trim();
  if (!state.selectedBucket) {
    state.objects = [];
    renderObjectList();
    throw new Error("バケットを選択してください。");
  }
  const params = new URLSearchParams({
    bucket: state.selectedBucket,
    prefix,
  });
  const data = await requestJson(`/api/list?${params.toString()}`);
  state.objects = data.objects;
  renderObjectList();
  renderPrefixSuggestions(false);
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
    contentType: state.currentContentType,
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

elements.newButton.addEventListener("click", createNewObject);
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
