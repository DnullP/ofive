---
title: "ofive Capability Catalog"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "backend"
  - "ai"
tags:
  - "ofive"
  - "capability"
  - "catalog"
concepts:
  - "能力目录"
  - "能力发现"
  - "调用约束"
related:
  - "ofive-capability"
  - "ofive-backend-module"
  - "ofive-tool-bridge"
---

# ofive Capability Catalog

Capability Catalog 是可调用系统能力的目录。它让能力可以被发现、筛选、授权、确认和路由。

## 边界

Capability Catalog 只描述能力，不实现能力。能力实现仍由对应模块 owner 维护。

## 关系

- [[ofive-capability|Capability]] 是目录中的条目。
- [[ofive-backend-module|Backend Module]] 通常是 capability owner。
- [[ofive-tool-bridge|Tool Bridge]] 通过目录选择可调用能力。

## 维护要点

1. 能力条目应有稳定名称和语义。
2. 目录应表达风险和调用边界。
3. 删除能力时，应同步处理调用方和文档关系。
