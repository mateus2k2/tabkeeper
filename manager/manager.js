"use strict";

// ─── Group color map ──────────────────────────────────────────────────────────
const GROUP_COLORS = {
  blue:   "#1a73e8",
  red:    "#e53935",
  yellow: "#f9ab00",
  green:  "#1e8e3e",
  pink:   "#e91e8c",
  purple: "#9334e6",
  cyan:   "#007b83",
  orange: "#e8430a",
  grey:   "#5f6368",
  gray:   "#5f6368",
};

function grpHex(color) {
  return GROUP_COLORS[color] || GROUP_COLORS.grey;
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  view: "current",
  sessions: [],
  currentState: null,
  searchQuery: "",
  // Tab selection
  selectedTabKeys: new Set(),   // "wi:ti" (window-render-index : tab-render-index)
  lastTabKey: null,             // for shift-range
  tabRenderOrder: [],           // [{key, tab}] in render order — rebuilt on render
  // Sidebar session selection
  selectedSessionIds: new Set(),
  lastSessionId: null,
  // History
  historyEntry: null,           // currently viewed history entry (null = show list)
};

// ─── Messaging ────────────────────────────────────────────────────────────────
function send(msg) {
  return browser.runtime.sendMessage(msg);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) +
    " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function highlightMatch(text, query) {
  const escaped = esc(text);
  if (!query) return escaped;
  const re = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  return escaped.replace(re, "<mark>$1</mark>");
}

function tabCountLabel(n) { return n === 1 ? "1 tab" : `${n} tabs`; }
function windowLabel(win, i, total) {
  if (win.name) return win.name;
  return total === 1 ? "This window" : `Window ${i + 1}`;
}
function safeFilename(name) { return name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80); }

function getFaviconEl(tab) {
  const url = tab.favIconUrl || "";
  if (url && (url.startsWith("http") || url.startsWith("data:") || url.startsWith("moz-extension:"))) {
    const img = document.createElement("img");
    img.className = "tab-favicon";
    img.src = url;
    img.alt = "";
    img.onerror = () => img.replaceWith(genericFaviconEl());
    return img;
  }
  return genericFaviconEl();
}

function genericFaviconEl() {
  const span = document.createElement("span");
  span.className = "tab-favicon-fallback";
  span.innerHTML = `<svg viewBox="0 0 16 16" fill="none" width="14" height="14">
    <rect x="1" y="2" width="14" height="12" rx="2" stroke="#666" stroke-width="1.2"/>
    <line x1="1" y1="6" x2="15" y2="6" stroke="#666" stroke-width="1.2"/>
  </svg>`;
  return span;
}

// ─── Export ───────────────────────────────────────────────────────────────────

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function downloadFileSaveAs(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  try {
    await browser.downloads.download({ url, filename, saveAs: true });
  } catch {
    // Fallback if saveAs not available
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function exportSessionAsJson(session) {
  const json = JSON.stringify([session], null, 2);
  downloadFileSaveAs(`${safeFilename(session.name)}.json`, json, "application/json");
}

function exportSessionAsText(session) {
  const lines = [session.name];

  for (let wi = 0; wi < session.windows.length; wi++) {
    const win = session.windows[wi];
    const sortedTabs = [...win.tabs].sort((a, b) => a.index - b.index);
    const groupMap = {};
    if (win.tabGroups) {
      for (const g of win.tabGroups) groupMap[g.id] = g;
    }
    const winLabel = session.windows.length === 1
      ? `  Window 1 (${tabCountLabel(sortedTabs.length)})`
      : `  Window ${wi + 1} (${tabCountLabel(sortedTabs.length)})${win.incognito ? " [Private]" : ""}`;
    lines.push("");
    lines.push(winLabel);

    let lastGroupId = null;
    for (const tab of sortedTabs) {
      const gid = tab.groupId ?? -1;
      if (gid !== -1 && gid !== lastGroupId) {
        const g = groupMap[gid];
        if (g) {
          const colorPart = g.color ? ` | ${g.color}` : "";
          lines.push(`    [${g.title || "Group"}${colorPart}]`);
        }
      }
      lastGroupId = gid;
      const indent = gid !== -1 ? "      " : "    ";
      const pin = tab.pinned ? "📌 " : "";
      lines.push(`${indent}${pin}${tab.title || tab.url || "New Tab"} | ${tab.url || ""}`);
    }
  }

  downloadFileSaveAs(`${safeFilename(session.name)}.txt`, lines.join("\n"), "text/plain");
}

// ─── Import ───────────────────────────────────────────────────────────────────

function getIndentLevel(line) {
  let spaces = 0;
  for (const ch of line) {
    if (ch === " ") spaces++;
    else if (ch === "\t") spaces += 2;
    else break;
  }
  return Math.floor(spaces / 2);
}

function parseTabLine(raw) {
  const line = raw.trim().replace(/^📌\s*/, "");
  const pinned = raw.trim().startsWith("📌");
  const sep = line.indexOf(" | ");
  if (sep !== -1) {
    return { title: line.slice(0, sep).trim(), url: line.slice(sep + 3).trim(), pinned };
  }
  if (line.startsWith("http://") || line.startsWith("https://")) {
    return { title: line, url: line, pinned };
  }
  return null;
}

function parseTextImport(text) {
  const sessions = [];
  let cur = null;
  let curWin = null;
  let curGroupId = null;

  const ensureSession = (name = "Imported Session") => {
    if (!cur) {
      cur = { id: genId(), name, date: Date.now(), windows: [], tabCount: 0, windowCount: 0 };
      sessions.push(cur);
    }
  };

  const ensureWindow = () => {
    ensureSession();
    if (!curWin) {
      curWin = { tabs: [], tabGroups: [], incognito: false };
      cur.windows.push(curWin);
    }
  };

  for (const rawLine of text.split("\n")) {
    const trimmed = rawLine.trim();
    const level = getIndentLevel(rawLine);

    if (!trimmed) { curGroupId = null; continue; }
    if (trimmed === "---") { cur = null; curWin = null; curGroupId = null; continue; }

    if (level === 0) {
      if (trimmed.startsWith("Saved:")) continue;
      curWin = null; curGroupId = null;
      cur = { id: genId(), name: trimmed, date: Date.now(), windows: [], tabCount: 0, windowCount: 0 };
      sessions.push(cur);
    } else if (level === 1) {
      ensureSession();
      const isPrivate = trimmed.includes("[Private]");
      curWin = { tabs: [], tabGroups: [], incognito: isPrivate };
      curGroupId = null;
      cur.windows.push(curWin);
    } else if (level === 2) {
      ensureWindow();
      if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
        const inner = trimmed.slice(1, -1);
        const parts = inner.split("|").map(s => s.trim());
        curGroupId = genId();
        curWin.tabGroups.push({ id: curGroupId, title: parts[0] || "", color: parts[1] || "blue", collapsed: false });
      } else {
        const tab = parseTabLine(trimmed);
        if (tab) curWin.tabs.push({ ...tab, id: genId(), index: curWin.tabs.length, active: false, favIconUrl: "", groupId: -1, cookieStoreId: "firefox-default" });
      }
    } else if (level >= 3) {
      ensureWindow();
      const tab = parseTabLine(trimmed);
      if (tab) curWin.tabs.push({ ...tab, id: genId(), index: curWin.tabs.length, active: false, favIconUrl: "", groupId: curGroupId || -1, cookieStoreId: "firefox-default" });
    }
  }

  return sessions.map(s => {
    s.tabCount = s.windows.reduce((n, w) => n + w.tabs.length, 0);
    s.windowCount = s.windows.length;
    return s;
  }).filter(s => s.tabCount > 0);
}

async function handleImportJson(file) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const sessions = Array.isArray(data) ? data : [data];
    if (!sessions.length) throw new Error("empty");
    const result = await send({ type: "importSessions", sessions });
    toast(`Imported ${result.count} session${result.count !== 1 ? "s" : ""}`);
    await loadSessions();
    renderSidebar();
  } catch (e) {
    toast("Import failed — invalid JSON file");
    console.error("[session-buddy] import JSON", e);
  }
}

async function handleImportText(file) {
  try {
    const text = await file.text();
    const sessions = parseTextImport(text);
    if (!sessions.length) throw new Error("no sessions found");
    const result = await send({ type: "importSessions", sessions });
    toast(`Imported ${result.count} session${result.count !== 1 ? "s" : ""}`);
    await loadSessions();
    renderSidebar();
  } catch (e) {
    toast("Import failed — check text file format");
    console.error("[session-buddy] import text", e);
  }
}

