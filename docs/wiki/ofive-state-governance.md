---
title: "ofive State Governance"
kind: "architecture-term"
status: "active"
updated: "2026-05-29"
owners:
  - "frontend"
  - "backend"
  - "maintainers"
tags:
  - "ofive"
  - "state"
  - "sync"
  - "editor"
  - "index"
concepts:
  - "前端状态一致性"
  - "前后端同步"
  - "索引一致性"
  - "会话生命周期"
related:
  - "ofive-managed-store"
  - "ofive-content-source-of-truth"
  - "ofive-app-event-bus"
  - "ofive-event-subscription"
  - "ofive-sync-status"
---

# ofive State Governance

State Governance 是 ofive 对编辑、阅读、检索和 AI 会话体验的一致性模型。它把状态问题拆成三层：

1. 前端状态与 UI 组件一致性。
2. 前端状态与后端文件系统一致性。
3. 后端文件系统与查询/语义索引一致性。

## 前端状态与 UI

用户体验一致性优先由前端 store 维护。编辑器内容、活跃编辑器、outline、AI chat runtime 等状态不能由 sidebar panel 或 tab component 的 mount lifecycle 决定。

治理规则：

1. 一个共享状态只有一个 owner store。
2. 组件消费 snapshot/subscribe/hook，不直接拥有同一份业务事实。
3. 面板、activity、tab 切换不应触发会话中断、outline 重载、草稿丢失或编辑缓冲区覆盖。
4. 需要维护者审计的状态通过 [[ofive-managed-store|Managed Store]] 注册 schema、flow 和测试锚点。

## 前后端同步

前端编辑态和后端文件系统通过受控保存、事件和去回环 trace 保持一致。

治理规则：

1. 保存走 `persistedMarkdownContentSync` 或受控 mutation service。
2. 本地写入带 `sourceTraceId`，watcher 回来的自触发事件不应造成内容 reload 循环。
3. 读型插件消费 `persisted.content.updated`，优先用前端 canonical Markdown 内容快照派生 UI；缺失时才 fallback 到后端读取。
4. 外部文件变化可以刷新缓存，但是否覆盖正在编辑的内容由编辑器 owner 决定。

## 文件系统与索引

检索高效性由后端文件系统和索引一致性保证。查询索引、语义索引、图谱和任务投影都不是内容事实源。

治理规则：

1. 文件系统是内容事实源，索引是可重建派生物。
2. 重命名、移动、删除、外部变更后，索引 owner 需要能增量更新或自修复。
3. 依赖索引的功能不要假设保存 command 成功等于索引已完成；需要显式读取稳定 query 或订阅同步状态。

## 功能分类

用户体验一致性功能：

- 编辑器内容、视图状态、scroll/reveal、outline、AI chat session/runtime、草稿、布局恢复。
- 这类功能要求前端有稳定状态 owner，组件重挂不能改变事实。

检索高效性功能：

- 搜索、backlinks、frontmatter 查询、任务看板、知识图谱、语义索引。
- 这类功能要求后端索引和 query contract 稳定，前端用 canonical 内容覆盖打开文档的局部新鲜度。

## Guard And Tests

- `scripts/check-store-state-tests.mjs`：确保 Managed Store schema、action、flow 和 failure mode 都有测试锚点。
- `scripts/check-persisted-content-guards.mjs`：阻止业务代码绕过受控持久内容 mutation。
- `scripts/check-event-subscription-guards.mjs`：阻止 UI 组件直接订阅后端事件或 stream。
- Playwright e2e 应覆盖面板切换、组件重挂、vault switch、split editor、autosave/external update 和 stream remount。
