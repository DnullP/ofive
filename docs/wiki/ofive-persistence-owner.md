---
title: "ofive Persistence Owner"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "backend"
  - "maintainers"
tags:
  - "ofive"
  - "persistence"
  - "owner"
concepts:
  - "持久化归属"
  - "私有状态"
  - "数据边界"
related:
  - "ofive-backend-module"
  - "ofive-private-boundary"
  - "ofive-module-manifest"
---

# ofive Persistence Owner

Persistence Owner 是持久化状态的归属声明。它说明哪个模块拥有某类持久化数据，以及其他模块是否可以访问。

## 边界

持久化 owner 不只是存储位置。它表达数据责任、迁移责任和访问边界。

## 关系

- [[ofive-backend-module|Backend Module]] 通常是持久化 owner。
- [[ofive-private-boundary|Private Boundary]] 保护模块私有状态。
- [[ofive-module-manifest|Module Manifest]] 应声明持久化归属。

## 维护要点

1. 新增持久化数据前应明确 owner。
2. 跨模块读取持久化数据应通过公共能力。
3. 数据迁移责任属于 owner。
