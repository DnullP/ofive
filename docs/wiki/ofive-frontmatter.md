---
title: "ofive Frontmatter"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "maintainers"
  - "backend"
tags:
  - "ofive"
  - "frontmatter"
  - "metadata"
concepts:
  - "结构化元数据"
  - "字段治理"
  - "查询属性"
related:
  - "ofive-note"
  - "ofive-frontmatter-query"
  - "ofive-wiki-authoring-guide"
  - "ofive-query-index"
---

# ofive Frontmatter

Frontmatter 是笔记开头的结构化元数据。它用于表达标题、状态、标签、负责人、分类、更新时间和其他可查询属性。

## 边界

Frontmatter 是内容的一部分，不是应用配置。它描述当前笔记，而不是控制整个应用行为。

Frontmatter 也不是自由注释区。字段越稳定，查询和治理视图越可靠。

## 关系

- [[ofive-note|Note]] 通过 Frontmatter 获得结构化描述。
- [[ofive-frontmatter-query|Frontmatter Query]] 负责基于字段进行查询。
- [[ofive-query-index|Query Index]] 可维护 Frontmatter 的派生读模型。
- [[ofive-wiki-authoring-guide|Wiki 维护规范]] 定义 wiki 文档中的字段使用习惯。

## 维护要点

1. 新增字段前应判断是否具有长期治理价值。
2. 字段命名应稳定，避免同义字段并存。
3. 字段值应尽量结构化，便于查询和聚合。
4. 删除字段前应评估依赖它的查询、图谱和维护视图。
