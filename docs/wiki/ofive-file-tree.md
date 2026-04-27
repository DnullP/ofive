---
title: "ofive File Tree"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "frontend"
  - "vault"
tags:
  - "ofive"
  - "file-tree"
  - "vault"
concepts:
  - "文件树"
  - "Vault 浏览"
  - "内容入口"
related:
  - "ofive-vault-tree"
  - "ofive-vault"
  - "ofive-file-opener"
  - "ofive-panel"
---

# ofive File Tree

File Tree 是用户浏览 Vault 内容结构的主要入口。它把 Vault Tree 投影为可点击、可创建、可管理的前端视图。

## 边界

File Tree 是用户界面入口，不是 Vault 内容事实源。它展示和触发操作，内容真实性仍归 [[ofive-vault|Vault]]。

## 关系

- [[ofive-vault-tree|Vault Tree]] 是 File Tree 的结构来源。
- [[ofive-file-opener|File Opener]] 决定用户打开节点后的 tab 类型。
- [[ofive-panel|Panel]] 通常承载 File Tree。

## 维护要点

1. 文件树刷新应遵守持久态内容事件语义。
2. 创建、删除、重命名需要通过 Vault 公共能力执行。
3. 树节点 UI 状态不应与内容事实源混淆。