function parseUrlList(text) {
  const lines = text.split(/\r?\n/);
  const hasIndented = lines.some(l => /^[ \t]/.test(l) && l.trim());

  const isUrl = s => /^(https?|file|ftp):\/\//i.test(s);
  const makeTab = (url, idx) => ({ url, title: url, index: idx, groupId: -1, favIconUrl: "" });

  if (!hasIndented) {
    // All flat — put everything in one window
    const tabs = lines.map(l => l.trim()).filter(isUrl).map(makeTab);
    return tabs.length ? [{ name: undefined, tabs, incognito: false }] : [];
  }

  // Indented format: non-indented line = new window (label or first URL), indented = tab
  const sessions = [{ name: undefined, tabs: [], incognito: false }];
  let currentWin = sessions[0];

  for (const raw of lines) {
    const indented = /^[ \t]/.test(raw);
    const line = raw.trim();
    if (!line) continue;

    if (!indented) {
      if (isUrl(line)) {
        // Non-indented URL = new single-tab window (or add to fresh current if it has no name and no tabs yet)
        if (currentWin.tabs.length === 0 && !currentWin.name) {
          currentWin.tabs.push(makeTab(line, 0));
        } else {
          currentWin = { name: undefined, tabs: [makeTab(line, 0)], incognito: false };
          sessions.push(currentWin);
        }
      } else {
        // Non-indented non-URL = window label
        currentWin = { name: line, tabs: [], incognito: false };
        sessions.push(currentWin);
      }
    } else {
      // Indented = tab in current window
      if (isUrl(line)) currentWin.tabs.push(makeTab(line, currentWin.tabs.length));
    }
  }

  return sessions.filter(w => w.tabs.length > 0);
}

async function handleImportUrlList() {
  showModal(
    "Import from URL list",
    `<p style="margin:0 0 8px;font-size:12px;color:var(--text-sec)">One URL per line. Indent lines with spaces/tabs to group them into the same window. Non-indented text labels start a new window group.</p>
     <textarea id="url-list-input" class="url-list-textarea" placeholder="https://example.com&#10;  https://sub.example.com&#10;Another group&#10;  https://other.com"></textarea>
     <label style="display:flex;align-items:center;gap:6px;margin-top:8px;font-size:12px;color:var(--text-sec)">
       <input type="text" id="url-list-name" class="settings-input" style="width:100%;text-align:left" placeholder="Collection name (optional)" />
     </label>`,
    [
      { label: "Cancel", cls: "btn-ghost", action: hideModal },
      { label: "Import", cls: "btn-primary", action: async () => {
        const text = document.getElementById("url-list-input").value;
        const name = document.getElementById("url-list-name").value.trim();
        const windows = parseUrlList(text);
        if (!windows.length) { toast("No valid URLs found"); return; }
        const session = {
          name: name || `URL list — ${new Date().toLocaleString()}`,
          date: Date.now(),
          windows,
          tabCount: windows.reduce((s, w) => s + w.tabs.length, 0),
          windowCount: windows.length,
        };
        hideModal();
        const result = await send({ type: "importSessions", sessions: [session] });
        toast(`Imported ${result.count} collection`);
        await loadSessions();
        renderSidebar();
      }},
    ]
  );
}

// ─── Selection ────────────────────────────────────────────────────────────────

function clearTabSelection() {
  state.selectedTabKeys.clear();
  state.lastTabKey = null;
  for (const { el } of state.tabRenderOrder) el.classList.remove("selected");
  updateSelectionBar();
}

function clearSidebarSelection() {
  state.selectedSessionIds.clear();
  state.lastSessionId = null;
  updateSidebarSelBar();
}

function selectTabKey(key, shiftKey) {
  if (shiftKey && state.lastTabKey !== null) {
    // Range select — don't update lastTabKey so next shift+click extends from same anchor
    const keys = state.tabRenderOrder.map(t => t.key);
    const a = keys.indexOf(state.lastTabKey);
    const b = keys.indexOf(key);
    const [from, to] = a < b ? [a, b] : [b, a];
    for (let i = from; i <= to; i++) state.selectedTabKeys.add(keys[i]);
  } else {
    if (state.selectedTabKeys.has(key)) {
      state.selectedTabKeys.delete(key);
    } else {
      state.selectedTabKeys.add(key);
    }
    state.lastTabKey = key;
  }
  updateSelectionBar();
  // Refresh row highlight without full re-render
  for (const { key: k, el } of state.tabRenderOrder) {
    el.classList.toggle("selected", state.selectedTabKeys.has(k));
  }
}

function selectAllInWindow(winKeys) {
  const allSelected = winKeys.every(k => state.selectedTabKeys.has(k));
  if (allSelected) {
    winKeys.forEach(k => state.selectedTabKeys.delete(k));
  } else {
    winKeys.forEach(k => state.selectedTabKeys.add(k));
  }
  updateSelectionBar();
  for (const { key: k, el } of state.tabRenderOrder) {
    el.classList.toggle("selected", state.selectedTabKeys.has(k));
  }
}

function updateSelectionBar() {
  const bar          = document.getElementById("selection-bar");
  const countEl      = document.getElementById("sel-count");
  const removeBtn    = document.getElementById("sel-remove");
  const newWinBtn    = document.getElementById("sel-new-window");
  const openBtn      = document.getElementById("sel-open");
  const saveBtn      = document.getElementById("sel-save");
  const n = state.selectedTabKeys.size;

  if (n === 0) {
    bar.classList.add("hidden");
  } else {
    bar.classList.remove("hidden");
    countEl.textContent = `${n} tab${n !== 1 ? "s" : ""} selected`;
    const isCurrent = state.view === "current";
    const isSession = !isCurrent && state.view !== "cookies" && state.view !== "history";
    removeBtn.style.display  = isSession ? "" : "none";
    newWinBtn.style.display  = isSession ? "" : "none";
    openBtn.style.display    = isSession ? "" : "none";
    saveBtn.style.display    = "";
    saveBtn.textContent      = isCurrent ? "Save selected" : "Extract to collection";
  }

  // Highlight window headers where every tab is selected
  const winKeys = {};
  for (const { key } of state.tabRenderOrder) {
    const wi = key.split(":")[0];
    if (!winKeys[wi]) winKeys[wi] = [];
    winKeys[wi].push(key);
  }
  document.querySelectorAll(".window-block[data-win-idx]").forEach(block => {
    const keys = winKeys[block.dataset.winIdx] || [];
    const allSel = keys.length > 0 && keys.every(k => state.selectedTabKeys.has(k));
    block.querySelector(".window-header").classList.toggle("win-all-selected", allSel);
  });
}

function updateSidebarSelBar() {
  const bar = document.getElementById("sidebar-sel-bar");
  const countEl = document.getElementById("sidebar-sel-count");
  const n = state.selectedSessionIds.size;
  if (n === 0) {
    bar.classList.add("hidden");
  } else {
    bar.classList.remove("hidden");
    countEl.textContent = `${n} selected`;
  }
}

// Selection bar button handlers
document.getElementById("sel-clear").addEventListener("click", () => {
  clearTabSelection();
});

document.getElementById("sel-copy").addEventListener("click", async () => {
  const urls = [];
  for (const { key, tab } of state.tabRenderOrder) {
    if (state.selectedTabKeys.has(key) && tab.url) urls.push(tab.url);
  }
  await navigator.clipboard.writeText(urls.join("\n"));
  toast(`Copied ${urls.length} URL${urls.length !== 1 ? "s" : ""}`);
});

document.getElementById("sel-open").addEventListener("click", async () => {
  const urls = [];
  for (const { key, tab } of state.tabRenderOrder) {
    if (state.selectedTabKeys.has(key) && tab.url) urls.push(tab.url);
  }
  if (!urls.length) return;
  await browser.windows.create({ url: urls });
  clearTabSelection();
});

document.getElementById("sel-remove").addEventListener("click", () => {
  const n = state.selectedTabKeys.size;
  showModal(
    "Remove tabs",
    `<p>Remove ${n} selected tab${n !== 1 ? "s" : ""} from this collection?</p>`,
    [
      { label: "Cancel", cls: "btn-ghost", action: hideModal },
      { label: "Remove", cls: "btn-danger", action: async () => {
        hideModal();
        await removeSelectedTabsFromSession();
      }},
    ]
  );
});

document.getElementById("sel-new-window").addEventListener("click", () => {
  extractSelectedToNewWindow();
});

function extractSelectedToNewWindow() {
  if (state.view === "current") return;
  const session = state.sessions.find(s => s.id === state.view);
  if (!session) return;

  const toMove = new Set(state.selectedTabKeys);

  // Collect selected tabs (in render order) and remove them from their source windows
  const movedTabs = [];
  for (let wi = 0; wi < session.windows.length; wi++) {
    const win = session.windows[wi];
    const sorted = [...win.tabs].sort((a, b) => a.index - b.index);
    const kept = [];
    sorted.forEach((tab, ti) => {
      if (toMove.has(`${wi}:${ti}`)) {
        movedTabs.push({ ...tab, groupId: -1, groupColor: undefined, groupTitle: undefined });
      } else {
        kept.push(tab);
      }
    });
    kept.forEach((t, i) => { t.index = i; });
    win.tabs = kept;
  }

  if (movedTabs.length === 0) return;

  // Re-index the moved tabs sequentially
  movedTabs.forEach((t, i) => { t.index = i; });

  // Drop now-empty windows
  session.windows = session.windows.filter(w => w.tabs.length > 0);

  // Append the new window
  session.windows.push({ tabs: movedTabs, tabGroups: [], incognito: false });
  session.tabCount    = session.windows.reduce((s, w) => s + w.tabs.length, 0);
  session.windowCount = session.windows.length;

  clearTabSelection();
  send({ type: "updateSession", session }).then(() => {
    const idx = state.sessions.findIndex(s => s.id === session.id);
    if (idx !== -1) state.sessions[idx] = session;
    renderSessionView(session);
    toast(`Extracted ${movedTabs.length} tab${movedTabs.length !== 1 ? "s" : ""} to new window`);
  }).catch(() => toast("Failed to save"));
}

