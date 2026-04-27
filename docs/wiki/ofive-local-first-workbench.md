---
title: "ofive Local First Workbench"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "maintainers"
tags:
  - "ofive"
  - "architecture"
  - "local-first"
concepts:
  - "本地优先"
  - "桌面知识工作台"
  - "离线可用"
related:
  - "ofive-architecture-overview"
  - "ofive-vault"
  - "ofive-content-source-of-truth"
  - "ofive-sync-module"
---

# ofive Local First Workbench

Local First Workbench 是 ofive 的产品和架构定位。用户知识内容优先保存在本地 Vault 中，桌面工作台围绕本地内容提供编辑、搜索、图谱、AI 和同步能力。

## 边界

本地优先不表示完全没有网络能力。AI、同步和模型管理可以使用外部服务，但它们不能替代本地内容事实源。

## 关系

- [[ofive-vault|Vault]] 是本地优先的内容边界。
- [[ofive-content-source-of-truth|Content Source of Truth]] 定义本地内容权威来源。
- [[ofive-sync-module|Sync Module]] 在本地事实源基础上表达同步意图。

## 维护要点

1. 新能力应先说明是否改变本地内容事实源。
2. 外部服务失败不应破坏本地笔记基本可用性。
3. 同步和 AI 只增强工作台，不替代本地内容所有权。
