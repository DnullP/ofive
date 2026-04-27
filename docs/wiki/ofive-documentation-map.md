---
title: "ofive 文档地图"
kind: "documentation-map"
status: "active"
updated: "2026-04-27"
owners:
  - "maintainers"
tags:
  - "ofive"
  - "documentation"
  - "governance"
concepts:
  - "wiki"
  - "专项文档"
  - "维护说明"
related:
  - "ofive-project-wiki"
  - "ofive-wiki-authoring-guide"
  - "ofive-atomic-term-model"
---

# ofive 文档地图

文档体系分为两层：wiki 负责长期概念和治理，专项文档负责具体开发流程和操作手册。

## Wiki 层

Wiki 层回答“系统是什么、边界是什么、为什么这样设计”。

- [[ofive-atomic-term-model]]：原子词条拆分规则。
- [[ofive-concept-glossary]]：核心概念索引。
- [[ofive-component-glossary]]：前端组件索引。
- [[ofive-frontend-runtime]]：前端运行时总览。
- [[ofive-plugin-runtime]]：插件生命周期治理。
- [[ofive-extension-registry]]：扩展点注册模型。
- [[ofive-workbench-host]]：工作台投影层。
- [[ofive-app-event-bus]]：前端语义事件层。
- [[ofive-managed-store]]：前端状态治理模型。
- [[ofive-module-glossary]]：后端模块。
- [[ofive-architecture-overview]]：整体架构。
- [[ofive-maintainer-dashboard]]：维护者视图。
- [[ofive-wiki-authoring-guide]]：wiki 写作规范。

## 专项文档层

专项文档回答“开发时怎么做、检查什么、怎么验证”。

- 功能扩展流程说明。
- 插件开发教程。
- 后端模块扩展流程。
- 测试体系说明。
- 语义索引设计说明。
- 同步模块续做说明。

## 分工原则

| 内容类型 | 放入 wiki | 放入专项文档 |
| --- | --- | --- |
| 概念定义 | 是 | 可引用 |
| 架构边界 | 是 | 可展开操作细节 |
| 设计原则 | 是 | 可落成 checklist |
| 具体实现入口 | 否 | 是 |
| 命令和测试步骤 | 否 | 是 |
| 发布和质量门操作 | 概念说明 | 具体命令与流程 |

## 文档更新规则

1. 设计边界变化，先更新 wiki。
2. 开发流程变化，再更新专项文档。
3. 新增概念、组件或模块，必须新增或更新对应词条。
4. 删除能力时，先移除入口说明，再更新概念关系。
