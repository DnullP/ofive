---
title: "ofive Sync Module"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "backend"
  - "maintainers"
tags:
  - "ofive"
  - "backend"
  - "module"
  - "sync"
concepts:
  - "同步模块"
  - "同步意图"
  - "内容一致性"
related:
  - "ofive-backend-module"
  - "ofive-vault-module"
  - "ofive-sync-status"
  - "ofive-persisted-content-event"
---

# ofive Sync Module

Sync Module 是多端同步能力的模块边界。它表达同步状态、同步意图和与 Vault 内容一致性相关的治理规则。

## 边界

Sync Module 不直接接管 Vault 私有写入机制。它应通过受控公共面表达同步意图，并通过持久态内容事件维持下游视图一致。

## 关系

- [[ofive-vault-module|Vault Module]] 持有本地内容事实源。
- [[ofive-sync-status|Sync Status]] 表达同步进度、失败和恢复语义。
- [[ofive-persisted-content-event|Persisted Content Event]] 用于通知内容持久态变化。

## 维护要点

1. 同步状态和内容事实源要分开治理。
2. 冲突、失败和重试需要可解释状态，而不是隐式覆盖。
3. 同步写入应触发统一内容更新语义。
