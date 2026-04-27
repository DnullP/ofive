---
title: "ofive Go Sidecar Test"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "ai"
tags:
  - "ofive"
  - "testing"
  - "go"
concepts:
  - "AI 辅助运行时测试"
  - "Provider 封装"
  - "工具桥行为"
related:
  - "ofive-testing-and-ci"
  - "ofive-sidecar"
  - "ofive-ai-chat"
---

# ofive Go Sidecar Test

Go Sidecar Test 验证 AI 辅助运行时、provider 封装和工具桥行为。

## 维护要点

1. Provider 适配变化应补该测试面。
2. 工具桥行为需要与 capability 语义一致。
3. Sidecar 内部失败应能转化为可解释错误。
