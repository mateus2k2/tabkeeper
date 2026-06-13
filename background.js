"use strict";

// ─── IndexedDB ───────────────────────────────────────────────────────────────

let DB = null;

function dbInit() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("session-buddy", 2);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (e.oldVersion < 1) {
        const store = db.createObjectStore("sessions", { keyPath: "id" });
        store.createIndex("date", "date");
        store.createIndex("name", "name");
      }
      if (e.oldVersion < 2) {
        const h = db.createObjectStore("history", { keyPath: "id" });
        h.createIndex("date", "date");
      }
    };
    req.onsuccess = () => {
      DB = req.result;
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}

function dbPut(session) {
  return new Promise((resolve, reject) => {
    const tx = DB.transaction("sessions", "readwrite");
    tx.objectStore("sessions").put(session);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function dbGet(id) {
  return new Promise((resolve, reject) => {
    const tx = DB.transaction("sessions", "readonly");
    const req = tx.objectStore("sessions").get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbGetAll() {
  return new Promise((resolve, reject) => {
    const tx = DB.transaction("sessions", "readonly");
    const req = tx.objectStore("sessions").getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbDelete(id) {
  return new Promise((resolve, reject) => {
    const tx = DB.transaction("sessions", "readwrite");
    tx.objectStore("sessions").delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function dbDeleteAll() {
  return new Promise((resolve, reject) => {
    const tx = DB.transaction("sessions", "readwrite");
    tx.objectStore("sessions").clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ─── History IndexedDB ────────────────────────────────────────────────────────

const HISTORY_LIMIT = 50;

function dbHistoryPut(entry) {
  return new Promise((resolve, reject) => {
    const tx = DB.transaction("history", "readwrite");
    tx.objectStore("history").put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function dbHistoryGetAll() {
  return new Promise((resolve, reject) => {
    const tx = DB.transaction("history", "readonly");
    const req = tx.objectStore("history").getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbHistoryDelete(id) {
  return new Promise((resolve, reject) => {
    const tx = DB.transaction("history", "readwrite");
    tx.objectStore("history").delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function dbHistoryDeleteAll() {
  return new Promise((resolve, reject) => {
    const tx = DB.transaction("history", "readwrite");
    tx.objectStore("history").clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ─── Tab Groups ──────────────────────────────────────────────────────────────

const tabGroupsEnabled = typeof browser !== "undefined" &&
  browser.tabGroups !== undefined &&
  typeof browser.tabs?.group === "function";

async function queryTabGroups(windowId) {
  if (!tabGroupsEnabled) return [];
  try {
    return await browser.tabGroups.query({ windowId });
  } catch {
    return [];
  }
}

async function restoreTabGroup(windowId, tabIds, groupInfo) {
  if (!tabGroupsEnabled || tabIds.length === 0) return;
  try {
    const groupId = await browser.tabs.group({ createProperties: { windowId }, tabIds });
    await browser.tabGroups.update(groupId, {
      title: groupInfo.title || "",
      color: groupInfo.color || "blue",
      collapsed: groupInfo.collapsed || false
    });
  } catch (e) {
    console.warn("[session-buddy] restoreTabGroup failed", e);
  }
}

// ─── Favicon as data URL ─────────────────────────────────────────────────────

async function fetchFaviconAsDataUrl(url) {
  if (!url || url.startsWith("data:") || url.startsWith("moz-extension:")) return url;
  try {
    const resp = await fetch(url, { mode: "no-cors" });
    const blob = await resp.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve(url);
      reader.readAsDataURL(blob);
    });
  } catch {
    return url;
  }
}

// ─── Session capture ─────────────────────────────────────────────────────────

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

async function captureCurrentSession(name, scope = "all") {
  const queryInfo = scope === "current" ? { currentWindow: true } : {};
  const tabs = await browser.tabs.query(queryInfo);

  const windowsMap = {};
  const windowIds = [];

  for (const tab of tabs) {
    const wid = tab.windowId;
    if (!windowsMap[wid]) {
      windowsMap[wid] = { tabs: [] };
      windowIds.push(wid);
    }
    const favicon = await fetchFaviconAsDataUrl(tab.favIconUrl || "");
    windowsMap[wid].tabs.push({
      id: tab.id,
      index: tab.index,
      url: tab.url,
      title: tab.title,
      favIconUrl: favicon,
      pinned: tab.pinned,
      active: tab.active,
      groupId: tab.groupId ?? -1,
      cookieStoreId: tab.cookieStoreId
    });
  }

  // Collect window metadata + tab groups
  const windows = [];
  for (const wid of windowIds) {
    const winInfo = await browser.windows.get(wid);
    const tabGroups = await queryTabGroups(wid);

    // Build a lookup by string key to avoid any int/string type mismatch
    const grpInfoMap = {};
    for (const g of tabGroups) grpInfoMap[String(g.id)] = g;

    // Embed group color/title directly on each tab so the renderer
    // never needs a cross-reference lookup that might fail on type mismatch
    for (const tab of windowsMap[wid].tabs) {
      if (tab.groupId !== -1) {
        const g = grpInfoMap[String(tab.groupId)];
        if (g) {
          tab.groupColor = g.color;
          tab.groupTitle = g.title;
        }
      }
    }

    windows.push({
      id: wid,
      state: winInfo.state,
      width: winInfo.width,
      height: winInfo.height,
      top: winInfo.top,
      left: winInfo.left,
      incognito: winInfo.incognito,
      tabs: windowsMap[wid].tabs,
      tabGroups: tabGroups.map(g => ({
        id: g.id,
        title: g.title,
        color: g.color,
        collapsed: g.collapsed
      }))
    });
  }

  return {
    id: generateId(),
    name: name || new Date().toLocaleString(),
    date: Date.now(),
    windows,
    tabCount: tabs.length,
    windowCount: windows.length
  };
}

// ─── Session restore ─────────────────────────────────────────────────────────

// Reconstruct group descriptors from tab-embedded fields (groupColor/groupTitle).
// Used when a session was captured without tabGroups permission so win.tabGroups=[].
function deriveGroupsFromTabs(tabs) {
  const seen = {};
  for (const tab of tabs) {
    const gid = tab.groupId;
    if (gid != null && gid !== -1 && !seen[String(gid)]) {
      seen[String(gid)] = {
        id: gid,
        title: tab.groupTitle || "",
        color: tab.groupColor || "blue",
        collapsed: false
      };
    }
  }
  return Object.values(seen);
}

async function openSession(session, mode = "newWindow") {
  const firstWindow = session.windows[0];
  if (!firstWindow) return;

  for (let i = 0; i < session.windows.length; i++) {
    const win = session.windows[i];
    const isFirst = i === 0;

    let targetWindowId;
    if (isFirst && mode === "currentWindow") {
      const [activeTab] = await browser.tabs.query({ currentWindow: true, active: true });
      targetWindowId = activeTab.windowId;

      const existingTabs = await browser.tabs.query({ windowId: targetWindowId });
      const keepTabId = existingTabs[0].id;
      if (existingTabs.length > 1) {
        await browser.tabs.remove(existingTabs.slice(1).map(t => t.id));
      }

      await createTabsInWindow(win, targetWindowId, true);
      await browser.tabs.remove(keepTabId);
    } else {
      const createData = {};
      if (win.incognito) createData.incognito = true;
      let newWin;
      try {
        newWin = await browser.windows.create(createData);
      } catch (e) {
        if (win.incognito) {
          // Extension not allowed in private browsing — open as normal window
          console.warn("[session-buddy] Private window creation failed. Enable extension in private browsing.", e);
          newWin = await browser.windows.create({});
        } else {
          throw e;
        }
      }
      targetWindowId = newWin.id;
      const blankTab = newWin.tabs[0];
      await createTabsInWindow(win, targetWindowId, false);
      await browser.tabs.remove(blankTab.id);
    }
  }
}

async function createTabsInWindow(win, windowId, isCurrentWindow) {
  const sortedTabs = [...win.tabs].sort((a, b) => a.index - b.index);
  const oldIdToNewId = {};

  for (const tab of sortedTabs) {
    let url = tab.url;
    if (url === "about:newtab" || url === "about:blank") url = undefined;

    const createOpts = {
      windowId,
      url,
      pinned: tab.pinned,
      active: tab.active
    };

    // Firefox container support
    if (tab.cookieStoreId && tab.cookieStoreId !== "firefox-default" &&
        tab.cookieStoreId !== "firefox-private") {
      createOpts.cookieStoreId = tab.cookieStoreId;
    }

    try {
      const newTab = await browser.tabs.create(createOpts);
      oldIdToNewId[tab.id] = newTab.id;
    } catch {
      // Retry without cookieStoreId if container no longer exists
      delete createOpts.cookieStoreId;
      try {
        const newTab = await browser.tabs.create(createOpts);
        oldIdToNewId[tab.id] = newTab.id;
      } catch (e) {
        console.warn("[session-buddy] Failed to create tab", url, e);
      }
    }
  }

  // Restore tab groups — use saved tabGroups array when present; fall back to
  // group info embedded on each tab (groupId/groupColor/groupTitle set at capture).
  if (tabGroupsEnabled) {
    const groups = (win.tabGroups && win.tabGroups.length > 0)
      ? win.tabGroups
      : deriveGroupsFromTabs(win.tabs);

    for (const group of groups) {
      const groupTabIds = sortedTabs
        .filter(t => String(t.groupId) === String(group.id))
        .map(t => oldIdToNewId[t.id])
        .filter(Boolean);
      await restoreTabGroup(windowId, groupTabIds, group);
    }
  }
}

// ─── Message handling ─────────────────────────────────────────────────────────

let initPromise = null;

async function ensureInit() {
  if (!initPromise) initPromise = dbInit();
  return initPromise;
}

browser.runtime.onMessage.addListener((request, sender) => {
  return (async () => {
    await ensureInit();

    switch (request.type) {
      case "saveSession": {
        const session = await captureCurrentSession(request.name, request.scope);
        await dbPut(session);
        return { ok: true, session };
      }

      case "getSessions": {
        const sessions = await dbGetAll();
        sessions.sort((a, b) => b.date - a.date);
        return sessions;
      }

      case "getSession": {
        const session = await dbGet(request.id);
        return session;
      }

      case "deleteSession": {
        await dbDelete(request.id);
        return { ok: true };
      }

      case "deleteAllSessions": {
        await dbDeleteAll();
        return { ok: true };
      }

      case "renameSession": {
        const session = await dbGet(request.id);
        if (!session) return { ok: false };
        session.name = request.name;
        await dbPut(session);
        return { ok: true, session };
      }

      case "openSession": {
        const session = await dbGet(request.id);
        if (!session) return { ok: false };
        await openSession(session, request.mode);
        return { ok: true };
      }

      case "getCurrentState": {
        const live = await captureCurrentSession("", "all");
        return live;
      }

      case "updateSession": {
        await dbPut(request.session);
        return { ok: true };
      }

      case "importSessions": {
        for (const session of request.sessions) {
          // Assign a fresh id to avoid collisions
          session.id = generateId();
          await dbPut(session);
        }
        return { ok: true, count: request.sessions.length };
      }

      case "getHistory": {
        const entries = await dbHistoryGetAll();
        entries.sort((a, b) => b.date - a.date);
        return entries;
      }

      case "deleteHistoryEntry": {
        await dbHistoryDelete(request.id);
        return { ok: true };
      }

      case "clearHistory": {
        await dbHistoryDeleteAll();
        return { ok: true };
      }

      case "saveHistoryAsSession": {
        const entry = request.entry;
        const session = {
          id: generateId(),
          name: request.name || new Date(entry.date).toLocaleString(),
          date: Date.now(),
          windows: entry.windows,
          tabCount: entry.tabCount,
          windowCount: entry.windowCount,
        };
        await dbPut(session);
        return { ok: true, session };
      }

      case "openHistoryEntry": {
        await openSession(request.entry, request.mode);
        return { ok: true };
      }

      default:
        return { ok: false, error: "unknown message type" };
    }
  })();
});

// Open manager page when toolbar icon is clicked
browser.action.onClicked.addListener(() => {
  browser.tabs.create({ url: browser.runtime.getURL("manager/manager.html") });
});

// ─── Auto-history ─────────────────────────────────────────────────────────────

let lastSnapshot = null;

async function updateSnapshot() {
  try {
    lastSnapshot = await captureCurrentSession("", "all");
  } catch {}
}

async function commitHistory(type) {
  if (!lastSnapshot || !lastSnapshot.windows || lastSnapshot.windows.length === 0) return;
  await ensureInit();
  const entry = {
    id: generateId(),
    date: Date.now(),
    type,
    windows: lastSnapshot.windows,
    tabCount: lastSnapshot.tabCount,
    windowCount: lastSnapshot.windowCount,
  };
  await dbHistoryPut(entry);
  // Trim to limit
  const all = await dbHistoryGetAll();
  if (all.length > HISTORY_LIMIT) {
    const sorted = all.sort((a, b) => a.date - b.date);
    for (const old of sorted.slice(0, all.length - HISTORY_LIMIT)) {
      await dbHistoryDelete(old.id);
    }
  }
}

// Keep snapshot fresh on tab/window changes
browser.tabs.onCreated.addListener(updateSnapshot);
browser.tabs.onRemoved.addListener(updateSnapshot);
browser.tabs.onUpdated.addListener(updateSnapshot);
browser.windows.onCreated.addListener(updateSnapshot);

// Save history when all windows close (browser closing)
browser.windows.onRemoved.addListener(async () => {
  await ensureInit();
  const remaining = await browser.windows.getAll();
  if (remaining.length === 0) {
    await commitHistory("browserClosed");
  } else {
    await updateSnapshot();
  }
});

// Periodic auto-save every 5 minutes
browser.alarms.create("historyAutoSave", { periodInMinutes: 5 });
browser.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "historyAutoSave") return;
  await ensureInit();
  await updateSnapshot();
  await commitHistory("autoSave");
});
