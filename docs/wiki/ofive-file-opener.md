---
title: "ofive File Opener"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "frontend"
tags:
  - "ofive"
  - "file-opener"
  - "workbench"
concepts:
  - "打开策略"
  - "文件类型"
  - "Tab 解析"
related:
  - "ofive-tab"
  - "ofive-extension-registry"
  - "ofive-workbench-host"
  - "ofive-vault-tree"
---

# ofive File Opener

File Opener 是文件类型到工作台 Tab 的解析策略。它声明自己支持哪些文件，并把打开请求转换成具体 Tab 定义。

## 边界

File Opener 是打开策略，不是文件内容事实源。它决定如何呈现内容，但不拥有内容。

## 关系

- [[ofive-vault-tree|Vault Tree]] 提供可打开节点。
- [[ofive-tab|Tab]] 是打开后的主工作区实例。
- [[ofive-extension-registry|Extension Registry]] 管理 opener 注册。
- [[ofive-workbench-host|Workbench Host]] 执行最终打开动作。

## 维护要点

1. 同一文件类型可有多个 opener，但优先级必须清晰。
2. Opener 应返回稳定 Tab 定义。
3. 新增文件类型应优先新增 opener，而不是修改工作台布局逻辑。
