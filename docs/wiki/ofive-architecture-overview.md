---
title: "ofive 架构总览"
kind: "architecture"
status: "active"
updated: "2026-04-27"
owners:
  - "maintainers"
  - "frontend"
  - "backend"
tags:
  - "ofive"
  - "architecture"
  - "design"
concepts:
  - "分层架构"
  - "插件化前端"
  - "模块化后端"
  - "本地优先知识库"
related:
  - "ofive-frontend-runtime"
  - "ofive-backend-module-platform"
  - "ofive-vault-and-query-index"
  - "ofive-ai-sidecar-and-capabilities"
  - "ofive-local-first-workbench"
  - "ofive-content-source-of-truth"
  - "ofive-derived-view"
---

# ofive 架构总览

ofive 是 [[ofive-local-first-workbench|Local First Workbench]]。它将用户的知识内容保存在本地 [[ofive-vault|Vault]] 中，通过插件化前端、模块化后端、AI sidecar 和多种查询索引提供笔记、图谱、搜索、编辑和 AI 能力。

## 架构层次

```text
用户界面
  工作台、插件、编辑器、面板、设置

前端宿主
  注册中心、命令、事件总线、状态治理、布局投影

桌面桥接
  Tauri 命令、宿主事件、窗口能力、运行时状态

后端模块
  Vault、AI、语义索引、应用存储、同步、平台能力

基础设施
  本地文件、查询索引、向量索引、sidecar、持久化
```

## 核心设计判断

1. [[ofive-vault|Vault]] 是 [[ofive-content-source-of-truth|Content Source of Truth]]，索引和图谱都是 [[ofive-derived-view|Derived View]]。
2. 前端功能通过 [[ofive-plugin|Plugin]] 贡献给宿主，而不是集中堆在应用壳层。
3. 后端能力通过 [[ofive-module-contribution|Module Contribution]] 接入平台，而不是散落注册。
4. AI 通过 [[ofive-capability|Capability]] 使用系统能力，而不是直接依赖各模块内部实现。
5. 设计文档和 wiki 只描述长期边界，具体实现细节留给开发文档和源码。

## 主要关系

- [[ofive-plugin-system]] 扩展 [[ofive-frontend-runtime]]。
- [[ofive-vault-and-query-index]] 支撑 [[ofive-markdown-editor]]、搜索、反链和图谱。
- [[ofive-semantic-index]] 消费 Vault 的持久态知识，并服务 [[ofive-ai-sidecar-and-capabilities]]。
- [[ofive-backend-module-platform]] 约束后端模块的公共面和私有边界。
- [[ofive-testing-and-ci]] 负责把这些架构边界转化为可执行质量门。

## 架构治理原则

1. 先确认事实源，再设计投影。
2. 先确认模块 owner，再扩展公共能力。
3. 先确认事件语义，再订阅或广播。
4. 先确认用户心智，再增加界面入口。
