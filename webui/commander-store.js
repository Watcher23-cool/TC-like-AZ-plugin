import { createStore } from "/js/AlpineStore.js";
import { callJsonApi } from "/js/api.js";
import { openModal, closeModal } from "/js/modals.js";
import {
  toastFrontendError,
  toastFrontendInfo,
  toastFrontendSuccess,
} from "/components/notifications/notification-store.js";

const MODAL_PATH = "/plugins/total_commander_plugin/webui/commander-modal.html";
const API_PATH = "/plugins/total_commander_plugin/fs";

const DEFAULT_LEFT = "/a0/usr/projects";
const DEFAULT_RIGHT = "/a0/usr";
const WINDOW_SIZE_STORAGE_KEY = "totalCommander.windowSize.v2";
const DEFAULT_WINDOW_WIDTH = 1700;
const DEFAULT_WINDOW_HEIGHT = 920;
const MIN_WINDOW_WIDTH = 1080;
const MIN_WINDOW_HEIGHT = 620;
const VIEWPORT_MARGIN = 20;

function clampWindowSize(width, height) {
  const viewportWidth = typeof window !== "undefined"
    ? window.innerWidth
    : DEFAULT_WINDOW_WIDTH + VIEWPORT_MARGIN;
  const viewportHeight = typeof window !== "undefined"
    ? window.innerHeight
    : DEFAULT_WINDOW_HEIGHT + VIEWPORT_MARGIN;

  const maxWidth = Math.max(560, viewportWidth - VIEWPORT_MARGIN);
  const maxHeight = Math.max(420, viewportHeight - VIEWPORT_MARGIN);

  const effectiveMinWidth = Math.min(MIN_WINDOW_WIDTH, maxWidth);
  const effectiveMinHeight = Math.min(MIN_WINDOW_HEIGHT, maxHeight);

  const w = Math.max(effectiveMinWidth, Math.min(Number(width) || DEFAULT_WINDOW_WIDTH, maxWidth));
  const h = Math.max(effectiveMinHeight, Math.min(Number(height) || DEFAULT_WINDOW_HEIGHT, maxHeight));

  return { width: Math.round(w), height: Math.round(h) };
}

function loadStoredWindowSize() {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(WINDOW_SIZE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (!Number.isFinite(Number(parsed.width)) || !Number.isFinite(Number(parsed.height))) {
      return null;
    }
    return {
      width: Number(parsed.width),
      height: Number(parsed.height),
    };
  } catch {
    return null;
  }
}

function saveStoredWindowSize(width, height) {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(
      WINDOW_SIZE_STORAGE_KEY,
      JSON.stringify({ width: Math.round(width), height: Math.round(height) }),
    );
  } catch {
    // Ignore storage errors.
  }
}


const BINARY_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".zip",
  ".tar", ".gz", ".tgz", ".7z", ".rar", ".pdf", ".mp3", ".mp4",
  ".avi", ".mkv", ".mov", ".woff", ".woff2", ".ttf", ".otf", ".exe",
  ".bin", ".so", ".dll", ".pyc", ".class",
]);

function mkPane(cwd) {
  return {
    cwd,
    inputPath: cwd,
    entries: [],
    selectedNames: [],
    selectedIndex: -1,
    loading: false,
    error: "",
  };
}

function basename(path) {
  if (!path) return "";
  const p = String(path).replace(/\/+$/, "");
  const idx = p.lastIndexOf("/");
  if (idx < 0) return p;
  return p.slice(idx + 1);
}

function joinPath(base, name) {
  const b = String(base || "").replace(/\/+$/, "") || "/";
  const n = String(name || "").replace(/^\/+/, "");
  return b === "/" ? `/${n}` : `${b}/${n}`;
}

function parentPath(path) {
  const p = String(path || "/").replace(/\/+$/, "") || "/";
  if (p === "/") return "/";
  const idx = p.lastIndexOf("/");
  if (idx <= 0) return "/";
  return p.slice(0, idx);
}

function inferArchiveFormat(name) {
  const n = String(name || "").toLowerCase();
  if (n.endsWith(".tar.gz") || n.endsWith(".tgz")) return "tar.gz";
  if (n.endsWith(".tar")) return "tar";
  return "zip";
}

function normalizeArchiveName(name) {
  const n = String(name || "").trim();
  if (!n) return "archive.zip";
  const lower = n.toLowerCase();
  if (lower.endsWith(".zip") || lower.endsWith(".tar") || lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) {
    return n;
  }
  return `${n}.zip`;
}

