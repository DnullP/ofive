---
title: "ofive Public Surface"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "backend"
  - "maintainers"
tags:
  - "ofive"
  - "public-surface"
  - "module"
concepts:
  - "公共表面"
  - "模块契约"
  - "依赖边界"
related:
  - "ofive-backend-module"
  - "ofive-module-manifest"
  - "ofive-module-contribution"
  - "ofive-private-boundary"
---

# ofive Public Surface

Public Surface 是模块允许外部依赖的公共契约。它可以包含命令、事件、capability、查询接口或其他稳定能力。

## 边界

Public Surface 不等于模块全部内容。只有被明确声明、长期维护并允许外部依赖的能力才属于公共表面。

## 关系

- [[ofive-backend-module|Backend Module]] 通过公共表面与其他模块协作。
- [[ofive-module-manifest|Module Manifest]] 声明公共表面。
- [[ofive-private-boundary|Private Boundary]] 定义公共表面之外的内部区域。

## 维护要点

1. 公共表面变更应被视为契约变更。
2. 外部模块不应依赖私有边界。
3. 新增公共能力前，应确认它具有长期稳定价值。
