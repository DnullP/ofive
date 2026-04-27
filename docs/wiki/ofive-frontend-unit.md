---
title: "ofive Frontend Unit"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "frontend"
tags:
  - "ofive"
  - "testing"
  - "frontend"
concepts:
  - "前端单测"
  - "状态流验证"
  - "插件局部验证"
related:
  - "ofive-testing-and-ci"
  - "ofive-web-development"
  - "ofive-managed-store"
---

# ofive Frontend Unit

Frontend Unit 验证纯前端逻辑、状态流、注册中心、插件局部行为和渲染辅助逻辑。

## 维护要点

1. 状态 owner、事件转换和注册中心变更应优先补前端单测。
2. 前端单测不覆盖真实浏览器交互和桌面宿主能力。
3. 插件局部行为应通过依赖注入保持可测试。
