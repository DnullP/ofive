---
title: "ofive AI Chat"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "ai"
  - "frontend"
tags:
  - "ofive"
  - "ai"
  - "chat"
concepts:
  - "AI 会话"
  - "流式反馈"
  - "工具确认"
related:
  - "ofive-sidecar"
  - "ofive-tool-bridge"
  - "ofive-confirmation-flow"
  - "ofive-semantic-index"
---

# ofive AI Chat

AI Chat 是用户与模型交互的会话表面。它承载输入、输出、流式反馈、历史上下文、工具调用提示和确认流程。

## 边界

AI Chat 是用户体验层，不是模型运行时。模型执行、工具桥和 capability 调用应留在对应运行时边界中。

## 关系

- [[ofive-sidecar|Sidecar]] 承接 AI 运行时能力。
- [[ofive-tool-bridge|Tool Bridge]] 连接模型工具调用与系统能力。
- [[ofive-confirmation-flow|Confirmation Flow]] 处理高风险操作确认。
- [[ofive-semantic-index|语义索引]] 可提供上下文增强。

## 维护要点

1. 会话状态应与工具执行状态区分。
2. 高风险工具调用必须可确认、可取消。
3. 流式输出失败应有可恢复反馈。
