import { useState, useEffect, useRef, useCallback } from "react";
import { useApp } from "../../context/AppContext";
import { send } from "../../utils/messaging";
import { tabCountLabel, esc } from "../../utils/helpers";
import { smartImportText } from "../../utils/import";
import { WindowBlock } from "./WindowBlock";
import type { Window as SessionWindow, Session, TabRenderEntry } from "../../context/types";

interface CurrentState {
  windows: SessionWindow[];
  tabCount: number;
  windowCount: number;
}

interface Props {
  onLoadSessions: () => Promise<void>;
  refreshKey?: number;
}

function Dropdown({
  label,
  cls,
  items,
}: {
  label: string;
  cls: string;
  items: { label: string; action: () => void }[];
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    const menu = menuRef.current;
    if (!menu) return;
    document.querySelectorAll(".dropdown-menu.open").forEach(m => m !== menu && m.classList.remove("open","align-left","flip-up"));
    const wasOpen = menu.classList.contains("open");
    menu.classList.remove("open","align-left","flip-up");
    if (!wasOpen) {
      menu.classList.add("open");
      const rect = menu.getBoundingClientRect();
      if (rect.left < 0) menu.classList.add("align-left");
      if (rect.bottom > window.innerHeight) menu.classList.add("flip-up");
    }
  }

  return (
    <div className="btn-dropdown">
      <button className={`btn ${cls}`} onClick={toggle}>{label}</button>
      <div className="dropdown-menu" ref={menuRef}>
        {items.map((item, i) => (
          <div
            key={i}
            className="dropdown-item"
            onClick={() => { menuRef.current?.classList.remove("open"); item.action(); }}
          >
            {item.label}
          </div>
        ))}
      </div>
    </div>
  );
}

