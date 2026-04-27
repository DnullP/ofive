---
title: "ofive Performance Smoke"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "maintainers"
tags:
  - "ofive"
  - "performance"
  - "testing"
concepts:
  - "性能冒烟"
  - "关键路径"
  - "退化检测"
related:
  - "ofive-testing-and-ci"
  - "ofive-quality-gate"
---

# ofive Performance Smoke

Performance Smoke 验证关键路径没有出现明显性能退化。它不是完整性能基准，而是交付前的风险提示。

## 维护要点

1. 工作台启动、搜索、索引和 AI 上下文召回属于高价值路径。
2. 性能冒烟失败应触发进一步定位。
3. 性能数据应可比较，不应只凭体感判断。
