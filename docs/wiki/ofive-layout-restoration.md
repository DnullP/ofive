---
title: "ofive Layout Restoration"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "frontend"
tags:
  - "ofive"
  - "workbench"
  - "layout"
concepts:
  - "布局恢复"
  - "界面状态"
  - "注册贡献匹配"
related:
  - "ofive-workbench-host"
  - "ofive-workbench-projection"
  - "ofive-plugin-cleanup"
  - "ofive-managed-store"
---

# ofive Layout Restoration

Layout Restoration 是恢复用户工作台界面状态的机制。它处理上次打开的 tab、激活区域、侧边栏状态和插件贡献变化后的缺口。

## 边界

Layout Restoration 只恢复界面状态，不恢复业务事实源。插件卸载、Vault 切换或配置变化都可能让旧布局中的一部分失效。

## 关系

- [[ofive-workbench-host|Workbench Host]] 拥有布局恢复职责。
- [[ofive-workbench-projection|Workbench Projection]] 提供可恢复的界面贡献。
- [[ofive-managed-store|Managed Store]] 可持有工作台偏好和恢复状态。

## 维护要点

1. 恢复时应跳过已经不存在的插件贡献。
2. 稳定标识比显示标题更适合用于恢复匹配。
3. 布局恢复不能假设业务数据仍然有效。
