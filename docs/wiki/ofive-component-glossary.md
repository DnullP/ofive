---
title: "ofive 核心组件词条"
kind: "glossary"
status: "active"
updated: "2026-04-27"
owners:
  - "frontend"
  - "maintainers"
tags:
  - "ofive"
  - "component"
  - "frontend"
  - "glossary"
concepts:
  - "Activity"
  - "Panel"
  - "Tab"
  - "Overlay"
  - "Event Bus"
  - "Managed Store"
related:
  - "ofive-atomic-term-model"
  - "ofive-frontend-runtime"
  - "ofive-plugin-system"
  - "ofive-markdown-editor"
  - "ofive-plugin-runtime"
  - "ofive-workbench-host"
  - "ofive-app-event-bus"
  - "ofive-managed-store"
---

# ofive 核心组件词条

本页是前端宿主和插件系统的组件索引。每个组件的详细边界和维护规则在对应原子词条中说明。

## 工作台组件

- [[ofive-activity|Activity]]：工作台上的功能入口。
- [[ofive-panel|Panel]]：侧边栏中的功能面板。
- [[ofive-tab|Tab]]：主工作区中的内容实例。
- [[ofive-overlay|Overlay]]：覆盖在工作台之上的临时交互层。
- [[ofive-file-opener|File Opener]]：文件类型到 Tab 的打开策略。

## 交互组件

- [[ofive-command|Command]]：可被快捷键、命令面板、按钮或插件触发的用户意图。
- [[ofive-app-event-bus|Event Bus]]：前端语义事件分发层。
- [[ofive-backend-event-bridge|Backend Event Bridge]]：后端宿主事件的前端单点桥接。
- [[ofive-editor-event|Editor Event]]：Markdown 编辑器产生的编辑语义。
- [[ofive-business-refresh-event|Business Refresh Event]]：读型组件刷新和派生视图失效语义。
- [[ofive-event-subscription|Event Subscription]]：事件消费者的订阅和清理关系。
- [[ofive-settings-surface|Settings Surface]]：系统和插件暴露配置能力的统一入口。

## 状态组件

- [[ofive-managed-store|Managed Store]]：带治理元数据的前端状态 owner。
- [[ofive-store-owner|Store Owner]]：共享状态的事实源归属。
- [[ofive-state-scope|State Scope]]：状态有效范围。
- [[ofive-state-schema|State Schema]]：共享状态字段和动作契约。
- [[ofive-state-flow|State Flow]]：共享状态变化路径。
- [[ofive-store-contribution|Store Contribution]]：store 向宿主暴露的设置或治理能力。

## 内容组件

- [[ofive-markdown-editor|Markdown Editor]]：笔记编辑和阅读体验的核心组件。

## 插件生命周期组件

- [[ofive-plugin-discovery|Plugin Discovery]]：建立候选插件集合。
- [[ofive-plugin-activation|Plugin Activation]]：执行插件入口并接收贡献。
- [[ofive-plugin-failure-isolation|Plugin Failure Isolation]]：隔离单个插件失败。
- [[ofive-plugin-hot-reload|Plugin Hot Reload]]：开发期替换插件实现。
- [[ofive-plugin-cleanup|Plugin Cleanup]]：撤销插件副作用。

## 使用规则

1. 组件词条只解释用户界面或运行时组件。
2. 业务概念应放入 [[ofive-concept-glossary|核心概念词条]]。
3. 后端模块应放入 [[ofive-module-glossary|后端模块词条]]。
