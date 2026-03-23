# ofive 插件开发教程

> 如果你在做的是完整功能扩展，而不是单纯的前端插件实现，请先看总流程文档：`docs/feature-extension-workflow.md`。

本文面向当前仓库的前端插件系统，目标是回答三个问题：

1. 插件是怎么被加载的。
2. 插件可以扩展哪些能力。
3. 写一个可维护、可调试、能和现有状态/事件/接口协作的插件，推荐怎么做。

本文以当前项目中的两个真实样板为参考：

1. [src/plugins/outlinePlugin.tsx](../src/plugins/outlinePlugin.tsx)
2. [src/plugins/architectureDevtoolsPlugin.tsx](../src/plugins/architectureDevtoolsPlugin.tsx)

## 1. 插件系统概览

当前项目的插件系统采用“自动发现 + 插件运行时激活”模式。

插件加载入口在 [src/main.tsx](../src/main.tsx)：

```ts
await startDiscoveredPlugins();
```

这意味着：

1. `src/plugins/` 下匹配 `*Plugin.ts` / `*Plugin.tsx` 的入口文件会被插件运行时自动发现。
2. 插件不需要在别处手动 `import`。
3. 入口模块应导出 `activatePlugin()`，由运行时负责激活、卸载与 HMR 重载。

推荐把插件理解成“入口文件”。入口文件的职责通常只有两类：

1. 注册 UI 扩展点，例如 activity、panel、tab。
2. 注册插件自己的架构元数据、i18n 资源、日志入口，并返回清理函数。

## 2. 一个重要约束

`src/plugins/` 目录是插件入口自动扫描目录，所以不要把以下内容直接放进这里：

1. 测试文件。
2. 纯工具模块。
3. 只想被插件入口调用、不想自动执行的 helper 文件。

正确做法是：

1. 插件入口文件放在 `src/plugins/`。
2. 插件内部的 helper、model、view、test 放到其他目录。

当前仓库里的架构 DevTools 插件就是这样组织的：

1. 入口文件在 [src/plugins/architectureDevtoolsPlugin.tsx](../src/plugins/architectureDevtoolsPlugin.tsx)
2. 实际实现放在 [src/devtools/architecture/](../src/devtools/architecture)

如果把 helper 文件也放进 `src/plugins/`，它们可能被误识别为插件入口，或者在后续重构时重新进入自动扫描范围。

### 2.1 当前插件入口约定

当前推荐写法：

```ts
export function activatePlugin(): () => void {
    const disposeA = registerSomething();
    const disposeB = registerSomethingElse();

    return () => {
        disposeB();
        disposeA();
    };
}
```

不要再依赖“模块一导入就直接顶层执行注册副作用”的模式。当前仓库已经有统一插件运行时，插件入口应把生命周期显式交给运行时管理。

## 3. 当前支持的扩展点

### 3.1 Activity

activity 是左侧或右侧 icon bar 上的图标入口，注册中心在：

1. [src/host/registry/activityRegistry.ts](../src/host/registry/activityRegistry.ts)

当前支持两种 activity：

1. `panel-container`
2. `callback`

`panel-container` 适合“点击图标后显示一组侧边栏面板”的场景。

```ts
registerActivity({
    type: "panel-container",
    id: "outline",
    title: () => i18n.t("outlinePlugin.title"),
    icon: React.createElement(Compass, { size: 18, strokeWidth: 1.8 }),
    defaultSection: "top",
    defaultBar: "right",
    defaultOrder: 4,
});
```

`callback` 适合“点击图标后直接做动作”的场景，例如打开一个 tab：

```ts
registerActivity({
    type: "callback",
    id: "architecture-devtools",
    title: () => i18n.t("architectureDevtools.title"),
    icon: <Workflow size={18} strokeWidth={1.8} />,
    defaultSection: "top",
    defaultBar: "left",
    defaultOrder: 5,
    onActivate: (context) => {
        context.openTab({
            id: "architecture-devtools",
            title: i18n.t("architectureDevtools.title"),
            component: "architecture-devtools",
        });
    },
});
```

### 3.2 Panel

panel 是侧边栏面板，注册中心在：

1. [src/host/registry/panelRegistry.ts](../src/host/registry/panelRegistry.ts)

panel 必须归属于一个 `activityId`：

