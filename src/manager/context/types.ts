export interface Tab {
  id?: number;
  index: number;
  url: string;
  title: string;
  favIconUrl?: string;
  pinned?: boolean;
  groupId?: number;
  groupColor?: string;
  groupTitle?: string;
  groupCollapsed?: boolean;
  cookieStoreId?: string;
  incognito?: boolean;
  openerTabId?: number;
}

export interface Window {
  id?: number;
  name?: string;
  state?: string;
  width?: number;
  height?: number;
  top?: number;
  left?: number;
  incognito?: boolean;
  tabs: Tab[];
}

export interface Session {
  id: string;
  name: string;
  date: number;
  windowCount: number;
  tabCount: number;
  windows: Window[];
}

export interface HistoryEntry {
  id: string;
  date: number;
  type: string;
  windowCount: number;
  tabCount: number;
  windows: Window[];
}

export interface Config {
  autoSaveInterval: number;
  maxHistory: number;
  fetchFavicons: boolean;
}

export interface TabRenderEntry {
  key: string;
  tab: Tab;
  el?: HTMLElement;
}

// ─── Undo snapshot types ──────────────────────────────────────────────────────

export type UndoSnapshot =
  | { type: "session"; sessionId: string; session: Session }
  | { type: "rename"; sessionId: string; oldName: string }
  | { type: "delete"; sessions: Session[]; oldOrder: string[] }
  | { type: "re-delete"; ids: string[] }
  | { type: "reorder"; oldOrder: string[] }
  | { type: "merge"; srcSession: Session; dstSession: Session }
  | { type: "re-merge"; srcId: string; mergedDstSession: Session }
  | { type: "extract-to-collection"; originalSrc: Session; modifiedSrc: Session; newSession: Session }
  | { type: "re-extract-to-collection"; modifiedSrc: Session; newSession: Session }
  | { type: "collection-merge"; originalTarget: Session; mergedTarget: Session; originalSources: Session[]; oldOrder: string[] }
  | { type: "re-collection-merge"; mergedTarget: Session; sourceIds: string[] };

// ─── App state ────────────────────────────────────────────────────────────────

export type ViewId = "current" | "history" | "closed" | "cookies" | string;

export interface AppState {
  sessions: Session[];
  view: ViewId;
  searchQuery: string;
  selectedTabKeys: Set<string>;
  lastTabKey: string | null;
  tabRenderOrder: TabRenderEntry[];
  selectedSessionIds: Set<string>;
  lastSessionId: string | null;
  historyEntry: HistoryEntry | null;
  undoStack: UndoSnapshot[];
  redoStack: UndoSnapshot[];
  toastMsg: string | null;
  toastAction: (() => void) | null;
  toastActionLabel: string;
  modalOpen: boolean;
  modalTitle: string;
  modalBody: string;
  modalActions: ModalAction[];
}

export interface ModalAction {
  label: string;
  cls?: string;
  action: () => void;
}

// ─── App actions ──────────────────────────────────────────────────────────────

export type AppAction =
  | { type: "SET_SESSIONS"; sessions: Session[] }
  | { type: "SET_VIEW"; view: ViewId }
  | { type: "SET_SEARCH"; query: string }
  | { type: "SET_SELECTED_TABS"; keys: Set<string> }
  | { type: "SET_LAST_TAB_KEY"; key: string | null }
  | { type: "SET_TAB_RENDER_ORDER"; order: TabRenderEntry[] }
  | { type: "SET_SELECTED_SESSIONS"; ids: Set<string> }
  | { type: "SET_LAST_SESSION_ID"; id: string | null }
  | { type: "SET_HISTORY_ENTRY"; entry: HistoryEntry | null }
  | { type: "PUSH_UNDO"; snapshot: UndoSnapshot }
  | { type: "APPLY_UNDO"; redoSnapshot: UndoSnapshot | null; sessions?: Session[] }
  | { type: "APPLY_REDO"; undoSnapshot: UndoSnapshot | null; sessions?: Session[] }
  | { type: "CLEAR_UNDO_REDO" }
  | { type: "SHOW_TOAST"; msg: string; action?: () => void; actionLabel?: string }
  | { type: "HIDE_TOAST" }
  | { type: "SHOW_MODAL"; title: string; body: string; actions: ModalAction[] }
  | { type: "HIDE_MODAL" };
