import { useSortable } from "@dnd-kit/react/sortable";
import { OptimisticSortingPlugin } from "@dnd-kit/dom/sortable";
import { TabRow } from "../views/TabRow";
import type { Tab } from "../../context/types";

interface Props {
  id: string;
  tab: Tab;
  winKey: string;
  index: number;  // position within the window (for sortable ordering)
  tabKey: string; // wi:ti key for selection
  query: string;
  selectable?: boolean;
  isLiveTab?: boolean;
  editMode?: boolean;
  selectedKeys: Set<string>;
  depth?: number;
  onUngroup?: () => void;
}

export function SortableTab({
  id, tab, winKey, index, tabKey, query, selectable, isLiveTab, editMode, selectedKeys, depth, onUngroup,
}: Props) {
  const { ref, handleRef, isDragging } = useSortable({
    id,
    index,
    type: "item",
    accept: "item",
    group: winKey,
    // onDragOver already updates React state (tabOrder), so dnd-kit's built-in
    // CSS-transform optimistic sorting would double-apply the move and cause a
    // visible swap on drop. Disable it and let React re-renders drive the UI.
    plugins: (defaults) => defaults.filter((p) => p !== OptimisticSortingPlugin),
  });

  return (
    <TabRow
      nodeRef={ref}
      handleRef={handleRef}
      isDragging={isDragging}
      tab={tab}
      tabKey={tabKey}
      groupColor={tab.groupColor ?? null}
      query={query}
      selectable={selectable}
      isLiveTab={isLiveTab}
      editMode={editMode}
      depth={depth}
      onUngroup={onUngroup}
    />
  );
}
