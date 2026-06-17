import { useCallback } from "react";
import { useApp } from "../context/AppContext";
import { send } from "../utils/messaging";
import { deepClone } from "../utils/helpers";
import type { Session, UndoSnapshot } from "../context/types";

export function useUndo() {
  const { state, dispatch, toast } = useApp();

  const loadSessions = useCallback(async () => {
    const sessions: Session[] = await send({ type: "getSessions" });
    dispatch({ type: "SET_SESSIONS", sessions });
  }, [dispatch]);

  const undo = useCallback(async () => {
    const stack = state.undoStack;
    const snap = stack.length > 0 ? stack[stack.length - 1]! : null;
    if (!snap) return;

    switch (snap.type) {
      case "session": {
        const current = state.sessions.find(s => s.id === snap.sessionId);
        const redoSnapshot: UndoSnapshot | null = current
          ? { type: "session", sessionId: current.id, session: deepClone(current) }
          : null;
        await send({ type: "updateSession", session: snap.session });
        const updated = state.sessions.map(s => s.id === snap.sessionId ? snap.session : s);
        dispatch({ type: "APPLY_UNDO", redoSnapshot, sessions: updated });
        break;
      }
      case "rename": {
        const current = state.sessions.find(s => s.id === snap.sessionId);
        const redoSnapshot: UndoSnapshot | null = current
          ? { type: "rename", sessionId: snap.sessionId, oldName: current.name }
          : null;
        await send({ type: "renameSession", id: snap.sessionId, name: snap.oldName });
        dispatch({ type: "APPLY_UNDO", redoSnapshot });
        await loadSessions();
        break;
      }
      case "delete": {
        const redoSnapshot: UndoSnapshot = { type: "re-delete", ids: snap.sessions.map(s => s.id) };
        for (const s of snap.sessions) await send({ type: "updateSession", session: s });
        if (snap.oldOrder) await send({ type: "reorderSessions", order: snap.oldOrder });
        dispatch({ type: "APPLY_UNDO", redoSnapshot });
        await loadSessions();
        break;
      }
      case "re-delete": {
        const toDelete = state.sessions.filter(s => snap.ids.includes(s.id));
        const redoSnapshot: UndoSnapshot = {
          type: "delete",
          sessions: toDelete.map(s => deepClone(s)),
          oldOrder: state.sessions.map(s => s.id),
        };
        for (const id of snap.ids) await send({ type: "deleteSession", id });
        dispatch({ type: "APPLY_UNDO", redoSnapshot });
        await loadSessions();
        if (snap.ids.includes(state.view)) dispatch({ type: "SET_VIEW", view: "current" });
        break;
      }
      case "reorder": {
        const redoSnapshot: UndoSnapshot = { type: "reorder", oldOrder: state.sessions.map(s => s.id) };
        await send({ type: "reorderSessions", order: snap.oldOrder });
        dispatch({ type: "APPLY_UNDO", redoSnapshot });
        await loadSessions();
        break;
      }
      case "merge": {
        const currentDst = state.sessions.find(s => s.id === snap.dstSession.id);
        const redoSnapshot: UndoSnapshot | null = currentDst
          ? { type: "re-merge", srcId: snap.srcSession.id, mergedDstSession: deepClone(currentDst) }
          : null;
        await send({ type: "updateSession", session: snap.srcSession });
        await send({ type: "updateSession", session: snap.dstSession });
        dispatch({ type: "APPLY_UNDO", redoSnapshot });
        await loadSessions();
        break;
      }
      case "extract-to-collection": {
        const redoSnapshot: UndoSnapshot = {
          type: "re-extract-to-collection",
          modifiedSrc: snap.modifiedSrc,
          newSession: snap.newSession,
        };
        await send({ type: "updateSession", session: snap.originalSrc });
        await send({ type: "deleteSession", id: snap.newSession.id });
        dispatch({ type: "APPLY_UNDO", redoSnapshot });
        await loadSessions();
        break;
      }
      case "collection-merge": {
        const redoSnapshot: UndoSnapshot = {
          type: "re-collection-merge",
          mergedTarget: snap.mergedTarget,
          sourceIds: snap.originalSources.map(s => s.id),
        };
        await send({ type: "updateSession", session: snap.originalTarget });
        for (const s of snap.originalSources) await send({ type: "updateSession", session: s });
        await send({ type: "reorderSessions", order: snap.oldOrder });
        dispatch({ type: "APPLY_UNDO", redoSnapshot });
        await loadSessions();
        break;
      }
    }
    toast("Undone");
  }, [state, dispatch, toast, loadSessions]);

  const redo = useCallback(async () => {
    const rstack = state.redoStack;
    const snap = rstack.length > 0 ? rstack[rstack.length - 1]! : null;
    if (!snap) return;

    switch (snap.type) {
      case "session": {
        const current = state.sessions.find(s => s.id === snap.sessionId);
        const undoSnapshot: UndoSnapshot | null = current
          ? { type: "session", sessionId: current.id, session: deepClone(current) }
          : null;
        await send({ type: "updateSession", session: snap.session });
        const updated = state.sessions.map(s => s.id === snap.sessionId ? snap.session : s);
        dispatch({ type: "APPLY_REDO", undoSnapshot, sessions: updated });
        break;
      }
      case "rename": {
        const current = state.sessions.find(s => s.id === snap.sessionId);
        const undoSnapshot: UndoSnapshot | null = current
          ? { type: "rename", sessionId: snap.sessionId, oldName: current.name }
          : null;
        await send({ type: "renameSession", id: snap.sessionId, name: snap.oldName });
        dispatch({ type: "APPLY_REDO", undoSnapshot });
        await loadSessions();
        break;
      }
      case "re-delete": {
        const toDelete = state.sessions.filter(s => snap.ids.includes(s.id));
        const undoSnapshot: UndoSnapshot = {
          type: "delete",
          sessions: toDelete.map(s => deepClone(s)),
          oldOrder: state.sessions.map(s => s.id),
        };
        for (const id of snap.ids) await send({ type: "deleteSession", id });
        dispatch({ type: "APPLY_REDO", undoSnapshot });
        await loadSessions();
        if (snap.ids.includes(state.view)) dispatch({ type: "SET_VIEW", view: "current" });
        break;
      }
      case "reorder": {
        const undoSnapshot: UndoSnapshot = { type: "reorder", oldOrder: state.sessions.map(s => s.id) };
        await send({ type: "reorderSessions", order: snap.oldOrder });
        dispatch({ type: "APPLY_REDO", undoSnapshot });
        await loadSessions();
        break;
      }
      case "re-merge": {
        const dstCurrent = state.sessions.find(s => s.id === snap.mergedDstSession.id);
        const srcCurrent = state.sessions.find(s => s.id === snap.srcId);
        const undoSnapshot: UndoSnapshot | null =
          dstCurrent && srcCurrent
            ? { type: "merge", srcSession: deepClone(srcCurrent), dstSession: deepClone(dstCurrent) }
            : null;
        await send({ type: "updateSession", session: snap.mergedDstSession });
        await send({ type: "deleteSession", id: snap.srcId });
        dispatch({ type: "APPLY_REDO", undoSnapshot });
        await loadSessions();
        if (state.view === snap.srcId) dispatch({ type: "SET_VIEW", view: snap.mergedDstSession.id });
        break;
      }
      case "re-extract-to-collection": {
        const undoSnapshot: UndoSnapshot = {
          type: "extract-to-collection",
          originalSrc: deepClone(state.sessions.find(s => s.id === snap.modifiedSrc.id) ?? snap.modifiedSrc),
          modifiedSrc: snap.modifiedSrc,
          newSession: snap.newSession,
        };
        await send({ type: "updateSession", session: snap.modifiedSrc });
        await send({ type: "importSessions", sessions: [snap.newSession] });
        dispatch({ type: "APPLY_REDO", undoSnapshot });
        await loadSessions();
        break;
      }
      case "re-collection-merge": {
        const currentSources = state.sessions.filter(s => snap.sourceIds.includes(s.id));
        const currentTarget = state.sessions.find(s => s.id === snap.mergedTarget.id);
        const undoSnapshot: UndoSnapshot | null =
          currentTarget
            ? {
                type: "collection-merge",
                originalTarget: deepClone(currentTarget),
                mergedTarget: snap.mergedTarget,
                originalSources: currentSources.map(s => deepClone(s)),
                oldOrder: state.sessions.map(s => s.id),
              }
            : null;
        await send({ type: "updateSession", session: snap.mergedTarget });
        for (const id of snap.sourceIds) await send({ type: "deleteSession", id });
        dispatch({ type: "APPLY_REDO", undoSnapshot });
        await loadSessions();
        if (snap.sourceIds.includes(state.view)) dispatch({ type: "SET_VIEW", view: snap.mergedTarget.id });
        break;
      }
    }
    toast("Redone");
  }, [state, dispatch, toast, loadSessions]);

  return { undo, redo, canUndo: state.undoStack.length > 0, canRedo: state.redoStack.length > 0 };
}
