---
title: "ofive Command"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "frontend"
tags:
  - "ofive"
  - "command"
  - "interaction"
concepts:
  - "用户意图"
  - "快捷键"
  - "命令面板"
related:
  - "ofive-extension-registry"
  - "ofive-overlay"
  - "ofive-workbench-host"
  - "ofive-backend-command"
---

# ofive Command

Command 是可被命令面板、快捷键、按钮或插件触发的用户意图抽象。它把“用户想做什么”和“具体如何执行”分离。

## 边界

Command 面向前端交互语义，不等同于后端命令。前端 Command 可以调用后端能力，也可以只更新界面状态。

Command 也不是按钮。按钮只是触发 Command 的一种入口。

## 关系

- [[ofive-extension-registry|Extension Registry]] 可接收 Command 贡献。
- [[ofive-overlay|Overlay]] 常用于发现和执行 Command。
- [[ofive-backend-command|Backend Command]] 是后端可调用入口，两者需要边界清晰。
- [[ofive-app-event-bus|App Event Bus]] 可承载命令请求事件。

## 维护要点

1. Command ID 应稳定。
2. Command 标题应表达用户意图。
3. Command 应有启用条件和失败反馈。
4. Command 不应把复杂业务状态散落在触发方。