export function CurrentView({ onLoadSessions, refreshKey }: Props) {
  const { state, dispatch, showModal, hideModal, toast } = useApp();
  const [data, setData] = useState<CurrentState | null>(null);
  const [loading, setLoading] = useState(true);
  const [treeEnabled, setTreeEnabled] = useState(false);

  useEffect(() => {
    void send({ type: "getConfig" }).then((cfg: { ifSupportTst?: boolean }) => {
      setTreeEnabled(cfg?.ifSupportTst === true);
    });
  }, []);

  // Initial load — shows the spinner once.
  const fetchState = useCallback(async () => {
    setLoading(true);
    try {
      const cur = await send({ type: "getCurrentState" }) as CurrentState;
      setData(cur);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Silent refresh — no spinner, no flicker; used for background-pushed updates.
  const fetchStateSilent = useCallback(async () => {
    try {
      const cur = await send({ type: "getCurrentState" }) as CurrentState;
      setData(cur);
    } catch { /* non-fatal */ }
  }, []);

  // Initial load only (fetchState is stable, so this runs once on mount).
  useEffect(() => { void fetchState(); }, [fetchState]);

  // Re-fetch silently when the caller signals a change (e.g. after closing browser tabs).
  useEffect(() => { if (refreshKey) void fetchStateSilent(); }, [fetchStateSilent, refreshKey]);

  // The background writes a ping to storage.local on every tab event.
  // storage.onChanged fires in ALL extension contexts including private windows,
  // so this works regardless of incognito state.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    function onStorageChanged(changes: Record<string, browser.storage.StorageChange>, area: string) {
      if (area === "local" && "_tabsChanged" in changes) {
        clearTimeout(timer);
        timer = setTimeout(() => { void fetchStateSilent(); }, 50);
      }
    }

    browser.storage.onChanged.addListener(onStorageChanged);
    return () => {
      clearTimeout(timer);
      browser.storage.onChanged.removeListener(onStorageChanged);
    };
  }, [fetchStateSilent]);

  useEffect(() => {
    const order: TabRenderEntry[] = [];
    (data?.windows ?? []).forEach((win, wi) => {
      [...win.tabs].sort((a, b) => a.index - b.index).forEach((tab, ti) => {
        order.push({ key: `${wi}:${ti}`, tab });
      });
    });
    dispatch({ type: "SET_TAB_RENDER_ORDER", order });
  }, [data, dispatch]);

  useEffect(() => {
    function close(e: MouseEvent) {
      if (!(e.target as HTMLElement).closest(".btn-dropdown")) {
        document.querySelectorAll(".dropdown-menu.open").forEach(m => m.classList.remove("open"));
      }
    }
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  function showSaveModal(scope: "all" | "current") {
    const defaultName = new Date().toLocaleString();
    showModal(
      scope === "current" ? "Save current window" : "Save all windows",
      `<input type="text" id="save-name-input" value="${esc(defaultName)}" placeholder="Session name" />`,
      [
        { label: "Cancel", cls: "btn-ghost", action: hideModal },
        {
          label: "Save", cls: "btn-primary", action: async () => {
            const input = document.getElementById("save-name-input") as HTMLInputElement;
            const name = input.value.trim() || defaultName;
            hideModal();
            try {
              await send({ type: "saveSession", name, scope });
              toast("Session saved");
              await onLoadSessions();
            } catch { toast("Failed to save session"); }
          }
        },
      ]
    );
  }

  function handleImportJson() {
    const el = document.getElementById("import-json-input") as HTMLInputElement;
    el?.click();
  }

  function handleImportText() {
    const el = document.getElementById("import-text-input") as HTMLInputElement;
    el?.click();
  }

  function handlePasteImport() {
    showModal(
      "Import from text",
      `<textarea id="paste-import-input" rows="8" placeholder="Paste URLs, JSON, or text export…"></textarea>`,
      [
        { label: "Cancel", cls: "btn-ghost", action: hideModal },
        {
          label: "Import", cls: "btn-primary", action: async () => {
            const ta = document.getElementById("paste-import-input") as HTMLTextAreaElement;
            const sessions = smartImportText(ta.value);
            if (!sessions.length) { toast("No valid data found"); return; }
            hideModal();
            if (sessions.length === 1) {
              const defaultName = (sessions[0] as Session).name || new Date().toLocaleString();
              showModal(
                "Name this collection",
                `<input type="text" id="import-name-input" value="${esc(defaultName)}" placeholder="Collection name" />`,
                [
                  { label: "Cancel", cls: "btn-ghost", action: hideModal },
                  {
                    label: "Import", cls: "btn-primary", action: async () => {
                      const name = (document.getElementById("import-name-input") as HTMLInputElement).value.trim() || defaultName;
                      (sessions[0] as Session).name = name;
                      hideModal();
                      await send({ type: "importSessions", sessions });
                      toast("Imported 1 collection");
                      await onLoadSessions();
                    }
                  },
                ]
              );
            } else {
              const result = await send({ type: "importSessions", sessions }) as { count: number };
              toast(`Imported ${result.count} collections`);
              await onLoadSessions();
            }
          }
        },
      ]
    );
  }

  const total = data?.windows.reduce((s, w) => s + w.tabs.length, 0) ?? 0;
  const winCount = data?.windows.length ?? 0;
  const sub = data
    ? `${tabCountLabel(total)} · ${winCount === 1 ? "1 window" : winCount + " windows"}`
    : "";

  const query = state.searchQuery.toLowerCase();

  return (
    <>
      <div className="content-header">
        <div className="content-header-info">
          <div className="content-header-title">This browser</div>
          <div className="content-header-sub">{sub}</div>
        </div>
        <div className="content-header-buttons">
          <Dropdown
            label="Save"
            cls="btn-primary"
            items={[
              { label: "Save all windows", action: () => showSaveModal("all") },
              { label: "Save current window", action: () => showSaveModal("current") },
            ]}
          />
          <Dropdown
            label="Import"
            cls="btn-ghost"
            items={[
              { label: "Import from JSON", action: handleImportJson },
              { label: "Import from text", action: handleImportText },
              { label: "Paste to import", action: handlePasteImport },
            ]}
          />
        </div>
      </div>

      <div className="content-area">
        {loading ? (
          <div className="empty-state"><p>Loading…</p></div>
        ) : !data ? (
          <div className="empty-state"><p>Could not load browser state</p></div>
        ) : (
          data.windows.map((win, i) => (
            <WindowBlock
              key={i}
              win={win}
              winIdx={i}
              winKey={`w${i}`}
              totalWindows={data.windows.length}
              query={query}
              selectable={true}
              isLiveTab={true}
              treeEnabled={treeEnabled}
              onCloseWindow={win.id != null ? async () => { await fetchState(); } : undefined}
            />
          ))
        )}
      </div>
    </>
  );
}