document.getElementById("sel-save").addEventListener("click", () => {
  saveSelectedTabs();
});

function saveSelectedTabs() {
  const isCurrent = state.view === "current";
  const sourceWindows = isCurrent
    ? state.currentState?.windows
    : state.sessions.find(s => s.id === state.view)?.windows;
  if (!sourceWindows) return;

  // Group selected tab objects by their window render index
  const byWindow = {};
  for (const { key, tab } of state.tabRenderOrder) {
    if (!state.selectedTabKeys.has(key)) continue;
    const wi = parseInt(key.split(":")[0], 10);
    if (!byWindow[wi]) byWindow[wi] = [];
    byWindow[wi].push(tab);
  }

  const wiIndices = Object.keys(byWindow).map(Number).sort((a, b) => a - b);
  if (wiIndices.length === 0) return;

  // Build a windows array from the selected tabs, preserving window metadata
  const windows = wiIndices.map((wi) => {
    const originalWin = sourceWindows[wi];
    const sortedTabs = [...byWindow[wi]].sort((a, b) => a.index - b.index);
    // Re-index so tabs start at 0 in the new session
    const reindexed = sortedTabs.map((t, i) => ({ ...t, index: i }));

    // Only keep tabGroups referenced by at least one selected tab
    const selectedGids = new Set(
      reindexed.filter(t => t.groupId !== -1).map(t => String(t.groupId))
    );
    const tabGroups = (originalWin.tabGroups || [])
      .filter(g => selectedGids.has(String(g.id)));

    return { ...originalWin, tabs: reindexed, tabGroups };
  });

  const tabCount = windows.reduce((s, w) => s + w.tabs.length, 0);
  const defaultName = new Date().toLocaleString();

  showModal(
    `Save ${tabCount} selected tab${tabCount !== 1 ? "s" : ""}`,
    `<input type="text" id="save-name-input" value="${esc(defaultName)}" placeholder="Session name" />`,
    [
      { label: "Cancel", cls: "btn-ghost", action: hideModal },
      { label: "Save", cls: "btn-primary", action: async () => {
        const name = document.getElementById("save-name-input").value.trim() || defaultName;
        hideModal();
        try {
          const session = {
            id: genId(),
            name,
            date: Date.now(),
            windows,
            tabCount,
            windowCount: windows.length
          };
          await send({ type: "importSessions", sessions: [session] });
          toast("Session saved");
          clearTabSelection();
          await loadSessions();
          renderSidebar();
        } catch {
          toast("Failed to save session");
        }
      }}
    ]
  );
  setTimeout(() => {
    const input = document.getElementById("save-name-input");
    if (input) { input.focus(); input.select(); }
  }, 50);
}

async function removeSelectedTabsFromSession() {
  if (state.view === "current") return;
  const session = state.sessions.find(s => s.id === state.view);
  if (!session) return;

  // Build set of "wi:ti" keys to remove
  const toRemove = new Set(state.selectedTabKeys);

  const newWindows = [];
  for (let wi = 0; wi < session.windows.length; wi++) {
    const win = session.windows[wi];
    const sortedTabs = [...win.tabs].sort((a, b) => a.index - b.index);
    const kept = sortedTabs.filter((_, ti) => !toRemove.has(`${wi}:${ti}`));
    if (kept.length > 0) {
      // Re-index remaining tabs
      kept.forEach((t, i) => { t.index = i; });
      newWindows.push({ ...win, tabs: kept });
    }
    // Window with 0 tabs left is dropped entirely
  }

  clearTabSelection();

  if (newWindows.length === 0) {
    // No windows left → delete the whole session
    await send({ type: "deleteSession", id: session.id });
    toast("Session deleted (all tabs removed)");
    await loadSessions();
    state.view = "current";
    renderSidebar();
    renderCurrentView();
    return;
  }

  const updated = {
    ...session,
    windows: newWindows,
    tabCount: newWindows.reduce((s, w) => s + w.tabs.length, 0),
    windowCount: newWindows.length
  };
  await send({ type: "updateSession", session: updated });
  const idx = state.sessions.findIndex(s => s.id === updated.id);
  if (idx !== -1) state.sessions[idx] = updated;
  toast("Removed from session");
  renderSidebar();
  renderSessionView(updated);
}

document.getElementById("sidebar-sel-del").addEventListener("click", async () => {
  if (!state.selectedSessionIds.size) return;
  const ids = [...state.selectedSessionIds];
  for (const id of ids) {
    await send({ type: "deleteSession", id });
  }
  toast(`Deleted ${ids.length} session${ids.length !== 1 ? "s" : ""}`);
  clearSidebarSelection();
  if (state.selectedSessionIds.has(state.view)) {
    state.view = "current";
  }
  await loadSessions();
  renderSidebar();
  if (state.view === "current") renderCurrentView();
});

// ─── Sidebar rendering ────────────────────────────────────────────────────────

function renderSidebar() {
  const list = document.getElementById("sessions-list");
  const noCollections = document.getElementById("no-collections");
  const countEl = document.getElementById("current-tab-count");

  if (state.currentState) {
    const total = state.currentState.windows.reduce((s, w) => s + w.tabs.length, 0);
    countEl.textContent = tabCountLabel(total);
  }

  list.innerHTML = "";
  if (state.sessions.length === 0) {
    noCollections.style.display = "";
  } else {
    noCollections.style.display = "none";
    const sessionIds = state.sessions.map(s => s.id);

    for (const session of state.sessions) {
      const isActive = state.view === session.id;
      const isMultiSel = state.selectedSessionIds.has(session.id);

      const item = document.createElement("div");
      item.className = "session-nav-item" +
        (isActive && !isMultiSel ? " active" : "") +
        (isMultiSel ? " sel-multi" : "");
      item.dataset.id = session.id;

      const total = session.windows.reduce((s, w) => s + w.tabs.length, 0);
      item.innerHTML = `
        <svg class="session-nav-icon" viewBox="0 0 16 16" fill="none">
          <rect x="1" y="2" width="14" height="12" rx="2" stroke="currentColor" stroke-width="1.2"/>
          <line x1="1" y1="6" x2="15" y2="6" stroke="currentColor" stroke-width="1.2"/>
        </svg>
        <div class="session-nav-text">
          <div class="session-nav-name" title="${esc(session.name)}">${esc(session.name)}</div>
          <div class="session-nav-meta">${tabCountLabel(total)}</div>
        </div>`;

      item.addEventListener("click", (e) => {
        if (e.shiftKey && state.lastSessionId !== null) {
          // Range select in sidebar
          const a = sessionIds.indexOf(state.lastSessionId);
          const b = sessionIds.indexOf(session.id);
          const [from, to] = a < b ? [a, b] : [b, a];
          for (let i = from; i <= to; i++) state.selectedSessionIds.add(sessionIds[i]);
          updateSidebarSelBar();
          renderSidebar();
        } else if (e.ctrlKey || e.metaKey) {
          if (state.selectedSessionIds.has(session.id)) {
            state.selectedSessionIds.delete(session.id);
          } else {
            state.selectedSessionIds.add(session.id);
          }
          state.lastSessionId = session.id;
          updateSidebarSelBar();
          renderSidebar();
        } else {
          // Normal click — navigate and clear multi-select
          clearSidebarSelection();
          state.lastSessionId = session.id;
          selectView(session.id);
          closeSidebarIfMobile();
        }
      });

      list.appendChild(item);
    }
  }

  updateSidebarSelBar();
  document.getElementById("sidebar-current").classList.toggle("active", state.view === "current");
  document.getElementById("sidebar-history").classList.toggle("active", state.view === "history");
  document.getElementById("sidebar-cookies").classList.toggle("active", state.view === "cookies");

  if (typeof initSidebarDragDrop === "function") initSidebarDragDrop();
}

// ─── View routing ─────────────────────────────────────────────────────────────

function selectView(viewId) {
  state.view = viewId;
  state.historyEntry = null;
  clearTabSelection();
  renderSidebar();
  if (viewId === "current") {
    renderCurrentView();
  } else if (viewId === "cookies") {
    renderCookieView();
  } else if (viewId === "history") {
    renderHistoryView();
  } else {
    const session = state.sessions.find(s => s.id === viewId);
    if (session) renderSessionView(session);
  }
}

