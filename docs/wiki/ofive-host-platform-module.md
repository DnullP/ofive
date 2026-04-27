---
title: "ofive Host Platform Module"
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
  - "platform"
concepts:
  - "宿主平台模块"
  - "平台装配"
  - "运行时治理"
related:
  - "ofive-backend-module"
  - "ofive-backend-command"
  - "ofive-capability-catalog"
  - "ofive-module-contribution"
---

# ofive Host Platform Module

Host Platform Module 是桌面宿主与平台治理模块。它负责把窗口能力、宿主事件、后端命令和平台级能力目录装配成稳定运行时。

## 边界

Host Platform Module 是平台装配层，不是业务模块。它可以组织能力、暴露宿主公共面和协调启动顺序，但不应吸收 Vault、AI、同步或语义索引的私有逻辑。

## 关系

- [[ofive-backend-module|Backend Module]] 提供模块治理模型。
- [[ofive-backend-command|Backend Command]] 是平台对前端暴露能力的一种形式。
- [[ofive-capability-catalog|Capability Catalog]] 可由平台聚合，但能力 owner 仍归具体模块。
- [[ofive-module-contribution|Module Contribution]] 描述业务模块如何接入宿主平台。

## 维护要点

1. 新增平台能力时，先判断它是宿主职责还是业务模块职责。
2. 平台只聚合公共能力，不直接读取模块私有状态。
3. 平台启动顺序应可解释，避免模块之间形成隐式依赖。
