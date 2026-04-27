---
title: "ofive Plugin Hot Reload"
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
  - "插件热重载"
  - "开发期替换"
  - "重复注册"
related:
  - "ofive-plugin-runtime"
  - "ofive-plugin-cleanup"
  - "ofive-extension-registry"
---

# ofive Plugin Hot Reload

Plugin Hot Reload 是开发期替换插件实现的运行时行为。它用于快速验证插件变更，同时暴露清理不完整、重复注册和残留监听等问题。

## 边界

热重载不是普通用户能力。它服务开发和维护，核心要求是先清理旧实例，再激活新实例。

## 关系

- [[ofive-plugin-cleanup|Plugin Cleanup]] 决定旧插件实例能否被完整撤销。
- [[ofive-plugin-activation|Plugin Activation]] 负责激活新插件实例。
- [[ofive-extension-registry|Extension Registry]] 应在热重载后保持贡献集合一致。

## 维护要点

1. 热重载后不应出现重复 activity、panel、command 或事件响应。
2. 插件清理函数缺失通常会在热重载场景中暴露。
3. 开发期行为不应改变生产期插件生命周期语义。
