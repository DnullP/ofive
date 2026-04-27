---
title: "ofive Production Build"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "maintainers"
tags:
  - "ofive"
  - "build"
  - "release"
concepts:
  - "生产构建"
  - "发布准备"
  - "构建验证"
related:
  - "ofive-build-and-dev-workflow"
  - "ofive-release-gate"
  - "ofive-quality-gate"
---

# ofive Production Build

Production Build 是发布前的最终构建验证。它应覆盖前端构建、后端检查、依赖构建、sidecar 产物和守卫检查。

## 维护要点

1. 生产构建失败应阻止发布。
2. 生产构建应比日常开发验证更完整。
3. 构建产物和运行时依赖必须同时确认。
