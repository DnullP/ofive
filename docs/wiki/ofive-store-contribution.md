---
title: "ofive Store Contribution"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "frontend"
tags:
  - "ofive"
  - "state"
  - "plugin"
  - "settings"
concepts:
  - "状态贡献"
  - "设置贡献"
  - "宿主表面"
related:
  - "ofive-managed-store"
  - "ofive-settings-surface"
  - "ofive-plugin-cleanup"
---

# ofive Store Contribution

Store Contribution 是 store 向宿主暴露的治理能力，例如设置入口、状态面板或可审计动作。它让配置 UI 与状态 owner 保持同源。

## 边界

Store Contribution 不是任意 UI 插入点。只有与状态 owner、配置或维护审计相关的宿主表面，才应作为 store contribution。

## 关系

- [[ofive-managed-store|Managed Store]] 管理状态贡献。
- [[ofive-settings-surface|Settings Surface]] 可承接设置贡献。
- [[ofive-plugin-cleanup|Plugin Cleanup]] 需要撤销插件注册的 store contribution。

## 维护要点

1. 设置入口应由对应状态 owner 注册。
2. 状态贡献随插件卸载或 store 注销而清理。
3. 设置 UI 不应与实际状态 owner 分离。
