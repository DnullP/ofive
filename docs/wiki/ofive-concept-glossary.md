---
title: "ofive 核心概念词条"
kind: "glossary"
status: "active"
updated: "2026-04-27"
owners:
  - "maintainers"
tags:
  - "ofive"
  - "concept"
  - "glossary"
concepts:
  - "Vault"
  - "Note"
  - "WikiLink"
  - "Frontmatter"
  - "Backlinks"
  - "Capability"
  - "Source of Truth"
  - "Derived View"
related:
  - "ofive-atomic-term-model"
  - "ofive-component-glossary"
  - "ofive-module-glossary"
  - "ofive-vault-and-query-index"
---

# ofive 核心概念词条

本页是核心概念索引。详细定义、边界、关系和维护要点放在各自的原子词条中。

## 知识内容

- [[ofive-local-first-workbench|Local First Workbench]]：本地优先的桌面知识工作台定位。
- [[ofive-vault|Vault]]：本地知识库容器和内容事实源。
- [[ofive-note|Note]]：面向用户的知识单元。
- [[ofive-content-source-of-truth|Content Source of Truth]]：本地内容权威来源。
- [[ofive-derived-view|Derived View]]：从内容事实源计算出的可重建视图。
- [[ofive-wikilink|WikiLink]]：笔记之间的显式语义链接。
- [[ofive-frontmatter|Frontmatter]]：笔记开头的结构化元数据。
- [[ofive-backlinks|Backlinks]]：链接关系的反向视图。
- [[ofive-knowledge-graph|Knowledge Graph]]：笔记关系的图形视图。
- [[ofive-query-index|Query Index]]：面向结构化读取的派生索引。

## 前端扩展

- [[ofive-plugin|Plugin]]：前端功能扩展组织单元。
- [[ofive-workbench|Workbench]]：承载 activity、panel、tab 和 overlay 的工作台框架。
- [[ofive-workbench-projection|Workbench Projection]]：把扩展点描述投影成工作台界面。
- [[ofive-workbench-context|Workbench Context]]：插件使用的宿主能力接口。
- [[ofive-layout-restoration|Layout Restoration]]：恢复工作台界面状态。

## 用户能力

- [[ofive-file-tree|File Tree]]：Vault 内容结构的用户入口。
- [[ofive-vault-search|Vault Search]]：本地知识库搜索能力。
- [[ofive-outline|Outline]]：当前文档标题结构投影。
- [[ofive-canvas|Canvas]]：空间组织的可视化笔记能力。
- [[ofive-task-board|Task Board]]：任务语义聚合视图。
- [[ofive-calendar|Calendar]]：按日期组织内容入口。
- [[ofive-command-palette|Command Palette]]：用户意图搜索和动作执行入口。

## 后端与 AI

- [[ofive-backend-module|Backend Module]]：后端业务能力的治理单元。
- [[ofive-capability|Capability]]：可被受控调用的系统能力描述。
- [[ofive-sidecar|Sidecar]]：独立辅助运行时。
- [[ofive-semantic-index|Semantic Index]]：面向语义检索的派生知识层。

## 使用规则

1. 需要引用概念时，优先链接到原子词条。
2. 本页只作为入口，不重复展开详细定义。
3. 新增核心概念时，应先建立原子词条，再把入口加入本页。
