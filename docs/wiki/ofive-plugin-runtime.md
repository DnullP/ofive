---
title: "ofive Plugin Runtime"
kind: "architecture-term"
status: "active"
updated: "2026-04-27"
owners:
  - "frontend"
tags:
  - "ofive"
  - "frontend"
  - "plugin"
  - "runtime"
  - "lifecycle"
concepts:
  - "插件生命周期"
  - "插件激活"
  - "热重载"
  - "失败隔离"
  - "清理函数"
related:
  - "ofive-frontend-runtime"
  - "ofive-plugin-system"
  - "ofive-extension-registry"
  - "ofive-workbench-host"
  - "ofive-plugin-discovery"
  - "ofive-plugin-activation"
  - "ofive-plugin-failure-isolation"
  - "ofive-plugin-hot-reload"
  - "ofive-plugin-cleanup"
---

# ofive Plugin Runtime

Plugin Runtime 是 ofive 前端插件生命周期的管理者。它回答一个核心问题：插件什么时候被发现、什么时候被激活、失败时如何隔离、更新时如何替换、卸载时如何清理。

它不是业务插件本身，也不决定插件界面长什么样。插件贡献什么能力由插件声明，贡献如何进入宿主由 [[ofive-extension-registry|Extension Registry]] 承接，贡献如何显示由 [[ofive-workbench-host|Workbench Host]] 投影。

## 核心职责

1. 发现可激活插件。
2. 按稳定顺序启动插件。
3. 调用插件入口并接收清理函数。
4. 在插件失败时隔离错误，避免一个插件阻塞整个前端运行时。
5. 在热重载时先清理旧实例，再激活新实例。
6. 在运行时关闭时逆序清理已激活插件。

## 生命周期

### [[ofive-plugin-discovery|Plugin Discovery]]

发现阶段建立“哪些模块可能是插件”的候选集合。候选集合只代表可被运行时尝试激活，不代表插件已经拥有界面入口。

治理要点：发现规则应稳定、可预测，并排除内部子模块，避免把局部编辑器扩展误识别为宿主插件。

### [[ofive-plugin-activation|Plugin Activation]]

激活阶段执行插件入口。插件入口通常只做注册和订阅，不应直接操纵应用壳层。

治理要点：插件入口应轻量、幂等，并返回清理函数。复杂状态应进入插件内部 store 或 [[ofive-managed-store|Managed Store]]，不应塞进生命周期函数。

### [[ofive-plugin-failure-isolation|Plugin Failure Isolation]]

失败隔离保证单个插件启动失败时，其他插件仍能继续运行。运行时负责捕获失败并记录上下文。

治理要点：插件失败应该退化为“该插件不可用”，不应退化为“整个工作台不可用”。

### [[ofive-plugin-hot-reload|Plugin Hot Reload]]

热重载用于开发期替换插件实现。正确的顺序是先清理旧实例，再激活新实例。

治理要点：热重载能暴露插件清理不完整的问题。若插件重复注册 activity、panel 或事件监听，通常说明清理函数缺失或不完整。

### [[ofive-plugin-cleanup|Plugin Cleanup]]

清理阶段撤销插件注册、事件订阅、状态贡献和其他副作用。

治理要点：插件必须把注册动作与注销动作配对。任何没有清理函数的长期副作用都应被视为维护风险。

## 与其他词条的关系

- [[ofive-extension-registry|Extension Registry]]：Plugin Runtime 激活插件，插件再向注册表贡献能力。
- [[ofive-workbench-host|Workbench Host]]：注册表变化后，Workbench Host 将贡献投影成界面。
- [[ofive-app-event-bus|App Event Bus]]：插件可订阅语义事件，也可发布业务刷新事件。
- [[ofive-managed-store|Managed Store]]：插件拥有的共享状态应通过 Managed Store 暴露治理信息。
- [[ofive-plugin-system|插件系统]]：Plugin Runtime 是插件系统的生命周期层。

## 维护检查

1. 新增插件时，确认插件入口只做注册、订阅和初始化。
2. 新增长期订阅时，确认清理函数会撤销订阅。
3. 新增注册贡献时，确认插件卸载会同步注销贡献。
4. 改动热重载行为时，重点检查重复注册、残留监听和状态泄漏。
5. 插件失败处理应保留错误上下文，但不应中断其他插件启动。

## 反模式

- 插件入口直接持有复杂业务事实源。
- 插件激活失败导致整个前端运行时停止。
- 热重载后出现重复 activity、panel 或事件响应。
- 插件注册贡献但卸载时不注销。
- 插件绕过注册表直接操作工作台布局。
