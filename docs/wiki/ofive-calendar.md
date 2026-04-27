---
title: "ofive Calendar"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "frontend"
tags:
  - "ofive"
  - "calendar"
  - "plugin"
concepts:
  - "日历视图"
  - "日期笔记"
  - "时间导航"
related:
  - "ofive-plugin"
  - "ofive-vault-search"
  - "ofive-query-index"
  - "ofive-panel"
---

# ofive Calendar

Calendar 是按日期组织笔记入口和时间相关内容的插件能力。它帮助用户从时间维度进入 Vault 内容。

## 边界

Calendar 是导航和聚合视图，不是内容事实源。日期笔记、任务和事件仍应回到 Vault 内容或对应模块 owner。

## 关系

- [[ofive-plugin|Plugin]] 提供日历功能入口。
- [[ofive-query-index|Query Index]] 可支持日期相关聚合。
- [[ofive-vault-search|Vault Search]] 可按日期相关元数据检索内容。
- [[ofive-panel|Panel]] 可承载日历侧边视图。

## 维护要点

1. 日期规则应稳定，避免同一天生成多个语义入口。
2. 日历导航不应隐式创建内容，除非用户明确发起。
3. 日期聚合结果应能回到来源笔记。
