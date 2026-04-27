---
title: "ofive Canvas"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "frontend"
  - "vault"
tags:
  - "ofive"
  - "canvas"
  - "vault"
concepts:
  - "画布"
  - "空间笔记"
  - "可视化编辑"
related:
  - "ofive-tab"
  - "ofive-vault"
  - "ofive-file-opener"
  - "ofive-workbench-host"
---

# ofive Canvas

Canvas 是面向空间组织的可视化笔记能力。它把内容节点、连接关系和布局放入可编辑画布中。

## 边界

Canvas 是内容类型和编辑体验，不是工作台布局本身。工作台负责打开和承载 Canvas，Canvas 自己负责画布内容语义。

## 关系

- [[ofive-tab|Tab]] 是 Canvas 的主工作区承载方式。
- [[ofive-file-opener|File Opener]] 决定 Canvas 内容如何打开。
- [[ofive-vault|Vault]] 持有 Canvas 持久态内容。
- [[ofive-workbench-host|Workbench Host]] 负责打开和激活 Canvas tab。

## 维护要点

1. Canvas 内容保存应回到 Vault 事实源。
2. 画布视图状态和画布内容语义需要区分。
3. 打开策略应通过 File Opener 表达。
