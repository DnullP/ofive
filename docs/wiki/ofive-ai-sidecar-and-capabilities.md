---
title: "ofive AI Sidecar 与 Capability"
kind: "architecture"
status: "active"
updated: "2026-04-27"
owners:
  - "ai"
  - "backend"
tags:
  - "ofive"
  - "ai"
  - "sidecar"
  - "capability"
concepts:
  - "AI Chat"
  - "Sidecar"
  - "Capability"
  - "Tool Bridge"
related:
  - "ofive-semantic-index"
  - "ofive-backend-module-platform"
  - "ofive-ai-chat"
  - "ofive-sidecar"
  - "ofive-capability"
---

# ofive AI Sidecar 与 Capability

AI 系统由前端会话体验、后端 AI 模块、sidecar runtime、capability 平台和语义索引共同组成。它的核心目标是让 AI 能在受控边界内理解和操作本地知识。

## 原子词条

- [[ofive-ai-chat|AI Chat]]：用户与模型交互的会话表面。
- [[ofive-sidecar|Sidecar]]：独立辅助运行时。
- [[ofive-tool-bridge|Tool Bridge]]：模型工具调用与系统能力之间的桥接层。
- [[ofive-capability|Capability]]：可被受控调用的系统能力描述。
- [[ofive-capability-catalog|Capability Catalog]]：可调用能力目录。
- [[ofive-confirmation-flow|Confirmation Flow]]：高风险操作的用户确认流程。
- [[ofive-sidecar-build|Sidecar Build]]：辅助运行时的构建治理。
- [[ofive-semantic-index|Semantic Index]]：AI 上下文增强的语义召回层。

## 设计边界

1. [[ofive-ai-chat|AI Chat]] 不直接拥有 Vault 内容。
2. [[ofive-sidecar|Sidecar]] 不直接绕过主应用权限。
3. [[ofive-capability|Capability]] 是 AI 调用系统能力的稳定边界。
4. [[ofive-semantic-index|语义索引]] 提供召回，不替代用户内容事实源。
5. 高风险操作必须进入 [[ofive-confirmation-flow|Confirmation Flow]]。

## 协作关系

```text
AI Chat
  -> Sidecar
  -> Tool Bridge
  -> Capability Catalog
  -> Backend Module
```

这条关系保证 AI 体验、辅助运行时、工具调用和系统能力不会混在同一层中。