```ts
registerPanel({
    id: "outline",
    title: () => i18n.t("outlinePlugin.title"),
    activityId: "outline",
    defaultPosition: "right",
    defaultOrder: 1,
    render: () => React.createElement(OutlinePanelPlugin),
});
```

`render` 会收到 `PanelRenderContext`，常用能力有：

1. `openTab`
2. `closeTab`
3. `setActiveTab`
4. `requestMoveFileToDirectory`

如果你的 panel 需要点击某项后在主区打开文件或新 tab，应通过这里的 `context.openTab` 完成，而不是直接操作 Dockview 内部实现。

### 3.3 Tab Component

tab 组件注册中心在：

1. [src/host/registry/tabComponentRegistry.ts](../src/host/registry/tabComponentRegistry.ts)

注册的是“组件类型”，而不是某个具体实例：

```ts
registerTabComponent({
    id: "architecture-devtools",
    component: ArchitectureDevtoolsTab,
});
```

后续任何地方都可以通过 `openTab` 打开该组件：

```ts
context.openTab({
    id: "architecture-devtools",
    title: i18n.t("architectureDevtools.title"),
    component: "architecture-devtools",
});
```

## 4. 推荐的插件目录组织

推荐结构：

```text
src/
  plugins/
    myFeaturePlugin.tsx
  my-feature/
    MyFeaturePanel.tsx
    myFeatureStore.ts
    myFeature.css
    myFeature.test.ts
```

也可以像架构 DevTools 一样：

```text
src/
  plugins/
    architectureDevtoolsPlugin.tsx
  devtools/
    architecture/
      ArchitectureDevtoolsTab.tsx
      architectureRegistry.ts
      architectureModel.ts
      architectureRegistry.test.ts
```

原则只有一个：

1. 真正需要自动执行的入口文件放进 `src/plugins/`
2. 其他东西放在自动扫描目录之外

## 5. 第一个插件：内容型读插件

当前最成熟的插件样板是 [src/plugins/outlinePlugin.tsx](../src/plugins/outlinePlugin.tsx)。

它展示了一个内容型读插件的完整链路：

1. 注册 i18n 文案。
2. 注册 activity。
3. 注册 panel。
4. 读取当前活跃文件。
5. 订阅持久态更新事件。
6. 调用后端接口获取结构化数据。
7. 点击面板条目后，发出编辑器导航事件。

### 5.1 读取当前活跃文件

推荐优先读取：

1. [src/host/store/activeEditorStore.ts](../src/host/store/activeEditorStore.ts)

典型用法：

```ts
const activeEditor = useActiveEditor();

if (!activeEditor?.path) {
    return;
}
```

这里的语义是“当前活跃的 Markdown 编辑器是谁”，很适合跟随型插件，比如：

1. outline
2. backlinks
3. 未来的 search result preview
4. future diagnostics panel

### 5.2 订阅持久态更新

推荐监听：

1. [src/events/appEventBus.ts](../src/events/appEventBus.ts) 中的 `persisted.content.updated`

典型用法：

```ts
useEffect(() => {
    const currentPath = activeEditor?.path;
    if (!currentPath) {
        return;
    }

    const unlisten = subscribePersistedContentUpdatedEvent((event) => {
        if (event.relativePath !== currentPath) {
            return;
        }
        loadSomething(currentPath);
    });

    return unlisten;
}, [activeEditor?.path, loadSomething]);
```

为什么推荐订阅这个事件，而不是直接消费底层 `vault.fs`：

1. `persisted.content.updated` 是更高层的语义事件。
2. 它屏蔽了“保存成功”和“外部文件变更”在底层来源上的差异。
3. 对读型插件来说，语义更稳定。

### 5.3 优先走 `vaultApi`

前端调用后端能力时，优先通过：

1. [src/api/vaultApi.ts](../src/api/vaultApi.ts)

例如：

```ts
const result = await getVaultMarkdownOutline(relativePath);
```

不要默认在插件里直接 `invoke("some_command")`，除非：

1. 该能力确实还没有在 `vaultApi.ts` 中封装。
2. 这是非常局部的插件试验。

更推荐的做法是先把接口补到 `vaultApi.ts`，这样：

1. 浏览器 fallback 逻辑可以统一处理。
2. 类型定义只维护一份。
3. 前端调用方式更一致。

## 6. 第二个插件：工具型 tab 插件

工具型插件的典型样板是：

