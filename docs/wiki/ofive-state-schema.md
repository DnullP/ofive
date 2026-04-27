---
title: "ofive State Schema"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "frontend"
  - "maintainers"
tags:
  - "ofive"
  - "state"
  - "schema"
concepts:
  - "状态 schema"
  - "状态字段"
  - "状态动作"
related:
  - "ofive-managed-store"
  - "ofive-store-owner"
  - "ofive-state-flow"
---

# ofive State Schema

State Schema 是共享状态的字段、初始值、不变量和对外动作说明。它让维护者知道状态可以如何变化，以及哪些变化是合法的。

## 边界

State Schema 描述状态契约，不描述具体实现细节。字段新增、动作新增和不变量变化都属于 schema 变化。

## 关系

- [[ofive-store-owner|Store Owner]] 维护 State Schema。
- [[ofive-state-flow|State Flow]] 描述 schema 中字段如何随事件和动作变化。
- [[ofive-managed-store|Managed Store]] 用 schema 提供可审计状态视图。

## 维护要点

1. 新增字段时，应说明初始值、派生关系和持久化语义。
2. 新增动作时，应说明会影响哪些字段。
3. 不变量变化需要同步测试和维护文档。
