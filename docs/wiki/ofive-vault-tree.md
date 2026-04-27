---
title: "ofive Vault Tree"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "frontend"
  - "backend"
tags:
  - "ofive"
  - "vault"
  - "tree"
concepts:
  - "目录树"
  - "浏览投影"
  - "文件结构"
related:
  - "ofive-vault"
  - "ofive-query-index"
  - "ofive-persisted-content-event"
---

# ofive Vault Tree

Vault Tree 是 Vault 内容结构的浏览投影。它帮助用户理解知识库中的文件、目录和可打开内容。

## 边界

Vault Tree 是结构视图，不是内容事实源。它可以刷新、重建或局部失效，但不应改变笔记内容本身。

## 关系

- [[ofive-vault|Vault]] 是目录树的事实来源。
- [[ofive-persisted-content-event|Persisted Content Event]] 可触发结构或内容相关刷新。
- [[ofive-file-opener|File Opener]] 决定用户打开树节点后的呈现方式。

## 维护要点

1. 目录树刷新应和内容更新语义区分。
2. 创建、删除和移动影响结构，普通内容修改通常不应改变树结构。
3. 树节点只表达可浏览结构，不应承载复杂业务状态。