1. [src/plugins/architectureDevtoolsPlugin.tsx](../src/plugins/architectureDevtoolsPlugin.tsx)

这个样板适合：

1. DevTools
2. 监控中心
3. 可视化页面
4. 大型设置界面

它的特点是：

1. 入口是一个 callback activity。
2. 点击后直接打开 tab。
3. 核心界面逻辑不放在 `src/plugins/` 里，而是放在专门目录。

推荐流程：

1. 写 tab 组件。
2. 用 `registerTabComponent` 注册组件类型。
3. 用 `registerActivity({ type: "callback" })` 注册入口。
4. 在 `onActivate` 里调用 `openTab`。

## 7. 插件开发中的状态、事件、接口建议

### 7.1 状态建议

根据当前项目的设计，推荐优先使用这些公开状态入口：

1. `useActiveEditor`：当前活跃 Markdown 编辑器
2. `useVaultState`：当前 vault 路径与树状态
3. `useConfigState`：仓库级配置与 feature flag
4. `useThemeState`：主题模式
5. `useShortcutState`：快捷键映射

建议：

1. 读型插件优先读公开 store，不要依赖布局内部局部 state。
2. 如果插件只需要“当前活跃文件”，优先用 `activeEditorStore`，不要直接依赖 Dockview。
3. 如果插件需要缓存自己的业务状态，单独建 store，不要硬塞进已有 store。

### 7.2 事件建议

推荐使用 [src/events/appEventBus.ts](../src/events/appEventBus.ts) 里的语义化事件。

当前常用事件包括：

1. `persisted.content.updated`
2. `editor.content.changed`
3. `editor.focus.changed`
4. `editor.rename.requested`
5. `editor.reveal.requested`
6. `vault.fs`
7. `vault.config`

建议：

1. 读型插件优先订阅高层语义事件。
2. 不要默认直接订阅底层文件系统事件。
3. 发事件时，尽量用已有事件，不要随便新增近义事件。

### 7.3 接口建议

推荐把插件需求分成三层：

1. 文件读写层：走 `vaultApi`
2. 事件层：走 `appEventBus`
3. UI 注册层：走 registry

如果一个插件需要补新的后端能力，推荐开发顺序：

1. 后端新增 Tauri command
2. `src/api/vaultApi.ts` 增加前端封装和类型
3. 插件消费 `vaultApi`

## 8. i18n、日志、样式的推荐写法

### 8.1 i18n

插件应自带文案，不要每次都去改全局 locale 文件。

推荐做法：

```ts
i18n.addResourceBundle("zh", "translation", {
    myPlugin: {
        title: "我的插件",
    },
}, true, true);
```

这样插件可以自包含，迁移和删除都更简单。

### 8.2 日志

前端日志会经过 [src/utils/frontendLogBridge.ts](../src/utils/frontendLogBridge.ts) 桥接到后端日志系统，所以插件要认真打日志。

至少建议记录：

1. 注册成功
2. 数据加载开始
3. 数据加载成功
4. 数据加载失败
5. 关键用户操作
6. 空值和降级处理

例如：

```ts
console.info("[outlinePlugin] loading outline for", { relativePath });
console.error("[outlinePlugin] failed to load outline", { relativePath, error: message });
```

### 8.3 样式

项目当前要求 CSS 和使用位置具备注释说明。推荐为插件单独建一个 CSS 文件，并保持“一个插件入口，对应一个样式文件或样式目录”。

例如：

1. [src/plugins/outlinePlugin.css](../src/plugins/outlinePlugin.css)
2. [src/devtools/architecture/architectureDevtools.css](../src/devtools/architecture/architectureDevtools.css)

## 9. 推荐的插件开发流程

### 9.1 做一个侧边栏插件

步骤如下：

1. 在 `src/plugins/` 新建入口文件 `myPlugin.tsx`
2. 在模块顶层注册 i18n 文案
3. 实现 panel 组件
4. 调用 `registerActivity`
5. 调用 `registerPanel`
6. 使用公开 store、事件和 `vaultApi` 衔接逻辑
7. 打必要日志
8. 为 CSS 写注释

最小示例：

