---
title: "ofive Activity"
kind: "atomic-term"
status: "active"
updated: "2026-04-27"
owners:
  - "frontend"
tags:
  - "ofive"
  - "activity"
  - "workbench"
concepts:
  - "功能入口"
  - "活动栏"
  - "面板容器"
related:
  - "ofive-workbench"
  - "ofive-panel"
  - "ofive-extension-registry"
  - "ofive-workbench-host"
---

# ofive Activity

Activity 是工作台上的功能入口。它通常表现为活动栏图标，可以激活一组 panel，也可以执行一个回调动作。

## 边界

Activity 是入口，不是内容本身。它负责把用户带到功能域，但不应承载复杂业务状态。

Activity 也不是 Panel。一个 Activity 可以关联多个 Panel，也可以不关联任何 Panel。

## 关系

- [[ofive-extension-registry|Extension Registry]] 接收 Activity 注册。
- [[ofive-workbench-host|Workbench Host]] 将 Activity 投影到工作台。
- [[ofive-panel|Panel]] 可以通过 Activity 分组展示。
- [[ofive-command|Command]] 可由 Activity 回调触发。

## 维护要点

1. Activity 标识应稳定，避免破坏布局恢复。
2. Activity 标题和图标应清晰表达功能域。
3. Activity 排序应可预测。
4. 删除 Activity 前，应评估关联 Panel 和布局恢复影响。
