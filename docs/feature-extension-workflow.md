# ofive 前后端功能扩展长期工作流 v1

## 1. 文档定位

本文档定义当前 ofive 新增功能时的长期扩展工作流，覆盖三类场景：

- 前端功能扩展
- 后端功能扩展
- 前后端联动功能扩展

它的目标不是描述理想中的未来脚手架，而是把当前仓库中已经落地、已经有边界支撑、已经适合长期复用的做法统一成一份总流程。

本文档回答四个问题：

1. 一个新功能应该先落在哪一层。
2. 前端该走插件、宿主服务、store 还是 API wrapper。
3. 后端该走现有模块扩展、还是新增模块接入。
4. 前后端联动时，状态同步、事件传播、接口契约该怎么收敛。

相关专项文档：

- 后端专项流程：`docs/backend-module-extension-workflow.md`
- 前端插件开发说明：`docs/plugin-development-guide.md`
- 同步模块待办与续做入口：`docs/sync-module-roadmap.md`
- 后端基线目标与结论：`docs/backend-parallel-agent-target.md`

## 1.1 快速 Checklist

日常新增功能时，先用这份简化清单做第一轮判断。

### 全功能通用检查

- [ ] 先判断这是前端功能、后端能力，还是前后端联动功能。
- [ ] 先判断是否能扩展现有边界，不要默认新建公共层。
- [ ] 先确认唯一事实源：命令 ID、事件 ID、feature flag、注册 ID 不双写。
- [ ] 先确认功能所有权：谁拥有状态、谁拥有副作用、谁对外暴露稳定接口。
- [ ] 新功能优先在自己的边界内闭环，不先改 `App.tsx`、中央注册表或公共实现细节。
- [ ] 只有在形成稳定复用入口时，才新增公共契约、公共 facade 或平台公共依赖面。
- [ ] 改完后同步补测试和文档，不以“编译通过”代替交付完成。

### 前端功能快速检查

- [ ] UI 扩展是否应该作为插件入口放到 `src/plugins/`。
- [ ] 宿主运行时副作用是否应该进入 `src/host/`，而不是塞进插件或 `App.tsx`。
- [ ] 状态是否有明确 owner，对应 store 是否唯一。
- [ ] 调后端是否统一经过 `src/api/` wrapper，不在组件里直接散落 `invoke/listen`。
- [ ] 读型插件是否优先订阅语义事件，而不是直接消费底层原始事件。
- [ ] 如果解析 Markdown 文本，是否通过 `markdownBlockDetector` 过滤块级结构。

### 后端功能快速检查

- [ ] 优先按 `docs/backend-module-extension-workflow.md` 判断是扩展现有模块还是新增模块。
- [ ] command、event、capability、persistence owner 是否都只保留一个事实源。
- [ ] AI 或其他模块是否只依赖稳定 capability/facade/contract，而不是私有 app/infra 实现。
- [ ] 若新增公共面，是否真的是稳定跨模块依赖入口。

### 前后端联动快速检查

- [ ] 后端命令、事件、contract 是否先稳定，再接前端。
- [ ] 前端 API wrapper 是否与后端命令/事件一一对应。
- [ ] 前端订阅的是底层事件还是语义事件，是否选对层级。
- [ ] 状态变化是否只在一个 owner store 内归一，再向外广播。
- [ ] 是否补了前端测试、后端测试，以及必要的前后端集成测试。

## 2. 功能分类：先判断它属于哪一类

开始编码前，先回答这三个问题：

### 2.1 它是前端功能、后端能力，还是联动功能？

建议按影响面分类：

- 只影响前端 UI 组合、交互、宿主体验：优先视为前端功能
- 只新增命令、事件、capability、持久化、索引或后端用例：优先视为后端能力
- 同时新增后端入口和前端消费路径：视为联动功能

### 2.2 它应该落在已有边界里，还是需要新边界？

优先顺序：

1. 扩展现有功能模块
2. 扩展现有宿主服务/registry/store
3. 在现有模块下新增一个局部子边界
4. 最后才是新增公共边界或新模块

