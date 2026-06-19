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

const DEFAULT_CONFIG = { historyInterval: 5, historyLimit: 50, ignoreExtensionTabs: true, ifSupportTst: false, tstDelay: 0, cloudAutoSync: true };

async function getConfig() {
  const stored = await browser.storage.local.get(DEFAULT_CONFIG);
  return { ...DEFAULT_CONFIG, ...stored };
}

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

const windowsSupported = typeof browser !== "undefined" && browser.windows !== undefined;

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

async function prependSessionOrder(ids) {
  const { sessionOrder = [] } = await browser.storage.local.get({ sessionOrder: [] });
  const without = sessionOrder.filter(id => !ids.includes(id));
  await browser.storage.local.set({ sessionOrder: [...ids, ...without] });
}

async function removeFromSessionOrder(ids) {
  const { sessionOrder = [] } = await browser.storage.local.get({ sessionOrder: [] });
  await browser.storage.local.set({ sessionOrder: sessionOrder.filter(id => !ids.includes(id)) });
}

async function captureCurrentSession(name, scope = "all", { fetchFavicons = true } = {}) {
  const queryInfo = scope === "current" ? { currentWindow: true } : {};
  let tabs = await browser.tabs.query(queryInfo);

  const { ignoreExtensionTabs } = await getConfig();
  if (ignoreExtensionTabs) {
    tabs = tabs.filter(t => !t.url?.startsWith("moz-extension://"));
  }
  const validTabIds = new Set(tabs.map(t => t.id));

  const windowsMap = {};
  const windowIds = [];

  for (const tab of tabs) {
    const wid = tab.windowId;
    if (!windowsMap[wid]) {
      windowsMap[wid] = { tabs: [] };
      windowIds.push(wid);
    }
    const favicon = fetchFavicons
      ? await fetchFaviconAsDataUrl(tab.favIconUrl || "")
      : (tab.favIconUrl || "");
    windowsMap[wid].tabs.push({
      id: tab.id,
      index: tab.index,
      url: tab.url,
      title: tab.title,
      favIconUrl: favicon,
      pinned: tab.pinned,
      active: tab.active,
      groupId: tab.groupId ?? -1,
      cookieStoreId: tab.cookieStoreId,
      openerTabId: (tab.openerTabId != null && validTabIds.has(tab.openerTabId)) ? tab.openerTabId : undefined
    });
  }

  // Collect window metadata + tab groups
  const windows = [];
  for (const wid of windowIds) {
    const winInfo = windowsSupported
      ? await browser.windows.get(wid)
      : { state: "normal", width: 0, height: 0, top: 0, left: 0, incognito: false };
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
    lastEditedTime: Date.now(),
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
      await createTabsInWindow(win, targetWindowId, false);
    } else {
      if (!windowsSupported) {
        // Android: no multi-window support — open tabs in the current window
        const existingTabs = await browser.tabs.query({ active: true, currentWindow: true });
        targetWindowId = existingTabs[0]?.windowId ?? browser.windows?.WINDOW_ID_CURRENT;
        await createTabsInWindow(win, targetWindowId, false);
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
}

const PLACEHOLDER_BASE = browser.runtime.getURL("placeholder/index.html");

function placeholderUrl(url, title) {
  return PLACEHOLDER_BASE +
    "?url=" + encodeURIComponent(url) +
    "&title=" + encodeURIComponent(title || "");
}

async function createTabsInWindow(win, windowId, isCurrentWindow) {
  const sortedTabs = [...win.tabs].sort((a, b) => a.index - b.index);
  const oldIdToNewId = {};
  const { ifSupportTst, tstDelay } = await getConfig();

  for (const tab of sortedTabs) {
    let url = tab.url;
    if (url === "about:newtab" || url === "about:blank") url = undefined;
    // about: pages other than newtab/blank cannot be opened by extensions — Firefox
    // may silently open a blank tab instead of throwing, so redirect proactively.
    if (url && /^about:/i.test(url)) url = placeholderUrl(url, tab.title || "");

    const createOpts = {
      windowId,
      url,
      pinned: tab.pinned,
      active: tab.active
    };

    // Tree Style Tab: set parent tab ID so TST builds the hierarchy
    if (ifSupportTst && tab.openerTabId != null && oldIdToNewId[tab.openerTabId] != null) {
      createOpts.openerTabId = oldIdToNewId[tab.openerTabId];
    }

    // Firefox container support
    if (tab.cookieStoreId && tab.cookieStoreId !== "firefox-default" &&
        tab.cookieStoreId !== "firefox-private") {
      createOpts.cookieStoreId = tab.cookieStoreId;
    }

    try {
      const newTab = await browser.tabs.create(createOpts);
      oldIdToNewId[tab.id] = newTab.id;
    } catch (e) {
      const isMissingContainer = e?.message?.startsWith("No cookie store exists");
      if (isMissingContainer) {
        delete createOpts.cookieStoreId;
      } else {
        createOpts.url = placeholderUrl(url || "", tab.title || "");
        delete createOpts.cookieStoreId;
      }
      try {
        const newTab = await browser.tabs.create(createOpts);
        oldIdToNewId[tab.id] = newTab.id;
      } catch (e2) {
        console.warn("[session-buddy] Failed to create tab", url, e2);
      }
    }

    // TST needs a moment to register each tab before the next child is created
    if (ifSupportTst && tstDelay > 0) {
      await new Promise(r => setTimeout(r, tstDelay));
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
        await prependSessionOrder([session.id]);
        scheduleAutoSyncDirty();
        return { ok: true, session };
      }

      case "getSessions": {
        const sessions = await dbGetAll();
        const { sessionOrder = [] } = await browser.storage.local.get({ sessionOrder: [] });
        sessions.sort((a, b) => {
          const ai = sessionOrder.indexOf(a.id);
          const bi = sessionOrder.indexOf(b.id);
          if (ai === -1 && bi === -1) return b.date - a.date;
          if (ai === -1) return -1;
          if (bi === -1) return 1;
          return ai - bi;
        });
        return sessions;
      }

      case "getSession": {
        const session = await dbGet(request.id);
        return session;
      }

      case "deleteSession": {
        await dbDelete(request.id);
        await removeFromSessionOrder([request.id]);
        const { syncRemovedQueue = [] } = await browser.storage.local.get({ syncRemovedQueue: [] });
        syncRemovedQueue.push(request.id);
        await browser.storage.local.set({ syncRemovedQueue });
        scheduleAutoSyncDirty();
        return { ok: true };
      }

      case "deleteAllSessions": {
        await dbDeleteAll();
        await browser.storage.local.remove("sessionOrder");
        await browser.storage.local.remove(["syncRemovedQueue"]);
        return { ok: true };
      }

      case "renameSession": {
        const session = await dbGet(request.id);
        if (!session) return { ok: false };
        session.name = request.name;
        session.lastEditedTime = Date.now();
        await dbPut(session);
        scheduleAutoSyncDirty();
        return { ok: true, session };
      }

      case "openSession": {
        const session = await dbGet(request.id);
        if (!session) return { ok: false };
        await openSession(session, request.mode);
        return { ok: true };
      }

      case "getCurrentState": {
        // Skip favicon data-URL conversion — raw URLs from the browser work directly in the UI
        const live = await captureCurrentSession("", "all", { fetchFavicons: false });
        return live;
      }

      case "updateSession": {
        request.session.lastEditedTime = Date.now();
        await dbPut(request.session);
        scheduleAutoSyncDirty();
        return { ok: true };
      }

      case "replaceSession": {
        const existing = await dbGet(request.id);
        if (!existing) return { ok: false };
        const captured = await captureCurrentSession(existing.name, "all");
        captured.id = existing.id;
        captured.name = existing.name;
        captured.date = existing.date;
        captured.lastEditedTime = Date.now();
        await dbPut(captured);
        scheduleAutoSyncDirty();
        return { ok: true };
      }

      case "importSessions": {
        const newIds = [];
        for (const session of request.sessions) {
          if (!Array.isArray(session.windows)) continue;
          session.id = generateId();
          session.lastEditedTime = Date.now();
          await dbPut(session);
          newIds.push(session.id);
        }
        if (newIds.length > 0) await prependSessionOrder(newIds);
        scheduleAutoSyncDirty();
        return { ok: true, count: newIds.length };
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
        await prependSessionOrder([session.id]);
        return { ok: true, session };
      }

      case "openHistoryEntry": {
        await openSession(request.entry, request.mode);
        return { ok: true };
      }

      case "navigateTab": {
        // Used by placeholder page to navigate itself to the original URL via extension API
        await browser.tabs.update(request.tabId, { url: request.url });
        return { ok: true };
      }

      case "getConfig": {
        return await getConfig();
      }

      case "saveConfig": {
        await browser.storage.local.set(request.config);
        await setupAlarm();
        await setupCloudAlarm();
        return { ok: true };
      }

      case "exportBackup": {
        const [sessions, history, config, syncStore] = await Promise.all([
          dbGetAll(),
          dbHistoryGetAll(),
          getConfig(),
          getCloudStore(),
        ]);
        // Include sync credentials so they survive a backup/restore cycle
        const sync = {
          syncClientId:     syncStore.syncClientId     || undefined,
          syncClientSecret: syncStore.syncClientSecret || undefined,
          syncRefreshToken: syncStore.syncRefreshToken || undefined,
          syncAccessToken:  syncStore.syncAccessToken  || undefined,
          syncTokenExpiry:  syncStore.syncTokenExpiry  || undefined,
          syncEmail:        syncStore.syncEmail        || undefined,
          syncLastSyncTime: syncStore.syncLastSyncTime || undefined,
        };
        return { sessions, history, config, sync };
      }

      case "importBackup": {
        const { sessions = [], history = [], config = {}, sync = {}, merge = false } = request;
        if (!merge) {
          await dbDeleteAll();
          await dbHistoryDeleteAll();
          await browser.storage.local.remove("sessionOrder");
        }
        const backupIds = [];
        for (const s of sessions) {
          s.id = merge ? generateId() : (s.id || generateId());
          await dbPut(s);
          backupIds.push(s.id);
        }
        for (const h of history) {
          h.id = merge ? generateId() : (h.id || generateId());
          await dbHistoryPut(h);
        }
        if (!merge) {
          await browser.storage.local.set({ sessionOrder: backupIds });
        } else {
          await prependSessionOrder(backupIds);
        }
        if (Object.keys(config).length > 0) {
          await browser.storage.local.set(config);
          await setupAlarm();
        }
        // Restore sync credentials when present (skip empty strings to avoid clobbering existing auth)
        const syncFields = {};
        for (const [k, v] of Object.entries(sync)) {
          if (v !== undefined && v !== "" && v !== 0) syncFields[k] = v;
        }
        if (Object.keys(syncFields).length > 0) {
          await browser.storage.local.set(syncFields);
        }
        return { ok: true };
      }

      case "reorderSessions": {
        await browser.storage.local.set({ sessionOrder: request.order });
        return { ok: true };
      }

      case "getRecentlyClosed": {
        if (!browser.sessions) return [];
        const closed = await browser.sessions.getRecentlyClosed({ maxResults: 25 });
        return closed;
      }

      case "restoreClosedSession": {
        if (!browser.sessions) return { ok: false };
        await browser.sessions.restore(request.sessionId);
        return { ok: true };
      }

      case "cloudGetStatus": {
        const store = await getCloudStore();
        return {
          ok: true,
          email: store.syncEmail,
          lastSyncTime: store.syncLastSyncTime,
          syncing: _cloudSyncing,
          redirectUri: browser.identity?.getRedirectURL?.() ?? ""
        };
      }

      case "cloudSignIn": {
        try {
          const email = await cloudSignIn(request.clientId, request.clientSecret);
          return { ok: true, email };
        } catch (e) {
          return { ok: false, error: String(e.message || e) };
        }
      }

      case "cloudSignOut": {
        await cloudSignOut();
        return { ok: true };
      }

      case "cloudSync": {
        return await syncCloud();
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
let _snapshotTimer = null;

function scheduleSnapshot() {
  clearTimeout(_snapshotTimer);
  _snapshotTimer = setTimeout(async () => {
    try {
      // Skip favicon network fetches for history snapshots — store URLs as-is
      lastSnapshot = await captureCurrentSession("", "all", { fetchFavicons: false });
    } catch (e) {
      console.warn("[session-buddy] updateSnapshot failed", e);
    }
  }, 1500);
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
  // Trim to configured limit
  const { historyLimit } = await getConfig();
  const all = await dbHistoryGetAll();
  if (all.length > historyLimit) {
    const sorted = all.sort((a, b) => a.date - b.date);
    for (const old of sorted.slice(0, all.length - historyLimit)) {
      await dbHistoryDelete(old.id);
    }
  }
}

// Push a lightweight notification to open manager pages by writing a ping to
// storage.local. browser.storage.onChanged fires in ALL extension contexts
// (including private-window extension pages) so this reliably reaches the manager
// regardless of incognito state — no tab querying or message routing needed.
let _notifyTimer = null;
function scheduleNotifyManager() {
  clearTimeout(_notifyTimer);
  _notifyTimer = setTimeout(() => {
    browser.storage.local.set({ _tabsChanged: Date.now() }).catch(() => {});
  }, 300);
}

// Keep snapshot fresh on tab/window changes (debounced — many events fire per page load)
browser.tabs.onCreated.addListener(() => { scheduleSnapshot(); scheduleNotifyManager(); });
browser.tabs.onRemoved.addListener(() => { scheduleSnapshot(); scheduleNotifyManager(); });
browser.tabs.onUpdated.addListener((_id, changeInfo) => {
  scheduleSnapshot();
  if (changeInfo.status === "complete" || "url" in changeInfo || "title" in changeInfo || "favIconUrl" in changeInfo || "pinned" in changeInfo) {
    scheduleNotifyManager();
  }
});
browser.tabs.onMoved.addListener(() => { scheduleSnapshot(); scheduleNotifyManager(); });
browser.tabs.onAttached.addListener(() => { scheduleSnapshot(); scheduleNotifyManager(); });
browser.tabs.onDetached.addListener(() => { scheduleSnapshot(); scheduleNotifyManager(); });
if (windowsSupported) browser.windows.onCreated.addListener(() => { scheduleSnapshot(); scheduleNotifyManager(); });

// Save history when all windows close (browser closing)
if (windowsSupported) browser.windows.onRemoved.addListener(async () => {
  await ensureInit();
  const remaining = await browser.windows.getAll();
  if (remaining.length === 0) {
    // Capture immediately (no debounce) before the browser exits
    try {
      lastSnapshot = await captureCurrentSession("", "all", { fetchFavicons: false });
    } catch {}
    await commitHistory("browserClosed");
  } else {
    scheduleSnapshot();
    scheduleNotifyManager();
  }
});

async function setupAlarm() {
  const { historyInterval } = await getConfig();
  const existing = await browser.alarms.get("historyAutoSave");
  if (!existing || Math.abs((existing.periodInMinutes ?? 0) - historyInterval) > 0.01) {
    await browser.alarms.clear("historyAutoSave");
    browser.alarms.create("historyAutoSave", { periodInMinutes: historyInterval });
  }
}
setupAlarm();

// Create a recurring 30-minute sync alarm only when the user is signed in AND auto-sync is on.
async function setupCloudAlarm() {
  const [store, cfg] = await Promise.all([getCloudStore(), getConfig()]);
  if (store.syncRefreshToken && cfg.cloudAutoSync) {
    const existing = await browser.alarms.get("cloudPeriodicSync");
    if (!existing) browser.alarms.create("cloudPeriodicSync", { periodInMinutes: 30 });
  } else {
    await browser.alarms.clear("cloudPeriodicSync");
    await browser.alarms.clear("cloudDirtySync");
  }
}
setupCloudAlarm();

// Debounced dirty-sync: fires 5 minutes after the last local change so rapid
// edits are batched into a single upload instead of one upload per keystroke.
async function scheduleAutoSyncDirty() {
  const cfg = await getConfig();
  if (!cfg.cloudAutoSync) return;
  // Replacing an existing alarm with the same name resets its timer — that's our debounce.
  browser.alarms.create("cloudDirtySync", { delayInMinutes: 5 });
}

browser.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "historyAutoSave") {
    await ensureInit();
    try {
      lastSnapshot = await captureCurrentSession("", "all", { fetchFavicons: false });
    } catch {}
    await commitHistory("autoSave");
    return;
  }
  if (alarm.name === "cloudPeriodicSync" || alarm.name === "cloudDirtySync") {
    await ensureInit();
    const [store, cfg] = await Promise.all([getCloudStore(), getConfig()]);
    if (!store.syncRefreshToken || !cfg.cloudAutoSync || _cloudSyncing) return;
    syncCloud().catch(() => {});
  }
});

// ─── Google Drive Cloud Sync ─────────────────────────────────────────────────

async function getCloudStore() {
  return browser.storage.local.get({
    syncClientId: "", syncClientSecret: "",
    syncAccessToken: "", syncRefreshToken: "", syncTokenExpiry: 0,
    syncEmail: "", syncLastSyncTime: 0, syncRemovedQueue: []
  });
}

async function getValidAccessToken() {
  const store = await getCloudStore();
  if (!store.syncRefreshToken) throw new Error("Not signed in to Google");
  if (store.syncTokenExpiry > Date.now() + 60000) return store.syncAccessToken;

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: store.syncClientId,
      client_secret: store.syncClientSecret,
      grant_type: "refresh_token",
      refresh_token: store.syncRefreshToken
    })
  });
  const json = await resp.json();
  if (json.error) throw new Error(json.error_description || json.error);
  await browser.storage.local.set({
    syncAccessToken: json.access_token,
    syncTokenExpiry: Date.now() + json.expires_in * 1000
  });
  return json.access_token;
}

