---
title: "ofive Overlay"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "frontend"
tags:
  - "ofive"
  - "overlay"
  - "workbench"
concepts:
  - "覆盖层"
  - "临时交互"
  - "焦点管理"
related:
  - "ofive-workbench"
  - "ofive-command"
  - "ofive-extension-registry"
  - "ofive-workbench-host"
---

# ofive Overlay

Overlay 是覆盖在工作台之上的临时交互层。命令面板、快速切换器和通知层都属于这一类。

## 边界

Overlay 是临时交互，不是长期业务容器。它可以发起命令、导航或选择，但不应保存核心事实源。

Overlay 也不是 Panel。Panel 是工作台布局的一部分，Overlay 是短暂覆盖层。

## 关系

- [[ofive-extension-registry|Extension Registry]] 接收 Overlay 贡献。
- [[ofive-workbench-host|Workbench Host]] 将 Overlay 渲染在工作台上方。
- [[ofive-command|Command]] 常通过 Overlay 被发现和执行。
- [[ofive-app-event-bus|App Event Bus]] 可驱动 Overlay 打开或关闭。

## 维护要点

1. Overlay 应有明确打开、关闭和取消语义。
2. Overlay 必须处理焦点归还。
3. Overlay 不应遮蔽不可恢复的关键操作反馈。
4. 多个 Overlay 同时存在时，需要有层级和冲突策略。
