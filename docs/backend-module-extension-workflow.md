# ofive 后端模块扩展标准流程 v1

> 这是后端专项流程文档。
>
> 如果你要新增的是完整功能，而不是纯后端能力，请先看总流程文档：`docs/feature-extension-workflow.md`。
> 如果你要继续推进多端同步模块，请同时参考：`docs/sync-module-roadmap.md`。
> 本文只负责回答“后端模块如何接入平台、如何保持模块边界稳定”。

## 1. 文档定位

本文档定义当前 ofive 后端新增模块或扩展现有模块时的标准接入流程。

这份流程文档的目标不是描述“未来理想自动脚手架”，而是约束“当前仓库里已经落地、已经有工程守卫支撑、可以长期复用”的做法。

适用场景：

- 新增一个后端业务模块
- 为现有模块新增命令、事件、capability 或持久化 owner
- 让 AI 或其他模块通过稳定边界消费某个模块能力
- 对模块边界进行收敛，而不是继续把实现细节泄漏到公共层

不适用场景：

- 只改某个模块内部实现、且不新增任何对外边界
- 只修复局部 bug、且不涉及命令、事件、能力、持久化、跨模块依赖
- 主要是前端插件、宿主服务、store 或 API wrapper 扩展，但不新增后端边界

## 1.1 快速 Checklist

需要一个日常可执行的简化版时，直接按这份清单过一遍。

### 新增模块快速检查

- [ ] 先确认这件事真的需要新模块，而不是扩展现有模块。
- [ ] 先定好稳定 `module_id` 和模块职责边界。
- [ ] 先在模块内落实现，再补平台接入，不要先改中央文件。
- [ ] 先写 `*_backend_module_manifest()`，再写 contribution。
- [ ] 如果有 command，把命令 ID 放在命令模块本地，并接入显式 handler。
- [ ] 如果有 capability，在模块内同时提供 catalog 和 execution。
- [ ] 如果有事件，只把 `UiBridge` 事件接到宿主前端桥接。
- [ ] 如果有私有状态，声明 persistence owner，不要绕过协议直写私有存储。
- [ ] 给业务模块补边界模板，限制 app/infra 私有实现的可访问范围。
- [ ] 跑 contribution、architecture guard、cargo check、cargo test，并补必要测试。

### 扩展现有模块快速检查

- [ ] 优先复用现有模块边界，不额外拆新公共层。
- [ ] 新增对外能力前，先确认它是 command、capability、event 还是 persistence owner。
- [ ] 命令 ID、事件 ID、capability ID 都只保留一个事实源，不双写字符串。
- [ ] 不让 AI 或其他模块直接依赖本模块私有 app/infra 实现。
- [ ] 只有在形成稳定跨模块入口时，才更新平台公共依赖面。
- [ ] 改完后至少过一遍自检和相关测试。

### 提交前最后确认

- [ ] 主要改动是否仍然收敛在模块自己的边界内。
- [ ] 是否新增了不必要的公共依赖面或共享 DTO。
- [ ] 是否已经同步文档或流程说明。

## 2. 当前平台已经提供的稳定入口

当前后端模块接入平台时，优先围绕以下入口工作：

- `src-tauri/src/backend_module_manifest.rs`
  - 模块统一 manifest 入口
- `src-tauri/src/module_contribution.rs`
  - 模块 contribution 结构与一致性校验
- `src-tauri/src/module_boundary_template.rs`
  - 模块私有边界模板
- `src-tauri/src/platform_public_surface.rs`
  - 平台公共依赖面清单
- `src-tauri/src/architecture_guard.rs`
  - 公共/私有边界源码级守卫
- `src-tauri/src/host/command_registry.rs`
  - Tauri 命令显式注册与命令 ID 一致性校验
- `src-tauri/src/host/events/mod.rs`
  - 前端桥接事件清单与事件边界校验

当前已明确的架构原则：

1. 保持 Tauri 原生命令注册方式，不对 `tauri::generate_handler!` 做额外抽象。
2. 模块优先通过 manifest 接入平台，而不是分别到多处补零散注册。
3. 跨模块协作优先依赖 capability、shared contract、platform facade、host event bridge 等稳定公共边界。
4. 不允许把其他模块的 app/infra 私有实现当作长期公共 API 直接依赖。

## 3. 新增模块前先判断三件事

在开始写代码前，先明确以下问题：

### 3.1 这是新模块，还是现有模块扩展？

如果只是给 Vault、AI、Host Platform 追加能力，优先在现有模块内闭环，不要为了“看起来独立”再拆一个新模块。

只有在以下情况更适合新建模块：

- 该功能有清晰的长期业务边界
- 它需要独立演进自己的命令、事件、能力或持久化状态
- 它的实现不应继续挂靠到 AI/Vault/Host Platform 内部

### 3.2 它的对外能力面是什么？

先列清楚模块真正需要对外暴露的边界：