const model = {
  initialized: false,
  open: false,
  activePane: "left",
  left: mkPane(DEFAULT_LEFT),
  right: mkPane(DEFAULT_RIGHT),
  busy: false,

  windowState: {
    width: DEFAULT_WINDOW_WIDTH,
    height: DEFAULT_WINDOW_HEIGHT,
  },

  _resize: {
    active: false,
    edge: "se",
    startX: 0,
    startY: 0,
    startWidth: DEFAULT_WINDOW_WIDTH,
    startHeight: DEFAULT_WINDOW_HEIGHT,
  },
  _boundResizeMove: null,
  _boundResizeEnd: null,
  _boundViewportResize: null,
  _modalInner: null,



  editor: {
    open: false,
    path: "",
    content: "",
    original: "",
    loading: false,
    saving: false,
    viewOnly: false,
    truncated: false,
  },

  async init() {
    if (this.initialized) return;

    this._boundResizeMove = (event) => this.onResizeMove(event);
    this._boundResizeEnd = () => this.stopResize();
    this._boundViewportResize = () => this.onViewportResize();

    this.applyInitialWindowSize();
    this.initialized = true;
  },

  async show() {
    await openModal(MODAL_PATH);
  },

  hide() {
    closeModal(MODAL_PATH);
  },

  async onOpen(rootEl = null) {
    this.open = true;
    this.editor.open = false;

    this._modalInner = rootEl?.closest(".modal")?.querySelector(".modal-inner") || null;

    this.attachViewportListener();
    this.applyInitialWindowSize();
    this.applyModalShellSize();

    if (this.left.entries.length === 0) {
      await this.loadPane("left", this.left.cwd || DEFAULT_LEFT);
    }
    if (this.right.entries.length === 0) {
      await this.loadPane("right", this.right.cwd || DEFAULT_RIGHT);
    }
  },

  onClose() {
    this.stopResize();
    this.detachViewportListener();
    this._modalInner = null;
    this.open = false;
    this.editor.open = false;
  },

  applyInitialWindowSize() {
    const stored = loadStoredWindowSize();
    const source = stored || {
      width: DEFAULT_WINDOW_WIDTH,
      height: DEFAULT_WINDOW_HEIGHT,
    };
    const clamped = clampWindowSize(source.width, source.height);
    this.windowState.width = clamped.width;
    this.windowState.height = clamped.height;
  },

  persistWindowSize() {
    saveStoredWindowSize(this.windowState.width, this.windowState.height);
  },

  applyModalShellSize() {
    const el = this._modalInner;
    if (!el) return;

    const width = `${this.windowState.width}px`;
    const height = `${this.windowState.height}px`;

    el.style.width = width;
    el.style.maxWidth = width;
    el.style.height = height;
    el.style.maxHeight = height;
  },

  resetWindowSize() {
    const clamped = clampWindowSize(DEFAULT_WINDOW_WIDTH, DEFAULT_WINDOW_HEIGHT);
    this.windowState.width = clamped.width;
    this.windowState.height = clamped.height;
    this.applyModalShellSize();
    this.persistWindowSize();
  },

  maximizeWindow() {
    const clamped = clampWindowSize(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
    this.windowState.width = clamped.width;
    this.windowState.height = clamped.height;
    this.applyModalShellSize();
    this.persistWindowSize();
  },

  getWindowStyle() {
    return `width: ${this.windowState.width}px; height: ${this.windowState.height}px;`;
  },

  attachViewportListener() {
    if (!this._boundViewportResize) return;
    window.addEventListener("resize", this._boundViewportResize);
  },

  detachViewportListener() {
    if (!this._boundViewportResize) return;
    window.removeEventListener("resize", this._boundViewportResize);
  },

  onViewportResize() {
    const clamped = clampWindowSize(this.windowState.width, this.windowState.height);
    this.windowState.width = clamped.width;
    this.windowState.height = clamped.height;
    this.applyModalShellSize();
    this.persistWindowSize();
  },

  startResize(event, edge = "se") {
    if (!this.open) return;
    event.preventDefault();
    event.stopPropagation();

    this._resize.active = true;
    this._resize.edge = edge;
    this._resize.startX = Number(event.clientX) || 0;
    this._resize.startY = Number(event.clientY) || 0;
    this._resize.startWidth = this.windowState.width;
    this._resize.startHeight = this.windowState.height;

    if (this._boundResizeMove) {
      document.addEventListener("mousemove", this._boundResizeMove);
    }
    if (this._boundResizeEnd) {
      document.addEventListener("mouseup", this._boundResizeEnd);
    }
  },

  onResizeMove(event) {
    if (!this._resize.active) return;

    const dx = (Number(event.clientX) || 0) - this._resize.startX;
    const dy = (Number(event.clientY) || 0) - this._resize.startY;

    let nextWidth = this._resize.startWidth;
    let nextHeight = this._resize.startHeight;

    if (this._resize.edge.includes("e")) {
      nextWidth = this._resize.startWidth + dx;
    }
    if (this._resize.edge.includes("s")) {
      nextHeight = this._resize.startHeight + dy;
    }

    const clamped = clampWindowSize(nextWidth, nextHeight);
    this.windowState.width = clamped.width;
    this.windowState.height = clamped.height;
    this.applyModalShellSize();
  },

  stopResize() {
    const wasActive = this._resize.active;
    this._resize.active = false;

    if (this._boundResizeMove) {
      document.removeEventListener("mousemove", this._boundResizeMove);
    }
    if (this._boundResizeEnd) {
      document.removeEventListener("mouseup", this._boundResizeEnd);
    }

    if (wasActive) {
      this.persistWindowSize();
    }
  },

  pane(side) {
    return side === "right" ? this.right : this.left;
  },

  otherSide(side) {
    return side === "left" ? "right" : "left";
  },

  async api(action, payload = {}) {
    return callJsonApi(API_PATH, { action, ...payload });
  },

  sortEntries(entries) {
    return [...(entries || [])].sort((a, b) => {
      if (a.is_dir && !b.is_dir) return -1;
      if (!a.is_dir && b.is_dir) return 1;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
  },

  setActive(side) {
    this.activePane = side;
  },

  isSelected(side, name) {
    return this.pane(side).selectedNames.includes(name);
  },

  clearSelection(side) {
    const pane = this.pane(side);
    pane.selectedNames = [];
    pane.selectedIndex = -1;
  },

  selectedEntries(side) {
    const pane = this.pane(side);
    const map = new Map(pane.entries.map((e) => [e.name, e]));

    const selected = pane.selectedNames
      .map((name) => map.get(name))
      .filter(Boolean);

    if (selected.length > 0) return selected;

    if (pane.selectedIndex >= 0 && pane.selectedIndex < pane.entries.length) {
      return [pane.entries[pane.selectedIndex]];
    }

    return [];
  },

  selectedPaths(side) {
    return this.selectedEntries(side).map((e) => e.path);
  },

  focusedEntry(side) {
    const pane = this.pane(side);
    const selected = this.selectedEntries(side);
    if (selected.length > 0) return selected[0];
    if (pane.entries.length === 0) return null;
    return pane.entries[Math.max(0, pane.selectedIndex)] || pane.entries[0];
  },

  async loadPane(side, path, { keepName = "" } = {}) {
    const pane = this.pane(side);
    pane.loading = true;
    pane.error = "";

    try {
      const res = await this.api("list", { path });
      pane.cwd = res.cwd;
      pane.inputPath = res.cwd;
      pane.entries = this.sortEntries(res.entries || []);

      if (keepName) {
        const idx = pane.entries.findIndex((e) => e.name === keepName);
        if (idx >= 0) {
          pane.selectedIndex = idx;
          pane.selectedNames = [pane.entries[idx].name];
          return;
        }
      }

      pane.selectedNames = [];
      pane.selectedIndex = pane.entries.length > 0 ? 0 : -1;
    } catch (error) {
      pane.error = error?.message || "Failed to load directory";
      await toastFrontendError(pane.error, "Total Commander");
    } finally {
      pane.loading = false;
    }
  },

  async goPath(side) {
    const pane = this.pane(side);
    const path = String(pane.inputPath || "").trim();
    if (!path) return;
    await this.loadPane(side, path);
  },

  async goParent(side) {
    const pane = this.pane(side);
    const parent = parentPath(pane.cwd);
    await this.loadPane(side, parent);
  },

  rowClick(side, index, evt) {
    this.setActive(side);
    const pane = this.pane(side);
    const entry = pane.entries[index];
    if (!entry) return;

    const multi = !!(evt?.ctrlKey || evt?.metaKey);

    if (multi) {
      if (pane.selectedNames.includes(entry.name)) {
        pane.selectedNames = pane.selectedNames.filter((n) => n !== entry.name);
      } else {
        pane.selectedNames = [...pane.selectedNames, entry.name];
      }
      pane.selectedIndex = index;
      return;
    }

    pane.selectedNames = [entry.name];
    pane.selectedIndex = index;
  },

  async openEntry(side, index) {
    this.setActive(side);
    const pane = this.pane(side);
    const entry = pane.entries[index];
    if (!entry) return;

    pane.selectedIndex = index;
    pane.selectedNames = [entry.name];

    if (entry.is_dir) {
      await this.loadPane(side, entry.path);
      return;
    }

    if (this.canEditEntry(entry)) {
      await this.openEditor(entry.path, true);
      return;
    }

    await toastFrontendInfo("This file type is not previewable as text.", "Total Commander");
  },

  async refreshBoth() {
    const keepLeft = this.focusedEntry("left")?.name || "";
    const keepRight = this.focusedEntry("right")?.name || "";
    await Promise.all([
      this.loadPane("left", this.left.cwd, { keepName: keepLeft }),
      this.loadPane("right", this.right.cwd, { keepName: keepRight }),
    ]);
  },

  canEditEntry(entry) {
    if (!entry || entry.is_dir) return false;
    const ext = String(entry.ext || "").toLowerCase();
    if (BINARY_EXT.has(ext)) return false;
    return true;
  },

  async viewSelected(side = this.activePane) {
    const entry = this.focusedEntry(side);
    if (!entry || entry.is_dir) {
      await toastFrontendError("Select a file first.", "Total Commander");
      return;
    }
    if (!this.canEditEntry(entry)) {
      await toastFrontendError("Selected file is not text-editable.", "Total Commander");
      return;
    }
    await this.openEditor(entry.path, true);
  },

  async editSelected(side = this.activePane) {
    const entry = this.focusedEntry(side);
    if (!entry || entry.is_dir) {
      await toastFrontendError("Select a file first.", "Total Commander");
      return;
    }
    if (!this.canEditEntry(entry)) {
      await toastFrontendError("Selected file is not text-editable.", "Total Commander");
      return;
    }
    await this.openEditor(entry.path, false);
  },

  async openEditor(path, viewOnly = false) {
    this.editor.loading = true;
    this.editor.open = true;
    this.editor.viewOnly = viewOnly;
    this.editor.path = path;
    this.editor.content = "";
    this.editor.original = "";
    this.editor.truncated = false;

    try {
      const res = await this.api("read_text", { path, max_bytes: 1_048_576 });
      this.editor.content = res.content || "";
      this.editor.original = this.editor.content;
      this.editor.truncated = !!res.truncated;
    } catch (error) {
      this.editor.open = false;
      await toastFrontendError(error?.message || "Failed to open file.", "Total Commander");
    } finally {
      this.editor.loading = false;
    }
  },

  editorDirty() {
    return this.editor.content !== this.editor.original;
  },

  async saveEditor() {
    if (!this.editor.open || this.editor.viewOnly || this.editor.saving) return;

    this.editor.saving = true;
    try {
      await this.api("write_text", {
        path: this.editor.path,
        content: this.editor.content,
      });
      this.editor.original = this.editor.content;
      await toastFrontendSuccess("File saved.", "Total Commander");
      await this.refreshBoth();
    } catch (error) {
      await toastFrontendError(error?.message || "Failed to save file.", "Total Commander");
    } finally {
      this.editor.saving = false;
    }
  },

  closeEditor() {
    if (!this.editor.open) return;
    if (!this.editor.viewOnly && this.editorDirty()) {
      const ok = window.confirm("Discard unsaved changes?");
      if (!ok) return;
    }
    this.editor.open = false;
  },

  async createFolder(side = this.activePane) {
    const pane = this.pane(side);
    const name = window.prompt("Folder name:");
    if (!name) return;

    try {
      await this.api("mkdir", { path: pane.cwd, name });
      await this.loadPane(side, pane.cwd);
      await toastFrontendSuccess("Folder created.", "Total Commander");
    } catch (error) {
      await toastFrontendError(error?.message || "Failed to create folder.", "Total Commander");
    }
  },

  async createFile(side = this.activePane) {
    const pane = this.pane(side);
    const name = window.prompt("File name:");
    if (!name) return;

    try {
      const res = await this.api("create_file", { path: pane.cwd, name });
      await this.loadPane(side, pane.cwd, { keepName: basename(res.path) });
      await toastFrontendSuccess("File created.", "Total Commander");
    } catch (error) {
      await toastFrontendError(error?.message || "Failed to create file.", "Total Commander");
    }
  },

  async renameSelected(side = this.activePane) {
    const selected = this.selectedEntries(side);
    if (selected.length !== 1) {
      await toastFrontendError("Select exactly one file or folder to rename.", "Total Commander");
      return;
    }

    const item = selected[0];
    const newName = window.prompt("New name:", item.name);
    if (!newName || newName === item.name) return;

    try {
      const res = await this.api("rename", {
        path: item.path,
        new_name: newName,
      });
      await this.loadPane(side, this.pane(side).cwd, { keepName: basename(res.path) });
      await toastFrontendSuccess("Renamed.", "Total Commander");
    } catch (error) {
      await toastFrontendError(error?.message || "Rename failed.", "Total Commander");
    }
  },

  async deleteSelected(side = this.activePane) {
    const paths = this.selectedPaths(side);
    if (paths.length === 0) {
      await toastFrontendError("Nothing selected.", "Total Commander");
      return;
    }

    const ok = window.confirm(`Delete ${paths.length} item(s)? This cannot be undone.`);
    if (!ok) return;

    try {
      await this.api("delete", { paths });
      await this.loadPane(side, this.pane(side).cwd);
      await toastFrontendSuccess("Deleted.", "Total Commander");
    } catch (error) {
      await toastFrontendError(error?.message || "Delete failed.", "Total Commander");
    }
  },

  async copySelected(fromSide = this.activePane) {
    const toSide = this.otherSide(fromSide);
    const srcPaths = this.selectedPaths(fromSide);
    if (srcPaths.length === 0) {
      await toastFrontendError("Nothing selected to copy.", "Total Commander");
      return;
    }

    try {
      await this.api("copy", {
        sources: srcPaths,
        destination: this.pane(toSide).cwd,
      });
      await this.loadPane(toSide, this.pane(toSide).cwd);
      await toastFrontendSuccess(`Copied ${srcPaths.length} item(s).`, "Total Commander");
    } catch (error) {
      await toastFrontendError(error?.message || "Copy failed.", "Total Commander");
    }
  },

  async moveSelected(fromSide = this.activePane) {
    const toSide = this.otherSide(fromSide);
    const srcPaths = this.selectedPaths(fromSide);
    if (srcPaths.length === 0) {
      await toastFrontendError("Nothing selected to move.", "Total Commander");
      return;
    }

    try {
      await this.api("move", {
        sources: srcPaths,
        destination: this.pane(toSide).cwd,
      });
      await Promise.all([
        this.loadPane(fromSide, this.pane(fromSide).cwd),
        this.loadPane(toSide, this.pane(toSide).cwd),
      ]);
      await toastFrontendSuccess(`Moved ${srcPaths.length} item(s).`, "Total Commander");
    } catch (error) {
      await toastFrontendError(error?.message || "Move failed.", "Total Commander");
    }
  },

  async compressSelected(side = this.activePane) {
    const pane = this.pane(side);
    const srcPaths = this.selectedPaths(side);
    if (srcPaths.length === 0) {
      await toastFrontendError("Nothing selected to compress.", "Total Commander");
      return;
    }

    const seed = basename(srcPaths[0]) || "archive";
    const typed = window.prompt("Archive name (.zip/.tar/.tar.gz):", `${seed}.zip`);
    if (!typed) return;

    const fileName = normalizeArchiveName(typed);
    const archivePath = fileName.includes("/") ? fileName : joinPath(pane.cwd, fileName);
    const format = inferArchiveFormat(fileName);

    try {
      await this.api("compress", {
        sources: srcPaths,
        archive_path: archivePath,
        format,
      });
      await this.loadPane(side, pane.cwd, { keepName: basename(archivePath) });
      await toastFrontendSuccess("Archive created.", "Total Commander");
    } catch (error) {
      await toastFrontendError(error?.message || "Compression failed.", "Total Commander");
    }
  },

  async extractSelected(side = this.activePane) {
    const pane = this.pane(side);
    const selected = this.selectedEntries(side);
    if (selected.length !== 1) {
      await toastFrontendError("Select exactly one archive to extract.", "Total Commander");
      return;
    }

    const archive = selected[0];
    const dst = window.prompt("Extract destination path:", pane.cwd);
    if (!dst) return;

    try {
      await this.api("extract", {
        archive_path: archive.path,
        destination: dst,
      });
      await this.loadPane(side, pane.cwd);
      await toastFrontendSuccess("Archive extracted.", "Total Commander");
    } catch (error) {
      await toastFrontendError(error?.message || "Extraction failed.", "Total Commander");
    }
  },

  moveSelection(delta) {
    const side = this.activePane;
    const pane = this.pane(side);
    const len = pane.entries.length;
    if (len === 0) return;

    let next = pane.selectedIndex;
    if (next < 0) next = 0;
    else next = (next + delta + len) % len;

    pane.selectedIndex = next;
    pane.selectedNames = [pane.entries[next].name];
  },

  async openFocused() {
    const side = this.activePane;
    const pane = this.pane(side);
    if (pane.entries.length === 0) return;
    const idx = pane.selectedIndex >= 0 ? pane.selectedIndex : 0;
    await this.openEntry(side, idx);
  },

  switchPane() {
    this.activePane = this.activePane === "left" ? "right" : "left";
  },

  formatSize(size) {
    const n = Number(size || 0);
    if (!Number.isFinite(n) || n < 0) return "0 B";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  },

  formatDate(ts) {
    const n = Number(ts || 0);
    if (!Number.isFinite(n) || n <= 0) return "-";
    try {
      return new Date(n * 1000).toLocaleString();
    } catch {
      return "-";
    }
  },

  selectionLabel(side) {
    const count = this.selectedEntries(side).length;
    if (count === 0) return "No selection";
    if (count === 1) return "1 item selected";
    return `${count} items selected`;
  },

  async handleKeydown(event) {
    if (!this.open) return;

    const key = event.key;
    const ctrl = event.ctrlKey || event.metaKey;
    const alt = event.altKey;

    const tag = (event.target?.tagName || "").toLowerCase();
    const typing = tag === "input" || tag === "textarea" || !!event.target?.isContentEditable;

    if (this.editor.open) {
      if (key === "Escape") {
        event.preventDefault();
        this.closeEditor();
        return;
      }
      if (ctrl && key.toLowerCase() === "s") {
        event.preventDefault();
        await this.saveEditor();
        return;
      }
      return;
    }

    if (key === "Tab") {
      event.preventDefault();
      this.switchPane();
      return;
    }

    if (typing && !key.startsWith("F") && key !== "Escape" && !(ctrl && ["n", "r"].includes(key.toLowerCase()))) {
      return;
    }

    if (key === "Escape") {
      event.preventDefault();
      this.hide();
      return;
    }

    if (key === "ArrowDown") {
      event.preventDefault();
      this.moveSelection(1);
      return;
    }

    if (key === "ArrowUp") {
      event.preventDefault();
      this.moveSelection(-1);
      return;
    }

    if (key === "Enter") {
      event.preventDefault();
      await this.openFocused();
      return;
    }

    if (key === "Backspace") {
      event.preventDefault();
      await this.goParent(this.activePane);
      return;
    }

    if (key === "F2") {
      event.preventDefault();
      await this.renameSelected(this.activePane);
      return;
    }

    if (key === "F3") {
      event.preventDefault();
      await this.viewSelected(this.activePane);
      return;
    }

    if (key === "F4") {
      event.preventDefault();
      await this.editSelected(this.activePane);
      return;
    }

    if (key === "F5" && !alt) {
      event.preventDefault();
      await this.copySelected(this.activePane);
      return;
    }

    if (key === "F6" && !alt) {
      event.preventDefault();
      await this.moveSelected(this.activePane);
      return;
    }

    if (key === "F7") {
      event.preventDefault();
      await this.createFolder(this.activePane);
      return;
    }

    if (key === "F8") {
      event.preventDefault();
      await this.deleteSelected(this.activePane);
      return;
    }

    if (ctrl && key.toLowerCase() === "n") {
      event.preventDefault();
      await this.createFile(this.activePane);
      return;
    }

    if (ctrl && key.toLowerCase() === "r") {
      event.preventDefault();
      await this.refreshBoth();
      return;
    }

    if (alt && key === "F5") {
      event.preventDefault();
      await this.compressSelected(this.activePane);
      return;
    }

    if (alt && key === "F6") {
      event.preventDefault();
      await this.extractSelected(this.activePane);
      return;
    }
  },
};

export const store = createStore("totalCommander", model);
