---
title: "ofive Module Manifest"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "backend"
tags:
  - "ofive"
  - "module"
  - "manifest"
concepts:
  - "模块声明"
  - "贡献清单"
  - "公共能力"
related:
  - "ofive-backend-module"
  - "ofive-module-identity"
  - "ofive-module-contribution"
  - "ofive-public-surface"
---

# ofive Module Manifest

Module Manifest 是后端模块的贡献清单。它描述模块身份、命令、事件、capability、持久化 owner 和公共表面。

## 边界

Manifest 是声明，不是实现。它让维护者理解模块对系统贡献了什么，以及哪些内容属于公共边界。

## 关系

- [[ofive-module-identity|Module Identity]] 是 manifest 的身份基础。
- [[ofive-module-contribution|Module Contribution]] 是 manifest 中的贡献条目。
- [[ofive-public-surface|Public Surface]] 描述模块可被外部依赖的部分。

## 维护要点

1. 新增公共能力时应更新 manifest。
2. 删除能力时应同步清理 manifest。
3. manifest 应避免暴露模块私有实现细节。