### 2.3 谁拥有它的状态与副作用？

必须在实现前明确：

- 哪个 store 拥有这份状态
- 哪个模块负责调用后端或监听事件
- 哪个层负责把底层事件转换成更稳定的语义事件
- 哪个层对外暴露稳定入口

如果这四件事答不清楚，代码大概率会重新流回顶层壳层或公共热点文件。

## 3. 当前前端稳定边界

当前前端已经形成几类稳定边界，新增功能优先在这些入口内落地。

### 3.1 业务插件边界

适合放在插件边界的内容：

- activity / panel / tab 扩展
- 跟随当前文件或上下文的业务面板
- 业务语义事件消费
- feature flag 控制下的功能入口注册

当前入口：

- `src/plugins/pluginRuntime.ts`
- `src/plugins/*Plugin.tsx`
- `src/host/registry/activityRegistry.ts`
- `src/host/registry/panelRegistry.ts`
- `src/host/registry/tabComponentRegistry.ts`

规则：

1. `src/plugins/` 里的入口文件应导出 `activatePlugin()`。
2. 顶层入口负责注册和清理，不把纯 helper/纯实现直接放进自动扫描目录。
3. 业务功能优先插件化，而不是回到 `App.tsx` 做集中注册。

### 3.2 宿主服务边界

适合放在宿主服务边界的内容：

- 窗口效果同步
- 拖拽支持
- 原生运行时判定
- 非业务性的 UI 壳层副作用

当前样板：

- `src/host/window/useWindowEffectsSync.ts`
- `src/utils/windowDragGesture.ts`

规则：

1. 宿主环境副作用不进业务插件。
2. 宿主环境副作用不长期留在 `App.tsx`。
3. 这类逻辑优先抽成 `host/*` 下的独立 hook、service 或 facade。

### 3.3 前端状态边界

适合进入 store 的内容：

- 具有明确 owner 的跨组件共享状态
- 需要订阅/快照读取的运行时状态
- 需要将后端快照归一为前端消费模型的状态

当前入口：

- `src/host/store/configStore.ts`
- `src/host/store/vaultStore.ts`
- `src/host/store/themeStore.ts`
- `src/host/store/editorContextStore.ts`

规则：

1. 一个状态只应有一个 owner store。
2. store 对外暴露的快照和更新入口应尽量稳定。
3. 组件不直接承担跨组件状态归一逻辑。

### 3.4 前端 API 与事件边界

前端调用后端，优先通过 `src/api/`；前端跨模块传播语义，优先通过 `appEventBus`。

当前入口：

- `src/api/vaultApi.ts`
- `src/api/aiApi.ts`
- `src/api/windowApi.ts`
- `src/host/events/appEventBus.ts`

规则：

1. 组件和插件不直接散落 `invoke()` 与底层 `listen()`。
2. 后端原始事件应先经过 API wrapper 和 bus，再由消费方订阅。
3. 如已存在语义事件，例如 `persisted.content.updated`，读型功能优先订阅语义事件，而不是底层 `vault.fs`。

## 4. 当前后端稳定边界

后端长期扩展仍以专项流程文档为准，这里只保留总流程需要的判断标准。

### 4.1 后端扩展优先级

新增后端能力时，优先顺序如下：

1. 扩展现有模块内部边界
2. 补模块自身 command / event / capability / persistence owner
3. 补 manifest / contribution / boundary template
4. 只有确实形成稳定共享入口时，才更新平台公共依赖面

### 4.2 后端专项入口

新增或扩展后端能力时，优先围绕这些入口工作：

- `src-tauri/src/backend_module_manifest.rs`
- `src-tauri/src/module_contribution.rs`
- `src-tauri/src/module_boundary_template.rs`
- `src-tauri/src/platform_public_surface.rs`
- `src-tauri/src/host/command_registry.rs`
- `src-tauri/src/host/events/mod.rs`

详细要求见：`docs/backend-module-extension-workflow.md`

## 5. 前后端联动功能的标准流程

新增联动功能时，推荐按下面的顺序做，而不是前端、后端各自随意推进。

