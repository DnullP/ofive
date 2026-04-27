---
title: "ofive Extension Registry"
kind: "architecture-term"
status: "active"
updated: "2026-04-27"
owners:
  - "frontend"
tags:
  - "ofive"
  - "frontend"
  - "registry"
  - "extension-point"
  - "plugin"
concepts:
  - "扩展点"
  - "注册中心"
  - "Activity"
  - "Panel"
  - "Tab Component"
  - "File Opener"
  - "Overlay"
  - "Command"
related:
  - "ofive-frontend-runtime"
  - "ofive-plugin-runtime"
  - "ofive-workbench-host"
  - "ofive-plugin-system"
  - "ofive-component-glossary"
  - "ofive-activity"
  - "ofive-panel"
  - "ofive-tab"
  - "ofive-file-opener"
  - "ofive-overlay"
  - "ofive-command"
---

# ofive Extension Registry

Extension Registry 是前端宿主维护的扩展点目录。它把“插件想贡献什么能力”转换成“宿主可读取、可排序、可订阅、可注销的描述”。

它的核心价值是解耦：插件不直接修改工作台，工作台也不直接了解每个插件的内部实现。插件只向注册表提交描述，[[ofive-workbench-host|Workbench Host]] 再根据描述生成用户界面。

## 扩展点模型

### [[ofive-activity|Activity]]

Activity 是用户可见的功能入口。它通常表现为活动栏上的图标，可以激活一组面板，也可以触发一个回调动作。

治理要点：Activity 应有稳定标识、清晰标题、明确默认区域和排序策略。

### [[ofive-panel|Panel]]

Panel 是侧边栏中的内容区域。它通常依附于某个 Activity，用于展示当前上下文的辅助信息。

治理要点：Panel 应声明所属 Activity，不应绕过工作台自行控制侧边栏。

### [[ofive-tab|Tab Component]]

Tab Component 是主工作区的内容类型。它描述“某类 tab 应由哪个组件渲染”，而不是某个具体 tab 实例。

治理要点：Tab 类型和 Tab 实例必须分离。类型由注册表管理，实例由工作台打开、激活和持久化。

### [[ofive-file-opener|File Opener]]

File Opener 是文件打开策略。它声明自己支持哪些文件，并把打开请求解析成具体 Tab 定义。

治理要点：同一类文件可有多个 opener，必须有优先级和显式选择策略。

### [[ofive-overlay|Overlay]]

Overlay 是覆盖在工作台之上的临时交互层。它适合命令面板、快速切换和通知等跨区域交互。

治理要点：Overlay 应有明确打开、关闭和焦点释放语义，不应成为长期业务事实源。

### [[ofive-command|Command]]

Command 是用户意图的操作抽象。它可以被快捷键、命令面板、按钮或插件触发。

治理要点：Command 应有稳定 ID、可解释标题、启用条件和失败反馈。

## 注册关系

```text
Plugin Runtime
  -> 插件入口
  -> Extension Registry
  -> Workbench Host
  -> 用户界面
```

这个关系保证插件扩展是声明式的。插件声明贡献，注册表保存贡献，工作台负责投影，用户通过界面触发能力。

## 设计原则

1. 注册表只保存描述，不保存业务事实源。
2. 注册表需要支持订阅变化，因为插件可动态注册和注销。
3. 注册表输出应是稳定快照，避免消费者重复排序或重复推断。
4. 相同标识的注册应有可预测覆盖行为。
5. 注销动作必须由插件清理函数统一执行。

## 与其他词条的关系

- [[ofive-plugin-runtime|Plugin Runtime]]：负责激活插件，插件再向注册表贡献扩展点。
- [[ofive-workbench-host|Workbench Host]]：订阅注册表快照并投影到工作台。
- [[ofive-plugin-system|插件系统]]：Extension Registry 是插件系统的扩展点层。
- [[ofive-component-glossary|核心组件词条]]：汇总前端基础组件词条。

## 维护检查

1. 新增扩展点时，先判断它是否应该成为宿主级概念。
2. 新增注册描述时，补齐 owner、排序、生命周期和注销语义。
3. 修改注册排序时，确认用户布局恢复不受破坏。
4. 修改注册覆盖行为时，确认热重载不会留下旧贡献。
5. 插件需要跨扩展点协作时，优先通过共享宿主概念表达，不要互相直接引用。

## 反模式

- 插件直接修改工作台结构，绕过注册表。
- 注册表保存插件运行时状态。
- 扩展点缺少注销语义。
- Activity 与 Panel 的归属关系不清晰。
- File Opener 之间没有可解释的优先级。
