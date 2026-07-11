import { useState, useEffect, useCallback, useRef } from "react";
import { useApp } from "../../context/AppContext";
import { send } from "../../utils/messaging";
import { deepClone, genId } from "../../utils/helpers";
import { downloadFileSaveAs } from "../../utils/download";
import type { Window as SessionWindow } from "../../context/types";

const PRIVATE_STORE = "firefox-private";
// Firefox for Android has no windows API and exposes a single cookie store
// ("firefox-default") — there's no separate "firefox-private" store to filter by there.
const ANDROID_MODE = typeof browser.windows === "undefined";

interface BrowserCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string;
  storeId?: string;
  firstPartyDomain?: string;
  hostOnly?: boolean;
  session?: boolean;
}

function cookieUrl(c: BrowserCookie) {
  return `http${c.secure ? "s" : ""}://${c.domain.replace(/^\./, "")}${c.path}`;
}

async function getPrivateCookies(): Promise<BrowserCookie[]> {
  try {
    return await browser.cookies.getAll(ANDROID_MODE ? {} : { storeId: PRIVATE_STORE }) as BrowserCookie[];
  } catch { return []; }
}

async function removeCookie(c: BrowserCookie) {
  return browser.cookies.remove({
    url: cookieUrl(c),
    name: c.name,
    storeId: c.storeId,
    firstPartyDomain: c.firstPartyDomain ?? "",
  }).catch(() => {});
}

async function clearPrivateCookies(): Promise<number> {
  const list = await getPrivateCookies();
  await Promise.all(list.map(removeCookie));
  return list.length;
}

async function clearDomainCookies(domain: string): Promise<number> {
  const list = await getPrivateCookies();
  const match = list.filter(c => c.domain.replace(/^\./, "").toLowerCase().includes(domain.toLowerCase()));
  await Promise.all(match.map(removeCookie));
  return match.length;
}

function mapBrowserWindow(win: browser.windows.Window): SessionWindow {
  const tabs: SessionWindow["tabs"] = (win.tabs ?? [])
    .filter(t => t.url && !t.url.startsWith("about:") && !t.url.startsWith("moz-extension:"))
    .map((t, i) => ({
      id: t.id,
      index: i,
      url: t.url ?? "",
      title: t.title ?? t.url ?? "",
      favIconUrl: t.favIconUrl,
      pinned: t.pinned,
      cookieStoreId: t.cookieStoreId,
    }));
  return { id: win.id, incognito: true, tabs };
}

// ─── Inline private window editor ────────────────────────────────────────────

