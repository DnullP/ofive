---
title: "ofive Workbench Host"
kind: "architecture-term"
status: "active"
updated: "2026-04-27"
owners:
  - "frontend"
tags:
  - "ofive"
  - "frontend"
  - "workbench"
  - "layout"
  - "host"
concepts:
  - "工作台投影"
  - "布局恢复"
  - "上下文注入"
  - "Tab 实例"
  - "Panel 渲染"
related:
  - "ofive-frontend-runtime"
  - "ofive-extension-registry"
  - "ofive-plugin-runtime"
  - "ofive-app-event-bus"
  - "ofive-managed-store"
  - "ofive-workbench-projection"
  - "ofive-workbench-context"
  - "ofive-layout-restoration"
---

# ofive Workbench Host

Workbench Host 是前端注册贡献与工作台布局之间的适配层。它负责把 [[ofive-extension-registry|Extension Registry]] 中的 activity、panel、tab component、overlay 和 file opener 投影成用户可操作的工作台。

它不拥有业务数据，也不替代插件。它负责 [[ofive-workbench-projection|Workbench Projection]]、[[ofive-workbench-context|Workbench Context]]、打开文件、激活 tab、侧边栏状态、内容首开展示和 [[ofive-layout-restoration|Layout Restoration]] 等宿主职责。

## 核心职责

1. 订阅注册表快照。
2. 将 activity 和 panel 转换成侧边栏和活动栏定义。
3. 将 tab component 转换成主工作区可渲染类型。
4. 将 file opener 解析结果打开为 tab 实例。
5. 注入宿主上下文，让插件可以请求打开 tab、创建文件、激活面板或关闭自身。
6. 维护工作台布局恢复、侧边栏可见性和活动状态。
7. 渲染 overlay，并确保它们不破坏主工作台结构。

## [[ofive-workbench-projection|投影边界]]

Workbench Host 的关键边界是“投影而不拥有”。

它可以决定某个注册贡献如何显示，但不应决定插件业务状态的真实含义。它可以持久化布局，但不应持久化插件私有数据。它可以打开 Markdown、画布、图片或设置页，但不应把这些内容解析逻辑放进布局层。

## [[ofive-workbench-context|上下文注入]]

Workbench Host 会为 panel 和 tab 提供上下文。上下文代表宿主能力，例如打开内容、关闭当前实例、设置激活状态、标记首屏内容已准备好。

治理要点：上下文应表达宿主动作，而不是泄露布局引擎细节。插件使用上下文时，应把它当成能力接口，而不是直接操控布局内部状态。

## [[ofive-layout-restoration|布局恢复]]

Workbench Host 需要把用户的工作台布局恢复到上次状态，同时处理注册贡献变化带来的缺口。

典型场景包括：

1. 插件仍存在，恢复对应 tab 和 panel。
2. 插件不存在，跳过失效贡献。
3. 注册贡献变更，使用稳定标识重新匹配。
4. 用户关闭或移动面板后，保存新的布局偏好。

治理要点：布局恢复只能恢复“界面状态”，不能假设业务数据仍然有效。Vault 切换、插件卸载和配置变化都可能使旧布局部分失效。

## 与文件打开的关系

Workbench Host 不直接判断每种文件如何打开。文件打开请求先交给 [[ofive-extension-registry|Extension Registry]] 中的 File Opener，再由 opener 解析成 tab 定义，最后由 Workbench Host 打开实例。

治理要点：新增文件类型时，应新增或更新 File Opener，而不是把文件类型判断塞进工作台布局层。

## 与事件的关系

Workbench Host 可以响应 [[ofive-app-event-bus|App Event Bus]] 的语义事件，也可以在用户操作后发布宿主事件。但它不应把事件总线当成布局状态的唯一事实源。

布局事实源应留在工作台状态，业务事实源应留在对应插件或 Managed Store。

## 与其他词条的关系

- [[ofive-extension-registry|Extension Registry]]：提供可投影的扩展描述。
- [[ofive-plugin-runtime|Plugin Runtime]]：确保插件贡献在正确生命周期注册和注销。
- [[ofive-app-event-bus|App Event Bus]]：提供后端、编辑器和业务刷新语义。
- [[ofive-managed-store|Managed Store]]：提供可治理的共享状态和设置贡献。

## 维护检查

1. 新增工作台能力时，判断它是布局能力、业务能力还是插件能力。
2. 新增上下文动作时，确保动作语义稳定，不暴露布局引擎私有细节。
3. 修改布局恢复时，验证插件缺失、Vault 切换和注册贡献变更。
4. 修改文件打开流程时，优先检查 File Opener 边界是否仍然清晰。
5. 修改 overlay 行为时，确认焦点、关闭和层级关系不会影响主工作区。

## 反模式

- Workbench Host 直接持有插件业务状态。
- 工作台布局层解析具体 Markdown 语义。
- 插件绕过上下文直接操作布局内部结构。
- 布局恢复假设所有历史插件都仍然可用。
- 文件类型打开策略散落在多个工作台分支中。
