---
title: "ofive Plugin Discovery"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "frontend"
tags:
  - "ofive"
  - "plugin"
  - "runtime"
concepts:
  - "插件发现"
  - "候选插件"
  - "激活顺序"
related:
  - "ofive-plugin-runtime"
  - "ofive-plugin-activation"
  - "ofive-plugin"
---

# ofive Plugin Discovery

Plugin Discovery 是插件运行时建立候选插件集合的阶段。它回答“哪些功能单元可能被宿主激活”。

## 边界

Plugin Discovery 只建立候选集合，不代表插件已经获得界面入口、状态权限或业务能力。候选插件必须经过 [[ofive-plugin-activation|Plugin Activation]] 才能贡献扩展点。

## 关系

- [[ofive-plugin-runtime|Plugin Runtime]] 负责发现流程。
- [[ofive-plugin|Plugin]] 是被发现和激活的功能贡献单元。
- [[ofive-extension-registry|Extension Registry]] 只接收已激活插件的贡献。

## 维护要点

1. 发现规则应稳定、可预测。
2. 内部子能力不应被误识别为宿主插件。
3. 发现顺序变化可能影响插件激活顺序，需要作为运行时治理事项处理。
