---
title: "ofive Content Source of Truth"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "maintainers"
  - "vault"
tags:
  - "ofive"
  - "vault"
  - "source-of-truth"
concepts:
  - "内容事实源"
  - "本地内容"
  - "持久态"
related:
  - "ofive-vault"
  - "ofive-vault-module"
  - "ofive-persisted-content-event"
  - "ofive-derived-view"
---

# ofive Content Source of Truth

Content Source of Truth 是 ofive 对本地知识内容权威来源的治理概念。它说明哪些数据是用户内容本身，哪些只是为了展示、搜索或 AI 召回而派生出来的视图。

## 边界

内容事实源归 [[ofive-vault|Vault]] 和 [[ofive-vault-module|Vault Module]]。查询索引、语义索引、图谱、文件树和任务看板都不应成为内容事实源。

## 关系

- [[ofive-persisted-content-event|Persisted Content Event]] 表达内容事实源发生持久态变化。
- [[ofive-derived-view|Derived View]] 从内容事实源派生用户可见或机器可用的视图。
- [[ofive-query-index|Query Index]] 和 [[ofive-semantic-index|Semantic Index]] 都依赖内容事实源。

## 维护要点

1. 写入路径应优先维护内容事实源一致性。
2. 派生视图可以重建，但内容事实源不能被派生结果覆盖。
3. 同步、编辑器和外部变更都应汇入统一持久态语义。
