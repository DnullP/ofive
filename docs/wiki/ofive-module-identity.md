---
title: "ofive Module Identity"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "backend"
  - "maintainers"
tags:
  - "ofive"
  - "module"
  - "identity"
concepts:
  - "模块身份"
  - "长期名称"
  - "业务边界"
related:
  - "ofive-backend-module"
  - "ofive-module-manifest"
---

# ofive Module Identity

Module Identity 是后端模块的长期身份。它表达业务边界，而不是临时实现形态。

## 边界

模块身份不应随着文件组织或内部实现轻易变化。它应服务于 capability、manifest、事件和持久化 owner 的长期治理。

## 关系

- [[ofive-backend-module|Backend Module]] 以 Module Identity 表达长期边界。
- [[ofive-module-manifest|Module Manifest]] 使用身份声明模块贡献。

## 维护要点

1. 身份命名应稳定且可解释。
2. 拆分模块前，应先明确新旧身份关系。
3. 身份变化会影响文档、能力目录和维护视图。
