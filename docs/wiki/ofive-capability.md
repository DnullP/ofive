---
title: "ofive Capability"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "backend"
  - "ai"
tags:
  - "ofive"
  - "capability"
  - "governance"
concepts:
  - "能力目录"
  - "受控调用"
  - "权限边界"
related:
  - "ofive-capability-catalog"
  - "ofive-backend-module"
  - "ofive-ai-sidecar-and-capabilities"
  - "ofive-tool-bridge"
---

# ofive Capability

Capability 是一个可被受控调用的系统能力描述。它让 AI、sidecar 或其他消费者调用 ofive 能力时经过统一目录、权限、确认和路由约束。

## 边界

Capability 不是普通函数。它必须具备稳定名称、输入输出语义、风险等级和调用边界。

Capability 也不是 UI command。Command 面向用户意图，Capability 面向受控系统能力。

## 关系

- [[ofive-capability-catalog|Capability Catalog]] 组织可调用能力。
- [[ofive-tool-bridge|Tool Bridge]] 将模型或 sidecar 调用桥接到 capability。
- [[ofive-confirmation-flow|Confirmation Flow]] 处理高风险能力的用户确认。
- [[ofive-backend-module|Backend Module]] 是 capability 的主要 owner。

## 维护要点

1. 新增 capability 时，必须说明风险和调用边界。
2. 高影响操作应纳入确认流程。
3. capability 的输入输出应保持稳定，避免破坏调用方。
4. capability 不应绕过模块公共边界直接访问私有状态。
