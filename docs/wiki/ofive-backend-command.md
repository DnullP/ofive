---
title: "ofive Backend Command"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "backend"
tags:
  - "ofive"
  - "backend"
  - "command"
concepts:
  - "后端命令"
  - "前后端桥接"
  - "调用入口"
related:
  - "ofive-backend-module"
  - "ofive-command"
  - "ofive-public-surface"
---

# ofive Backend Command

Backend Command 是前端可调用的后端入口。它把前端请求桥接到后端应用服务或基础设施能力。

## 边界

Backend Command 面向前后端边界，不等同于前端 [[ofive-command|Command]]。前端 Command 表达用户意图，Backend Command 表达宿主可调用能力入口。

## 关系

- [[ofive-backend-module|Backend Module]] 通常拥有命令语义。
- [[ofive-public-surface|Public Surface]] 约束命令对外暴露方式。
- [[ofive-capability|Capability]] 可在更高层描述受控系统能力。

## 维护要点

1. 命令输入输出应稳定。
2. 命令应委托到模块 owner，而不是直接散落业务逻辑。
3. 命令错误应能被前端解释和展示。
