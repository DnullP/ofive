---
title: "ofive State Flow"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "frontend"
  - "maintainers"
tags:
  - "ofive"
  - "state"
  - "flow"
concepts:
  - "状态流"
  - "状态机"
  - "失败模式"
related:
  - "ofive-managed-store"
  - "ofive-state-schema"
  - "ofive-app-event-bus"
---

# ofive State Flow

State Flow 描述共享状态如何变化。简单状态可以用值域变化说明，复杂状态应表达为状态机、事件来源和失败恢复。

## 边界

State Flow 不是事件总线。事件可以触发状态变化，但状态变化的合法性由 state owner 和 schema 决定。

## 关系

- [[ofive-state-schema|State Schema]] 描述状态字段和动作。
- [[ofive-app-event-bus|App Event Bus]] 可提供触发状态变化的语义事件。
- [[ofive-managed-store|Managed Store]] 用 State Flow 提升状态可维护性。

## 维护要点

1. 共享状态应说明主要更新来源。
2. 失败状态和恢复路径需要显式表达。
3. 没有状态流说明的共享状态很难安全扩展。
