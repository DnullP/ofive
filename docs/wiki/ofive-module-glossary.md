---
title: "ofive 后端模块词条"
kind: "glossary"
status: "active"
updated: "2026-04-27"
owners:
  - "backend"
  - "maintainers"
tags:
  - "ofive"
  - "backend"
  - "module"
  - "glossary"
concepts:
  - "后端模块"
  - "模块边界"
  - "模块 owner"
related:
  - "ofive-backend-module-platform"
  - "ofive-ai-sidecar-and-capabilities"
  - "ofive-semantic-index"
  - "ofive-host-platform-module"
  - "ofive-app-storage-module"
  - "ofive-vault-module"
  - "ofive-ai-chat-module"
  - "ofive-semantic-index-module"
  - "ofive-sync-module"
  - "ofive-capability-module"
---

# ofive 后端模块词条

本页定义 ofive 后端的长期模块边界。模块词条描述职责、公共能力和治理约束，不列出实现文件。

## 模块索引

- [[ofive-host-platform-module|Host Platform Module]]：桌面宿主与平台治理。
- [[ofive-app-storage-module|App Storage Module]]：应用级存储资源。
- [[ofive-vault-module|Vault Module]]：本地知识库事实源。
- [[ofive-ai-chat-module|AI Chat Module]]：AI 会话与工具编排。
- [[ofive-semantic-index-module|Semantic Index Module]]：语义检索派生索引。
- [[ofive-sync-module|Sync Module]]：多端同步意图与状态。
- [[ofive-capability-module|Capability Module]]：平台能力目录与执行路由。

## 模块治理

所有后端模块都遵守 [[ofive-backend-module|Backend Module]] 的基本模型：稳定身份、公共面、私有边界、持久化 owner 和能力贡献。

模块之间不通过私有实现互相依赖。需要跨模块协作时，应通过 [[ofive-module-contribution|Module Contribution]]、[[ofive-public-surface|Public Surface]] 或 [[ofive-capability|Capability]] 表达。

## 使用规则

1. 新增模块时，先新增独立模块词条，再更新本页索引。
2. 模块职责变化时，同步更新 [[ofive-backend-module-platform|后端模块平台]]。
3. 模块新增 AI 可调用能力时，同步更新 [[ofive-capability-catalog|Capability Catalog]] 和 [[ofive-ai-sidecar-and-capabilities|AI Sidecar 与 Capability]]。
