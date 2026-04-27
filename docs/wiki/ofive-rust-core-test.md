---
title: "ofive Rust Core Test"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "backend"
tags:
  - "ofive"
  - "testing"
  - "rust"
concepts:
  - "后端核心测试"
  - "模块边界"
  - "查询能力"
related:
  - "ofive-testing-and-ci"
  - "ofive-backend-module-platform"
  - "ofive-query-index"
---

# ofive Rust Core Test

Rust Core Test 验证不依赖真实 sidecar 的后端业务能力、查询能力和模块边界。

## 维护要点

1. 后端模块边界变化应补核心测试。
2. 查询索引、Vault 和持久化语义属于核心测试高价值区域。
3. Sidecar 真实联动应进入专门测试面。
