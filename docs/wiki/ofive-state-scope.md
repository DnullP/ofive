---
title: "ofive State Scope"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "frontend"
  - "maintainers"
tags:
  - "ofive"
  - "state"
  - "scope"
concepts:
  - "状态作用域"
  - "Vault 作用域"
  - "插件作用域"
related:
  - "ofive-managed-store"
  - "ofive-store-owner"
  - "ofive-persistence-owner"
---

# ofive State Scope

State Scope 描述前端状态在哪个范围内有效，例如前端本地、Vault 级、插件私有、应用级或后端服务级。

## 边界

State Scope 决定状态是否需要持久化、是否随 Vault 切换重置、是否可跨插件共享。作用域不清会导致配置漂移和状态污染。

## 关系

- [[ofive-managed-store|Managed Store]] 使用 scope 治理共享状态。
- [[ofive-store-owner|Store Owner]] 负责解释状态作用域。
- [[ofive-persistence-owner|Persistence Owner]] 是持久化作用域的后端对应概念。

## 维护要点

1. Vault 级状态不应被误放入应用级作用域。
2. 插件私有状态只有需要宿主治理时才上升为共享状态。
3. 作用域变化通常需要迁移或重置策略。
