---
title: "ofive App Storage Module"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "backend"
  - "maintainers"
tags:
  - "ofive"
  - "backend"
  - "module"
  - "storage"
concepts:
  - "应用级存储"
  - "跨 Vault 资源"
  - "存储作用域"
related:
  - "ofive-backend-module"
  - "ofive-persistence-owner"
  - "ofive-vault-module"
  - "ofive-model-catalog"
---

# ofive App Storage Module

App Storage Module 是应用级存储资源分配模块。它为跨 Vault 复用的资源提供统一归属，例如应用设置、模型资产和平台注册信息。

## 边界

App Storage Module 管理应用级资源，不管理 Vault 内容事实源。随 Vault 切换变化的内容应归 [[ofive-vault-module|Vault Module]] 或对应业务模块。

## 关系

- [[ofive-persistence-owner|Persistence Owner]] 用于判断某类持久状态属于应用级还是 Vault 级。
- [[ofive-vault-module|Vault Module]] 持有本地知识库内容，不应把内容事实源放入应用级存储。
- [[ofive-model-catalog|Model Catalog]] 可使用应用级空间管理跨 Vault 复用的模型信息。

## 维护要点

1. 新增持久化数据前，先确认作用域。
2. 应用级状态不应隐式影响某个 Vault 的内容语义。
3. 跨 Vault 复用资源需要稳定迁移和版本治理。
