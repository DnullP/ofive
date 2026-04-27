---
title: "ofive 前端运行时"
kind: "architecture"
status: "active"
updated: "2026-04-27"
owners:
  - "frontend"
tags:
  - "ofive"
  - "frontend"
  - "runtime"
  - "architecture"
concepts:
  - "宿主运行时"
  - "工作台"
  - "事件总线"
  - "状态治理"
related:
  - "ofive-plugin-system"
  - "ofive-component-glossary"
  - "ofive-plugin-runtime"
  - "ofive-extension-registry"
  - "ofive-workbench-host"
  - "ofive-app-event-bus"
  - "ofive-managed-store"
---

# ofive 前端运行时

前端运行时是 ofive 用户界面的宿主层。它负责启动插件、挂载工作台、分发事件、管理共享状态，并把业务扩展投影为可交互界面。

它不是某一个插件，也不是某一个面板。它是一组稳定协议：插件通过 [[ofive-plugin-runtime|Plugin Runtime]] 获得生命周期，通过 [[ofive-extension-registry|Extension Registry]] 声明贡献，通过 [[ofive-workbench-host|Workbench Host]] 被投影到界面，通过 [[ofive-app-event-bus|App Event Bus]] 接收语义事件，并通过 [[ofive-managed-store|Managed Store]] 暴露可治理的共享状态。

## 职责

1. 通过 [[ofive-plugin-runtime|Plugin Runtime]] 发现、激活、重载和清理插件贡献。
2. 通过 [[ofive-extension-registry|Extension Registry]] 接收 activity、panel、tab、overlay、file opener 和 command。
3. 通过 [[ofive-workbench-host|Workbench Host]] 将注册贡献投影为工作台界面。
4. 通过 [[ofive-app-event-bus|App Event Bus]] 连接后端事件、编辑器事件和业务刷新事件。
5. 通过 [[ofive-managed-store|Managed Store]] 管理主题、配置、Vault 状态、快捷键和插件状态的治理视图。
6. 将命令、事件和状态以稳定语义提供给插件和宿主组件。

## 运行时词条

### [[ofive-plugin-runtime|Plugin Runtime]]

Plugin Runtime 是插件生命周期的管理者。它保证插件在启动、热重载、失败隔离和卸载时有一致行为。

### [[ofive-extension-registry|Extension Registry]]

Extension Registry 是宿主维护的扩展点目录。它让插件只声明能力，不直接控制工作台结构。

### [[ofive-workbench-host|Workbench Host]]

Workbench Host 是注册贡献与工作台布局之间的适配层。它负责投影、上下文注入、布局持久化和打开文件协调。

### [[ofive-app-event-bus|App Event Bus]]

App Event Bus 将后端事件、编辑器事件和业务刷新事件整理为稳定前端语义，使读型组件不依赖事件来源细节。

### [[ofive-managed-store|Managed Store]]

Managed Store 是带治理声明的共享状态。它使状态 owner、动作、状态流、失败模式和设置贡献可以被追踪。

## 运行时关系

```text
插件生命周期
  -> 扩展注册
  -> 工作台投影
  -> 事件同步
  -> 状态治理
```

这条关系说明了前端运行时的边界：插件不直接支配界面，注册表不拥有业务事实源，工作台不拥有插件状态，事件总线不替代状态管理，Managed Store 不接管组件内部状态。

## 设计原则

1. 插件只贡献能力，不接管宿主生命周期。
2. 宿主只做组合，不拥有业务私有状态。
3. 事件先抽象成语义，再暴露给业务消费。
4. 工作台状态与业务状态保持分离。
5. 可共享状态必须能说明 owner、作用域、动作和失败模式。
6. 前端运行时词条必须优先解释概念边界，再解释协作关系。
