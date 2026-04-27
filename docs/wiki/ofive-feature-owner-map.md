---
title: "ofive 功能责任地图"
kind: "governance"
status: "active"
updated: "2026-04-27"
owners:
  - "maintainers"
tags:
  - "ofive"
  - "owner"
  - "governance"
concepts:
  - "功能 owner"
  - "责任边界"
related:
  - "ofive-component-glossary"
  - "ofive-module-glossary"
  - "ofive-maintainer-dashboard"
  - "ofive-feature-owner"
  - "ofive-risk-surface"
---

# ofive 功能责任地图

本页按能力域说明 owner，而不是列实现路径。它用于变更前判断责任边界。

## 功能域

| 能力域 | 主要 owner | 责任说明 |
| --- | --- | --- |
| [[ofive-file-tree|File Tree]] | Vault + 前端插件 | 展示知识库结构、创建和管理内容入口 |
| [[ofive-markdown-editor|Markdown Editor]] | Markdown 编辑器 | 编辑态、阅读态、语法渲染和编辑事件 |
| [[ofive-vault-search|Vault Search]] | Vault 查询 | 文件名、正文、标签和结构化结果 |
| [[ofive-outline|Outline]] | Markdown 查询 | 当前文档结构提取和导航 |
| [[ofive-backlinks|Backlinks]] | 查询索引 | 当前文档的反向引用 |
| [[ofive-knowledge-graph|Knowledge Graph]] | 查询索引 + 可视化插件 | 笔记关系图谱和交互视图 |
| [[ofive-canvas|Canvas]] | Canvas 插件 + Vault | 画布文档编辑和保存 |
| [[ofive-task-board|Task Board]] | 任务插件 + Vault 查询 | 任务语法聚合和看板视图 |
| [[ofive-calendar|Calendar]] | 日历插件 | 日期视图和相关笔记入口 |
| [[ofive-ai-chat|AI Chat]] | AI 模块 + sidecar | 会话、流式输出、工具调用和确认流程 |
| [[ofive-semantic-search|Semantic Search]] | 语义索引 | 向量化、语义召回和 AI 上下文增强 |
| [[ofive-settings-surface|Settings Surface]] | 宿主设置面 | 系统和插件配置入口 |
| [[ofive-command-palette|Command Palette]] | 命令系统 | 用户意图搜索和动作执行 |

## Owner 判断规则

1. 用户界面入口归 [[ofive-plugin|Plugin]] 或宿主组件。
2. 本地内容事实归 [[ofive-content-source-of-truth|Content Source of Truth]]。
3. 派生查询归 [[ofive-query-index|Query Index]] 或 [[ofive-semantic-index|Semantic Index]]。
4. AI 工具归 [[ofive-capability|Capability]] owner。
5. 跨组件状态归 [[ofive-managed-store|Managed Store]]。
6. 跨模块能力归 [[ofive-backend-module-platform|后端模块平台]]治理。

## 文档同步规则

新增能力域时，需要同步：

- 对应概念词条。
- 对应组件词条。
- 对应后端模块词条。
- 维护者管理视图。
