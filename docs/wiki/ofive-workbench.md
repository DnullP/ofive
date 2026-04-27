---
title: ofive Workbench
kind: atomic-term
status: active
updated: 2026-04-27
owners:
  - frontend
tags:
  - ofive
  - workbench
  - layout
concepts:
  - 工作台
  - 主工作区
  - 侧边栏
  - 活动栏
related:
  - ofive-workbench-host
  - ofive-activity
  - ofive-panel
  - ofive-tab
---

# ofive Workbench

Workbench 是承载 activity、侧边栏、panel、主工作区、tab 和 overlay 的用户界面框架。它把插件贡献组织成可操作的知识工作台。

## 边界

Workbench 是界面结构，不是业务事实源。它可以恢复布局、打开 tab、激活 panel，但不拥有笔记内容、查询结果或插件私有状态。

Workbench 与 [[ofive-workbench-host|Workbench Host]] 也不同。Workbench 是概念上的用户界面框架，Workbench Host 是把注册贡献投影到该框架的宿主适配层。

## 关系

- [[ofive-activity|Activity]] 是工作台的功能入口。
- [[ofive-panel|Panel]] 是侧边栏中的功能区域。
- [[ofive-tab|Tab]] 是主工作区中的内容实例。
- [[ofive-overlay|Overlay]] 是覆盖在工作台之上的临时交互层。

## 维护要点

1. 工作台布局状态应与业务状态分离。
2. 插件贡献应通过注册表进入工作台。
3. 布局恢复必须能处理插件缺失和 Vault 切换。
4. 新增工作台交互时，应明确它属于布局能力还是业务能力。