- 是否需要新增 Tauri command
- 是否需要新增 capability
- 是否需要向前端桥接事件
- 是否需要 module-private persistence owner
- 是否需要被 AI 或其他模块消费

如果答案只是“内部实现变了”，那通常不应新增公共边界。

### 3.3 其他模块会通过什么边界使用它？

推荐顺序：

1. shared contract
2. capability
3. platform facade
4. host event bridge

不推荐：

1. 直接 import 该模块 app service
2. 直接 import 该模块 infra adapter
3. 直接复用该模块私有 DTO / store / helper

## 4. 标准实施流程

## 4.1 定义模块身份与边界

先确定：

- `module_id`
- 模块职责
- 模块归属的命令、事件、capability、persistence owner

要求：

- `module_id` 必须稳定、唯一、可长期使用
- 命名应表达业务语义，而不是临时实现细节

当前可参考：

- `ai-chat`
- `vault`
- `host-platform`
- `sync`（当前已接入模块身份与 persistence owner，后续同步流程应优先通过 `src-tauri/src/app/vault/sync_facade.rs` 消费 Vault）

## 4.2 先在模块目录内落业务实现

当前仓库还没有完全切到 `modules/<name>/...` 目录形态，因此 v1 流程遵循“按现有分层目录组织，但模块内部实现尽量聚拢”的做法。

通常需要落这些位置：

- `src-tauri/src/app/<module>/`
- `src-tauri/src/domain/<module>/` 或复用稳定 domain 平台层
- `src-tauri/src/infra/<module>/`，如果确实需要模块私有 infra
- `src-tauri/src/host/commands/`，如果需要新增命令入口
- `src-tauri/src/host/events/`，如果需要新增前端桥接事件

原则：

- 业务用例编排放 app
- 稳定产品语义放 domain
- 技术实现放 infra
- 宿主桥接只放 host

## 4.3 先写模块 manifest，再接 contribution

这是当前流程的核心要求。

新增模块时，应先提供模块自己的 manifest 函数，而不是先到平台中央文件写散落注册。

现有样板：

- `src-tauri/src/app/ai/module_contribution.rs`
- `src-tauri/src/app/vault/module_contribution.rs`
- `src-tauri/src/host/module_contribution.rs`

最低要求：

- 提供 `*_backend_module_contribution()`
- 提供 `*_backend_module_manifest()`

manifest 当前至少应收敛：

- `module_id`
- `contribution`
- `boundary_template`，测试态

这一步完成后，再把该 manifest 接入 `builtin_backend_module_manifests()`。

## 4.4 命令接入流程

如果模块需要新增 Tauri command，按以下顺序操作：

1. 在对应的命令文件中实现命令函数。
2. 在该命令文件里声明本模块的命令 ID 常量列表。
3. 在模块 contribution 里复用命令 ID 常量，不重复手写字符串。
4. 在 `src-tauri/src/host/command_registry.rs` 的显式 handler 列表中补上 handler。

约束：

- 命令 ID 的事实源应在命令模块本地
- command registry 只负责显式装配，不应重新维护一份业务语义
- contribution 与显式 handler 必须保持一致，启动前自检会校验

这一步为什么还需要改中央注册表：

- 因为当前仍保持 Tauri 原生 `generate_handler!` 显式注册
- 这是有意保留的宿主边界，不是尚未清理的历史问题

## 4.5 Capability 接入流程

如果模块需要对 AI、frontend 或 sidecar 暴露能力，按以下顺序操作：

1. 在模块内提供 capability catalog 函数。
2. 在模块内提供 capability execution 函数。
3. 在 module contribution 里挂上 `capability_catalog` 与 `capability_execute`。
4. 确保 descriptor、execution route、module ownership 一致。

当前样板：

- `src-tauri/src/domain/capability/vault_catalog.rs`
- `src-tauri/src/app/vault/capability_execution.rs`

要求：

- descriptor 与执行实现保持同模块维护
- capability ID 必须唯一
- descriptor 必须声明权限、consumer、输入输出契约
- 有 catalog 就必须有 execution，反之亦然

禁止做法：

- 把新 capability 继续堆回中央 builtin 大表
- 把多个模块的执行逻辑重新堆回一个全局 `match`

## 4.6 事件接入流程

如果模块需要向前端桥接事件，按以下顺序操作：

1. 在 `src-tauri/src/host/events/` 下新增或扩展模块事件文件。
2. 在该文件内定义稳定事件常量和事件描述列表。
3. 在 module contribution 中复用事件描述，而不是手写事件字符串。
4. 仅将 `UiBridge` 事件纳入宿主显式桥接边界。

当前样板：

- `src-tauri/src/host/events/ai_events.rs`

要求：

- 先明确事件种类：`Domain`、`UiBridge`、`Runtime`
- 前端桥接只能接 `UiBridge`
- 事件命名必须稳定，避免模块外部依赖临时字符串

## 4.7 Persistence 接入流程

如果模块需要 module-private 状态，按以下顺序操作：

