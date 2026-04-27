---
title: "ofive Store Owner"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "frontend"
  - "maintainers"
tags:
  - "ofive"
  - "state"
  - "owner"
concepts:
  - "状态 owner"
  - "状态事实源"
  - "共享状态"
related:
  - "ofive-managed-store"
  - "ofive-state-scope"
  - "ofive-state-schema"
---

# ofive Store Owner

Store Owner 是某个共享前端状态的事实源归属。它说明谁负责状态字段、动作、不变量、持久化语义和失败恢复。

## 边界

Store Owner 不等于所有订阅者。多个组件可以读取或订阅同一状态，但只有一个 owner 负责定义和更新事实源。

## 关系

- [[ofive-managed-store|Managed Store]] 要求共享状态声明 owner。
- [[ofive-state-scope|State Scope]] 决定 owner 管理的状态作用域。
- [[ofive-state-schema|State Schema]] 由 owner 维护。

## 维护要点

1. 新增共享状态前，先指定 owner。
2. 多个 owner 维护同一事实源会造成状态冲突。
3. owner 变化需要同步状态 schema、flow 和设置贡献。
