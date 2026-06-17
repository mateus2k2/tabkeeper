import {
  DndContext, DragEndEvent, PointerSensor, TouchSensor,
  useSensor, useSensors, closestCenter,
} from "@dnd-kit/core";
import {
  SortableContext, verticalListSortingStrategy,
  useSortable, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useApp } from "../../context/AppContext";
import { send } from "../../utils/messaging";
import { tabCountLabel, deepClone, esc } from "../../utils/helpers";
import type { Session } from "../../context/types";

interface SidebarCounts {
  tabs: number | null;
  history: number | null;
  closed: number | null;
}

interface Props {
  onLoadSessions: () => Promise<void>;
  counts: SidebarCounts;
}

// ─── Sortable session item ───────────────────────────────────────────────────

function SortableSessionItem({
  session, isSelected, isCurrentView, query, onClick,
}: {
  session: Session; isSelected: boolean; isCurrentView: boolean; query: string;
  onClick: (e: React.MouseEvent) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: session.id,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const total = session.tabCount ?? session.windows.reduce((s, w) => s + w.tabs.length, 0);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`session-nav-item${isCurrentView ? " active" : ""}${isSelected ? " sel" : ""}${isDragging ? " dragging" : ""}`}
      data-session-id={session.id}
      onClick={onClick}
      {...attributes}
    >
      <div
        ref={setActivatorNodeRef}
        className="session-drag-handle"
        title="Drag to reorder"
        {...listeners}
      >
        <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12">
          <circle cx="5" cy="4" r="1.2"/>
          <circle cx="11" cy="4" r="1.2"/>
          <circle cx="5" cy="8" r="1.2"/>
          <circle cx="11" cy="8" r="1.2"/>
          <circle cx="5" cy="12" r="1.2"/>
          <circle cx="11" cy="12" r="1.2"/>
        </svg>
      </div>
      <svg viewBox="0 0 16 16" fill="none">
        <rect x="1" y="2" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.2"/>
        <line x1="1" y1="6" x2="15" y2="6" stroke="currentColor" strokeWidth="1.2"/>
      </svg>
      <div className="session-nav-text">
        <div className="session-nav-name" title={session.name}>{session.name}</div>
        <div className="session-nav-meta">{tabCountLabel(total)}</div>
      </div>
    </div>
  );
}

// ─── Main Sidebar ────────────────────────────────────────────────────────────