async function cloudSignIn(clientId, clientSecret) {
  const redirectUri = browser.identity.getRedirectURL();
  const authURL = "https://accounts.google.com/o/oauth2/v2/auth" +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent("https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email")}` +
    `&access_type=offline&prompt=consent`;

  const redirected = await browser.identity.launchWebAuthFlow({ url: authURL, interactive: true });
  const params = new URL(redirected.replace("#", "?")).searchParams;
  if (params.has("error")) throw new Error(params.get("error"));
  const code = params.get("code");

  const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, grant_type: "authorization_code", redirect_uri: redirectUri })
  });
  const tokens = await tokenResp.json();
  if (tokens.error) throw new Error(tokens.error_description || tokens.error);

  const emailResp = await fetch(`https://www.googleapis.com/oauth2/v1/userinfo?access_token=${tokens.access_token}`);
  const { email } = await emailResp.json();

  await browser.storage.local.set({
    syncClientId: clientId, syncClientSecret: clientSecret,
    syncAccessToken: tokens.access_token, syncRefreshToken: tokens.refresh_token,
    syncTokenExpiry: Date.now() + tokens.expires_in * 1000,
    syncEmail: email, syncLastSyncTime: 0, syncRemovedQueue: []
  });
  await setupCloudAlarm();
  // Kick off an initial sync immediately so the user sees their cloud data right away
  syncCloud().catch(() => {});
  return email;
}

