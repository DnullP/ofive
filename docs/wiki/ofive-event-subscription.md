---
title: "ofive Event Subscription"
kind: "atomic-term"
status: "active"
updated: "2026-05-29"
owners:
  - "frontend"
tags:
  - "ofive"
  - "event"
  - "lifecycle"
concepts:
  - "事件订阅"
  - "订阅清理"
  - "生命周期"
related:
  - "ofive-app-event-bus"
  - "ofive-plugin-cleanup"
  - "ofive-plugin-runtime"
---

# ofive Event Subscription

Event Subscription 是组件、插件或 store 对语义事件的监听关系。它让系统在不直接耦合的情况下响应内容、编辑器和业务刷新变化。

## 边界

Event Subscription 不是状态事实源。订阅者可以根据事件更新自己的状态，但事件本身不保存状态。

## 关系

- [[ofive-app-event-bus|App Event Bus]] 提供可订阅事件。
- [[ofive-plugin-cleanup|Plugin Cleanup]] 必须撤销插件创建的事件订阅。
- [[ofive-plugin-runtime|Plugin Runtime]] 管理订阅生命周期所在的插件生命周期。

## 维护要点

1. 每个长期订阅都需要清理动作。
2. 订阅者应能处理重复事件和乱序感知风险。
3. 事件订阅不应绕过 owner 直接改写他人状态。
4. 后端事件订阅只能放在 API wrapper、App Event Bus bridge、plugin-level hub 或插件激活 owner 中；React 组件应消费 store、hub 或语义 bus。
5. AI chat 这类会话/stream 功能必须让后端 stream listener 独立于组件 mount lifecycle；组件重挂只能重连前端 listener，不能重启会话本体。

## Guard

`scripts/check-event-subscription-guards.mjs` 会阻止业务 UI 直接调用底层后端订阅函数，例如 `subscribeAiChatStreamEvents`、`subscribeVaultFsEvents` 和 `subscribeVaultConfigEvents`。

新增后端事件时，应先确定 lifecycle owner：

1. 低层 Tauri `listen()` 留在 `src/api/**`。
2. 多业务共享事件桥接到 [[ofive-app-event-bus|App Event Bus]]。
3. 会话型或 stream 型事件进入 plugin-level hub。
4. 单一插件生命周期事件可以由 `activatePlugin()` owner 订阅并在 dispose 时清理。
