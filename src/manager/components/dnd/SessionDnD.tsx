import { createContext, useContext, useRef, useState, useEffect } from "react";
import { DragDropProvider, DragOverlay } from "@dnd-kit/react";
import { RestrictToVerticalAxis } from "@dnd-kit/abstract/modifiers";
import { RestrictToElement } from "@dnd-kit/dom/modifiers";
import { PointerSensor, PointerActivationConstraints, KeyboardSensor } from "@dnd-kit/dom";
import { move } from "@dnd-kit/helpers";
import { useApp } from "../../context/AppContext";
import { send } from "../../utils/messaging";
import { deepClone, esc } from "../../utils/helpers";
import type { Session, Tab } from "../../context/types";

// ─── Drag state context (lets WindowBlock read optimistic tab order) ──────────

export interface DragState {
  // maps window key ('w0', 'w1') → ordered tab IDs
  tabOrder: Record<string, string[]>;
  // maps tab ID → tab object
  tabMap: Record<string, Tab>;
  // winKey of the window a tab is being dragged FROM (null when not dragging)
  dragSourceWinKey: string | null;
}

const DragStateCtx = createContext<DragState>({ tabOrder: {}, tabMap: {}, dragSourceWinKey: null });
export const useDragState = () => useContext(DragStateCtx);

// ─── Stable tab ID from content so React keys don't move when order changes ───

