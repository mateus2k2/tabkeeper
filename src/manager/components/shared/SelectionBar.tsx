import { useApp } from "../../context/AppContext";
import { send } from "../../utils/messaging";
import { deepClone, genId, esc } from "../../utils/helpers";
import type { Session, Tab, Window as SessionWindow } from "../../context/types";

interface Props {
  onLoadSessions: () => Promise<void>;
  onRefreshCurrent?: () => void;
}

export function SelectionBar({ onLoadSessions, onRefreshCurrent }: Props) {
  const { state, dispatch, toast, pushUndo, showModal, hideModal } = useApp();
  const { selectedTabKeys, view, sessions } = state;

  const isSessionView = !["current", "history", "cookies", "closed"].includes(view);
  const count = selectedTabKeys.size;
  if (count === 0) return null;

  const session = sessions.find(s => s.id === view);

  function clearSelection() {
    dispatch({ type: "SET_SELECTED_TABS", keys: new Set() });
  }

  // Collect the actual tab objects in render order from selectedTabKeys
  function collectSelectedTabs(s: Session): Tab[] {
    const result: Tab[] = [];
    s.windows.forEach((win, wi) => {
      [...win.tabs].sort((a, b) => a.index - b.index).forEach((tab, ti) => {
        if (selectedTabKeys.has(`${wi}:${ti}`)) result.push(tab);
      });
    });
    return result;
  }

  async function removeSelected() {
    if (!session) return;
    pushUndo({ type: "session", sessionId: session.id, session: deepClone(session) });

    const toRemove = new Set(selectedTabKeys);
    const newWindows = session.windows.map((win, wi) => {
      const sorted = [...win.tabs].sort((a, b) => a.index - b.index);
      const kept = sorted.filter((_, ti) => !toRemove.has(`${wi}:${ti}`));
      kept.forEach((t, i) => { t.index = i; });
      return { ...win, tabs: kept };
    }).filter(w => w.tabs.length > 0);

    if (newWindows.length === 0) {
      await send({ type: "deleteSession", id: session.id });
      toast("Session deleted");
      await onLoadSessions();
      dispatch({ type: "SET_VIEW", view: "current" });
      return;
    }

    const updated: Session = {
      ...session,
      windows: newWindows,
      tabCount: newWindows.reduce((s, w) => s + w.tabs.length, 0),
      windowCount: newWindows.length,
    };
    await send({ type: "updateSession", session: updated });
    dispatch({ type: "SET_SESSIONS", sessions: sessions.map(s => s.id === updated.id ? updated : s) });
    clearSelection();
    toast("Removed from collection");
  }

  async function copyUrls() {
    if (!session) return;
    const urls: string[] = [];
    session.windows.forEach((win, wi) => {
      [...win.tabs].sort((a, b) => a.index - b.index).forEach((tab, ti) => {
        if (selectedTabKeys.has(`${wi}:${ti}`)) urls.push(tab.url);
      });
    });
    await navigator.clipboard.writeText(urls.join("\n"));
    toast("URLs copied");
    clearSelection();
  }

  function extractToNewWindow() {
    if (!session) return;

    // Deep-clone first so tabSet refs match the objects we'll filter from s.windows
    const s: Session = { ...session, windows: deepClone(session.windows) };
    pushUndo({ type: "session", sessionId: s.id, session: deepClone(session) });

    const tabsToMove = collectSelectedTabs(s);
    if (!tabsToMove.length) return;

    const tabSet = new Set(tabsToMove);
    // Remove selected tabs from their current windows
    s.windows = s.windows.map(win => ({
      ...win,
      tabs: win.tabs.filter(t => !tabSet.has(t)),
    }));
    s.windows.forEach(win => {
      win.tabs.sort((a, b) => a.index - b.index).forEach((t, i) => { t.index = i; });
    });
    s.windows = s.windows.filter(w => w.tabs.length > 0);

    // Add new window with those tabs (strip group info since they come from different contexts)
    const newTabs = tabsToMove.map((t, i) => ({
      ...t, index: i, groupId: -1, groupColor: undefined, groupTitle: undefined,
    }));
    s.windows.push({ tabs: newTabs });
    s.tabCount = s.windows.reduce((n, w) => n + w.tabs.length, 0);
    s.windowCount = s.windows.length;

    send({ type: "updateSession", session: s })
      .then(() => { toast("Extracted to new window"); return onLoadSessions(); })
      .catch(() => toast("Failed to save"));
    clearSelection();
  }

  function extractToNewCollection() {
    if (!session) return;
    const defaultName = `${session.name} — Selection`;
    showModal(
      "Extract to new collection",
      `<input type="text" id="extract-col-name" value="${esc(defaultName)}" placeholder="New collection name" />`,
      [
        { label: "Cancel", cls: "btn-ghost", action: hideModal },
        {
          label: "Extract", cls: "btn-primary", action: async () => {
            const name = (document.getElementById("extract-col-name") as HTMLInputElement).value.trim() || defaultName;
            hideModal();

            // Deep-clone first so tabSet refs match the objects we'll filter from s.windows
            const originalSrc = deepClone(session);
            const s: Session = { ...session, windows: deepClone(session.windows) };

            const tabsToMove = collectSelectedTabs(s);
            const tabSet = new Set(tabsToMove);
            s.windows = s.windows.map(win => ({
              ...win,
              tabs: win.tabs.filter(t => !tabSet.has(t)),
            }));
            s.windows.forEach(win => {
              win.tabs.sort((a, b) => a.index - b.index).forEach((t, i) => { t.index = i; });
            });
            s.windows = s.windows.filter(w => w.tabs.length > 0);
            s.tabCount = s.windows.reduce((n, w) => n + w.tabs.length, 0);
            s.windowCount = s.windows.length;

            const newTabs = tabsToMove.map((t, i) => ({
              ...t, index: i, groupId: -1, groupColor: undefined, groupTitle: undefined,
            }));
            const newSession: Session = {
              id: genId(), name, date: Date.now(),
              windowCount: 1, tabCount: newTabs.length,
              windows: [{ tabs: newTabs }],
            };

            pushUndo({
              type: "extract-to-collection",
              originalSrc,
              modifiedSrc: deepClone(s),
              newSession: deepClone(newSession),
            });

            await Promise.all([
              send({ type: "importSessions", sessions: [newSession] }),
              s.windows.length > 0
                ? send({ type: "updateSession", session: s })
                : send({ type: "deleteSession", id: session.id }),
            ]);

            toast("Extracted to new collection");
            await onLoadSessions();
            if (s.windows.length === 0) dispatch({ type: "SET_VIEW", view: "current" });
            clearSelection();
          }
        },
      ]
    );
  }

  async function closeInBrowser() {
    const tabIds = state.tabRenderOrder
      .filter(r => selectedTabKeys.has(r.key) && r.tab.id != null)
      .map(r => r.tab.id!);
    if (!tabIds.length) { toast("No live tabs to close"); return; }
    await browser.tabs.remove(tabIds);
    clearSelection();
    toast(`Closed ${tabIds.length} tab${tabIds.length !== 1 ? "s" : ""} in browser`);
    onRefreshCurrent?.();
  }

  async function saveSelectionAsCollection() {
    // Group selected tabs by window index, preserving multi-window structure
    const winTabMap = new Map<number, Tab[]>();
    for (const { key, tab } of state.tabRenderOrder) {
      if (!selectedTabKeys.has(key)) continue;
      const wi = parseInt(key.split(":")[0]);
      if (!winTabMap.has(wi)) winTabMap.set(wi, []);
      winTabMap.get(wi)!.push(tab);
    }
    if (!winTabMap.size) { toast("Nothing to save"); return; }

    const defaultName = new Date().toLocaleString();
    showModal(
      "Save selection as collection",
      `<input type="text" id="save-live-name" value="${esc(defaultName)}" placeholder="Collection name" />`,
      [
        { label: "Cancel", cls: "btn-ghost", action: hideModal },
        {
          label: "Save", cls: "btn-primary", action: async () => {
            const name = (document.getElementById("save-live-name") as HTMLInputElement).value.trim() || defaultName;
            hideModal();
            const windows: SessionWindow[] = [...winTabMap.values()].map(tabs => ({
              tabs: tabs.map((t, i) => ({ ...t, index: i })),
            }));
            const newSession: Session = {
              id: genId(), name, date: Date.now(),
              windowCount: windows.length,
              tabCount: windows.reduce((n, w) => n + w.tabs.length, 0),
              windows,
            };
            await send({ type: "importSessions", sessions: [newSession] });
            toast("Saved as collection");
            await onLoadSessions();
            clearSelection();
          }
        },
      ]
    );
  }

  return (
    <div className="selection-bar">
      <span className="sel-count">{count} tab{count !== 1 ? "s" : ""} selected</span>
      {isSessionView && session && (
        <>
          <button className="sel-btn sel-remove" onClick={() => void removeSelected()}>
            Remove
          </button>
          <button className="sel-btn" onClick={extractToNewWindow}>
            Extract to new window
          </button>
          <button className="sel-btn" onClick={extractToNewCollection}>
            Extract to new collection
          </button>
        </>
      )}
      {view === "current" && (
        <>
          <button className="sel-btn" onClick={() => void saveSelectionAsCollection()}>
            Save as collection
          </button>
          <button className="sel-btn sel-remove" onClick={() => void closeInBrowser()}>
            Close in browser
          </button>
        </>
      )}
      <button className="sel-btn" onClick={() => void copyUrls()}>Copy URLs</button>
      <button className="sel-btn sel-clear" onClick={clearSelection}>Clear</button>
    </div>
  );
}
