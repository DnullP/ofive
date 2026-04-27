---
title: "ofive 测试与质量治理"
kind: "governance"
status: "active"
updated: "2026-04-27"
owners:
  - "maintainers"
tags:
  - "ofive"
  - "testing"
  - "ci"
  - "quality"
concepts:
  - "质量门"
  - "测试面"
  - "发布门"
related:
  - "ofive-build-and-dev-workflow"
  - "ofive-maintainer-dashboard"
  - "ofive-quality-gate"
---

# ofive 测试与质量治理

ofive 的测试体系由多个测试面组成。每个测试面验证不同风险，不应被单一“测试通过”概念覆盖。

## 原子词条

- [[ofive-quality-gate|Quality Gate]]：判断变更是否可以继续推进的验证边界。
- [[ofive-frontend-unit|Frontend Unit]]：前端逻辑、状态流、注册中心和插件局部行为验证。
- [[ofive-browser-e2e|Browser E2E]]：用户路径和工作台交互验证。
- [[ofive-mouse-drag-audit|Mouse Drag Audit]]：高保真拖拽和命中区域审计。
- [[ofive-rust-core-test|Rust Core Test]]：后端业务能力、查询能力和模块边界验证。
- [[ofive-rust-sidecar-test|Rust Sidecar Test]]：主应用与 AI sidecar 的真实联动验证。
- [[ofive-go-sidecar-test|Go Sidecar Test]]：AI 辅助运行时和 provider 封装验证。
- [[ofive-performance-smoke|Performance Smoke]]：关键路径性能退化检测。
- [[ofive-release-gate|Release Gate]]：发布前完整质量门。

## 选择原则

1. 改概念边界，补文档和相关测试。
2. 改前端组件，跑前端单测和用户路径。
3. 改工作台交互，补 E2E。
4. 改后端模块，跑后端测试面。
5. 改 AI 或 sidecar，跑 sidecar 相关测试面。
6. 改发布或构建流程，跑发布相关质量门。