async function cloudSignOut() {
  const store = await getCloudStore();
  for (const token of [store.syncAccessToken, store.syncRefreshToken]) {
    if (token) fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token })
    }).catch(() => {});
  }
  await browser.alarms.clear("cloudPeriodicSync");
  await browser.alarms.clear("cloudDirtySync");
  await browser.storage.local.remove([
    "syncAccessToken", "syncRefreshToken", "syncTokenExpiry",
    "syncEmail", "syncLastSyncTime", "syncRemovedQueue", "syncFolderId"
  ]);
}

async function driveGetOrCreateFolder(): Promise<string> {
  const token = await getValidAccessToken();
  const cached = await browser.storage.local.get({ syncFolderId: "" });
  if (cached.syncFolderId) return cached.syncFolderId;

  // Search for existing TabKeeper folder
  const q = `name='TabKeeper' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const searchResp = await fetch(
    `https://www.googleapis.com/drive/v3/files?${new URLSearchParams({ q, fields: "files(id)" })}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const searchJson = await searchResp.json();
  if (searchJson.error) throw new Error(searchJson.error.message);

  if (searchJson.files?.length) {
    const id = searchJson.files[0].id;
    await browser.storage.local.set({ syncFolderId: id });
    return id;
  }

  // Create it
  const createResp = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "TabKeeper", mimeType: "application/vnd.google-apps.folder" })
  });
  const createJson = await createResp.json();
  if (createJson.error) throw new Error(createJson.error.message);
  await browser.storage.local.set({ syncFolderId: createJson.id });
  return createJson.id;
}

