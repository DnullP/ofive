---
title: "ofive Settings Surface"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "frontend"
  - "maintainers"
tags:
  - "ofive"
  - "settings"
  - "governance"
concepts:
  - "设置入口"
  - "配置贡献"
  - "用户偏好"
related:
  - "ofive-managed-store"
  - "ofive-plugin"
  - "ofive-workbench-host"
  - "ofive-frontend-runtime"
---

# ofive Settings Surface

Settings Surface 是系统和插件暴露配置能力的统一入口。它让用户设置不散落在各个功能面板中，也让维护者能追踪设置项的 owner。

## 边界

Settings Surface 是配置交互界面，不是状态 owner。真实状态应归属于宿主 store、插件 store 或后端配置。

Settings Surface 也不是任意调试入口。只有用户可理解、可长期维护的配置项才应进入设置表面。

## 关系

- [[ofive-managed-store|Managed Store]] 可向设置表面贡献设置项。
- [[ofive-plugin|Plugin]] 可以通过自己的 store 暴露插件设置。
- [[ofive-workbench-host|Workbench Host]] 将设置页作为工作台内容呈现。
- [[ofive-frontend-runtime|前端运行时]] 负责同步配置状态。

## 维护要点

1. 每个设置项必须有明确 owner。
2. 设置项默认值和持久化语义应清晰。
3. 设置修改后应有可见反馈或可推断结果。
4. 删除设置项前，应考虑历史配置的迁移或忽略策略。
