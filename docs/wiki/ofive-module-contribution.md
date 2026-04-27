---
title: "ofive Module Contribution"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "backend"
tags:
  - "ofive"
  - "module"
  - "contribution"
concepts:
  - "模块贡献"
  - "命令贡献"
  - "事件贡献"
  - "能力贡献"
related:
  - "ofive-module-manifest"
  - "ofive-backend-command"
  - "ofive-capability"
  - "ofive-public-surface"
---

# ofive Module Contribution

Module Contribution 是后端模块向平台声明的能力条目。它可以是命令、事件、capability、持久化 owner 或其他公共表面。

## 边界

Module Contribution 是模块对外声明，不是内部实现。它让平台和维护者知道模块贡献了什么能力。

## 关系

- [[ofive-module-manifest|Module Manifest]] 汇总模块贡献。
- [[ofive-backend-command|Backend Command]] 是常见贡献类型。
- [[ofive-capability|Capability]] 是可被受控调用的贡献类型。
- [[ofive-public-surface|Public Surface]] 定义贡献对外可见边界。

## 维护要点

1. 新增贡献必须有明确 owner。
2. 删除贡献应同步更新 manifest 和调用方。
3. 贡献描述应表达业务语义，不应暴露内部实现细节。
