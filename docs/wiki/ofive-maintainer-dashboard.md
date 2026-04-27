---
title: "ofive 维护者管理视图"
kind: "governance"
status: "active"
updated: "2026-04-27"
owners:
  - "maintainers"
tags:
  - "ofive"
  - "maintenance"
  - "governance"
concepts:
  - "owner"
  - "风险面"
  - "质量门"
related:
  - "ofive-feature-owner-map"
  - "ofive-testing-and-ci"
  - "ofive-documentation-map"
  - "ofive-feature-owner"
  - "ofive-risk-surface"
  - "ofive-quality-gate"
---

# ofive 维护者管理视图

维护者视图回答三个问题：谁拥有这个能力，变更会影响哪些系统，交付时需要补哪些治理材料。

## 管理分区

| 分区 | 主要责任 | 维护关注点 |
| --- | --- | --- |
| 前端宿主 | [[ofive-workbench|Workbench]]、[[ofive-extension-registry|Extension Registry]]、[[ofive-managed-store|Managed Store]] 和 [[ofive-app-event-bus|App Event Bus]] | 保持插件贡献与宿主职责分离 |
| 笔记核心 | [[ofive-vault|Vault]]、[[ofive-markdown-editor|Markdown Editor]]、[[ofive-query-index|Query Index]]、[[ofive-knowledge-graph|Knowledge Graph]] | 保持内容事实源与派生索引一致 |
| 后端平台 | [[ofive-module-contribution|Module Contribution]]、[[ofive-backend-command|Backend Command]]、[[ofive-capability|Capability]]、[[ofive-persistence-owner|Persistence Owner]] | 保持模块边界可验证 |
| AI 能力 | [[ofive-ai-chat|AI Chat]]、[[ofive-sidecar|Sidecar]]、[[ofive-tool-bridge|Tool Bridge]]、[[ofive-semantic-search|Semantic Search]] | 保持 AI 与业务模块之间的受控调用 |
| 工程治理 | [[ofive-build-and-dev-workflow|构建治理]]、[[ofive-testing-and-ci|测试治理]]、[[ofive-documentation-map|文档治理]] | 保持变更有对应 [[ofive-quality-gate|Quality Gate]] |

## 维护 Checklist

1. 变更前先判断 [[ofive-feature-owner|Feature Owner]]，避免跨边界直接改内部实现。
2. 新增用户可见能力时，同步更新 [[ofive-feature-owner-map]]。
3. 新增核心概念时，同步更新 [[ofive-concept-glossary]]。
4. 新增前端组件时，同步更新 [[ofive-component-glossary]]。
5. 新增后端模块或能力时，同步更新 [[ofive-module-glossary]] 和 [[ofive-backend-module-platform]]。
6. 改变质量门或发布流程时，同步更新 [[ofive-testing-and-ci]] 与 [[ofive-build-and-dev-workflow]]。

## 风险面

| 风险面 | 风险描述 | 治理手段 |
| --- | --- | --- |
| [[ofive-content-source-of-truth|Content Source of Truth]] | 编辑器、外部内容变更和索引更新可能语义不一致 | 使用统一持久态事件和索引写路径 |
| [[ofive-exclusion-zone|Exclusion Zone]] | 块级语法与行级语法可能互相污染 | 使用排斥区域和渲染一致性检查 |
| [[ofive-private-boundary|Private Boundary]] | 后端模块可能直接依赖其他模块私有实现 | 使用 manifest、公共面和私有边界模板 |
| [[ofive-tool-bridge|Tool Bridge]] | AI 可能绕过权限和上下文治理 | 使用 capability 目录和执行路由 |
| [[ofive-documentation-map|Documentation Map]] | 设计说明可能落后于系统事实 | 用 wiki 记录概念，用专项文档记录操作流程 |

## 管理输出

一次完整交付至少应回答：

- 这属于哪个概念或模块？
- 用户可见行为是否改变？
- 事实源、派生索引和事件语义是否仍一致？
- 是否需要更新 wiki 词条？
- 是否需要更新专项开发文档？
