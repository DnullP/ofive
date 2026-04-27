---
title: "ofive Command Palette"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "frontend"
tags:
  - "ofive"
  - "command"
  - "overlay"
concepts:
  - "命令面板"
  - "用户意图搜索"
  - "动作执行"
related:
  - "ofive-command"
  - "ofive-overlay"
  - "ofive-extension-registry"
  - "ofive-plugin-system"
---

# ofive Command Palette

Command Palette 是面向用户意图搜索和动作执行的覆盖层。它把宿主和插件注册的命令组织成可搜索入口。

## 边界

Command Palette 负责发现和触发命令，不拥有命令的业务语义。具体动作由 [[ofive-command|Command]] owner 执行。

## 关系

- [[ofive-command|Command]] 是可执行动作抽象。
- [[ofive-overlay|Overlay]] 是命令面板的界面形态。
- [[ofive-extension-registry|Extension Registry]] 承接插件注册的命令贡献。

## 维护要点

1. 命令标题应可解释，便于用户搜索。
2. 命令启用条件应在执行前可判断。
3. 命令失败需要给出清晰反馈。
