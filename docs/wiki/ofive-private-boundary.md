---
title: "ofive Private Boundary"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "backend"
  - "maintainers"
tags:
  - "ofive"
  - "private-boundary"
  - "module"
concepts:
  - "私有边界"
  - "内部状态"
  - "模块封装"
related:
  - "ofive-backend-module"
  - "ofive-public-surface"
  - "ofive-persistence-owner"
---

# ofive Private Boundary

Private Boundary 是模块内部实现和私有状态的保护边界。它让模块可以演进内部结构，而不破坏外部依赖。

## 边界

Private Boundary 之外只能依赖 [[ofive-public-surface|Public Surface]]。私有状态、内部 helper 和临时实现不应被其他模块直接使用。

## 关系

- [[ofive-backend-module|Backend Module]] 拥有自己的私有边界。
- [[ofive-persistence-owner|Persistence Owner]] 说明私有持久化状态归属。
- [[ofive-public-surface|Public Surface]] 是私有边界对外开放的部分。

## 维护要点

1. 内部实现变化不应影响公共表面。
2. 跨模块访问私有状态应被视为边界违规。
3. 如果私有能力被多个模块需要，应上升为公共表面或 capability。