function PrivateWindowsEditor({
  wins,
  onRemoveTab,
  onRemoveWindow,
  onSaveWindow,
  onReset,
}: {
  wins: SessionWindow[];
  onRemoveTab: (wi: number, ti: number) => void;
  onRemoveWindow: (wi: number) => void;
  onSaveWindow: (wi: number) => void;
  onReset: () => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const allCollapsed = wins.length > 0 && collapsed.size === wins.length;

  function toggleCollapse(wi: number) {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(wi)) next.delete(wi); else next.add(wi);
      return next;
    });
  }

  function toggleAll() {
    if (allCollapsed) setCollapsed(new Set());
    else setCollapsed(new Set(wins.map((_, i) => i)));
  }

  const totalTabs = wins.reduce((n, w) => n + w.tabs.length, 0);

  return (
    <div className="cookie-win-editor">
      <div className="cookie-section-header">
        <div className="cookie-section-title">
          Tabs to export
          <span className="cookie-section-meta">
            {wins.length} window{wins.length !== 1 ? "s" : ""} · {totalTabs} tab{totalTabs !== 1 ? "s" : ""}
          </span>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {wins.length > 1 && (
            <button className="btn btn-ghost btn-xs" onClick={toggleAll}>
              {allCollapsed ? "Expand all" : "Collapse all"}
            </button>
          )}
          <button className="btn btn-ghost btn-xs" onClick={onReset} title="Re-sync with current private windows">
            Reset
          </button>
        </div>
      </div>

      {wins.length === 0 ? (
        <div className="cookie-info">All tabs removed — export will include no tabs.</div>
      ) : wins.map((win, wi) => (
        <div key={wi} className="cookie-edit-window">
          <div className="cookie-edit-win-header">
            <button
              className="cookie-edit-collapse"
              onClick={() => toggleCollapse(wi)}
              title="Collapse / expand"
            >
              <svg
                className={`collapse-arrow${collapsed.has(wi) ? " collapsed" : ""}`}
                viewBox="0 0 16 16" fill="none"
              >
                <polyline points="4,6 8,10 12,6" stroke="currentColor" strokeWidth="1.5"
                  strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            <svg className="cookie-edit-win-icon" viewBox="0 0 16 16" fill="none">
              <rect x="3" y="7" width="10" height="8" rx="1.5" stroke="#b980ff" strokeWidth="1.3"/>
              <path d="M5 7V5a3 3 0 0 1 6 0v2" stroke="#b980ff" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
            <span className="cookie-edit-win-label">
              Window {wi + 1}
              <span className="cookie-edit-win-count">{win.tabs.length} tab{win.tabs.length !== 1 ? "s" : ""}</span>
            </span>
            <div className="cookie-edit-win-actions">
              <button
                className="btn btn-ghost btn-xs"
                onClick={() => onSaveWindow(wi)}
                title="Save this window as a collection"
              >
                Save
              </button>
              <button
                className="cookie-edit-remove-win"
                onClick={() => onRemoveWindow(wi)}
                title="Remove this window from export"
              >
                ×
              </button>
            </div>
          </div>

          {!collapsed.has(wi) && (
            <div className="cookie-edit-win-body">
              {win.tabs.map((tab, ti) => (
                <div key={ti} className="cookie-edit-tab">
                  {tab.favIconUrl ? (
                    <img className="cookie-edit-fav" src={tab.favIconUrl} alt="" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  ) : (
                    <svg className="cookie-edit-fav-placeholder" viewBox="0 0 16 16" fill="none">
                      <rect x="1" y="2" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.2"/>
                      <line x1="1" y1="6" x2="15" y2="6" stroke="currentColor" strokeWidth="1.2"/>
                    </svg>
                  )}
                  <div className="cookie-edit-tab-info">
                    <div className="cookie-edit-tab-title" title={tab.title}>{tab.title || tab.url}</div>
                    <div className="cookie-edit-tab-url" title={tab.url}>{tab.url}</div>
                  </div>
                  <button
                    className="cookie-edit-remove-tab"
                    onClick={() => onRemoveTab(wi, ti)}
                    title="Remove from export"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

export function CookieView() {
  const { showModal, hideModal, toast } = useApp();
  const [cookies, setCookies] = useState<BrowserCookie[]>([]);
  const [liveWins, setLiveWins] = useState<SessionWindow[]>([]);
  const [editableWins, setEditableWins] = useState<SessionWindow[]>([]);
  const [privOpen, setPrivOpen] = useState(false);
  const [incogAllowed, setIncogAllowed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filterQuery, setFilterQuery] = useState("");
  const [includeTabs, setIncludeTabs] = useState(true);
  const [expandedDomains, setExpandedDomains] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);
  // Tracks the previous live state so refreshLive can distinguish user-removed
  // tabs from brand-new tabs that just appeared in the private window.
  const prevLiveRef = useRef<SessionWindow[]>([]);

  const fetchLiveWins = useCallback(async (): Promise<SessionWindow[]> => {
    if (typeof browser.windows !== "undefined") {
      const allWins = await browser.windows.getAll({ populate: true });
      return (allWins as browser.windows.Window[]).filter(w => w.incognito).map(mapBrowserWindow);
    }
    // Firefox for Android has no windows API — private tabs live in the same
    // window as normal tabs, distinguished only by tab.incognito.
    const allTabs = await browser.tabs.query({});
    const privateTabs = allTabs.filter(t => t.incognito);
    if (privateTabs.length === 0) return [];
    const byWindow = new Map<number, browser.tabs.Tab[]>();
    for (const t of privateTabs) {
      const list = byWindow.get(t.windowId);
      if (list) list.push(t); else byWindow.set(t.windowId, [t]);
    }
    return [...byWindow.entries()].map(([windowId, tabs]) =>
      mapBrowserWindow({ id: windowId, tabs } as browser.windows.Window)
    );
  }, []);

  // Initial load — sets everything including editableWins
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [mapped, allowed, cookieList] = await Promise.all([
        fetchLiveWins(),
        browser.extension.isAllowedIncognitoAccess().catch(() => false),
        getPrivateCookies(),
      ]);
      prevLiveRef.current = mapped;
      setPrivOpen(mapped.length > 0);
      setLiveWins(mapped);
      setEditableWins(deepClone(mapped));
      setIncogAllowed(allowed);
      setCookies(cookieList);
    } finally {
      setLoading(false);
    }
  }, [fetchLiveWins]);

  // Event-triggered refresh — merges live changes into editableWins while preserving
  // tabs the user manually removed. Logic per window:
  //   user-removed = was in prevLive but not in editable (user deleted it)
  //   new editable  = newLive tabs minus user-removed tabs
  const refreshLive = useCallback(async () => {
    const [mapped, cookieList] = await Promise.all([fetchLiveWins(), getPrivateCookies()]);
    const prevLive = prevLiveRef.current;
    prevLiveRef.current = mapped;
    setPrivOpen(mapped.length > 0);
    setLiveWins(mapped);
    setCookies(cookieList);
    setEditableWins(prevEditable => {
      const liveIds = new Set(mapped.map(w => w.id));
      return [
        // Existing windows: add new live tabs, drop closed tabs, keep user removals
        ...prevEditable
          .filter(w => liveIds.has(w.id))
          .map(editWin => {
            const newLiveWin = mapped.find(w => w.id === editWin.id);
            if (!newLiveWin) return editWin;
            const prevLiveWin = prevLive.find(w => w.id === editWin.id);
            const prevLiveTabIds = new Set(prevLiveWin?.tabs.map(t => t.id) ?? []);
            const editTabIds = new Set(editWin.tabs.map(t => t.id));
            // Tabs the user manually removed from the editable list
            const userRemovedIds = new Set([...prevLiveTabIds].filter(id => !editTabIds.has(id)));
            const newTabs = newLiveWin.tabs.filter(t => !userRemovedIds.has(t.id));
            return { ...editWin, tabs: newTabs };
          }),
        // Brand-new windows not previously tracked
        ...mapped.filter(w => !prevEditable.some(e => e.id === w.id)),
      ];
    });
  }, [fetchLiveWins]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  // The background writes _tabsChanged to storage.local on every tab/window event.
  // storage.onChanged fires in all extension contexts including private-window pages,
  // so this is the only reliable way to receive private window events here.
  // cookies.onChanged fires directly in extension pages for all cookie stores.
  useEffect(() => {
    let tabTimer: ReturnType<typeof setTimeout> | undefined;
    let cookieTimer: ReturnType<typeof setTimeout> | undefined;

    function onStorageChanged(changes: Record<string, browser.storage.StorageChange>, area: string) {
      if (area === "local" && "_tabsChanged" in changes) {
        clearTimeout(tabTimer);
        tabTimer = setTimeout(() => { void refreshLive(); }, 50);
      }
    }

    function onCookieChanged() {
      clearTimeout(cookieTimer);
      cookieTimer = setTimeout(async () => {
        try {
          const list = await getPrivateCookies();
          setCookies(list);
        } catch { /* non-fatal */ }
      }, 100);
    }

    browser.storage.onChanged.addListener(onStorageChanged);
    browser.cookies.onChanged.addListener(onCookieChanged);

    return () => {
      clearTimeout(tabTimer);
      clearTimeout(cookieTimer);
      browser.storage.onChanged.removeListener(onStorageChanged);
      browser.cookies.onChanged.removeListener(onCookieChanged);
    };
  }, [refreshLive]);

  useEffect(() => {
    browser.storage.local.get("cookieIncludeTabs").then(r => {
      setIncludeTabs((r as Record<string, boolean>).cookieIncludeTabs ?? true);
    }).catch(() => {});
  }, []);

  // ─── Export using editable state ─────────────────────────────────────────

  async function handleExport() {
    const cookies = await getPrivateCookies();
    const payload: Record<string, unknown> = { cookies };
    if (includeTabs) {
      payload.tabs = editableWins
        .flatMap(w => w.tabs.map(t => t.url))
        .filter((url): url is string => !!url);
    }
    await downloadFileSaveAs("private-cookies.json", JSON.stringify(payload, null, 2), "application/json");
  }

  // ─── Cookie management ────────────────────────────────────────────────────

  function handleClearAll() {
    showModal(
      "Clear all cookies",
      `<p>Delete all ${cookies.length} private window cookie${cookies.length !== 1 ? "s" : ""}? This cannot be undone.</p>`,
      [
        { label: "Cancel", cls: "btn-ghost", action: hideModal },
        {
          label: "Clear All", cls: "btn-danger", action: async () => {
            hideModal();
            const n = await clearPrivateCookies();
            toast(`Cleared ${n} cookie${n !== 1 ? "s" : ""}`);
            void fetchData();
          }
        },
      ]
    );
  }

  async function handleClearDomain(domain: string) {
    const n = await clearDomainCookies(domain);
    toast(`Cleared ${n} cookie${n !== 1 ? "s" : ""} for ${domain}`);
    void fetchData();
  }

  async function handleImport(file: File) {
    let data: Record<string, unknown>;
    try { data = JSON.parse(await file.text()); }
    catch { toast("Invalid JSON"); return; }

    const list = Array.isArray(data) ? data : ((data.cookies as BrowserCookie[]) || []);
    await clearPrivateCookies();

    let ok = 0, fail = 0;
    for (const raw of list) {
      const c = { ...raw, storeId: ANDROID_MODE ? undefined : PRIVATE_STORE } as BrowserCookie;
      delete (c as Record<string, unknown>).hostOnly;
      delete (c as Record<string, unknown>).session;
      if (c.sameSite === "unspecified") c.sameSite = "no_restriction";
      try {
        await browser.cookies.set({ url: cookieUrl(c), ...c });
        ok++;
      } catch { fail++; }
    }

    if (data.tabs && Array.isArray(data.tabs) && data.tabs.length > 0 && typeof browser.windows !== "undefined") {
      try {
        const allWindows = await browser.windows.getAll();
        const existing = allWindows.find(w => w.incognito);
        const windowId = existing
          ? existing.id!
          : (await browser.windows.create({ incognito: true })).id!;
        for (const url of data.tabs as string[]) {
          await browser.tabs.create({ windowId, url });
        }
      } catch (e) {
        console.warn("[tabkeeper] Could not restore private tabs", e);
      }
    }

    toast(`Restored ${ok} cookie${ok !== 1 ? "s" : ""}${fail ? `, ${fail} failed` : ""}`);
    void fetchData();
  }

  // ─── Editable windows handlers ────────────────────────────────────────────

  function removeTab(wi: number, ti: number) {
    setEditableWins(prev => {
      const next = prev.map((w, i) => i !== wi ? w : {
        ...w,
        tabs: w.tabs.filter((_, j) => j !== ti).map((t, j) => ({ ...t, index: j })),
      });
      return next.filter(w => w.tabs.length > 0);
    });
  }

  function removeWindow(wi: number) {
    setEditableWins(prev => prev.filter((_, i) => i !== wi));
  }

  function resetEditable() {
    setEditableWins(deepClone(liveWins));
  }

  async function saveWindow(wi: number) {
    const win = editableWins[wi];
    if (!win) return;
    const name = `Private Window — ${new Date().toLocaleString()}`;
    const session = {
      id: genId(),
      name,
      date: Date.now(),
      windowCount: 1,
      tabCount: win.tabs.length,
      windows: [deepClone(win)],
    };
    await send({ type: "importSessions", sessions: [session] });
    toast("Saved as collection");
  }

  // ─── Cookies domain grouping ──────────────────────────────────────────────

  const byDomain: Record<string, BrowserCookie[]> = {};
  for (const c of cookies) {
    const d = c.domain.replace(/^\./, "");
    (byDomain[d] = byDomain[d] || []).push(c);
  }
  const domains = Object.keys(byDomain).sort();
  const filteredDomains = filterQuery
    ? domains.filter(d => d.toLowerCase().includes(filterQuery.toLowerCase()))
    : domains;

  const sub = `${cookies.length} cookie${cookies.length !== 1 ? "s" : ""} · ${domains.length} domain${domains.length !== 1 ? "s" : ""}`;

  return (
    <>
      <div className="content-header">
        <div className="content-header-info">
          <div className="content-header-title">Private Window</div>
          <div className="content-header-sub">{loading ? "" : sub}</div>
        </div>
        <div className="content-header-buttons" />
      </div>

      <input
        type="file"
        ref={fileRef}
        accept=".json,application/json"
        style={{ display: "none" }}
        onChange={e => { const f = e.target.files?.[0]; if (f) void handleImport(f); e.target.value = ""; }}
      />

      <div className="content-area">
        {loading ? (
          <div className="empty-state"><p>Loading…</p></div>
        ) : !incogAllowed ? (
          <div className="cookie-warning">
            <strong>Private window access disabled</strong>
            Go to Firefox → Add-ons → TabKeeper → Allow in private windows to use this feature.
          </div>
        ) : (
          <>
            <div className="cookie-actions">
              <button
                className="btn btn-primary"
                disabled={!privOpen || cookies.length === 0}
                onClick={() => void handleExport()}
              >
                Export JSON
              </button>
              <button
                className="btn btn-ghost"
                disabled={!privOpen}
                onClick={() => fileRef.current?.click()}
              >
                Import JSON
              </button>
              <button
                className="btn btn-danger"
                disabled={!privOpen || cookies.length === 0}
                onClick={handleClearAll}
              >
                Clear Cookies
              </button>
              <label className="cookie-tabs-label">
                <input
                  type="checkbox"
                  checked={includeTabs}
                  onChange={e => {
                    setIncludeTabs(e.target.checked);
                    void browser.storage.local.set({ cookieIncludeTabs: e.target.checked });
                  }}
                />
                {" "}Include tabs
              </label>
            </div>

            {!privOpen ? (
              <div className="cookie-info">
                No private window is currently open. Open one to capture cookies.
              </div>
            ) : (
              <PrivateWindowsEditor
                wins={editableWins}
                onRemoveTab={removeTab}
                onRemoveWindow={removeWindow}
                onSaveWindow={wi => void saveWindow(wi)}
                onReset={resetEditable}
              />
            )}

            {cookies.length === 0 ? (
              <div className="empty-state"><p>No cookies in private windows</p></div>
            ) : (
              <>
                <div className="cookie-section-header" style={{ marginTop: 20 }}>
                  <div className="cookie-section-title">Cookies</div>
                  <div className="cookie-domain-filter">
                    <input
                      type="text"
                      placeholder="Filter by domain…"
                      value={filterQuery}
                      onChange={e => setFilterQuery(e.target.value)}
                    />
                    <button
                      className="btn btn-ghost"
                      onClick={() => { if (filterQuery) void handleClearDomain(filterQuery); }}
                    >
                      Clear domain
                    </button>
                  </div>
                </div>

                <div className="cookie-list">
                  {filteredDomains.map(domain => {
                    const domCookies = byDomain[domain];
                    const isExpanded = expandedDomains.has(domain);
                    return (
                      <div key={domain} className="cookie-domain-group" data-domain={domain}>
                        <div
                          className="cookie-domain-header"
                          onClick={() => setExpandedDomains(prev => {
                            const next = new Set(prev);
                            if (next.has(domain)) next.delete(domain);
                            else next.add(domain);
                            return next;
                          })}
                        >
                          <span className="cookie-domain-name">{domain}</span>
                          <span className="cookie-domain-count">
                            {domCookies.length} cookie{domCookies.length !== 1 ? "s" : ""}
                          </span>
                          <button
                            className="cookie-domain-del"
                            onClick={e => { e.stopPropagation(); void handleClearDomain(domain); }}
                          >
                            Clear
                          </button>
                        </div>
                        {isExpanded && (
                          <div className="cookie-domain-body">
                            {domCookies.map((c, i) => (
                              <div
                                key={i}
                                className="cookie-item"
                                title={`${c.name}${c.httpOnly ? " · httpOnly" : ""}${c.secure ? " · secure" : ""}`}
                              >
                                {c.name || "(unnamed)"}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}
