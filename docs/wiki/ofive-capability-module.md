---
title: "ofive Capability Module"
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
  - "capability"
concepts:
  - "能力模块"
  - "执行路由"
  - "能力治理"
related:
  - "ofive-capability"
  - "ofive-capability-catalog"
  - "ofive-tool-bridge"
  - "ofive-confirmation-flow"
---

# ofive Capability Module

Capability Module 是平台能力治理模块。它聚合业务模块声明的能力目录，并把能力描述、权限语义和执行路由组织成可治理的公共面。

## 边界

Capability Module 聚合能力，不替代能力 owner。某个能力的输入语义、执行结果和失败模式仍应由贡献它的业务模块负责。

## 关系

- [[ofive-capability|Capability]] 是可被前端、AI 或插件调用的系统能力。
- [[ofive-capability-catalog|Capability Catalog]] 保存能力描述与治理信息。
- [[ofive-tool-bridge|Tool Bridge]] 让 AI 工具调用进入能力路由。
- [[ofive-confirmation-flow|Confirmation Flow]] 保护高影响能力执行。

## 维护要点

1. 每个能力都需要明确 owner、输入、输出、权限和失败语义。
2. 平台可以统一路由，但不能吞掉业务模块的领域约束。
3. 新增 AI 可调用能力时，应同步确认确认流程和审计语义。
