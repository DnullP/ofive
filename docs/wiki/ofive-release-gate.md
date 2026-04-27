---
title: "ofive Release Gate"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "maintainers"
tags:
  - "ofive"
  - "release"
  - "quality"
concepts:
  - "发布门"
  - "完整质量门"
  - "发布准备"
related:
  - "ofive-quality-gate"
  - "ofive-production-build"
  - "ofive-testing-and-ci"
---

# ofive Release Gate

Release Gate 是发布前的完整质量门。它应比日常主线验证更严格，覆盖构建、测试、sidecar、文档和关键路径。

## 维护要点

1. Release Gate 失败应阻止发布。
2. 发布门应包含比日常开发更完整的组合验证。
3. 发布门变化必须同步更新构建和测试治理说明。
