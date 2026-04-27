---
title: "ofive 插件系统"
kind: "architecture"
status: "active"
updated: "2026-04-27"
owners:
  - "frontend"
tags:
  - "ofive"
  - "plugin"
  - "architecture"
concepts:
  - "插件"
  - "扩展点"
  - "注册中心"
related:
  - "ofive-frontend-runtime"
  - "ofive-component-glossary"
  - "ofive-plugin-runtime"
  - "ofive-extension-registry"
  - "ofive-plugin"
  - "ofive-activity"
  - "ofive-panel"
  - "ofive-tab"
  - "ofive-file-opener"
  - "ofive-overlay"
  - "ofive-command"
---

# ofive 插件系统

插件系统是 ofive 前端扩展能力的核心。[[ofive-plugin|Plugin]] 不是独立产品，而是一个受宿主管理的功能贡献单元。

## 插件模型

插件负责声明“我要贡献什么”，宿主负责决定“如何把贡献挂到工作台”。这种分工让功能扩展不需要修改应用壳层。

生命周期由 [[ofive-plugin-runtime|Plugin Runtime]] 管理，扩展点由 [[ofive-extension-registry|Extension Registry]] 承接，最终由 [[ofive-workbench-host|Workbench Host]] 通过 [[ofive-workbench-projection|Workbench Projection]] 投影为界面。

## 扩展点词条

- [[ofive-activity|Activity]]：用户可见的长期功能入口。
- [[ofive-panel|Panel]]：侧边栏内容区域。
- [[ofive-tab|Tab Component]]：主工作区内容类型。
- [[ofive-file-opener|File Opener]]：内容类型到打开方式的解析规则。
- [[ofive-overlay|Overlay]]：临时覆盖层。
- [[ofive-command|Command]]：可被用户或插件触发的动作。

## 插件治理

1. 插件入口应只负责注册和清理。
2. 插件内部状态应留在插件边界内。
3. 跨插件共享能力必须上升为宿主概念。
4. 插件读取后端能力时应通过前端 API 边界。
5. 插件解析 Markdown 时必须尊重块级语法排除规则。

## 典型插件类型

- 内容编辑插件。
- 辅助阅读插件。
- 工作台工具插件。
- AI 能力插件。
- 可视化插件。
- 设置贡献插件。
