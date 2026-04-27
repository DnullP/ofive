---
title: "ofive Workbench Projection"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "frontend"
tags:
  - "ofive"
  - "workbench"
  - "frontend"
concepts:
  - "工作台投影"
  - "扩展点渲染"
  - "宿主适配"
related:
  - "ofive-workbench-host"
  - "ofive-extension-registry"
  - "ofive-activity"
  - "ofive-panel"
  - "ofive-tab"
---

# ofive Workbench Projection

Workbench Projection 是把注册表中的扩展点描述转换为工作台界面的过程。它让插件贡献进入活动栏、侧边栏、主工作区和覆盖层。

## 边界

Workbench Projection 负责“如何显示”，不拥有插件业务状态。它可以投影 activity、panel、tab component 和 overlay，但不能把这些贡献改写成宿主私有业务逻辑。

## 关系

- [[ofive-extension-registry|Extension Registry]] 提供可投影描述。
- [[ofive-workbench-host|Workbench Host]] 执行投影。
- [[ofive-activity|Activity]]、[[ofive-panel|Panel]] 和 [[ofive-tab|Tab]] 是主要投影对象。

## 维护要点

1. 新增投影类型时，应先确认它是否是稳定宿主概念。
2. 投影排序和默认显示策略需要可解释。
3. 投影层不应保存业务事实源。
