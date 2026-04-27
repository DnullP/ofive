---
title: "ofive Plugin Activation"
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
  - "插件激活"
  - "插件入口"
  - "注册贡献"
related:
  - "ofive-plugin-runtime"
  - "ofive-plugin-cleanup"
  - "ofive-extension-registry"
  - "ofive-managed-store"
---

# ofive Plugin Activation

Plugin Activation 是执行插件入口并接收插件贡献的阶段。插件在这里注册 activity、panel、tab component、overlay、command、store 或事件订阅。

## 边界

Plugin Activation 不应承载复杂业务事实源。插件入口应轻量、幂等，并把长期状态放回插件内部或 [[ofive-managed-store|Managed Store]]。

## 关系

- [[ofive-plugin-runtime|Plugin Runtime]] 调用插件入口。
- [[ofive-extension-registry|Extension Registry]] 接收插件的扩展点贡献。
- [[ofive-plugin-cleanup|Plugin Cleanup]] 撤销激活阶段产生的副作用。

## 维护要点

1. 插件入口应只做注册、订阅和初始化。
2. 每个长期副作用都需要对应清理动作。
3. 激活失败应进入 [[ofive-plugin-failure-isolation|Plugin Failure Isolation]]，不能中断整个运行时。