1. 明确该状态是否真的属于模块私有持久化。
2. 为该模块声明稳定的 persistence owner。
3. 在 module contribution 中登记该 owner。
4. 通过宿主持久化协议访问，不直接绕过平台写私有存储。

要求：

- `owner` 与 `module_id` 对齐
- 未声明 owner 的请求会被运行时拒绝
- 共享配置不应承载模块私有状态

如果某个结构会被多个模块稳定共享，应优先提炼到 shared contract，而不是塞到某个模块的私有 store 里让别人绕用。

## 4.8 声明私有边界模板

如果是业务模块，就应声明自己的私有边界模板。

当前入口：

- `src-tauri/src/module_boundary_template.rs`

当前做法：

- 在模块 manifest 中挂入 `boundary_template`
- 模板中声明私有命名空间、允许访问路径、规则说明

要求：

- app 私有实现默认只允许本模块和必要宿主桥接层访问
- infra 私有实现默认只允许本模块 app/infra 访问
- 允许路径必须尽量窄，不要用大范围兜底

如果新增业务模块但没有边界模板，测试应直接失败。

## 4.9 检查是否需要新增平台公共依赖面

不是每个新模块都需要改公共面。

只有在模块需要对外提供“稳定跨模块依赖入口”时，才应更新：

- `src-tauri/src/platform_public_surface.rs`

判断标准：

1. 这是稳定平台语义，而不是模块内部实现吗？
2. 它会被多个模块长期依赖吗？
3. 它应该被视为平台级 contract / facade / registry 吗？

如果答案不是明确的“是”，就不应把它提到公共面。

## 4.10 补测试与工程校验

新增模块或新增模块边界后，至少要覆盖以下验证：

1. 模块 contribution 一致性
2. manifest 唯一性与对齐关系
3. 命令注册一致性
4. 事件注册一致性
5. capability catalog / execution 闭环
6. architecture guard
7. 与新增后端接口对应的单元测试或集成测试

当前常用验证命令：

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib module_contribution
cargo test --manifest-path src-tauri/Cargo.toml --lib architecture_guard
cargo test --manifest-path src-tauri/Cargo.toml --lib host::command_registry
cargo test --manifest-path src-tauri/Cargo.toml --lib host::events
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

如果新增的是前端可调用接口，还应补对应集成测试，满足仓库现有集成测试要求。

## 5. 新模块最小交付清单

一个新业务模块至少应交付：

1. 模块实现代码，按 app/domain/infra/host 分层放置
2. 模块 contribution 函数
3. 模块 manifest 函数
4. 命令 ID、事件描述、capability 或 persistence owner 中实际需要的部分
5. 私有边界模板
6. 必要的 shared contract 或 capability contract
7. 单元测试
8. 必要的集成测试
9. 规划文档或流程文档更新，说明新模块的公共边界

## 6. 代码评审检查表

提交前应逐项自查：

1. 模块是否优先在自身目录内闭环，而不是把逻辑摊到多个公共文件。
2. 是否先写 manifest，再接 contribution 和边界模板。
3. command ID / event ID 是否以模块本地定义为事实源。
4. capability 是否在模块内同时声明 descriptor 与 execution。
5. 是否错误地把私有实现抬升成公共依赖面。
6. 是否让 AI 或其他模块直接依赖了本模块的 app/infra 私有实现。
7. persistence owner 是否已声明并通过协议使用。
8. architecture guard 和 contribution 校验是否能通过。
9. 是否补了必要测试，而不是只做了编译通过。

## 7. v1 边界与后续演进

这份标准流程文档是 v1，代表“当前已经可以稳定执行”的方式，不代表最终形态。

当前仍然保留的人工装配点：

- `builtin_backend_module_manifests()` 仍需要手动把新模块 manifest 接入
- `tauri::generate_handler!` 仍需要显式补 handler
- 平台公共依赖面仍是平台级清单，不是完全内嵌到模块 manifest
- 事件 payload 契约和更细粒度平台 facade 还会继续收敛

但对当前阶段来说，这套流程已经满足两个关键目标：

1. 新模块接入不再依赖零散、多点、隐式约定。
2. 多个 Agent 并行扩展不同模块时，大部分改动都可以收敛在各自模块边界内。

## 8. 推荐样板

如果要新增业务模块，当前最值得对照的样板是：

- Vault 模块：命令多、capability 完整、边界最清晰
- AI 模块：事件桥接与 persistence owner 较完整
- Host Platform：展示“平台自身也通过 manifest/contribution 纳入统一装配视图”的做法

可优先参考：

- `src-tauri/src/app/vault/module_contribution.rs`
- `src-tauri/src/app/vault/sync_facade.rs`
- `src-tauri/src/app/vault/capability_execution.rs`
- `src-tauri/src/domain/capability/vault_catalog.rs`
- `src-tauri/src/app/ai/module_contribution.rs`
- `src-tauri/src/host/module_contribution.rs`

一句话原则：先在模块内闭环，再通过 manifest 接入平台；先提炼稳定边界，再允许跨模块依赖。