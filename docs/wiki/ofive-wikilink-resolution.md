---
title: "ofive WikiLink Resolution"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "backend"
  - "frontend"
tags:
  - "ofive"
  - "wikilink"
  - "resolution"
concepts:
  - "链接解析"
  - "目标匹配"
  - "别名"
related:
  - "ofive-wikilink"
  - "ofive-note"
  - "ofive-query-index"
---

# ofive WikiLink Resolution

WikiLink Resolution 是把 WikiLink 文本解析为目标笔记的过程。它决定链接点击、建议、反链和图谱关系是否指向同一目标。

## 边界

解析规则是知识关系规则，不是某个编辑器视图的局部行为。不同界面应共享同一套解释。

## 关系

- [[ofive-wikilink|WikiLink]] 提供待解析文本。
- [[ofive-note|Note]] 是主要解析目标。
- [[ofive-query-index|Query Index]] 可以为目标查找提供派生读模型。

## 维护要点

1. 同名目标和别名必须有稳定策略。
2. 解析失败应有可解释反馈。
3. 解析规则变化会影响反链、图谱和编辑器跳转。