```tsx
import React from "react";
import { Star } from "lucide-react";
import i18n from "../i18n";
import { registerActivity } from "../registry/activityRegistry";
import { registerPanel } from "../registry/panelRegistry";

i18n.addResourceBundle("zh", "translation", {
    myPlugin: {
        title: "示例插件",
    },
}, true, true);

function MyPanel(): React.ReactNode {
    return <div>hello plugin</div>;
}

registerActivity({
    type: "panel-container",
    id: "my-plugin",
    title: () => i18n.t("myPlugin.title"),
    icon: React.createElement(Star, { size: 18, strokeWidth: 1.8 }),
    defaultSection: "top",
    defaultBar: "right",
    defaultOrder: 20,
});

registerPanel({
    id: "my-plugin-panel",
    title: () => i18n.t("myPlugin.title"),
    activityId: "my-plugin",
    defaultPosition: "right",
    defaultOrder: 1,
    render: () => React.createElement(MyPanel),
});
```

### 9.2 做一个打开 tab 的工具插件

步骤如下：

1. 在非 `src/plugins/` 目录实现 tab 组件
2. 在 `src/plugins/` 里写入口文件
3. 注册 `registerTabComponent`
4. 注册 `callback activity`
5. 点击图标时 `openTab`

## 10. 调试与验证

### 10.1 本地运行

前端联调：

```bash
bun run web:dev
```

桌面容器联调：

```bash
bun run tauri dev
```

### 10.2 验证插件是否被加载

最直接的方法：

1. 看 activity icon 是否出现
2. 看浏览器控制台或后端日志里有没有插件注册日志

建议插件入口至少打印一条：

```ts
console.info("[myPlugin] registered");
```

### 10.3 类型检查

```bash
bunx tsc --noEmit
```

如果你新增了纯前端逻辑，至少确保你的插件文件没有新错误。

### 10.4 单元测试

如果插件有纯函数、注册中心或数据转换逻辑，建议直接补 `bun test`。

例如架构注册中心测试：

```bash
bun test src/devtools/architecture/architectureRegistry.test.ts
```

## 11. 进阶：让插件进入架构可视化中心

如果你的插件希望被 Architecture DevTools 展示，可以注册一个 architecture slice。

入口 API 在：

1. [src/devtools/architecture/architectureRegistry.ts](../src/devtools/architecture/architectureRegistry.ts)

示例：

```ts
registerArchitectureSlice({
    id: "my-plugin-architecture",
    title: "My Plugin",
    nodes: [
        {
            id: "plugin:my-plugin",
            title: "myPlugin",
            kind: "plugin",
            summary: "示例插件",
        },
    ],
    edges: [],
});
```

这样你的插件可以进入架构 DAG，帮助后续排查依赖关系和插件边界。

## 12. 常见错误

### 错误一：helper 文件也放进 `src/plugins/`

后果：

1. helper 被自动执行
2. 测试文件被自动执行
3. 模块顶层副作用在启动时被误触发

解决：

1. 只把入口文件放进 `src/plugins/`

### 错误二：直接依赖布局内部实现

后果：

1. 插件和 Dockview 细节耦合
2. 布局重构时插件容易失效

解决：

1. 优先使用 registry、store、event bus、vaultApi 这些公开入口

### 错误三：读型插件混用草稿态和持久态

后果：

1. 不同面板对同一篇笔记展示结果不一致
2. 保存前后行为难以预测

解决：

1. 默认以持久态为准
2. 通过 `persisted.content.updated` 刷新
3. 只有明确需要读取 draft 时，才额外接入编辑器态

## 13. 开发检查清单

提交前建议自查：

1. 插件入口是否只放在 `src/plugins/`
2. 是否使用 registry 完成 UI 注册
3. 是否优先走 `vaultApi` 而不是散落的 `invoke`
4. 是否有清晰日志
5. 是否有 i18n 文案
6. CSS 和组件使用位置是否有必要注释
7. 是否避免直接依赖布局内部细节
8. 是否补了最小测试或至少做了类型检查

## 14. 推荐起步模板

如果你要新增一个插件，最推荐的起步方式不是从零写，而是复制一个最接近的样板：

1. 做跟随当前文件的侧边栏插件：复制 [src/plugins/outlinePlugin.tsx](../src/plugins/outlinePlugin.tsx)
2. 做打开工具页面的插件：参考 [src/plugins/architectureDevtoolsPlugin.tsx](../src/plugins/architectureDevtoolsPlugin.tsx)

当前仓库的插件系统还在持续演进，但这两类样板已经足够支撑绝大多数新插件开发。