async function driveList() {
  const token = await getValidAccessToken();
  const folderId = await driveGetOrCreateFolder();
  const q = `'${folderId}' in parents and mimeType='application/json' and trashed=false`;
  const params = new URLSearchParams({ q, fields: "files(id,name,appProperties)", pageSize: "1000" });
  const resp = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const json = await resp.json();
  if (json.error) throw new Error(json.error.message);
  return json.files || [];
}

async function driveUpload(session, fileId = "") {
  const token = await getValidAccessToken();
  const folderId = await driveGetOrCreateFolder();
  const metadata = {
    name: session.id,
    appProperties: { lastEditedTime: String(session.lastEditedTime || session.date || 0) },
    mimeType: "application/json",
    ...(!fileId && { parents: [folderId] })
  };
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.append("file", new Blob([JSON.stringify(session)], { type: "application/json" }));
  const resp = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files${fileId ? `/${fileId}` : ""}?uploadType=multipart`,
    { method: fileId ? "PATCH" : "POST", headers: { Authorization: `Bearer ${token}` }, body: form }
  );
  const json = await resp.json();
  if (json.error) throw new Error(json.error.message);
}

async function driveDownload(fileId) {
  const token = await getValidAccessToken();
  const resp = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return resp.json();
}

async function driveDelete(fileId) {
  const token = await getValidAccessToken();
  await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: "DELETE", headers: { Authorization: `Bearer ${token}` }
  });
}

// Tombstone file tracks all IDs ever deleted so other devices don't re-download them.
const TOMBSTONES_FILENAME = "tabkeeper-tombstones";

async function driveUploadTombstones(ids, fileId) {
  const token = await getValidAccessToken();
  const folderId = await driveGetOrCreateFolder();
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify({
    name: TOMBSTONES_FILENAME,
    mimeType: "application/json",
    ...(!fileId && { parents: [folderId] })
  })], { type: "application/json" }));
  form.append("file", new Blob([JSON.stringify({ ids })], { type: "application/json" }));
  const resp = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files${fileId ? `/${fileId}` : ""}?uploadType=multipart`,
    { method: fileId ? "PATCH" : "POST", headers: { Authorization: `Bearer ${token}` }, body: form }
  );
  const json = await resp.json();
  if (json.error) throw new Error(json.error.message);
  return json.id;
}