function tabContentHash(tab: Tab): string {
  const str = `${tab.url ?? ""}|${tab.title ?? ""}`;
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

// ─── Sensor config — longer touch tolerance so small finger wobble doesn't cancel drag ───

const sensors = [
  PointerSensor.configure({
    activationConstraints(event: PointerEvent) {
      if (event.pointerType === "touch") {
        return [new PointerActivationConstraints.Delay({ value: 200, tolerance: 15 })];
      }
      // mouse/pen: start immediately when a handle is grabbed, small distance otherwise
      return [new PointerActivationConstraints.Distance({ value: 5 })];
    },
  }),
  KeyboardSensor,
];

// ─── SessionDnD ───────────────────────────────────────────────────────────────

interface Props {
  session: Session;
  onUpdate: () => Promise<void>;
  children: React.ReactNode;
}

export function SessionDnD({ session, onUpdate, children }: Props) {
  const { dispatch, toast, pushUndo, showModal, hideModal } = useApp();

  const [tabOrder, setTabOrder] = useState<Record<string, string[]>>({});
  const [dragSourceWinKey, setDragSourceWinKey] = useState<string | null>(null);
  const tabOrderRef = useRef<Record<string, string[]>>({});
  const tabMapRef = useRef<Record<string, Tab>>({});
  const prevTabOrder = useRef<Record<string, string[]>>({});
  const prevTabMap = useRef<Record<string, Tab>>({});

  // Rebuild tabOrder and tabMap whenever the session changes (after save or on load).
  // Tab IDs are derived from URL+title hash so the same tab keeps the same React key
  // even when its position (index) changes — preventing a false "swap" animation on drop.
  useEffect(() => {
    const order: Record<string, string[]> = {};
    const dataMap: Record<string, Tab> = {};
    session.windows.forEach((win, wi) => {
      const winKey = `w${wi}`;
      order[winKey] = [];
      const seen: Record<string, number> = {};
      [...win.tabs].sort((a, b) => a.index - b.index).forEach((tab) => {
        const h = tabContentHash(tab);
        seen[h] = (seen[h] ?? 0) + 1;
        const tabId = `${session.id}-w${wi}-${h}${seen[h] > 1 ? `-${seen[h]}` : ""}`;
        order[winKey].push(tabId);
        dataMap[tabId] = tab;
      });
    });
    tabOrderRef.current = order;
    setTabOrder(order);
    tabMapRef.current = dataMap;
  }, [session]);

  function onDragStart(event: any) {
    prevTabOrder.current = tabOrderRef.current;
    prevTabMap.current = { ...tabMapRef.current };
    const draggedId = event.operation?.source?.id as string | undefined;
    const srcWin = draggedId
      ? (Object.entries(tabOrderRef.current).find(([, ids]) => ids.includes(draggedId))?.[0] ?? null)
      : null;
    setDragSourceWinKey(srcWin);
  }

  function onDragOver(event: any) {
    const source = event.operation?.source;
    if (source?.type !== "item") return;

    const draggedId = source.id as string;
    const origWinKey = Object.entries(prevTabOrder.current).find(
      ([, ids]) => ids.includes(draggedId)
    )?.[0];

    const newOrder = move(tabOrderRef.current, event);

    // Reflect the dragged tab's group membership live (same logic for both same- and
    // cross-window): inherit from neighbors so the group label preview stays correct.
    for (const [, tabIds] of Object.entries(newOrder)) {
      const idx = tabIds.indexOf(draggedId);
      if (idx === -1) continue;

      const aboveId = idx > 0 ? tabIds[idx - 1] : null;
      const belowId = idx < tabIds.length - 1 ? tabIds[idx + 1] : null;
      const above = aboveId ? prevTabMap.current[aboveId] : null;
      const below = belowId ? prevTabMap.current[belowId] : null;
      const srcGroup =
        above?.groupId && above.groupId !== -1 ? above :
        below?.groupId && below.groupId !== -1 ? below : null;

      tabMapRef.current = {
        ...tabMapRef.current,
        [draggedId]: {
          ...tabMapRef.current[draggedId],
          groupId: srcGroup?.groupId ?? -1,
          groupColor: srcGroup?.groupColor,
          groupTitle: srcGroup?.groupTitle,
        },
      };
      break;
    }

    tabOrderRef.current = newOrder;
    setTabOrder(newOrder);
  }

  function onDragEnd(event: any) {
    const { operation, canceled } = event;
    const source = operation?.source;
    const target = operation?.target;

    setDragSourceWinKey(null);

    if (canceled) {
      if (source?.type === "item") {
        tabOrderRef.current = prevTabOrder.current;
        setTabOrder(prevTabOrder.current);
        tabMapRef.current = prevTabMap.current;
      }
      return;
    }

    if (source?.type === "item") {
      // Dropping on a window body (empty area) rather than a specific tab row:
      // move() doesn't fire for column targets, so the tab may still be in the
      // source window. Manually append it to the target window.
      const targetId = String(target?.id ?? "");
      if (targetId.startsWith("body-")) {
        const targetWinKey = targetId.slice(5); // "body-w1" → "w1"
        const tabId = String(source.id);
        const srcWinKey = Object.keys(tabOrderRef.current).find(
          k => tabOrderRef.current[k].includes(tabId)
        );
        if (srcWinKey && srcWinKey !== targetWinKey && tabOrderRef.current[targetWinKey] !== undefined) {
          tabOrderRef.current = {
            ...tabOrderRef.current,
            [srcWinKey]: tabOrderRef.current[srcWinKey].filter(id => id !== tabId),
            [targetWinKey]: [...tabOrderRef.current[targetWinKey], tabId],
          };
          setTabOrder(tabOrderRef.current);
        }
      }
      commitTabsToSession(tabOrderRef.current, source.id as string);
    } else if (source?.type === "window" && target && source.id !== target.id) {
      const srcWinKey = source.id as string;
      const dstWinKey = target.id as string;
      const srcWi = parseInt(srcWinKey.slice(1));
      const dstWi = parseInt(dstWinKey.slice(1));
      const srcWin = session.windows[srcWi];
      const dstWin = session.windows[dstWi];
      if (!srcWin || !dstWin) return;

      showModal(
        "Merge windows",
        `<p>Merge <strong>${esc(srcWin.name ?? `Window ${srcWi + 1}`)}</strong> into <strong>${esc(dstWin.name ?? `Window ${dstWi + 1}`)}</strong>? This cannot be undone easily.</p>`,
        [
          { label: "Cancel", cls: "btn-ghost", action: hideModal },
          {
            label: "Merge", cls: "btn-danger", action: () => {
              hideModal();
              mergeWindows(srcWi, dstWi);
            }
          },
        ]
      );
    }
  }

  function commitTabsToSession(order: Record<string, string[]>, draggedTabId: string | null = null) {
    const originalWindowOf: Record<string, string> = {};
    Object.entries(prevTabOrder.current).forEach(([winKey, tabIds]) => {
      tabIds.forEach(id => { originalWindowOf[id] = winKey; });
    });

    const newWindows = Object.entries(order)
      .map(([winKey, tabIds]) => {
        const wi = parseInt(winKey.slice(1));
        const origWin = session.windows[wi] ?? {};
        const tabs = tabIds
          .map((tabId, idx) => {
            const tab = tabMapRef.current[tabId];
            if (!tab) return null;
            const movedAcrossWindow = originalWindowOf[tabId] !== winKey;

            if (movedAcrossWindow) {
              // Cross-window move: inherit group from neighbors (same as same-window logic)
              // so that dropping inside a group joins it rather than splitting it.
              const aboveId = idx > 0 ? tabIds[idx - 1] : null;
              const belowId = idx < tabIds.length - 1 ? tabIds[idx + 1] : null;
              const above = aboveId ? tabMapRef.current[aboveId] : null;
              const below = belowId ? tabMapRef.current[belowId] : null;
              const srcGroup = above?.groupId && above.groupId !== -1 ? above : (below?.groupId && below.groupId !== -1 ? below : null);
              return {
                ...tab, index: idx,
                groupId: srcGroup?.groupId ?? -1,
                groupColor: srcGroup?.groupColor,
                groupTitle: srcGroup?.groupTitle,
              };
            }

            if (tabId === draggedTabId) {
              // Same-window drag: determine group by looking at both neighbors.
              // Inherit from the tab above if it's in a group; if above has no group
              // but the tab below does, join the group below (placed at group start).
              const aboveId = idx > 0 ? tabIds[idx - 1] : null;
              const belowId = idx < tabIds.length - 1 ? tabIds[idx + 1] : null;
              const above = aboveId ? tabMapRef.current[aboveId] : null;
              const below = belowId ? tabMapRef.current[belowId] : null;
              const srcGroup = above?.groupId && above.groupId !== -1 ? above : (below?.groupId && below.groupId !== -1 ? below : null);
              return {
                ...tab,
                index: idx,
                groupId: srcGroup?.groupId ?? -1,
                groupColor: srcGroup?.groupColor,
                groupTitle: srcGroup?.groupTitle,
              };
            }

            return { ...tab, index: idx };
          })
          .filter((t): t is Tab => t !== null);
        return { ...origWin, tabs };
      })
      .filter(w => w.tabs.length > 0);

    if (newWindows.length === 0) return;

    const updated: Session = {
      ...session,
      windows: newWindows,
      tabCount: newWindows.reduce((n, w) => n + w.tabs.length, 0),
      windowCount: newWindows.length,
    };

    pushUndo({ type: "session", sessionId: session.id, session: deepClone(session) });
    dispatch({ type: "SET_SELECTED_TABS", keys: new Set() });
    send({ type: "updateSession", session: updated })
      .then(() => { toast("Collection updated"); return onUpdate(); })
      .catch(() => toast("Failed to save"));
  }

  function mergeWindows(srcWi: number, dstWi: number) {
    const s: Session = { ...session, windows: deepClone(session.windows) };
    pushUndo({ type: "session", sessionId: s.id, session: deepClone(session) });

    const srcWin = s.windows[srcWi];
    s.windows.splice(srcWi, 1);
    const actualDst = srcWi < dstWi ? dstWi - 1 : dstWi;
    const dstWin = s.windows[actualDst];
    if (!srcWin || !dstWin) return;

    const offset = dstWin.tabs.length;
    srcWin.tabs.sort((a, b) => a.index - b.index).forEach(tab => {
      tab.index = offset + tab.index;
      tab.groupId = -1; tab.groupColor = undefined; tab.groupTitle = undefined;
      dstWin.tabs.push(tab);
    });
    s.tabCount = s.windows.reduce((n, w) => n + w.tabs.length, 0);
    s.windowCount = s.windows.length;

    send({ type: "updateSession", session: s })
      .then(() => { toast("Windows merged"); return onUpdate(); })
      .catch(() => toast("Failed to save"));
  }

  return (
    <DragStateCtx.Provider value={{ tabOrder, tabMap: tabMapRef.current, dragSourceWinKey }}>
      <DragDropProvider
        sensors={sensors}
        modifiers={[RestrictToVerticalAxis, RestrictToElement.configure({ element: () => document.querySelector(".content-area") })]}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
      >
        {/* Suppress the default fly-back settle animation. Without this, dnd-kit
            animates the dropped element back to its source-window placeholder, which
            looks like the slot "growing" when dropping cross-window. */}
        <DragOverlay disabled dropAnimation={() => Promise.resolve()}>{null}</DragOverlay>
        {children}
      </DragDropProvider>
    </DragStateCtx.Provider>
  );
}
