---
title: "ofive Backend Event Bridge"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "frontend"
  - "backend"
tags:
  - "ofive"
  - "event"
  - "runtime"
concepts:
  - "后端事件桥"
  - "单点订阅"
  - "语义转发"
related:
  - "ofive-app-event-bus"
  - "ofive-persisted-content-event"
  - "ofive-vault-module"
---

# ofive Backend Event Bridge

Backend Event Bridge 是前端运行时对后端宿主事件的单点桥接。它把原生通知转换为 [[ofive-app-event-bus|App Event Bus]] 可消费的语义事件。

## 边界

Backend Event Bridge 不解释业务状态。它只负责桥接和转发，具体刷新、合并或提示由事件消费者的 owner 决定。

## 关系

- [[ofive-app-event-bus|App Event Bus]] 承接桥接后的前端语义事件。
- [[ofive-persisted-content-event|Persisted Content Event]] 是内容持久态变化的一种语义事件。
- [[ofive-vault-module|Vault Module]] 是 Vault 内容事件的后端 owner。

## 维护要点

1. 桥接应保持单例语义，避免重复订阅。
2. 低层事件名称不应直接泄露给业务组件。
3. 桥接失败应有可诊断上下文，但不应伪造业务状态。
