---
title: "ofive Wiki 维护规范"
kind: "documentation-guide"
status: "active"
updated: "2026-04-27"
owners:
  - "maintainers"
tags:
  - "ofive"
  - "wiki"
  - "frontmatter"
  - "wikilink"
concepts:
  - "词条写作"
  - "frontmatter"
  - "wikilink"
related:
  - "ofive-project-wiki"
  - "ofive-documentation-map"
  - "ofive-atomic-term-model"
---

# ofive Wiki 维护规范

Wiki 的目标是构建项目知识图谱，而不是实现索引。页面应以概念、架构、设计和治理为主。

## 页面类型

| 类型 | 用途 |
| --- | --- |
| `wiki-index` | 总入口 |
| `glossary` | 词条索引 |
| `architecture` | 架构说明 |
| `governance` | 治理说明 |
| `documentation-map` | 文档关系 |
| `documentation-guide` | 写作规范 |
| `atomic-term` | 原子词条 |

## Frontmatter 字段

推荐字段：

- `title`：页面标题。
- `kind`：页面类型。
- `status`：页面状态。
- `updated`：更新日期。
- `owners`：维护责任。
- `tags`：查询标签。
- `concepts`：页面覆盖的概念。
- `related`：相关 wiki 页面。

不在 wiki frontmatter 中记录实现路径、测试路径或命令入口。

## Wikilink 规则

1. 用 wikilink 表达概念关系。
2. 链接目标应是另一个 wiki 词条或主题页。
3. 不用 wikilink 伪造路径索引。
4. 示例 wikilink 应放在说明文本中，避免形成无效知识边。

## 词条写法

每个词条至少回答：

1. 它是什么。
2. 为什么存在。
3. 与哪些概念相连。
4. 维护时有哪些边界。

复杂主题应先保留一个总览页，再按 [[ofive-atomic-term-model|Atomic Term Model]] 拆成原子词条。总览页负责组织关系，原子页负责解释单一概念。

## 禁止内容

Wiki 中不写：

- 实现文件路径。
- 测试文件路径。
- 目录结构。
- 命令手册。
- 临时调试记录。

这些内容应进入专项开发文档或任务记录。
