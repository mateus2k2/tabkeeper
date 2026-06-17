import { useApp } from "../../context/AppContext";
import { grpHex, hexToRgba } from "../../utils/helpers";
import { highlightMatch, getFaviconUrl } from "../../utils/render";
import type { Tab } from "../../context/types";

interface Props {
  tab: Tab;
  tabKey: string;
  groupColor?: string | null;
  query: string;
  selectable?: boolean;
  isLiveTab?: boolean;
  editMode?: boolean;
  nodeRef?: ((el: Element | null) => void) | React.Ref<HTMLDivElement>;
  handleRef?: ((el: Element | null) => void) | React.Ref<HTMLDivElement>;
  isDragging?: boolean;
  depth?: number;
  onUngroup?: () => void;
}

export function TabRow({
  tab, tabKey, groupColor, query, selectable = true, isLiveTab = false,
  editMode = false, nodeRef, handleRef, isDragging = false, depth = 0, onUngroup,
}: Props) {
  const { state, dispatch } = useApp();
  const isSelected = state.selectedTabKeys.has(tabKey);

  const matchText = (tab.title ?? "") + " " + (tab.url ?? "");
  const isHidden = !!query && !matchText.toLowerCase().includes(query.toLowerCase());

  const groupColor2 = groupColor ?? tab.groupColor ?? null;
  const borderStyle = groupColor2
    ? { borderLeftColor: grpHex(groupColor2), backgroundColor: hexToRgba(grpHex(groupColor2), 0.04) }
    : {};
  const depthStyle = depth > 0 ? { paddingLeft: `${8 + depth * 16}px` } : {};

  function handleClick(e: React.MouseEvent) {
    if (!selectable) return;
    if ((e.target as HTMLElement).closest("button,a")) return;

    if (e.shiftKey) {
      e.preventDefault();
      const { tabRenderOrder, lastTabKey, selectedTabKeys } = state;
      if (!lastTabKey) {
        const newKeys = new Set(selectedTabKeys);
        newKeys.add(tabKey);
        dispatch({ type: "SET_SELECTED_TABS", keys: newKeys });
        dispatch({ type: "SET_LAST_TAB_KEY", key: tabKey });
        return;
      }
      const visible = tabRenderOrder.filter(r => {
        const match = (r.tab.title ?? "") + " " + (r.tab.url ?? "");
        return !query || match.toLowerCase().includes(query.toLowerCase());
      });
      const from = visible.findIndex(r => r.key === lastTabKey);
      const to   = visible.findIndex(r => r.key === tabKey);
      if (from === -1 || to === -1) return;
      const [lo, hi] = from < to ? [from, to] : [to, from];
      const newKeys = new Set(selectedTabKeys);
      for (let i = lo; i <= hi; i++) newKeys.add(visible[i]!.key);
      dispatch({ type: "SET_SELECTED_TABS", keys: newKeys });
    } else if (e.ctrlKey || e.metaKey) {
      const newKeys = new Set(state.selectedTabKeys);
      if (newKeys.has(tabKey)) newKeys.delete(tabKey);
      else newKeys.add(tabKey);
      dispatch({ type: "SET_SELECTED_TABS", keys: newKeys });
      dispatch({ type: "SET_LAST_TAB_KEY", key: tabKey });
    } else {
      const newKeys = new Set(state.selectedTabKeys);
      if (newKeys.has(tabKey) && newKeys.size === 1) {
        newKeys.clear();
        dispatch({ type: "SET_LAST_TAB_KEY", key: null });
      } else {
        newKeys.clear();
        newKeys.add(tabKey);
        dispatch({ type: "SET_LAST_TAB_KEY", key: tabKey });
      }
      dispatch({ type: "SET_SELECTED_TABS", keys: newKeys });
    }
  }

  async function openTab(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (isLiveTab && tab.id) {
      await browser.tabs.update(tab.id, { active: true });
      const wid = (tab as Tab & { windowId?: number }).windowId;
      if (wid && typeof browser.windows !== "undefined") {
        await browser.windows.update(wid, { focused: true });
      }
    } else if (tab.url) {
      await browser.tabs.create({ url: tab.url });
    }
  }

  const faviconUrl = getFaviconUrl(tab.url ?? "", tab.favIconUrl);
  const displayUrl = (tab.url ?? "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  const canOpen = !!(tab.url && tab.url !== "about:newtab" && tab.url !== "about:blank");

  return (
    <div
      ref={nodeRef as React.Ref<HTMLDivElement>}
      className={`tab-row${isSelected ? " selected" : ""}${isHidden ? " search-hidden" : ""}${depth > 0 ? " tab-tree-child" : ""}`}
      style={{ ...borderStyle, ...depthStyle }}
      data-tab-key={tabKey}
      data-dragging={isDragging || undefined}
      tabIndex={selectable ? 0 : undefined}
      onMouseDown={e => { if (e.shiftKey) e.preventDefault(); }}
      onClick={handleClick}
    >
      {editMode && (
        <div
          ref={handleRef as React.Ref<HTMLDivElement>}
          className="tab-drag-handle"
          title="Drag to reorder"
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
      )}
      {faviconUrl ? (
        <img
          className="tab-favicon"
          src={faviconUrl}
          width={16} height={16} alt=""
          onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
      ) : (
        <svg className="tab-favicon tab-favicon-default" viewBox="0 0 16 16" fill="none">
          <rect x="1" y="2" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.2"/>
          <line x1="1" y1="6" x2="15" y2="6" stroke="currentColor" strokeWidth="1.2"/>
        </svg>
      )}

      <span className="tab-title" title={tab.title ?? ""}
        dangerouslySetInnerHTML={{ __html: highlightMatch(tab.title ?? tab.url ?? "New Tab", query) }} />
      {canOpen ? (
        <a className="tab-url" href={tab.url} title={tab.url ?? ""}
          onClick={openTab}
          dangerouslySetInnerHTML={{ __html: highlightMatch(displayUrl, query) }} />
      ) : (
        <span className="tab-url" title={tab.url ?? ""}
          dangerouslySetInnerHTML={{ __html: highlightMatch(displayUrl, query) }} />
      )}

      {tab.pinned && <span className="tab-pin-badge">📌</span>}
      {editMode && onUngroup && (tab.groupId ?? -1) !== -1 && (
        <button
          className="tab-ungroup-btn"
          title="Remove from group"
          onClick={e => { e.stopPropagation(); onUngroup(); }}
        >×</button>
      )}
    </div>
  );
}
