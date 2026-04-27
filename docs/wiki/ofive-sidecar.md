---
title: "ofive Sidecar"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "ai"
  - "backend"
tags:
  - "ofive"
  - "sidecar"
  - "runtime"
concepts:
  - "辅助运行时"
  - "AI 执行层"
  - "进程边界"
related:
  - "ofive-ai-sidecar-and-capabilities"
  - "ofive-ai-chat"
  - "ofive-tool-bridge"
  - "ofive-sidecar-build"
---

# ofive Sidecar

Sidecar 是独立于桌面主进程的辅助运行时。ofive 使用 Sidecar 承接 AI provider、agent runtime、工具调用桥接和模型相关能力。

## 边界

Sidecar 是运行时边界，不是前端界面。前端通过宿主能力与 Sidecar 交互，用户不应直接管理 Sidecar 内部状态。

Sidecar 也不是所有后端能力的归宿。只有适合隔离执行、独立依赖或 AI 运行时的能力才应放入 Sidecar。

## 关系

- [[ofive-ai-chat|AI Chat]] 是 Sidecar 能力的用户会话表面之一。
- [[ofive-tool-bridge|Tool Bridge]] 连接 Sidecar 工具调用与后端 capability。
- [[ofive-sidecar-build|Sidecar Build]] 处理辅助运行时的构建治理。
- [[ofive-capability|Capability]] 约束 Sidecar 可调用的系统能力。

## 维护要点

1. Sidecar 边界应保持清晰，避免把桌面宿主职责迁入 Sidecar。
2. Sidecar 调用宿主能力必须经过 capability 约束。
3. Sidecar 失败应可被前端和后端识别并降级。
4. 修改 Sidecar 协议时，应同步评估 AI Chat、工具桥和构建治理。
