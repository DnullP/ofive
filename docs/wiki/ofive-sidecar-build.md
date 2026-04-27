---
title: "ofive Sidecar Build"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "maintainers"
  - "ai"
tags:
  - "ofive"
  - "sidecar"
  - "build"
concepts:
  - "Sidecar 构建"
  - "辅助运行时产物"
  - "发布准备"
related:
  - "ofive-sidecar"
  - "ofive-build-and-dev-workflow"
  - "ofive-testing-and-ci"
---

# ofive Sidecar Build

Sidecar Build 是辅助运行时的构建治理。它保证 AI sidecar 或工具 sidecar 在开发、测试和发布时拥有可用产物。

## 边界

Sidecar Build 是构建域，不是 AI 会话域。它关注产物准备、平台匹配和发布可用性。

## 关系

- [[ofive-sidecar|Sidecar]] 是构建产物运行后的边界。
- [[ofive-build-and-dev-workflow|构建与开发治理]] 组织构建域。
- [[ofive-testing-and-ci|测试与质量治理]] 验证构建产物可用性。

## 维护要点

1. 构建产物应与目标平台匹配。
2. 测试环境应能区分真实产物和占位产物。
3. 发布前必须确认 sidecar 产物可执行。
