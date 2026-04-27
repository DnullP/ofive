---
title: "ofive Workbench Context"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "frontend"
tags:
  - "ofive"
  - "workbench"
  - "context"
concepts:
  - "工作台上下文"
  - "宿主能力接口"
  - "插件上下文"
related:
  - "ofive-workbench-host"
  - "ofive-workbench-projection"
  - "ofive-plugin"
---

# ofive Workbench Context

Workbench Context 是工作台提供给插件、panel 和 tab 的宿主能力接口。它让插件可以请求打开内容、关闭实例、激活区域或发布宿主意图。

## 边界

Workbench Context 表达宿主动作，不暴露布局内部实现。插件应把它当成能力接口，而不是直接操作工作台状态结构。

## 关系

- [[ofive-workbench-host|Workbench Host]] 创建和注入上下文。
- [[ofive-plugin|Plugin]] 通过上下文请求宿主动作。
- [[ofive-workbench-projection|Workbench Projection]] 决定上下文挂载到哪些界面贡献上。

## 维护要点

1. 新增上下文动作时，应保证语义稳定。
2. 上下文不应泄露布局引擎私有状态。
3. 插件跨区域协作应通过上下文或宿主能力表达。