// ─── "This browser" view ─────────────────────────────────────────────────────

function renderCurrentView() {
  const data = state.currentState;
  document.getElementById("content-title").textContent = "This browser";
  if (data) {
    const total = data.windows.reduce((s, w) => s + w.tabs.length, 0);
    document.getElementById("content-sub").textContent =
      `${tabCountLabel(total)} · ${data.windows.length === 1 ? "1 window" : data.windows.length + " windows"}`;
  } else {
    document.getElementById("content-sub").textContent = "";
  }

  const actionsEl = document.getElementById("content-actions");
  actionsEl.innerHTML = "";

  actionsEl.appendChild(makeDropdownButton("Save", [
    { label: "Save all windows",    action: () => showSaveModal("all") },
    { label: "Save current window", action: () => showSaveModal("current") }
  ], "btn-primary"));

  actionsEl.appendChild(makeDropdownButton("Import", [
    { label: "Import from JSON",     action: () => document.getElementById("import-json-input").click() },
    { label: "Import from text",     action: () => document.getElementById("import-text-input").click() },
    { label: "Import from URL list", action: () => handleImportUrlList() },
  ], "btn-ghost"));

  const areaEl = document.getElementById("content-area");
  areaEl.innerHTML = "";
  state.tabRenderOrder = [];

  if (!data) { areaEl.innerHTML = renderEmptyHTML("Loading…"); return; }

  for (let i = 0; i < data.windows.length; i++) {
    areaEl.appendChild(buildWindowBlock(data.windows[i], i, data.windows.length, state.searchQuery, true));
  }
}

// ─── Saved session view ───────────────────────────────────────────────────────

function renderSessionView(session) {
  document.getElementById("content-title").textContent = session.name;
  const total = session.windows.reduce((s, w) => s + w.tabs.length, 0);
  document.getElementById("content-sub").textContent =
    `${formatDate(session.date)} · ${tabCountLabel(total)} · ${session.windows.length === 1 ? "1 window" : session.windows.length + " windows"}`;

  const actionsEl = document.getElementById("content-actions");
  actionsEl.innerHTML = "";

  actionsEl.appendChild(makeDropdownButton("Open", [
    { label: "Open in new window",     action: () => openSession(session.id, "newWindow") },
    { label: "Open in current window", action: () => openSession(session.id, "currentWindow") }
  ], "btn-primary"));

  actionsEl.appendChild(makeDropdownButton("Export", [
    { label: "Export as JSON", action: () => exportSessionAsJson(session) },
    { label: "Export as text", action: () => exportSessionAsText(session) }
  ], "btn-ghost"));

  actionsEl.appendChild(makeDropdownButton("⋯", [
    { label: "Rename",    action: () => showRenameModal(session) },
    { label: "Duplicate", action: () => duplicateSession(session) },
    { label: "Replace with current browser", action: () => showReplaceModal(session) },
    { separator: true },
    { label: "Delete",    action: () => showDeleteModal(session), danger: true }
  ], "btn-ghost"));

  const areaEl = document.getElementById("content-area");
  areaEl.innerHTML = "";
  state.tabRenderOrder = [];

  for (let i = 0; i < session.windows.length; i++) {
    areaEl.appendChild(buildWindowBlock(session.windows[i], i, session.windows.length, state.searchQuery, true, session));
  }

  if (typeof initSessionDragDrop === "function") initSessionDragDrop(session, areaEl);
}

// ─── Window block builder ─────────────────────────────────────────────────────

function buildWindowBlock(win, winIdx, totalWindows, query, selectable, editSession = null) {
  const block = document.createElement("div");
  block.className = "window-block";
  block.dataset.winIdx = winIdx;

  const isPrivate = win.incognito === true;
  const label = windowLabel(win, winIdx, totalWindows);
  const tabCount = win.tabs.length;
  const sortedTabs = [...win.tabs].sort((a, b) => a.index - b.index);

  // Build group map with string keys to avoid int/string type mismatch
  const groupMap = {};
  if (win.tabGroups) {
    for (const g of win.tabGroups) groupMap[String(g.id)] = g;
  }

  // Collect keys for this window (for select-all)
  const winTabKeys = sortedTabs.map((_, ti) => `${winIdx}:${ti}`);

  // ── Header ──
  const header = document.createElement("div");
  header.className = "window-header" + (isPrivate ? " private" : "");

  // Clickable area (select all tabs in window)
  const clickArea = document.createElement("div");
  clickArea.className = "window-header-click";

  const winIconSvg = isPrivate
    ? `<svg class="window-header-icon" viewBox="0 0 16 16" fill="none">
         <rect x="3" y="7" width="10" height="8" rx="1.5" stroke="${isPrivate ? '#b980ff' : 'currentColor'}" stroke-width="1.3"/>
         <path d="M5 7V5a3 3 0 0 1 6 0v2" stroke="${isPrivate ? '#b980ff' : 'currentColor'}" stroke-width="1.3" stroke-linecap="round"/>
       </svg>`
    : `<svg class="window-header-icon" viewBox="0 0 16 16" fill="none">
         <rect x="1" y="2" width="14" height="12" rx="2" stroke="currentColor" stroke-width="1.2"/>
         <line x1="1" y1="6" x2="15" y2="6" stroke="currentColor" stroke-width="1.2"/>
       </svg>`;

  clickArea.innerHTML = winIconSvg +
    `<span class="window-header-title">${esc(label)}</span>` +
    (isPrivate ? `<span class="private-badge">Private</span>` : "") +
    `<span class="window-tab-count">${tabCountLabel(tabCount)}</span>`;

  if (selectable) {
    clickArea.title = "Click to select all tabs in this window";
    clickArea.addEventListener("click", () => {
      selectAllInWindow(winTabKeys);
    });
  }

  // Collapse button (separate from select area)
  const collapseBtn = document.createElement("button");
  collapseBtn.className = "collapse-btn";
  collapseBtn.title = "Collapse / expand";
  collapseBtn.innerHTML = `<svg class="collapse-arrow" viewBox="0 0 16 16" fill="none">
    <polyline points="4,6 8,10 12,6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;

  header.appendChild(clickArea);

  // Rename button (only for editable saved sessions)
  if (editSession) {
    const renameBtn = document.createElement("button");
    renameBtn.className = "window-rename-btn";
    renameBtn.title = "Rename window";
    renameBtn.innerHTML = `<svg viewBox="0 0 16 16" fill="none">
      <path d="M11 2.5a1.5 1.5 0 0 1 2.12 0l.38.38a1.5 1.5 0 0 1 0 2.12L5 13.5 2 14l.5-3L11 2.5Z" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
    renameBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const current = win.name || "";
      showModal(
        "Rename window",
        `<input id="win-rename-input" type="text" value="${esc(current)}" placeholder="Window name (leave blank to reset)" />`,
        [
          { label: "Cancel", cls: "btn-ghost", action: hideModal },
          { label: "Rename", cls: "btn-primary", action: async () => {
            const newName = document.getElementById("win-rename-input").value.trim();
            win.name = newName || undefined;
            hideModal();
            await send({ type: "updateSession", session: editSession });
            renderSessionView(editSession);
          }},
        ]
      );
    });
    header.appendChild(renameBtn);
  }

  header.appendChild(collapseBtn);

  // ── Body ──
  const body = document.createElement("div");
  body.className = "window-body";

  let lastGroupId = null;
  let tabRenderIdx = 0;

  for (const tab of sortedTabs) {
    const gid = tab.groupId ?? -1;
    const key = `${winIdx}:${tabRenderIdx}`;

    // Resolve color/title: prefer values embedded on the tab at capture time,
    // fall back to groupMap lookup (covers imported/old sessions without embedded values)
    const resolvedColor = tab.groupColor || (gid !== -1 ? groupMap[String(gid)]?.color : null) || null;
    const resolvedTitle = tab.groupTitle || (gid !== -1 ? groupMap[String(gid)]?.title : null) || "Group";

    // Group label when group changes
    if (gid !== -1 && gid !== lastGroupId) {
      const hex = grpHex(resolvedColor || "grey");
      const labelEl = document.createElement("div");
      labelEl.className = "tab-group-label";
      labelEl.style.backgroundColor = hexToRgba(hex, 0.15);
      labelEl.style.borderLeftColor = hex;
      labelEl.style.color = hex;
      labelEl.textContent = resolvedTitle;
      body.appendChild(labelEl);
    }
    lastGroupId = gid;

    const row = buildTabRow(tab, resolvedColor, query, key, selectable);
    body.appendChild(row);

    state.tabRenderOrder.push({ key, tab, el: row });
    if (state.selectedTabKeys.has(key)) row.classList.add("selected");
    tabRenderIdx++;
  }

  // Collapse toggle — only on the button
  collapseBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const arrow = collapseBtn.querySelector(".collapse-arrow");
    const isCollapsed = body.style.display === "none";
    body.style.display = isCollapsed ? "" : "none";
    arrow.classList.toggle("collapsed", !isCollapsed);
  });

  block.appendChild(header);
  block.appendChild(body);
  return block;
}

