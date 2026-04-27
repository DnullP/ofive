---
title: "ofive 构建与开发治理"
kind: "governance"
status: "active"
updated: "2026-04-27"
owners:
  - "maintainers"
tags:
  - "ofive"
  - "build"
  - "workflow"
  - "governance"
concepts:
  - "开发环境"
  - "构建链路"
  - "sidecar 构建"
  - "发布准备"
related:
  - "ofive-testing-and-ci"
  - "ofive-ai-sidecar-and-capabilities"
  - "ofive-web-development"
  - "ofive-production-build"
---

# ofive 构建与开发治理

构建与开发治理定义“开发者如何稳定地启动、验证和交付 ofive”。本页只说明概念和责任，不列具体命令。

## 原子词条

- [[ofive-web-development|Web Development]]：快速验证前端工作台、插件和 UI 行为的开发域。
- [[ofive-desktop-development|Desktop Development]]：验证桌面宿主、后端命令、文件系统和 sidecar 联动的开发域。
- [[ofive-production-build|Production Build]]：发布前的最终构建验证。
- [[ofive-sidecar-build|Sidecar Build]]：辅助运行时的构建治理。
- [[ofive-local-layout-dependency|Local Layout Dependency]]：共享布局引擎依赖的治理边界。
- [[ofive-release-gate|Release Gate]]：发布前完整质量门。

## 治理原则

1. Web 通过不代表桌面能力通过。
2. 前端构建通过不代表 sidecar 协议一致。
3. 发布前应使用比日常开发更完整的质量门。
4. 本地依赖变化必须有明确验证。
5. 构建脚本属于工程边界，变更时应同步测试治理说明。