### 5.1 先定义稳定能力面

先回答：

- 这是 command、event、capability，还是已有能力的组合？
- 前端最终需要的是“命令返回值”还是“持续事件流”？
- 这份数据应该在哪一层变成前端语义模型？

原则：

1. 后端先稳定边界，再让前端消费。
2. 前端不要围绕临时 DTO 或临时字符串搭建长期逻辑。

### 5.2 后端先形成单一事实源

后端需要先固定：

- command ID
- event ID
- capability ID
- 输入输出 contract

然后前端 API wrapper 再围绕这些稳定事实源接入。

### 5.3 前端通过 API wrapper 承接后端边界

联动功能新增后，优先在 `src/api/` 中补一层 wrapper，再让插件、store、宿主服务消费。

不要直接在组件里：

- 写命令字符串
- 写事件字符串
- 分散处理原始 payload

### 5.4 再决定前端 owner

前端拿到后端能力后，必须再判断 owner：

- 如果它是跨组件状态，进入 store
- 如果它是业务 UI 扩展，进入插件边界
- 如果它是宿主环境副作用，进入 `host/*` 服务边界
- 如果它只是局部渲染数据，停留在组件局部

### 5.5 再决定事件层级

新增联动时，不要跳过语义层直接用底层事件。

优先顺序：

1. 后端原始事件
2. API wrapper / appEventBus 桥接
3. 前端语义事件
4. 业务消费方订阅

这样可以减少多个功能都去理解底层事件细节，降低耦合和冲突面。

## 6. 长期边界规则

### 6.1 `App.tsx` 只保留壳层装配职责

`App.tsx` 当前应主要负责：

- 顶层布局装配
- 必要宿主 hook 启动
- 初始 tab / builtin 装配

不应持续堆积：

- 业务功能注册
- 业务文件同步细节
- 宿主窗口实现细节
- 多个 feature flag 的集中分发逻辑

### 6.2 业务功能优先插件化

如果一个功能主要表现为 activity、panel、tab 或内容跟随面板，它默认应优先走插件边界，而不是 host shell。

### 6.3 宿主副作用优先进入 `host/*`

如果一个功能本质是窗口、平台、运行时、壳层副作用，它默认应优先进入 `host/*`，而不是业务插件或顶层组件。

### 6.4 统一语义层高于底层事件

如果仓库里已经存在更高层语义事件，优先消费语义事件，不要让多个功能直接共享底层原始 watcher 事件语义。

### 6.5 公共面保持低频变更

无论前端还是后端，公共层都应是低频变更层。新增功能时，应优先证明它确实需要公共化，而不是默认把它抬到共享层。

## 7. 测试与交付 Checklist

### 7.1 前端交付检查

- [ ] 插件/宿主服务/store/API wrapper 的 owner 是否明确。
- [ ] 是否避免直接在组件中散落调用后端接口。
- [ ] 是否给新增宿主服务或插件补了单元测试。
- [ ] 是否补了必要的 registry、event bus、store 或语义事件测试。
- [ ] 如涉及 Markdown 解析，是否覆盖块级结构排除场景。

### 7.2 后端交付检查

- [ ] 是否按后端专项流程补 manifest / contribution / boundary template。
- [ ] 是否过了相关 architecture guard、自检和测试。
- [ ] 是否避免把私有实现抬成跨模块公共入口。

### 7.3 联动功能交付检查

- [ ] 后端命令/事件/contract 是否已经稳定。
- [ ] 前端 API wrapper 是否作为唯一消费入口。
- [ ] 状态 owner 是否单一，是否没有重复归一。
- [ ] 事件层级是否合理，是否没有直接耦合底层 watcher 细节。
- [ ] 是否补了前端测试、后端测试，以及必要的联动集成测试。

## 8. 一句话原则

新增功能时，先判断 owner，再选择边界：业务扩展优先插件化，宿主副作用优先进入 `host/*`，后端能力优先在模块内闭环并通过稳定 contract 接入平台，前后端联动优先先收敛能力面，再实现状态与事件传播。