function buildTabRow(tab, groupColor, query, key, selectable) {
  const row = document.createElement("div");
  row.className = "tab-row";

  // Apply group color as left border
  if (groupColor) {
    const hex = grpHex(groupColor);
    row.style.borderLeftColor = hex;
    row.style.backgroundColor = hexToRgba(hex, 0.04);
  }

  row.appendChild(getFaviconEl(tab));

  const titleEl = document.createElement("span");
  titleEl.className = "tab-title";
  titleEl.innerHTML = highlightMatch(tab.title || tab.url || "New Tab", query);
  titleEl.title = tab.title || "";
  row.appendChild(titleEl);

  const urlEl = document.createElement("span");
  urlEl.className = "tab-url";
  const displayUrl = (tab.url || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  urlEl.innerHTML = highlightMatch(displayUrl, query);
  urlEl.title = tab.url || "";
  row.appendChild(urlEl);

  if (tab.pinned) {
    const badge = document.createElement("span");
    badge.className = "tab-pin-badge";
    badge.textContent = "📌";
    row.appendChild(badge);
  }

  // Open button — focuses the live tab (current view) or opens URL in a new tab
  if (tab.url && tab.url !== "about:newtab" && tab.url !== "about:blank") {
    const openTabBtn = document.createElement("button");
    openTabBtn.className = "tab-open-btn";
    openTabBtn.title = "Open tab";
    openTabBtn.innerHTML = `<svg viewBox="0 0 16 16" fill="none">
      <path d="M7 3H3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
      <path d="M10 2h4v4M14 2l-6 6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
    openTabBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (state.view === "current" && tab.id) {
        await browser.tabs.update(tab.id, { active: true });
        if (tab.windowId) await browser.windows.update(tab.windowId, { focused: true });
      } else {
        await browser.tabs.create({ url: tab.url });
      }
    });
    row.appendChild(openTabBtn);
  }

  if (selectable) {
    row.setAttribute("tabindex", "0");
    row.addEventListener("mousedown", (e) => {
      if (e.shiftKey) e.preventDefault();
    });
    row.addEventListener("click", (e) => {
      selectTabKey(key, e.shiftKey);
    });
    row.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const visible = state.tabRenderOrder.filter(t => !t.el.classList.contains("search-hidden"));
        const idx = visible.findIndex(t => t.key === key);
        if (idx === -1) return;
        const next = visible[idx + (e.key === "ArrowDown" ? 1 : -1)];
        if (!next) return;
        next.el.focus();
        next.el.scrollIntoView({ block: "nearest" });
        if (e.shiftKey) selectTabKey(next.key, true);
      } else if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        selectTabKey(key, e.shiftKey);
      }
    });
  }

  if (query) {
    const matchText = (tab.title || "") + " " + (tab.url || "");
    if (!matchText.toLowerCase().includes(query.toLowerCase())) {
      row.classList.add("search-hidden");
    }
  }

  return row;
}

function renderEmptyHTML(text) {
  return `<div class="empty-state">
    <svg viewBox="0 0 48 48" fill="none">
      <rect x="6" y="8" width="36" height="32" rx="4" stroke="#555" stroke-width="2"/>
      <line x1="14" y1="18" x2="34" y2="18" stroke="#555" stroke-width="2"/>
      <line x1="14" y1="26" x2="26" y2="26" stroke="#555" stroke-width="2"/>
    </svg>
    <div class="empty-state-text">${esc(text)}</div>
  </div>`;
}

// ─── Dropdown button factory ──────────────────────────────────────────────────

function makeDropdownButton(label, items, cls = "btn-ghost") {
  const wrapper = document.createElement("div");
  wrapper.className = "btn-dropdown";

  const btn = document.createElement("button");
  btn.className = `btn ${cls}`;
  btn.textContent = label;

  const menu = document.createElement("div");
  menu.className = "dropdown-menu";

  for (const item of items) {
    if (item.separator) {
      const sep = document.createElement("div");
      sep.className = "dropdown-separator";
      menu.appendChild(sep);
      continue;
    }
    const el = document.createElement("div");
    el.className = "dropdown-item" + (item.danger ? " danger" : "");
    el.textContent = item.label;
    el.addEventListener("click", () => { menu.classList.remove("open"); item.action(); });
    menu.appendChild(el);
  }

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const wasOpen = menu.classList.contains("open");
    closeAllDropdowns();
    if (!wasOpen) menu.classList.add("open");
  });

  wrapper.appendChild(btn);
  wrapper.appendChild(menu);
  return wrapper;
}

function closeAllDropdowns() {
  document.querySelectorAll(".dropdown-menu.open").forEach(m => m.classList.remove("open"));
}

document.addEventListener("click", closeAllDropdowns);

// ─── Modals ───────────────────────────────────────────────────────────────────

function showModal(title, bodyHTML, actions) {
  document.getElementById("modal-title").textContent = title;
  document.getElementById("modal-body").innerHTML = bodyHTML;
  const actionsEl = document.getElementById("modal-actions");
  actionsEl.innerHTML = "";
  const buttons = [];
  for (const a of actions) {
    const btn = document.createElement("button");
    btn.className = `btn ${a.cls || "btn-ghost"}`;
    btn.textContent = a.label;
    btn.addEventListener("click", a.action);
    actionsEl.appendChild(btn);
    buttons.push(btn);
  }

  // Arrow key navigation between action buttons
  actionsEl.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const idx = buttons.indexOf(document.activeElement);
    if (idx === -1) return;
    const dir = e.key === "ArrowRight" ? 1 : -1;
    buttons[(idx + dir + buttons.length) % buttons.length].focus();
    e.preventDefault();
  });

  // Enter in text inputs fires the primary/danger action button
  const primaryBtn = buttons.find(b => b.classList.contains("btn-primary") || b.classList.contains("btn-danger"))
    ?? buttons[buttons.length - 1];
  document.querySelectorAll("#modal-body input[type=text]").forEach(input => {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); primaryBtn?.click(); }
    });
  });

  document.getElementById("modal-overlay").classList.remove("hidden");

  // Auto-focus text input if present, otherwise focus first button
  setTimeout(() => {
    const input = document.querySelector("#modal-body input[type=text]");
    if (input) { input.focus(); input.select(); }
    else buttons[0]?.focus();
  }, 50);
}

function hideModal() {
  document.getElementById("modal-overlay").classList.add("hidden");
}

document.getElementById("modal-overlay").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) hideModal();
});

function showSaveModal(scope) {
  const defaultName = new Date().toLocaleString();
  showModal(
    scope === "current" ? "Save current window" : "Save all windows",
    `<input type="text" id="save-name-input" value="${esc(defaultName)}" placeholder="Session name" />`,
    [
      { label: "Cancel", cls: "btn-ghost", action: hideModal },
      { label: "Save", cls: "btn-primary", action: async () => {
        const name = document.getElementById("save-name-input").value.trim() || defaultName;
        hideModal();
        try {
          await send({ type: "saveSession", name, scope });
          toast("Session saved");
          await loadSessions();
          renderSidebar();
        } catch { toast("Failed to save session"); }
      }}
    ]
  );
}

function showRenameModal(session) {
  showModal(
    "Rename collection",
    `<input type="text" id="rename-input" value="${esc(session.name)}" placeholder="Session name" />`,
    [
      { label: "Cancel", cls: "btn-ghost", action: hideModal },
      { label: "Rename", cls: "btn-primary", action: async () => {
        const name = document.getElementById("rename-input").value.trim();
        if (!name) return;
        hideModal();
        await send({ type: "renameSession", id: session.id, name });
        toast("Renamed");
        await loadSessions();
        renderSidebar();
        if (state.view === session.id) {
          const updated = state.sessions.find(s => s.id === session.id);
          if (updated) renderSessionView(updated);
        }
      }}
    ]
  );
}

function showDeleteModal(session) {
  showModal(
    "Delete collection",
    `<p>Delete "<strong>${esc(session.name)}</strong>"? This cannot be undone.</p>`,
    [
      { label: "Cancel", cls: "btn-ghost", action: hideModal },
      { label: "Delete", cls: "btn-danger", action: async () => {
        hideModal();
        await send({ type: "deleteSession", id: session.id });
        toast("Collection deleted");
        await loadSessions();
        state.view = "current";
        clearTabSelection();
        renderSidebar();
        renderCurrentView();
      }}
    ]
  );
}

function duplicateSession(session) {
  const copy = {
    ...session,
    id: genId(),
    name: `${session.name} (copy)`,
    date: Date.now(),
    windows: JSON.parse(JSON.stringify(session.windows)), // deep clone
  };
  showModal(
    "Duplicate collection",
    `<input type="text" id="dup-name-input" value="${esc(copy.name)}" placeholder="Collection name" />`,
    [
      { label: "Cancel",    cls: "btn-ghost",   action: hideModal },
      { label: "Duplicate", cls: "btn-primary",  action: async () => {
        copy.name = document.getElementById("dup-name-input").value.trim() || copy.name;
        hideModal();
        await send({ type: "importSessions", sessions: [copy] });
        toast("Collection duplicated");
        await loadSessions();
        renderSidebar();
      }},
    ]
  );
}

function showReplaceModal(session) {
  showModal(
    "Replace with current browser",
    `<p>Overwrite "<strong>${esc(session.name)}</strong>" with all currently open tabs? This cannot be undone.</p>`,
    [
      { label: "Cancel",  cls: "btn-ghost",  action: hideModal },
      { label: "Replace", cls: "btn-danger",  action: async () => {
        hideModal();
        const live = await send({ type: "getCurrentState" });
        if (!live || !live.windows.length) { toast("No tabs to capture"); return; }
        const updated = {
          ...session,
          windows: live.windows,
          tabCount: live.tabCount,
          windowCount: live.windowCount,
          date: Date.now(),
        };
        await send({ type: "updateSession", session: updated });
        toast("Collection replaced");
        await loadSessions();
        const refreshed = state.sessions.find(s => s.id === session.id);
        if (refreshed) renderSessionView(refreshed);
        renderSidebar();
      }},
    ]
  );
}

// ─── Open session ─────────────────────────────────────────────────────────────

async function openSession(id, mode) {
  try {
    await send({ type: "openSession", id, mode });
  } catch { toast("Failed to open session"); }
}

// ─── Toast ────────────────────────────────────────────────────────────────────

let toastTimer = null;
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 2500);
}

// ─── Settings ────────────────────────────────────────────────────────────────

async function exportBackup() {
  const data = await send({ type: "exportBackup" });
  const blob = new Blob([JSON.stringify({ ...data, version: 1, exportedAt: Date.now() }, null, 2)], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const date = new Date().toISOString().slice(0, 10);
  await browser.downloads.download({ url, filename: `tabkeeper-backup-${date}.json`, saveAs: false });
  URL.revokeObjectURL(url);
}

document.getElementById("btn-settings").addEventListener("click", async () => {
  const cfg = await send({ type: "getConfig" });

  const intervalOptions = [1, 2, 5, 10, 15, 30, 60];

  showModal(
    "Settings",
    `<div class="settings-form">
      <div class="settings-group">
        <div class="settings-label">History</div>

        <label class="settings-row">
          <span class="settings-row-label">Auto-save interval</span>
          <select id="cfg-interval" class="settings-select">
            ${intervalOptions.map(m =>
              `<option value="${m}" ${cfg.historyInterval === m ? "selected" : ""}>${m} minute${m !== 1 ? "s" : ""}</option>`
            ).join("")}
          </select>
        </label>

        <label class="settings-row">
          <span class="settings-row-label">Maximum entries kept</span>
          <input id="cfg-limit" type="number" class="settings-input" min="5" max="500" value="${cfg.historyLimit}" />
        </label>
      </div>

      <div class="settings-group">
        <div class="settings-label">Backup</div>

        <div class="settings-row">
          <span class="settings-row-label">Export all collections, history, and settings</span>
          <button id="cfg-export-backup" class="btn btn-ghost settings-backup-btn">Export</button>
        </div>

        <div class="settings-row">
          <span class="settings-row-label">Import from backup file</span>
          <button id="cfg-import-backup" class="btn btn-ghost settings-backup-btn">Import</button>
        </div>
      </div>
    </div>`,
    [
      { label: "Cancel", cls: "btn-ghost", action: hideModal },
      { label: "Save", cls: "btn-primary", action: async () => {
        const interval = parseInt(document.getElementById("cfg-interval").value, 10);
        const limit    = Math.max(5, Math.min(500, parseInt(document.getElementById("cfg-limit").value, 10) || 50));
        await send({ type: "saveConfig", config: { historyInterval: interval, historyLimit: limit } });
        hideModal();
        toast("Settings saved");
      }},
    ]
  );

  document.getElementById("cfg-export-backup").addEventListener("click", async () => {
    await exportBackup();
    toast("Backup exported");
  });

  document.getElementById("cfg-import-backup").addEventListener("click", () => {
    document.getElementById("import-backup-input").click();
  });
});

// ─── Sidebar toggle (mobile) ──────────────────────────────────────────────────

function closeSidebarIfMobile() {
  if (window.innerWidth <= 700) document.body.classList.remove("sidebar-open");
}

document.getElementById("btn-sidebar-toggle").addEventListener("click", () => {
  document.body.classList.toggle("sidebar-open");
});

document.getElementById("sidebar-overlay").addEventListener("click", () => {
  document.body.classList.remove("sidebar-open");
});

// Auto-close sidebar on mobile when navigating to a view
const _origSelectView = selectView;
// patch: close sidebar when user picks an item on narrow screen
document.getElementById("sidebar-current").addEventListener("click", closeSidebarIfMobile, true);
document.getElementById("sidebar-history").addEventListener("click", closeSidebarIfMobile, true);
document.getElementById("sidebar-cookies").addEventListener("click", closeSidebarIfMobile, true);

// ─── Search ───────────────────────────────────────────────────────────────────

document.getElementById("search-input").addEventListener("input", (e) => {
  state.searchQuery = e.target.value.trim();
  clearTabSelection();
  if (state.view === "current") renderCurrentView();
  else {
    const session = state.sessions.find(s => s.id === state.view);
    if (session) renderSessionView(session);
  }
});

document.getElementById("sidebar-current").addEventListener("click", () => {
  clearSidebarSelection();
  selectView("current");
});

document.getElementById("sidebar-history").addEventListener("click", () => {
  clearSidebarSelection();
  selectView("history");
});

document.getElementById("sidebar-cookies").addEventListener("click", () => {
  clearSidebarSelection();
  selectView("cookies");
});

// ─── File import wiring ───────────────────────────────────────────────────────

document.getElementById("import-json-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (file) await handleImportJson(file);
  e.target.value = "";
});

document.getElementById("import-text-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (file) await handleImportText(file);
  e.target.value = "";
});

document.getElementById("import-cookie-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (file) await importCookies(file);
  e.target.value = "";
});

document.getElementById("import-backup-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;

  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    toast("Invalid backup file");
    return;
  }

  const sessionCount = (data.sessions || []).length;
  const historyCount = (data.history  || []).length;

  showModal(
    "Import backup",
    `<p>This backup contains <strong>${sessionCount} collection${sessionCount !== 1 ? "s" : ""}</strong> and <strong>${historyCount} history entr${historyCount !== 1 ? "ies" : "y"}</strong>.</p>
     <p>How would you like to import it?</p>`,
    [
      { label: "Cancel", cls: "btn-ghost", action: hideModal },
      { label: "Merge", cls: "btn-ghost", action: async () => {
        hideModal();
        await send({ type: "importBackup", sessions: data.sessions || [], history: data.history || [], config: {}, merge: true });
        await loadSessions();
        renderSidebar();
        toast("Backup merged");
      }},
      { label: "Replace all", cls: "btn-danger", action: async () => {
        hideModal();
        await send({ type: "importBackup", sessions: data.sessions || [], history: data.history || [], config: data.config || {}, merge: false });
        await loadSessions();
        renderSidebar();
        selectView("current");
        toast("Backup restored");
      }},
    ]
  );
});

// ─── History ──────────────────────────────────────────────────────────────────

function formatHistoryTime(date) {
  return new Date(date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatHistoryDate(date) {
  const d = new Date(date);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function historyTypeLabel(type) {
  if (type === "browserClosed") return "Browser closed";
  if (type === "autoSave")      return "Auto-save";
  return "Saved";
}

function buildHistoryEntryEl(entry) {
  const tabWord = `${entry.tabCount} tab${entry.tabCount !== 1 ? "s" : ""}`;
  const winWord = `${entry.windowCount} window${entry.windowCount !== 1 ? "s" : ""}`;

  const el = document.createElement("div");
  el.className = "history-entry";

  // Header (always visible)
  const header = document.createElement("div");
  header.className = "history-entry-header";
  header.innerHTML = `
    <div class="history-entry-dot"></div>
    <div class="history-entry-info">
      <div class="history-entry-time">${formatHistoryTime(entry.date)}</div>
      <div class="history-entry-type">${historyTypeLabel(entry.type)}</div>
      <div class="history-entry-meta">${winWord} · ${tabWord}</div>
    </div>
    <span class="history-entry-arrow">▶</span>`;
  el.appendChild(header);

  // Collapsible body
  const body = document.createElement("div");
  body.className = "history-entry-body";

  // Window/tab list (built lazily on first open)
  const windowsDiv = document.createElement("div");
  windowsDiv.className = "history-entry-windows";
  body.appendChild(windowsDiv);

  // Action buttons
  const actionsDiv = document.createElement("div");
  actionsDiv.className = "history-entry-actions";

  const saveBtn = document.createElement("button");
  saveBtn.className = "btn btn-primary";
  saveBtn.textContent = "Save as collection";
  saveBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const defaultName = `${formatHistoryDate(entry.date)} ${formatHistoryTime(entry.date)}`;
    showModal(
      "Save as collection",
      `<input type="text" id="history-save-input" value="${esc(defaultName)}" placeholder="Collection name" />`,
      [
        { label: "Cancel", cls: "btn-ghost", action: hideModal },
        { label: "Save", cls: "btn-primary", action: async () => {
          const name = document.getElementById("history-save-input").value.trim() || defaultName;
          hideModal();
          await send({ type: "saveHistoryAsSession", entry, name });
          toast("Saved as collection");
          await loadSessions();
          renderSidebar();
        }},
      ]
    );
  });

  const openBtn = document.createElement("button");
  openBtn.className = "btn btn-ghost";
  openBtn.textContent = "Open in new window";
  openBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    send({ type: "openHistoryEntry", entry, mode: "newWindow" }).catch(() => {});
  });

  const delBtn = document.createElement("button");
  delBtn.className = "btn btn-ghost";
  delBtn.style.marginLeft = "auto";
  delBtn.textContent = "Delete";
  delBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    showModal(
      "Delete entry",
      `<p>Remove this history entry from ${formatHistoryTime(entry.date)}?</p>`,
      [
        { label: "Cancel", cls: "btn-ghost", action: hideModal },
        { label: "Delete", cls: "btn-danger", action: async () => {
          hideModal();
          await send({ type: "deleteHistoryEntry", id: entry.id });
          el.remove();
        }},
      ]
    );
  });

  actionsDiv.append(saveBtn, openBtn, delBtn);
  body.appendChild(actionsDiv);
  el.appendChild(body);

  // Toggle collapse on header click — build window list lazily
  let built = false;
  header.addEventListener("click", () => {
    const isOpen = el.classList.toggle("open");
    if (isOpen && !built) {
      built = true;
      for (let i = 0; i < entry.windows.length; i++) {
        windowsDiv.appendChild(buildWindowBlock(entry.windows[i], i, entry.windows.length, "", false));
      }
    }
  });

  return el;
}

async function renderHistoryView() {
  const area = document.getElementById("content-area");
  area.innerHTML = "";
  state.tabRenderOrder = [];

  const entries = await send({ type: "getHistory" });

  document.getElementById("content-title").textContent = "History";
  document.getElementById("content-sub").textContent =
    `${entries.length} entr${entries.length !== 1 ? "ies" : "y"}`;
  document.getElementById("history-sidebar-sub").textContent =
    `${entries.length} entr${entries.length !== 1 ? "ies" : "y"}`;

  const actionsEl = document.getElementById("content-actions");
  actionsEl.innerHTML = "";
  if (entries.length > 0) {
    const clearBtn = document.createElement("button");
    clearBtn.className = "btn btn-ghost";
    clearBtn.textContent = "Clear history";
    clearBtn.addEventListener("click", () => {
      showModal("Clear history", "<p>Delete all history entries? This cannot be undone.</p>", [
        { label: "Cancel", cls: "btn-ghost", action: hideModal },
        { label: "Clear All", cls: "btn-danger", action: async () => {
          hideModal();
          await send({ type: "clearHistory" });
          renderHistoryView();
        }},
      ]);
    });
    actionsEl.appendChild(clearBtn);
  }

  if (entries.length === 0) {
    area.innerHTML = renderEmptyHTML("No history yet — history saves automatically when the browser closes");
    return;
  }

  // Group entries by date
  const groups = {};
  for (const e of entries) {
    const label = formatHistoryDate(e.date);
    (groups[label] = groups[label] || []).push(e);
  }

  // "Now" entry at the top
  const nowTimeline = document.createElement("div");
  nowTimeline.className = "history-timeline";
  const nowEntry = document.createElement("div");
  nowEntry.className = "history-entry now";
  nowEntry.innerHTML = `<div class="history-entry-dot"></div>
    <div class="history-entry-time">Now</div>`;
  nowTimeline.appendChild(nowEntry);
  area.appendChild(nowTimeline);

  for (const [dateLabel, dayEntries] of Object.entries(groups)) {
    const daySection = document.createElement("div");

    const dayHeader = document.createElement("div");
    dayHeader.style.cssText = "font-size:11px;font-weight:600;color:var(--text-sec);text-transform:uppercase;letter-spacing:0.06em;padding:12px 0 4px 0;";
    dayHeader.textContent = dateLabel;
    daySection.appendChild(dayHeader);

    const timeline = document.createElement("div");
    timeline.className = "history-timeline";

    for (const entry of dayEntries) {
      timeline.appendChild(buildHistoryEntryEl(entry));
    }

    daySection.appendChild(timeline);
    area.appendChild(daySection);
  }
}

// ─── Cookie manager ───────────────────────────────────────────────────────────

const PRIVATE_STORE = "firefox-private";

async function isPrivateWindowOpen() {
  const windows = await browser.windows.getAll();
  return windows.some(w => w.incognito);
}

async function isIncognitoAllowed() {
  try { return await browser.extension.isAllowedIncognitoAccess(); }
  catch { return false; }
}

async function getPrivateCookies() {
  try { return await browser.cookies.getAll({ storeId: PRIVATE_STORE }); }
  catch { return []; }
}

function cookieUrl(c) {
  return `http${c.secure ? "s" : ""}://${c.domain.replace(/^\./, "")}${c.path}`;
}

async function removeCookie(c) {
  return browser.cookies.remove({
    url: cookieUrl(c),
    name: c.name,
    storeId: c.storeId,
    firstPartyDomain: c.firstPartyDomain ?? "",
  }).catch(() => {});
}

async function clearPrivateCookies() {
  const list = await getPrivateCookies();
  await Promise.all(list.map(removeCookie));
  return list.length;
}

async function clearDomainCookies(domain) {
  const list = await getPrivateCookies();
  const match = list.filter(c => c.domain.replace(/^\./, "").toLowerCase().includes(domain.toLowerCase()));
  await Promise.all(match.map(removeCookie));
  return match.length;
}

async function exportCookies(includeTabs) {
  const cookies = await getPrivateCookies();
  const payload = { cookies };
  if (includeTabs) {
    const allWindows = await browser.windows.getAll({ populate: true });
    payload.tabs = allWindows
      .filter(w => w.incognito)
      .flatMap(w => w.tabs.map(t => t.url))
      .filter(url => url && !url.startsWith("about:") && !url.startsWith("moz-extension:"));
  }
  downloadFileSaveAs("private-cookies.json", JSON.stringify(payload, null, 2), "application/json");
}

async function importCookies(file) {
  let data;
  try { data = JSON.parse(await file.text()); }
  catch { toast("Invalid JSON"); return; }

  const list = Array.isArray(data) ? data : (data.cookies || []);
  await clearPrivateCookies();

  let ok = 0, fail = 0;
  for (const raw of list) {
    const c = { ...raw, storeId: PRIVATE_STORE };
    delete c.hostOnly;
    delete c.session;
    if (c.sameSite === "unspecified") c.sameSite = "no_restriction";
    try {
      await browser.cookies.set({ url: cookieUrl(c), ...c });
      ok++;
    } catch { fail++; }
  }

  if (data.tabs && data.tabs.length > 0) {
    try {
      const allWindows = await browser.windows.getAll();
      const existing = allWindows.find(w => w.incognito);
      const windowId = existing
        ? existing.id
        : (await browser.windows.create({ incognito: true })).id;
      for (const url of data.tabs) {
        await browser.tabs.create({ windowId, url });
      }
    } catch (e) {
      console.warn("[session-buddy] Could not restore private tabs", e);
    }
  }

  toast(`Restored ${ok} cookie${ok !== 1 ? "s" : ""}${fail ? `, ${fail} failed` : ""}`);
  renderCookieView();
}

async function updateCookieSidebarSub() {
  try {
    const cookies = await getPrivateCookies();
    document.getElementById("cookie-sidebar-sub").textContent =
      `${cookies.length} cookie${cookies.length !== 1 ? "s" : ""}`;
  } catch { /* permissions not ready yet */ }
}

async function renderCookieView() {
  const area = document.getElementById("content-area");
  area.innerHTML = "";
  state.tabRenderOrder = [];

  document.getElementById("content-title").textContent = "Private Window Cookies";
  document.getElementById("content-sub").textContent = "";
  document.getElementById("content-actions").innerHTML = "";

  const [privOpen, incogAllowed, cookies] = await Promise.all([
    isPrivateWindowOpen(),
    isIncognitoAllowed(),
    getPrivateCookies(),
  ]);

  // Group by domain
  const byDomain = {};
  for (const c of cookies) {
    const d = c.domain.replace(/^\./, "");
    (byDomain[d] = byDomain[d] || []).push(c);
  }
  const domains = Object.keys(byDomain).sort();

  document.getElementById("content-sub").textContent =
    `${cookies.length} cookie${cookies.length !== 1 ? "s" : ""} · ${domains.length} domain${domains.length !== 1 ? "s" : ""}`;
  document.getElementById("cookie-sidebar-sub").textContent =
    `${cookies.length} cookie${cookies.length !== 1 ? "s" : ""}`;

  if (!incogAllowed) {
    const warn = document.createElement("div");
    warn.className = "cookie-warning";
    warn.innerHTML = `<strong>Private window access disabled</strong>Go to Firefox → Add-ons → TabKeeper → Allow in private windows to use this feature.`;
    area.appendChild(warn);
    return;
  }

  // Action buttons
  const actionsDiv = document.createElement("div");
  actionsDiv.className = "cookie-actions";

  // "Include tabs" checkbox
  const tabsLabel = document.createElement("label");
  tabsLabel.className = "cookie-tabs-label";
  const tabsCheck = document.createElement("input");
  tabsCheck.type = "checkbox";
  tabsCheck.id = "cookie-include-tabs";
  tabsCheck.checked = (await browser.storage.local.get("cookieIncludeTabs")).cookieIncludeTabs ?? true;
  tabsCheck.addEventListener("change", () => {
    browser.storage.local.set({ cookieIncludeTabs: tabsCheck.checked });
  });
  tabsLabel.appendChild(tabsCheck);
  tabsLabel.appendChild(document.createTextNode(" Include tabs"));

  const exportBtn = document.createElement("button");
  exportBtn.className = "btn btn-primary";
  exportBtn.textContent = "Export JSON";
  exportBtn.disabled = !privOpen || cookies.length === 0;
  exportBtn.addEventListener("click", () => exportCookies(tabsCheck.checked));

  const importBtn = document.createElement("button");
  importBtn.className = "btn btn-ghost";
  importBtn.textContent = "Import JSON";
  importBtn.disabled = !privOpen;
  importBtn.addEventListener("click", () => document.getElementById("import-cookie-input").click());

  const clearBtn = document.createElement("button");
  clearBtn.className = "btn btn-danger";
  clearBtn.textContent = "Clear All";
  clearBtn.disabled = !privOpen || cookies.length === 0;
  clearBtn.addEventListener("click", () => {
    showModal(
      "Clear all cookies",
      `<p>Delete all ${cookies.length} private window cookie${cookies.length !== 1 ? "s" : ""}? This cannot be undone.</p>`,
      [
        { label: "Cancel", cls: "btn-ghost", action: hideModal },
        { label: "Clear All", cls: "btn-danger", action: async () => {
          hideModal();
          const n = await clearPrivateCookies();
          toast(`Cleared ${n} cookie${n !== 1 ? "s" : ""}`);
          renderCookieView();
        }},
      ]
    );
  });

  actionsDiv.append(exportBtn, importBtn, clearBtn, tabsLabel);
  area.appendChild(actionsDiv);

  if (!privOpen) {
    const info = document.createElement("div");
    info.className = "cookie-info";
    info.textContent = "No private window is currently open. Open one to capture cookies.";
    area.appendChild(info);
  }

  if (cookies.length === 0) {
    area.insertAdjacentHTML("beforeend", renderEmptyHTML("No cookies in private windows"));
    return;
  }

  // Domain filter + clear-by-domain
  const filterDiv = document.createElement("div");
  filterDiv.className = "cookie-domain-filter";

  const domainInput = document.createElement("input");
  domainInput.type = "text";
  domainInput.placeholder = "Filter or clear by domain…";
  domainInput.setAttribute("list", "cookie-domain-datalist");

  const datalist = document.createElement("datalist");
  datalist.id = "cookie-domain-datalist";
  domains.forEach(d => { const o = document.createElement("option"); o.value = d; datalist.appendChild(o); });

  const clearDomBtn = document.createElement("button");
  clearDomBtn.className = "btn btn-ghost";
  clearDomBtn.textContent = "Clear domain";
  clearDomBtn.addEventListener("click", async () => {
    const d = domainInput.value.trim();
    if (!d) return;
    const n = await clearDomainCookies(d);
    toast(`Cleared ${n} cookie${n !== 1 ? "s" : ""} for ${d}`);
    domainInput.value = "";
    renderCookieView();
  });

  filterDiv.append(domainInput, datalist, clearDomBtn);
  area.appendChild(filterDiv);

  // Live filter
  domainInput.addEventListener("input", () => {
    const q = domainInput.value.toLowerCase();
    area.querySelectorAll(".cookie-domain-group").forEach(g => {
      g.style.display = g.dataset.domain.includes(q) ? "" : "none";
    });
  });

  // Cookie list
  const listDiv = document.createElement("div");
  listDiv.className = "cookie-list";

  for (const domain of domains) {
    const domCookies = byDomain[domain];
    const group = document.createElement("div");
    group.className = "cookie-domain-group";
    group.dataset.domain = domain;

    const header = document.createElement("div");
    header.className = "cookie-domain-header";

    const nameEl = document.createElement("span");
    nameEl.className = "cookie-domain-name";
    nameEl.textContent = domain;

    const countEl = document.createElement("span");
    countEl.className = "cookie-domain-count";
    countEl.textContent = `${domCookies.length} cookie${domCookies.length !== 1 ? "s" : ""}`;

    const delBtn = document.createElement("button");
    delBtn.className = "cookie-domain-del";
    delBtn.textContent = "Clear";
    delBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const n = await clearDomainCookies(domain);
      toast(`Cleared ${n} cookie${n !== 1 ? "s" : ""}`);
      renderCookieView();
    });

    header.append(nameEl, countEl, delBtn);

    const body = document.createElement("div");
    body.className = "cookie-domain-body collapsed";
    for (const c of domCookies) {
      const item = document.createElement("div");
      item.className = "cookie-item";
      item.textContent = c.name || "(unnamed)";
      item.title = `${c.name}${c.httpOnly ? " · httpOnly" : ""}${c.secure ? " · secure" : ""}`;
      body.appendChild(item);
    }

    header.addEventListener("click", (e) => {
      if (e.target === delBtn) return;
      body.classList.toggle("collapsed");
    });

    group.append(header, body);
    listDiv.appendChild(group);
  }

  area.appendChild(listDiv);
}

