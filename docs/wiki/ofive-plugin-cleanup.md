---
title: "ofive Plugin Cleanup"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "frontend"
tags:
  - "ofive"
  - "plugin"
  - "runtime"
concepts:
  - "插件清理"
  - "注销贡献"
  - "撤销副作用"
related:
  - "ofive-plugin-runtime"
  - "ofive-plugin-activation"
  - "ofive-plugin-hot-reload"
  - "ofive-extension-registry"
---

# ofive Plugin Cleanup

Plugin Cleanup 是撤销插件注册、事件订阅、状态贡献和其他长期副作用的阶段。它让插件生命周期可重复、可卸载、可热重载。

## 边界

Plugin Cleanup 只撤销插件产生的副作用，不负责修复插件业务数据。业务状态的迁移和恢复应由对应 owner 处理。

## 关系

- [[ofive-plugin-activation|Plugin Activation]] 产生需要清理的贡献。
- [[ofive-extension-registry|Extension Registry]] 需要接收注销语义。
- [[ofive-plugin-hot-reload|Plugin Hot Reload]] 依赖完整清理才能避免重复贡献。

## 维护要点

1. 注册和注销应成对出现。
2. 事件订阅、store 贡献和 overlay 注册都属于需要撤销的副作用。
3. 没有清理函数的长期副作用应被视为维护风险。
