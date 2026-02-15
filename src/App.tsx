import { useMemo, type ReactNode } from "react";
import { Compass, FolderOpen, Search } from "lucide-react";
import {
  DockviewLayout,
  FileTree,
  type FileTreeItem,
  type PanelDefinition,
  type TabComponentDefinition,
  type TabInstanceDefinition,
} from "./layout";
import { CodeMirrorEditorTab } from "./layout/CodeMirrorEditorTab";
import "./App.css";

const files: FileTreeItem[] = [
  { id: "1", path: "docs/guide.md" },
  { id: "2", path: "docs/changelog.md" },
  { id: "3", path: "notes/meeting/2026-02-15.md" },
  { id: "4", path: "notes/ideas/product.md" },
  { id: "5", path: "README.md" },
];

function HomeTab(): ReactNode {
  return (
    <div className="editor-tab-view">
      <h2>ofive 工作区</h2>
      <p>主区域由 dockview 官方 React 适配驱动，支持可插拔的 tab 组件。</p>
    </div>
  );
}

function createFileTab(item: FileTreeItem): TabInstanceDefinition {
  const fileName = item.path.split("/").pop() ?? item.path;
  return {
    id: `file:${item.id}`,
    title: fileName,
    component: "codemirror",
    params: {
      path: item.path,
      content: `# ${fileName}\n\n这里是 ${item.path} 的示例内容。\n\n你可以直接在这个 Tab 中编辑文本。`,
    },
  };
}

function App() {
  const filesIcon = <FolderOpen size={18} strokeWidth={1.8} />;
  const searchIcon = <Search size={18} strokeWidth={1.8} />;
  const outlineIcon = <Compass size={18} strokeWidth={1.8} />;

  const panels = useMemo<PanelDefinition[]>(
    () => [
      {
        id: "files",
        title: "资源管理器",
        icon: filesIcon,
        position: "left",
        order: 1,
        activityId: "files",
        activityTitle: "资源管理器",
        activityIcon: filesIcon,
        activitySection: "top",
        render: ({ openTab }) => (
          <FileTree
            items={files}
            onOpenFile={(item) => {
              openTab(createFileTab(item));
            }}
          />
        ),
      },
      {
        id: "search",
        title: "搜索",
        icon: searchIcon,
        position: "left",
        order: 2,
        activityId: "search",
        activityTitle: "搜索",
        activityIcon: searchIcon,
        activitySection: "top",
        render: () => (
          <div className="panel-placeholder">
            <h3>搜索面板</h3>
            <p>在这里接入全文检索能力。</p>
          </div>
        ),
      },
      {
        id: "outline",
        title: "大纲",
        icon: outlineIcon,
        position: "right",
        order: 1,
        render: ({ activeTabId }) => (
          <div className="panel-placeholder">
            <h3>文档大纲</h3>
            <p>当前激活 Tab: {activeTabId ?? "无"}</p>
          </div>
        ),
      },
    ],
    [filesIcon, searchIcon, outlineIcon],
  );

  const tabComponents = useMemo<TabComponentDefinition[]>(
    () => [
      { key: "home", component: HomeTab },
      { key: "codemirror", component: CodeMirrorEditorTab },
    ],
    [],
  );

  const initialTabs = useMemo<TabInstanceDefinition[]>(
    () => [
      {
        id: "home",
        title: "首页",
        component: "home",
      },
    ],
    [],
  );

  return (
    <DockviewLayout
      panels={panels}
      tabComponents={tabComponents}
      initialTabs={initialTabs}
      initialActivePanelId="files"
    />
  );
}

export default App;
