---
title: "ofive Plugin Failure Isolation"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "frontend"
tags:
  - "ofive"
  - "plugin"
  - "runtime"
  - "failure"
concepts:
  - "插件失败隔离"
  - "运行时退化"
  - "错误上下文"
related:
  - "ofive-plugin-runtime"
  - "ofive-plugin-activation"
  - "ofive-risk-surface"
---

# ofive Plugin Failure Isolation

Plugin Failure Isolation 是插件运行时的故障边界。它保证单个插件失败时，其他插件和工作台仍能继续运行。

## 边界

失败隔离不是吞掉错误。它应保留错误上下文，并把失败退化为“该插件不可用”，而不是“前端运行时不可用”。

## 关系

- [[ofive-plugin-activation|Plugin Activation]] 可能触发插件启动失败。
- [[ofive-plugin-runtime|Plugin Runtime]] 负责捕获和隔离失败。
- [[ofive-risk-surface|Risk Surface]] 用于维护者判断失败影响范围。

## 维护要点

1. 插件失败不应阻塞其他插件激活。
2. 错误上下文应可用于维护诊断。
3. 失败后的残留贡献必须通过清理机制撤销。
