---
title: "ofive 后端模块平台"
kind: "architecture"
status: "active"
updated: "2026-04-27"
owners:
  - "backend"
tags:
  - "ofive"
  - "backend"
  - "module"
  - "governance"
concepts:
  - "Backend Module"
  - "Manifest"
  - "Contribution"
  - "Capability"
  - "Persistence Owner"
related:
  - "ofive-module-glossary"
  - "ofive-backend-module"
  - "ofive-ai-sidecar-and-capabilities"
---

# ofive 后端模块平台

后端模块平台是 ofive 后端治理体系。它让每个业务模块用统一方式声明身份、能力、命令、事件、持久化 owner 和公共依赖边界。

## 原子词条

- [[ofive-backend-module|Backend Module]]：后端业务能力的治理单元。
- [[ofive-module-identity|Module Identity]]：模块的长期身份。
- [[ofive-module-manifest|Module Manifest]]：模块的贡献清单。
- [[ofive-module-contribution|Module Contribution]]：模块向平台声明的能力条目。
- [[ofive-backend-command|Backend Command]]：前端可调用的后端入口。
- [[ofive-capability|Capability]]：可被受控调用的系统能力。
- [[ofive-persistence-owner|Persistence Owner]]：持久化状态的归属声明。
- [[ofive-public-surface|Public Surface]]：允许外部依赖的公共契约。
- [[ofive-private-boundary|Private Boundary]]：模块内部实现和私有状态的保护边界。

## 平台关系

```text
Module Identity
  -> Module Manifest
  -> Module Contribution
  -> Public Surface / Private Boundary
```

这条关系保证后端模块不是任意代码集合，而是拥有身份、贡献和边界的治理单元。

## 治理原则

1. 先定义模块身份，再新增对外能力。
2. 能力描述和执行应由同一 owner 维护。
3. 跨模块协作优先走公共表面、事件或 capability。
4. 平台负责聚合和校验，不承接业务私有逻辑。
