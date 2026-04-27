---
title: "ofive Plugin"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "frontend"
tags:
  - "ofive"
  - "plugin"
  - "extension"
concepts:
  - "插件"
  - "能力贡献"
  - "扩展单元"
related:
  - "ofive-plugin-system"
  - "ofive-plugin-runtime"
  - "ofive-extension-registry"
  - "ofive-managed-store"
---

# ofive Plugin

Plugin 是 ofive 前端功能扩展的组织单元。它通过注册扩展点贡献 activity、panel、tab、overlay、file opener、command 或设置能力。

## 边界

Plugin 不是独立应用，也不拥有宿主生命周期。插件由 [[ofive-plugin-runtime|Plugin Runtime]] 激活和清理。

Plugin 也不应直接控制工作台结构。它应通过 [[ofive-extension-registry|Extension Registry]] 声明贡献，让宿主决定如何投影。

## 关系

- [[ofive-plugin-system|插件系统]] 定义整体扩展模型。
- [[ofive-plugin-runtime|Plugin Runtime]] 管理生命周期。
- [[ofive-extension-registry|Extension Registry]] 承接扩展点声明。
- [[ofive-managed-store|Managed Store]] 可承载插件暴露的共享状态。

## 维护要点

1. 插件入口应轻量，只做注册、订阅和初始化。
2. 插件必须提供清理逻辑，避免热重载后残留贡献。
3. 插件私有状态不应升级为宿主状态，除非需要跨组件共享或设置贡献。
4. 插件与插件之间应通过宿主概念协作，不应形成隐式依赖。
