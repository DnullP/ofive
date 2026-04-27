---
title: "ofive Quality Gate"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "maintainers"
tags:
  - "ofive"
  - "quality"
  - "gate"
concepts:
  - "质量门"
  - "验证边界"
  - "交付判断"
related:
  - "ofive-testing-and-ci"
  - "ofive-release-gate"
  - "ofive-maintainer-dashboard"
---

# ofive Quality Gate

Quality Gate 是判断变更是否可以继续推进的验证边界。它由多个测试面、构建检查和文档同步要求组成。

## 维护要点

1. 不同风险需要不同质量门。
2. 单一测试通过不能覆盖所有风险。
3. 质量门变化应同步更新测试与构建治理文档。
