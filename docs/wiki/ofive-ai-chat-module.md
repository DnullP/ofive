---
title: "ofive AI Chat Module"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "backend"
  - "ai"
tags:
  - "ofive"
  - "backend"
  - "module"
  - "ai"
concepts:
  - "AI 会话模块"
  - "工具编排"
  - "流式响应"
related:
  - "ofive-ai-chat"
  - "ofive-sidecar"
  - "ofive-tool-bridge"
  - "ofive-capability"
  - "ofive-confirmation-flow"
---

# ofive AI Chat Module

AI Chat Module 是 AI 会话和工具编排模块。它管理聊天配置、会话上下文、流式响应、sidecar 协作和工具调用流程。

## 边界

AI Chat Module 不拥有 Vault 私有实现，也不拥有语义索引内部结构。它通过 [[ofive-capability|Capability]] 使用系统能力，通过 [[ofive-tool-bridge|Tool Bridge]] 表达工具调用。

## 关系

- [[ofive-ai-chat|AI Chat]] 是用户可见的会话能力。
- [[ofive-sidecar|Sidecar]] 承载独立进程中的 AI 或工具执行。
- [[ofive-confirmation-flow|Confirmation Flow]] 约束高影响工具调用。
- [[ofive-capability-catalog|Capability Catalog]] 描述可被 AI 调用的系统能力。

## 维护要点

1. 工具调用必须有能力 owner 和权限语义。
2. 高影响动作需要确认流程，不应由模型直接执行。
3. 会话上下文可以引用 Vault 内容，但不应绕过 Vault 边界直接写入。
