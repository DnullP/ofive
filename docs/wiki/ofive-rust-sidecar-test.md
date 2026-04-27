---
title: "ofive Rust Sidecar Test"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "backend"
  - "ai"
tags:
  - "ofive"
  - "testing"
  - "sidecar"
concepts:
  - "Sidecar 联动测试"
  - "宿主通信"
  - "AI 运行时"
related:
  - "ofive-testing-and-ci"
  - "ofive-sidecar"
  - "ofive-tool-bridge"
---

# ofive Rust Sidecar Test

Rust Sidecar Test 验证主应用与 AI sidecar 的真实联动。

## 维护要点

1. Sidecar 协议和进程边界变化需要该测试面。
2. 工具桥和 capability 调用链应被覆盖。
3. 真实 sidecar 缺失时，应明确测试降级语义。
