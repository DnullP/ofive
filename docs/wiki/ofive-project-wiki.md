---
title: "ofive 项目 Wiki"
kind: "wiki-index"
status: "active"
updated: "2026-04-27"
owners:
  - "maintainers"
tags:
  - "ofive"
  - "wiki"
  - "documentation"
  - "knowledge-base"
concepts:
  - "项目知识库"
  - "概念词条"
  - "治理视图"
related:
  - "ofive-concept-glossary"
  - "ofive-component-glossary"
  - "ofive-module-glossary"
  - "ofive-architecture-overview"
  - "ofive-atomic-term-model"
---

# ofive 项目 Wiki

本 wiki 是 ofive 的项目知识库。它只记录概念、架构、设计和治理说明，不承担源码目录、测试路径或文件索引职责。需要定位实现时，先通过这里理解概念边界，再回到普通开发文档和本地检索工具。

## 入口

- [[ofive-concept-glossary|核心概念词条]]
- [[ofive-component-glossary|核心组件词条]]
- [[ofive-module-glossary|后端模块词条]]
- [[ofive-atomic-term-model|原子词条模型]]
- [[ofive-architecture-overview|架构总览]]
- [[ofive-maintainer-dashboard|维护者管理视图]]
- [[ofive-documentation-map|文档地图]]

## 主题

- [[ofive-frontend-runtime|前端运行时]]
  - [[ofive-plugin-runtime|Plugin Runtime]]
  - [[ofive-extension-registry|Extension Registry]]
  - [[ofive-workbench-host|Workbench Host]]
  - [[ofive-app-event-bus|App Event Bus]]
  - [[ofive-managed-store|Managed Store]]
- [[ofive-plugin-system|插件系统]]
- [[ofive-vault-and-query-index|Vault 与查询索引]]
  - [[ofive-content-source-of-truth|Content Source of Truth]]
  - [[ofive-derived-view|Derived View]]
  - [[ofive-vault-search|Vault Search]]
  - [[ofive-outline|Outline]]
- [[ofive-markdown-editor|Markdown 编辑器]]
- [[ofive-feature-owner-map|功能责任地图]]
- [[ofive-backend-module-platform|后端模块平台]]
- [[ofive-ai-sidecar-and-capabilities|AI Sidecar 与 Capability]]
- [[ofive-semantic-index|语义索引]]
- [[ofive-build-and-dev-workflow|构建与开发治理]]
- [[ofive-testing-and-ci|测试与质量治理]]
- [[ofive-wiki-authoring-guide|Wiki 维护规范]]

## 使用原则

1. 每个 wiki 页面应解释一个稳定主题，复杂主题应按 [[ofive-atomic-term-model|Atomic Term Model]] 拆成可链接词条。
2. 词条页面应回答“是什么、为什么存在、与谁相连、维护时注意什么”。
3. 概念关系使用 wikilink 表达，便于在 ofive 中形成知识图谱。
4. 具体实现入口、命令和测试锚点放在专项开发文档，不放在 wiki。
