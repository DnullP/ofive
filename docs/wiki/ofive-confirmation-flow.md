---
title: "ofive Confirmation Flow"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "frontend"
  - "backend"
  - "ai"
tags:
  - "ofive"
  - "confirmation"
  - "safety"
concepts:
  - "用户确认"
  - "风险控制"
  - "可取消操作"
related:
  - "ofive-capability"
  - "ofive-tool-bridge"
  - "ofive-ai-chat"
---

# ofive Confirmation Flow

Confirmation Flow 是高风险操作的用户确认流程。它确保 AI、工具桥或插件发起的高影响操作不会在用户不知情时执行。

## 边界

Confirmation Flow 不是普通错误提示。它发生在操作执行前，用于授权、取消或修改请求。

## 关系

- [[ofive-capability|Capability]] 可声明需要确认的操作。
- [[ofive-tool-bridge|Tool Bridge]] 在调用前触发确认。
- [[ofive-ai-chat|AI Chat]] 展示确认请求和结果反馈。

## 维护要点

1. 高影响写入、删除、外部调用应优先进入确认流程。
2. 确认文本应说明操作对象和影响。
3. 用户取消应被视为正常结果，而不是异常失败。
