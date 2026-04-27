---
title: "ofive Managed Store"
kind: "architecture-term"
status: "active"
updated: "2026-04-27"
owners:
  - "frontend"
  - "maintainers"
tags:
  - "ofive"
  - "frontend"
  - "state"
  - "governance"
  - "store"
concepts:
  - "状态 owner"
  - "状态 schema"
  - "状态流"
  - "设置贡献"
  - "插件状态"
related:
  - "ofive-frontend-runtime"
  - "ofive-app-event-bus"
  - "ofive-workbench-host"
  - "ofive-plugin-runtime"
  - "ofive-plugin-system"
  - "ofive-store-owner"
  - "ofive-state-scope"
  - "ofive-state-schema"
  - "ofive-state-flow"
  - "ofive-store-contribution"
---

# ofive Managed Store

Managed Store 是 ofive 前端状态治理模型。它不是把所有状态集中到一个实现里，而是要求每个可共享状态说明自己的 owner、作用域、状态字段、动作、状态流、失败模式和可选设置贡献。

它解决的问题是：前端状态会随着插件、工作台、配置、Vault 和编辑器增多而变得难以追踪。Managed Store 提供维护者视角，让状态不只是“能用”，也能被理解、被检查、被测试。

## 核心概念

### [[ofive-store-owner|Store Owner]]

Store Owner 是状态事实源的归属。owner 可以是宿主，也可以是插件。

治理要点：一个共享状态只能有一个 owner。多个组件可以订阅同一状态，但不能各自维护冲突的事实源。

### [[ofive-state-scope|State Scope]]

Scope 描述状态的作用域，例如前端本地、Vault 配置、插件私有或后端服务。

治理要点：状态作用域决定它是否需要持久化、是否随 Vault 切换重置、是否能跨插件共享。

### [[ofive-state-schema|State Schema]]

State Schema 描述状态字段、初始值、不变量和对外动作。

治理要点：新增字段时，应说明它是否派生、是否持久化、由哪个动作更新、失败时如何恢复。

### [[ofive-state-flow|State Flow]]

State Flow 描述状态如何变化。简单状态可以是值域流，复杂状态可以是状态机。

治理要点：状态流应覆盖主要更新来源和失败模式。没有状态流说明的共享状态很难维护。

### [[ofive-store-contribution|Store Contribution]]

Contribution 是 store 向宿主贡献的能力，例如设置入口。它让配置 UI 与状态 owner 保持同源。

治理要点：设置贡献应由状态 owner 注册和清理，避免设置页与业务状态漂移。

## 管理对象

Managed Store 适合管理以下状态：

1. 宿主级主题、Vault、配置、快捷键和工作台偏好。
2. 插件暴露给设置页或其他宿主表面的状态。
3. 需要维护者审计字段、动作和失败模式的共享状态。
4. 需要在插件卸载时同步移除的状态贡献。

Managed Store 不适合管理以下状态：

1. 组件内部的临时 UI 状态。
2. 不需要跨组件共享的局部输入状态。
3. 可以从已有事实源即时派生的短期视图状态。
4. 后端数据库或文件系统本身的事实源。

## 与事件的关系

[[ofive-app-event-bus|App Event Bus]] 告诉系统“发生了什么”，Managed Store 决定“状态如何变化”。两者不能互相替代。

例如，持久态内容更新事件可以触发某个 store 重新读取数据，但事件本身不保存读取结果。读取结果应进入对应 owner 的状态。

## 与插件的关系

插件可以拥有自己的 store，并通过 Managed Store 暴露治理信息。这样维护者可以知道插件状态的字段、动作、作用域和设置贡献，而不需要进入插件内部才能理解状态边界。

治理要点：插件私有状态可以留在插件内部；只有跨组件共享、需要设置贡献或需要维护者审计的状态才应注册为 Managed Store。

## 与其他词条的关系

- [[ofive-frontend-runtime|前端运行时]]：Managed Store 是前端运行时的状态治理层。
- [[ofive-app-event-bus|App Event Bus]]：事件触发变化，store 持有状态。
- [[ofive-plugin-runtime|Plugin Runtime]]：插件激活时注册 store，清理时注销 store。
- [[ofive-workbench-host|Workbench Host]]：工作台可消费宿主状态，但不应拥有业务状态。
- [[ofive-plugin-system|插件系统]]：插件状态通过 Managed Store 获得宿主级治理视图。

## 维护检查

1. 新增共享状态时，先确认 owner。
2. 新增字段时，补充字段说明、初始值和持久化语义。
3. 新增动作时，说明会更新哪些字段、有哪些副作用。
4. 新增设置贡献时，确认它随 store 注册和注销。
5. 修改 Vault 切换行为时，确认相关 store 的作用域是否需要重置或重载。

## 反模式

- 多个组件分别维护同一业务事实源。
- store 没有 owner 或 owner 不清晰。
- 状态字段没有不变量和更新动作说明。
- 设置项和实际状态 owner 分离。
- 把后端事实源复制成前端长期事实源且没有同步策略。
