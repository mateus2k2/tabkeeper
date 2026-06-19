import { useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/react";
import { CollisionPriority } from "@dnd-kit/abstract";
import { useApp } from "../../context/AppContext";
import { grpHex, hexToRgba, tabCountLabel, deepClone, esc } from "../../utils/helpers";
import { windowLabel } from "../../utils/render";
import { send } from "../../utils/messaging";
import { SortableTab } from "../dnd/SortableTab";
import { TabRow } from "./TabRow";
import { useDragState } from "../dnd/SessionDnD";
import type { Window as SessionWindow, Session, Tab } from "../../context/types";

function buildDepthMap(tabs: Tab[]): Map<number, number> {
  const idToTab = new Map<number, Tab>();
  for (const tab of tabs) {
    if (tab.id != null) idToTab.set(tab.id, tab);
  }
  const cache = new Map<number, number>();
  function getDepth(tabId: number, visiting: Set<number>): number {
    if (cache.has(tabId)) return cache.get(tabId)!;
    if (visiting.has(tabId)) return 0;
    visiting.add(tabId);
    const tab = idToTab.get(tabId);
    if (!tab || tab.openerTabId == null || !idToTab.has(tab.openerTabId)) {
      cache.set(tabId, 0);
      return 0;
    }
    const d = getDepth(tab.openerTabId, visiting) + 1;
    cache.set(tabId, d);
    return d;
  }
  for (const tab of tabs) {
    if (tab.id != null) getDepth(tab.id, new Set());
  }
  return cache;
}

interface Props {
  win: SessionWindow;
  winIdx: number;
  winKey: string;   // 'w0', 'w1', etc.
  totalWindows: number;
  query: string;
  selectable?: boolean;
  editSession?: Session | null;
  isLiveTab?: boolean;
  treeEnabled?: boolean;
  onSessionUpdate?: () => void;
  onSaveWindow?: (winIdx: number) => void;
  onCloseWindow?: () => void;
}

// Only rendered inside DragDropProvider (edit mode).
// Attaches drag ref to the entire block and drop ref to the same element,
// exposing handleRef separately so only the header acts as the drag handle.
function WindowDragDropWrapper({
  winKey,
  children,
}: {
  winKey: string;
  children: (props: {
    blockRef: (el: Element | null) => void;
    handleRef: (el: Element | null) => void;
    isDragging: boolean;
    isDropTarget: boolean;
  }) => React.ReactNode;
}) {
  const { ref: dragRef, handleRef, isDragging } = useDraggable({
    id: winKey,
    type: "window",
  });
  const { ref: dropRef, isDropTarget } = useDroppable({
    id: winKey,
    type: "window",
    accept: "window",
    collisionPriority: CollisionPriority.High,
  });

  // Same element is both the drag source bounds and the drop target
  const blockRef = (el: Element | null) => { dragRef(el); dropRef(el); };
  return <>{children({ blockRef, handleRef, isDragging, isDropTarget })}</>;
}

// Only rendered inside DragDropProvider (edit mode).
// Low-priority drop zone at the bottom of a window for cross-window tab drops.
// Elevated to High priority when the window is the empty drag source so @dnd-kit
// prefers it over items in other windows, allowing the user to drag the tab back.
function DroppableWinBody({
  winKey,
  elevated,
  children,
}: {
  winKey: string;
  elevated?: boolean;
  children: (isDropTarget: boolean) => React.ReactNode;
}) {
  const { ref, isDropTarget } = useDroppable({
    id: `body-${winKey}`,
    type: "column",
    accept: "item",
    collisionPriority: elevated ? CollisionPriority.High : CollisionPriority.Low,
  });

  return (
    <div ref={ref}>
      {children(isDropTarget)}
    </div>
  );
}

export function WindowBlock({
  win, winIdx, winKey, totalWindows, query, selectable = true,
  editSession = null, isLiveTab = false, treeEnabled = false, onSessionUpdate, onSaveWindow, onCloseWindow,
}: Props) {
  const { state, dispatch, showModal, hideModal, toast, pushUndo } = useApp();
  const { tabOrder, tabMap, dragSourceWinKey } = useDragState();
  const [collapsed, setCollapsed] = useState(false);

  // In edit mode, use optimistic tab order from DnD context; fall back to session data
  const currentTabIds = editSession ? tabOrder[winKey] : undefined;
  const currentTabs = currentTabIds
    ? currentTabIds.map(id => tabMap[id]).filter(Boolean) as SessionWindow["tabs"]
    : [...win.tabs].sort((a, b) => a.index - b.index);

  const label = windowLabel(win.name, winIdx, totalWindows);
  const isPrivate = win.incognito === true;

  // True when every tab in this window is currently selected
  const allTabsSelected = selectable && currentTabs.length > 0 &&
    currentTabs.every((_, ti) => state.selectedTabKeys.has(`${winIdx}:${ti}`));

  function selectAllInWindow() {
    if (!selectable) return;
    const keys = currentTabs.map((_, ti) => `${winIdx}:${ti}`);
    const newKeys = new Set(state.selectedTabKeys);
    const allSelected = keys.every(k => newKeys.has(k));
    keys.forEach(k => allSelected ? newKeys.delete(k) : newKeys.add(k));
    dispatch({ type: "SET_SELECTED_TABS", keys: newKeys });
    dispatch({ type: "SET_FOCUSED_WIN", idx: allSelected ? null : winIdx, winId: allSelected ? null : (win.id ?? null) });
  }

  function createEditTabFn(tab: SessionWindow["tabs"][number]) {
    if (!editSession) return undefined;
    return () => {
      showModal(
        "Edit tab",
        `<div class="settings-form">
          <label>Title
            <input type="text" id="edit-tab-title" value="${esc(tab.title ?? "")}" />
          </label>
          <label>URL
            <input type="text" id="edit-tab-url" value="${esc(tab.url ?? "")}" />
          </label>
        </div>`,
        [
          { label: "Cancel", cls: "btn-ghost", action: hideModal },
          {
            label: "Save", cls: "btn-primary", action: async () => {
              const newTitle = (document.getElementById("edit-tab-title") as HTMLInputElement).value.trim();
              const newUrl = (document.getElementById("edit-tab-url") as HTMLInputElement).value.trim();
              if (!newUrl) { toast("URL cannot be empty"); return; }
              pushUndo({ type: "session", sessionId: editSession!.id, session: deepClone(editSession!) });
              tab.title = newTitle || newUrl;
              tab.url = newUrl;
              hideModal();
              await send({ type: "updateSession", session: editSession! });
              toast("Tab updated");
              onSessionUpdate?.();
            }
          },
        ]
      );
    };
  }

  function openRenameModal() {
    if (!editSession) return;
    showModal(
      "Rename window",
      `<input id="win-rename-input" type="text" value="${esc(win.name ?? "")}" placeholder="Window name (leave blank to reset)" />`,
      [
        { label: "Cancel", cls: "btn-ghost", action: hideModal },
        {
          label: "Rename", cls: "btn-primary", action: async () => {
            const input = document.getElementById("win-rename-input") as HTMLInputElement;
            const newName = input.value.trim();
            pushUndo({ type: "session", sessionId: editSession.id, session: deepClone(editSession) });
            win.name = newName || undefined;
            hideModal();
            await send({ type: "updateSession", session: editSession });
            toast("Window renamed");
            onSessionUpdate?.();
          }
        },
      ]
    );
  }

  const depthMap = treeEnabled ? buildDepthMap(currentTabs) : new Map<number, number>();

  // Build tab rows — SortableTab in edit mode, plain TabRow in live/readonly mode
  const rows: React.ReactNode[] = [];
  let lastGroupId: number | null = null;

  currentTabs.forEach((tab, ti) => {
    const gid = tab.groupId ?? -1;
    const resolvedColor = tab.groupColor ?? null;
    const resolvedTitle = tab.groupTitle?.trim() || "Group";

    if (gid !== -1 && gid !== lastGroupId) {
      const hex = grpHex(resolvedColor ?? "grey");
      const capturedGid = gid;
      const capturedTitle = resolvedTitle;
      rows.push(
        <div key={`grp-${gid}-${ti}`} className={`tab-group-label${editSession ? " tab-group-label-editable" : ""}`}
          style={{ backgroundColor: hexToRgba(hex, 0.15), borderLeftColor: hex, color: hex }}
          onClick={editSession ? () => {
            showModal(
              "Rename group",
              `<input type="text" id="grp-rename-input" value="${esc(capturedTitle === "Group" ? "" : capturedTitle)}" placeholder="Group name" />`,
              [
                { label: "Cancel", cls: "btn-ghost", action: hideModal },
                {
                  label: "Rename", cls: "btn-primary", action: async () => {
                    const newName = (document.getElementById("grp-rename-input") as HTMLInputElement).value.trim();
                    if (!editSession) return;
                    pushUndo({ type: "session", sessionId: editSession.id, session: deepClone(editSession) });
                    editSession.windows[winIdx]?.tabs
                      .filter(t => (t.groupId ?? -1) === capturedGid)
                      .forEach(t => { t.groupTitle = newName || undefined; });
                    hideModal();
                    await send({ type: "updateSession", session: editSession });
                    toast("Group renamed");
                    onSessionUpdate?.();
                  }
                },
              ]
            );
          } : undefined}>
          {resolvedTitle}
          {editSession && (
            <svg className="tab-group-label-edit-icon" viewBox="0 0 16 16" fill="none" width="10" height="10">
              <path d="M11 2.5a1.5 1.5 0 0 1 2.12 0l.38.38a1.5 1.5 0 0 1 0 2.12L5 13.5 2 14l.5-3L11 2.5Z"
                stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
        </div>
      );
    }
    lastGroupId = gid;

    const tabId = currentTabIds?.[ti] ?? `${editSession?.id ?? "live"}-w${winIdx}-t${ti}`;
    const tabKey = `${winIdx}:${ti}`;
    const depth = tab.id != null ? (depthMap.get(tab.id) ?? 0) : 0;

    if (editSession) {
      const ungroupTab = async () => {
        const srcGid = tab.groupId ?? -1;
        pushUndo({ type: "session", sessionId: editSession.id, session: deepClone(editSession) });

        const winTabs = [...(editSession.windows[winIdx]?.tabs ?? [])].sort((a, b) => a.index - b.index);
        const tabPos = winTabs.indexOf(tab);

        // If there are group members after this tab, move the tab to after the last group member
        // so the group stays visually contiguous
        const hasGroupAfter = tabPos !== -1 && winTabs.slice(tabPos + 1).some(t => (t.groupId ?? -1) === srcGid);
        if (hasGroupAfter) {
          let lastGroupPos = tabPos;
          for (let i = winTabs.length - 1; i > tabPos; i--) {
            if ((winTabs[i]?.groupId ?? -1) === srcGid) { lastGroupPos = i; break; }
          }
          winTabs.splice(tabPos, 1);
          // After removing at tabPos (< lastGroupPos), last group member shifted left by 1,
          // so insert at lastGroupPos (= (lastGroupPos-1) + 1) to land after it.
          winTabs.splice(lastGroupPos, 0, tab);
          winTabs.forEach((t, i) => { t.index = i; });
          if (editSession.windows[winIdx]) editSession.windows[winIdx].tabs = winTabs;
        }

        tab.groupId = -1;
        tab.groupColor = undefined;
        tab.groupTitle = undefined;
        await send({ type: "updateSession", session: editSession });
        toast("Removed from group");
        onSessionUpdate?.();
      };

      rows.push(
        <SortableTab
          key={tabId}
          id={tabId}
          tab={tab}
          winKey={winKey}
          index={ti}
          tabKey={tabKey}
          query={query}
          selectable={selectable}
          isLiveTab={false}
          editMode={true}
          selectedKeys={state.selectedTabKeys}
          depth={depth}
          onUngroup={(tab.groupId ?? -1) !== -1 ? ungroupTab : undefined}
          onEditTab={createEditTabFn(tab)}
        />
      );
    } else {
      rows.push(
        <TabRow
          key={tabKey}
          tab={tab}
          tabKey={tabKey}
          groupColor={tab.groupColor ?? null}
          query={query}
          selectable={selectable}
          isLiveTab={isLiveTab}
          editMode={false}
          depth={depth}
        />
      );
    }
  });

  function renderHeader(isOver = false, handleRef?: (el: Element | null) => void) {
    return (
      <div className={`window-header${isPrivate ? " private" : ""}${isOver ? " dd-win-over" : ""}${allTabsSelected ? " win-all-selected" : ""}`}>
        {handleRef && (
          <div
            ref={handleRef as React.RefCallback<HTMLDivElement>}
            className="win-drag-handle"
            title="Drag to merge with another window"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
              <circle cx="5" cy="4" r="1.3"/>
              <circle cx="11" cy="4" r="1.3"/>
              <circle cx="5" cy="8" r="1.3"/>
              <circle cx="11" cy="8" r="1.3"/>
              <circle cx="5" cy="12" r="1.3"/>
              <circle cx="11" cy="12" r="1.3"/>
            </svg>
          </div>
        )}
        <div
          className="window-header-click"
          title={selectable ? "Click to select all tabs in this window" : undefined}
          onClick={e => { if (!(e.target as HTMLElement).closest("button")) selectAllInWindow(); }}
        >
          {isPrivate ? (
            <svg className="window-header-icon" viewBox="0 0 16 16" fill="none">
              <rect x="3" y="7" width="10" height="8" rx="1.5" stroke="#b980ff" strokeWidth="1.3"/>
              <path d="M5 7V5a3 3 0 0 1 6 0v2" stroke="#b980ff" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
          ) : (
            <svg className="window-header-icon" viewBox="0 0 16 16" fill="none">
              <rect x="1" y="2" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.2"/>
              <line x1="1" y1="6" x2="15" y2="6" stroke="currentColor" strokeWidth="1.2"/>
            </svg>
          )}
          <span className="window-header-title">{label}</span>
          {isPrivate && <span className="private-badge">Private</span>}
          <span className="window-tab-count">{tabCountLabel(currentTabs.length)}</span>
        </div>

        {isLiveTab && onSaveWindow && (
          <button className="window-rename-btn" title="Save this window as a new collection"
            onClick={e => { e.stopPropagation(); onSaveWindow(winIdx); }}>
            <svg viewBox="0 0 16 16" fill="none">
              <path d="M8 2v7M8 9L5 6M8 9l3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
              <rect x="1" y="11" width="14" height="3" rx="1" stroke="currentColor" strokeWidth="1.2"/>
            </svg>
          </button>
        )}
        {isLiveTab && win.id != null && onCloseWindow && !isPrivate && (
          <button className="window-rename-btn" title="Close this browser window"
            onClick={e => {
              e.stopPropagation();
              showModal(
                "Close window",
                `<p>Close this window and its ${currentTabs.length} tab${currentTabs.length !== 1 ? "s" : ""}?</p>`,
                [
                  { label: "Cancel", cls: "btn-ghost", action: hideModal },
                  {
                    label: "Close", cls: "btn-danger", action: async () => {
                      hideModal();
                      try { await browser.windows.remove(win.id!); onCloseWindow(); }
                      catch { toast("Could not close window"); }
                    }
                  },
                ]
              );
            }}>
            <svg viewBox="0 0 16 16" fill="none">
              <line x1="4" y1="4" x2="12" y2="12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              <line x1="12" y1="4" x2="4" y2="12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </button>
        )}

        {editSession && (
          <button className="window-rename-btn" title="Rename window"
            onClick={e => { e.stopPropagation(); openRenameModal(); }}>
            <svg viewBox="0 0 16 16" fill="none">
              <path d="M11 2.5a1.5 1.5 0 0 1 2.12 0l.38.38a1.5 1.5 0 0 1 0 2.12L5 13.5 2 14l.5-3L11 2.5Z"
                stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        )}

        <button className="collapse-btn" title="Collapse / expand"
          onClick={e => { e.stopPropagation(); setCollapsed(c => !c); }}>
          <svg className={`collapse-arrow${collapsed ? " collapsed" : ""}`} viewBox="0 0 16 16" fill="none">
            <polyline points="4,6 8,10 12,6" stroke="currentColor" strokeWidth="1.5"
              strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>
    );
  }

  function renderBody(isBodyOver = false) {
    // When this window is the drag source and all tabs have been dragged out,
    // keep a visible drop zone so the user can drag the tab back.
    const isDragSourceEmpty = dragSourceWinKey === winKey && currentTabs.length === 0;
    return (
      <div
        className={`window-body${isBodyOver ? " dd-win-body-over" : ""}`}
        style={collapsed ? { display: "none" } : undefined}
      >
        {isDragSourceEmpty ? <div className="window-drag-source-placeholder" /> : rows}
      </div>
    );
  }

  // Live / readonly mode — no DnD hooks
  if (!editSession) {
    return (
      <div className="window-block" data-win-key={winKey}>
        {renderHeader()}
        {renderBody()}
      </div>
    );
  }

  // Edit mode — wrap with drag/drop (must be inside DragDropProvider from SessionDnD)
  return (
    <WindowDragDropWrapper winKey={winKey}>
      {({ blockRef, handleRef, isDragging, isDropTarget }) => (
        <div
          ref={blockRef}
          className={`window-block${isDragging ? " dragging" : ""}${isDropTarget ? " dd-win-over" : ""}`}
          data-win-key={winKey}
        >
          {renderHeader(false, handleRef)}
          <DroppableWinBody winKey={winKey} elevated={dragSourceWinKey === winKey && currentTabs.length === 0}>
            {renderBody}
          </DroppableWinBody>
        </div>
      )}
    </WindowDragDropWrapper>
  );
}
