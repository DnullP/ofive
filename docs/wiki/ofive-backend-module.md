---
title: "ofive Backend Module"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "backend"
  - "maintainers"
tags:
  - "ofive"
  - "backend"
  - "module"
concepts:
  - "后端模块"
  - "业务边界"
  - "能力声明"
related:
  - "ofive-backend-module-platform"
  - "ofive-module-identity"
  - "ofive-module-manifest"
  - "ofive-capability"
---

# ofive Backend Module

Backend Module 是后端业务能力的治理单元。它声明自己的身份、命令、事件、capability、持久化 owner、公共表面和私有边界。

## 边界

Backend Module 不是任意代码分组，而是长期业务边界。模块应围绕稳定能力组织，而不是围绕临时实现形态组织。

Backend Module 也不是前端插件。前端插件负责界面贡献，后端模块负责宿主能力和数据边界。

## 关系

- [[ofive-module-identity|Module Identity]] 定义模块长期名称。
- [[ofive-module-manifest|Module Manifest]] 描述模块公开贡献。
- [[ofive-capability|Capability]] 使模块能力可被受控调用。
- [[ofive-persistence-owner|Persistence Owner]] 定义模块私有状态归属。

## 维护要点

1. 新增后端能力时，先判断所属模块。
2. 跨模块调用必须通过公共表面或 capability。
3. 模块内部状态不应被其他模块直接读写。
4. 模块删除或拆分时，必须同步更新 manifest、capability 和文档关系。
