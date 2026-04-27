---
title: "ofive Local Layout Dependency"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "frontend"
  - "maintainers"
tags:
  - "ofive"
  - "layout"
  - "dependency"
concepts:
  - "本地布局依赖"
  - "共享布局引擎"
  - "宿主投影"
related:
  - "ofive-workbench-host"
  - "ofive-build-and-dev-workflow"
  - "ofive-browser-e2e"
---

# ofive Local Layout Dependency

Local Layout Dependency 表示 ofive 消费独立布局引擎。布局问题需要判断是宿主投影问题，还是共享布局引擎问题。

## 维护要点

1. 布局依赖变化需要验证工作台投影。
2. 拖拽、拆分、恢复和命中区域都属于高风险交互。
3. 需要区分共享布局引擎缺陷和 ofive 宿主集成缺陷。