let _cloudSyncing = false;

async function syncCloud() {
  if (_cloudSyncing) return { ok: false, error: "Sync already in progress" };
  _cloudSyncing = true;
  try {
    const store = await getCloudStore();
    if (!store.syncRefreshToken) throw new Error("Not signed in to Google");

    const [driveFiles, localSessions] = await Promise.all([driveList(), dbGetAll()]);
    const now = Date.now();

    // Split tombstones file from session files
    const tombstonesFile = driveFiles.find(f => f.name === TOMBSTONES_FILENAME);
    const sessionFiles = driveFiles.filter(f => f.name !== TOMBSTONES_FILENAME);

    // Merge remote tombstones with local removal queue
    let remoteTombstoneIds: string[] = [];
    if (tombstonesFile) {
      const data = await driveDownload(tombstonesFile.id).catch(() => null);
      remoteTombstoneIds = Array.isArray(data?.ids) ? data.ids : [];
    }
    const allTombstoneIds = new Set([...remoteTombstoneIds, ...(store.syncRemovedQueue || [])]);

    const driveMap = Object.fromEntries(sessionFiles.map(f => [f.name, f]));
    const localMap = Object.fromEntries(localSessions.map(s => [s.id, s]));

    // Step 1: Apply tombstones — purge deleted sessions from both sides
    for (const id of allTombstoneIds) {
      if (localMap[id]) {
        await dbDelete(id);
        await removeFromSessionOrder([id]);
        delete localMap[id];
      }
      if (driveMap[id]) {
        await driveDelete(driveMap[id].id);
        delete driveMap[id];
      }
    }

    // Step 2: Download sessions that are new or updated on Drive
    for (const file of Object.values(driveMap)) {
      const driveTime = parseInt(file.appProperties?.lastEditedTime || "0");
      const local = localMap[file.name];
      const localTime = local?.lastEditedTime || local?.date || 0;
      if (!local || driveTime > localTime) {
        const session = await driveDownload(file.id);
        if (session?.id && !allTombstoneIds.has(session.id)) {
          session.lastEditedTime = driveTime || session.date;
          await dbPut(session);
          if (!local) await prependSessionOrder([session.id]);
          localMap[session.id] = session;
        }
      }
    }

    // Step 3: Upload sessions that are new or updated locally
    for (const session of Object.values(localMap)) {
      const file = driveMap[session.id];
      const localTime = session.lastEditedTime || session.date || 0;
      const driveTime = parseInt(file?.appProperties?.lastEditedTime || "0");
      if (!file || localTime > driveTime) {
        await driveUpload(session, file?.id);
      }
    }

    // Step 4: Persist tombstones on Drive so other devices respect deletions
    if (allTombstoneIds.size > 0) {
      await driveUploadTombstones([...allTombstoneIds], tombstonesFile?.id ?? "");
    }

    // Notify the manager page to reload sessions (storage.onChanged fires in all contexts)
    await browser.storage.local.set({ syncLastSyncTime: now, syncRemovedQueue: [], _syncDone: now });
    return { ok: true, time: now };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  } finally {
    _cloudSyncing = false;
  }
}