// ─── Data loading ─────────────────────────────────────────────────────────────

async function loadSessions() {
  const sessions = await send({ type: "getSessions" });
  state.sessions = sessions || [];
}

async function loadCurrentState() {
  const cur = await send({ type: "getCurrentState" });
  state.currentState = cur;
}

// ─── Keyboard shortcuts ───────────────────────────────────────────────────────

document.addEventListener("keydown", (e) => {
  const modalVisible = !document.getElementById("modal-overlay").classList.contains("hidden");

  if (e.key === "Escape") {
    if (modalVisible) { hideModal(); return; }
    if (state.selectedTabKeys.size > 0) { clearTabSelection(); return; }
    if (state.selectedSessionIds.size > 0) { clearSidebarSelection(); return; }
    return;
  }

  // Never fire other shortcuts while a modal is open or focus is in an input
  if (modalVisible) return;
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

  const isSessionView = state.view !== "current" && state.view !== "cookies" && state.view !== "history";

  if (e.key === "F2") {
    e.preventDefault();
    if (isSessionView) {
      const session = state.sessions.find(s => s.id === state.view);
      if (session) showRenameModal(session);
    }
    return;
  }

  if (e.key === "Delete") {
    e.preventDefault();
    if (state.selectedTabKeys.size > 0 && isSessionView) {
      document.getElementById("sel-remove").click(); // goes through the confirmation modal
    } else if (state.selectedSessionIds.size > 0) {
      document.getElementById("sidebar-sel-del").click();
    } else if (isSessionView) {
      const session = state.sessions.find(s => s.id === state.view);
      if (session) showDeleteModal(session);
    }
  }
});

// ─── Boot ─────────────────────────────────────────────────────────────────────

async function init() {
  await Promise.all([loadSessions(), loadCurrentState()]);
  renderSidebar();
  renderCurrentView();
  updateCookieSidebarSub();
  send({ type: "getHistory" }).then(entries => {
    if (!entries) return;
    document.getElementById("history-sidebar-sub").textContent =
      `${entries.length} entr${entries.length !== 1 ? "ies" : "y"}`;
  }).catch(() => {});
}

init().catch(console.error);

setInterval(async () => {
  if (state.view === "current") {
    await loadCurrentState();
    renderCurrentView();
    const total = state.currentState
      ? state.currentState.windows.reduce((s, w) => s + w.tabs.length, 0)
      : 0;
    document.getElementById("current-tab-count").textContent = tabCountLabel(total);
  }
}, 5000);
