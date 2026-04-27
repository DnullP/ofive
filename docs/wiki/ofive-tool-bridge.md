---
title: "ofive Tool Bridge"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "ai"
  - "backend"
tags:
  - "ofive"
  - "ai"
  - "tool"
concepts:
  - "工具桥"
  - "Capability 调用"
  - "模型工具"
related:
  - "ofive-capability"
  - "ofive-capability-catalog"
  - "ofive-sidecar"
  - "ofive-confirmation-flow"
---

# ofive Tool Bridge

Tool Bridge 是连接模型工具调用与 ofive capability 的桥接层。它把模型请求转换为受控系统能力调用。

## 边界

Tool Bridge 不直接拥有业务能力。它只负责路由、校验、确认和结果返回。真实能力仍归属对应 [[ofive-backend-module|Backend Module]]。

## 关系

- [[ofive-capability|Capability]] 是可调用能力单位。
- [[ofive-capability-catalog|Capability Catalog]] 提供能力目录。
- [[ofive-sidecar|Sidecar]] 可能发起工具调用。
- [[ofive-confirmation-flow|Confirmation Flow]] 处理高影响调用。

## 维护要点

1. 工具调用必须映射到明确 capability。
2. 高风险调用必须走确认语义。
3. 调用结果应可解释，失败应可反馈给会话层。