export function Sidebar({ onLoadSessions, counts }: Props) {
  const { state, dispatch, toast, pushUndo, showModal, hideModal } = useApp();
  const { view, sessions, selectedSessionIds } = state;


  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 15 } })
  );

  function setView(v: string) {
    dispatch({ type: "SET_VIEW", view: v });
  }

  function sidebarItemClass(id: string) {
    return `sidebar-item${view === id ? " active" : ""}`;
  }

  // ─── Session selection ──────────────────────────────────────────────────────

  function handleSessionClick(e: React.MouseEvent, session: Session, filteredIds: string[]) {
    if (e.shiftKey && state.lastSessionId) {
      // Range-select within the visible (filtered) list
      const a = filteredIds.indexOf(state.lastSessionId);
      const b = filteredIds.indexOf(session.id);
      if (a === -1 || b === -1) return;
      const [from, to] = a < b ? [a, b] : [b, a];
      const newIds = new Set(selectedSessionIds);
      for (let i = from; i <= to; i++) newIds.add(filteredIds[i]!);
      dispatch({ type: "SET_SELECTED_SESSIONS", ids: newIds });
      dispatch({ type: "SET_LAST_SESSION_ID", id: session.id });
    } else if (e.ctrlKey || e.metaKey) {
      const newIds = new Set(selectedSessionIds);
      // If starting a fresh multi-select from a normal navigation, anchor the current item too
      if (newIds.size === 0 && state.lastSessionId && state.lastSessionId !== session.id) {
        newIds.add(state.lastSessionId);
      }
      if (newIds.has(session.id)) newIds.delete(session.id);
      else newIds.add(session.id);
      dispatch({ type: "SET_SELECTED_SESSIONS", ids: newIds });
      dispatch({ type: "SET_LAST_SESSION_ID", id: session.id });
    } else {
      dispatch({ type: "SET_SELECTED_SESSIONS", ids: new Set() });
      dispatch({ type: "SET_LAST_SESSION_ID", id: session.id });
      setView(session.id);
    }
  }

  // ─── Bulk delete ─────────────────────────────────────────────────────────

  async function deleteBulk() {
    const ids = [...selectedSessionIds];
    const toDelete = sessions.filter(s => ids.includes(s.id));
    pushUndo({ type: "delete", sessions: toDelete.map(s => deepClone(s)), oldOrder: sessions.map(s => s.id) });
    for (const id of ids) await send({ type: "deleteSession", id });
    toast(`Deleted ${ids.length} collection${ids.length !== 1 ? "s" : ""}`, undefined);
    dispatch({ type: "SET_SELECTED_SESSIONS", ids: new Set() });
    if (ids.includes(view)) dispatch({ type: "SET_VIEW", view: "current" });
    await onLoadSessions();
  }

  // ─── Merge selected collections ───────────────────────────────────────────

  function showMergeModal() {
    const ids = [...selectedSessionIds];
    const toMerge = sessions.filter(s => ids.includes(s.id));
    if (toMerge.length < 2) return;

    // Let the user pick which collection becomes the target (others fold into it)
    const options = toMerge.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join("");
    showModal(
      `Merge ${toMerge.length} collections`,
      `<p>All selected collections will be merged into:</p>
       <select id="merge-target-select" style="width:100%;margin-top:8px;padding:6px 8px;background:var(--bg-input,#1e1e1e);color:var(--text-pri);border:1px solid var(--border);border-radius:6px;font-size:13px;">
         ${options}
       </select>`,
      [
        { label: "Cancel", cls: "btn-ghost", action: hideModal },
        {
          label: "Merge", cls: "btn-primary", action: async () => {
            const targetId = (document.getElementById("merge-target-select") as HTMLSelectElement).value;
            const target = sessions.find(s => s.id === targetId);
            if (!target) return;
            hideModal();

            const sources = toMerge.filter(s => s.id !== targetId);

            const extraWins = sources.flatMap(src =>
              deepClone(src.windows).map(win => ({
                ...win,
                tabs: [...win.tabs].sort((a, b) => a.index - b.index).map((t, i) => ({
                  ...t, index: i, groupId: -1, groupColor: undefined, groupTitle: undefined,
                })),
              }))
            );
            const merged = {
              ...target,
              windows: [...target.windows, ...extraWins],
              tabCount: target.tabCount + sources.reduce((n, s) => n + s.tabCount, 0),
              windowCount: target.windowCount + sources.reduce((n, s) => n + s.windowCount, 0),
            };

            pushUndo({
              type: "collection-merge",
              originalTarget: deepClone(target),
              mergedTarget: merged,
              originalSources: sources.map(s => deepClone(s)),
              oldOrder: sessions.map(s => s.id),
            });

            await Promise.all([
              send({ type: "updateSession", session: merged }),
              ...sources.map(s => send({ type: "deleteSession", id: s.id })),
            ]);

            toast(`Merged into "${target.name}"`);
            dispatch({ type: "SET_SELECTED_SESSIONS", ids: new Set() });
            if (sources.some(s => s.id === view)) dispatch({ type: "SET_VIEW", view: target.id });
            await onLoadSessions();
          }
        },
      ]
    );
  }

  // ─── Drag and drop (reorder) ──────────────────────────────────────────────

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const oldIndex = sessions.findIndex(s => s.id === active.id);
    const newIndex = sessions.findIndex(s => s.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(sessions, oldIndex, newIndex);
    pushUndo({ type: "reorder", oldOrder: sessions.map(s => s.id) });
    dispatch({ type: "SET_SESSIONS", sessions: reordered });
    send({ type: "reorderSessions", order: reordered.map(s => s.id) }).catch(() => toast("Failed to save order"));
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  const query = state.searchQuery.toLowerCase();
  const filtered = query
    ? sessions.filter(s =>
        s.name.toLowerCase().includes(query) ||
        s.windows.some(w => w.tabs.some(t =>
          t.title?.toLowerCase().includes(query) || t.url?.toLowerCase().includes(query)
        ))
      )
    : sessions;
  const filteredIds = filtered.map(s => s.id);

  return (
    <aside className="sidebar">
      <section className="sidebar-section">
        <div className="sidebar-label">TABS</div>

        <div className={sidebarItemClass("history")} onClick={() => setView("history")}>
          <svg className="sidebar-item-icon" viewBox="0 0 24 24" fill="none">
            <path d="M12 7V12L14.5 10.5M21 12C21 16.97 16.97 21 12 21C7.03 21 3 16.97 3 12C3 7.03 7.03 3 12 3C16.97 3 21 7.03 21 12Z" stroke="#9a9a9a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <div className="sidebar-item-text">
            <div className="sidebar-item-title">History</div>
            <div className="sidebar-item-sub" id="history-sidebar-sub">
              {counts.history === null ? "— entries" : `${counts.history} entr${counts.history !== 1 ? "ies" : "y"}`}
            </div>
          </div>
        </div>

        <div className={sidebarItemClass("closed")} onClick={() => setView("closed")}>
          <svg className="sidebar-item-icon" viewBox="0 0 24 24" fill="none">
            <path d="M12 7V12L14.5 10.5M21 12C21 16.97 16.97 21 12 21C7.03 21 3 16.97 3 12C3 7.03 7.03 3 12 3C16.97 3 21 7.03 21 12Z" stroke="#9a9a9a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <div className="sidebar-item-text">
            <div className="sidebar-item-title">Recently closed</div>
            <div className="sidebar-item-sub" id="closed-sidebar-sub">
              {counts.closed === null ? "— items" : `${counts.closed} item${counts.closed !== 1 ? "s" : ""}`}
            </div>
          </div>
        </div>

        <div className={sidebarItemClass("current")} onClick={() => setView("current")}>
          <svg className="sidebar-item-icon" viewBox="0 0 20 20" fill="none">
            <circle cx="10" cy="10" r="8" stroke="#e8a020" strokeWidth="1.8"/>
            <line x1="10" y1="2" x2="10" y2="18" stroke="#e8a020" strokeWidth="1.4"/>
            <path d="M2 10 Q6 6 10 10 Q14 14 18 10" stroke="#e8a020" strokeWidth="1.4" fill="none"/>
          </svg>
          <div className="sidebar-item-text">
            <div className="sidebar-item-title">This browser</div>
            <div className="sidebar-item-sub" id="current-tab-count">
              {counts.tabs === null ? "— tabs" : `${counts.tabs} tab${counts.tabs !== 1 ? "s" : ""}`}
            </div>
          </div>
        </div>
      </section>

      <section className="sidebar-section">
        <div className="sidebar-label">COOKIES</div>
        <div className={sidebarItemClass("cookies")} onClick={() => setView("cookies")}>
          <svg className="sidebar-item-icon" viewBox="0 0 20 20" fill="none">
            <circle cx="10" cy="10" r="8" stroke="#9a6dd7" strokeWidth="1.8"/>
            <circle cx="7"  cy="8"  r="1.2" fill="#9a6dd7"/>
            <circle cx="13" cy="8"  r="1.2" fill="#9a6dd7"/>
            <circle cx="10" cy="13" r="1.2" fill="#9a6dd7"/>
            <circle cx="7"  cy="13" r="0.8" fill="#9a6dd7"/>
            <circle cx="13" cy="13" r="0.8" fill="#9a6dd7"/>
          </svg>
          <div className="sidebar-item-text">
            <div className="sidebar-item-title">Private window</div>
            <div className="sidebar-item-sub" id="cookie-sidebar-sub">cookies</div>
          </div>
        </div>
      </section>

      <section className="sidebar-section">
        <div className="sidebar-label">COLLECTIONS</div>
        <div id="sessions-list" className="sessions-nav">
          {filtered.length === 0 && (
            <div className="no-collections">
              <svg viewBox="0 0 40 40" fill="none">
                <rect x="6" y="8" width="28" height="24" rx="3" stroke="#555" strokeWidth="1.5"/>
                <line x1="13" y1="14" x2="27" y2="14" stroke="#555" strokeWidth="1.5"/>
                <line x1="13" y1="20" x2="22" y2="20" stroke="#555" strokeWidth="1.5"/>
              </svg>
              <div className="no-collections-title">No collections</div>
              <div className="no-collections-sub">Save tabs to create a collection</div>
            </div>
          )}

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[({ transform }) => ({ ...transform, x: 0 })]}
            onDragEnd={onDragEnd}
          >
            <SortableContext items={filteredIds} strategy={verticalListSortingStrategy}>
              {filtered.map(session => (
                <SortableSessionItem
                  key={session.id}
                  session={session}
                  isSelected={selectedSessionIds.has(session.id)}
                  isCurrentView={view === session.id}
                  query={query}
                  onClick={e => handleSessionClick(e, session, filteredIds)}
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>

        {selectedSessionIds.size > 0 && (
          <div className="sidebar-sel-bar">
            <span className="sidebar-sel-count">{selectedSessionIds.size} selected</span>
            {selectedSessionIds.size >= 2 && (
              <button className="sidebar-sel-btn" onClick={showMergeModal}>Merge</button>
            )}
            <button className="sidebar-sel-del" onClick={() => void deleteBulk()}>Delete</button>
          </div>
        )}
      </section>
    </aside>
  );
}
