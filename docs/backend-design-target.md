# [已废弃] ofive 后端目标架构设计

> 废弃说明
>
> 本文档反映的是上一阶段以后端分层、能力治理和宿主边界为核心的规划目标。
> 当前后端规划已切换为以“多个 Agent 并行开发扩展功能时尽量降低公共模块冲突”为首要评估标准。
> 请以 [docs/backend-parallel-agent-target.md](docs/backend-parallel-agent-target.md) 作为新的规划依据。

## 1. 设计背景

当前前端架构已经具备较清晰的层次：

- 宿主基础能力
- 注册中心
- 插件运行时
- 事件与状态
- 具体功能插件

相比之下，当前后端虽然已经可以支撑现有功能，但整体上仍偏向“按功能堆叠模块 + 在 `lib.rs` 汇总命令”的组织方式：

- `lib.rs` 同时承担模块装配、状态初始化、命令注册
- `vault_commands.rs` 既是前端命令入口，又承担了较多对外能力汇总职责
- `ai_service.rs` 既处理 sidecar 生命周期，也处理设置读写、模型发现、流式事件转发
- `state.rs` 当前主要保存少量全局运行时句柄，但尚未形成明确的运行时上下文模型

这种组织方式在当前规模下是可工作的，但对未来目标并不够稳健。特别是在以下方向持续扩展后，现有结构会迅速变得难以维护：

- AI agent 调用前后端更多能力
- 新增更多 sidecar / agent / tool runtime
- 后端形成宿主模块能力的稳定承载面
- 会话、工具调用、审计日志、用户确认等 AI 基础设施逐渐增加
- 单元测试、集成测试、性能基准需要基于稳定模块边界扩展

因此需要设计一版“可扩展、可测试、可演进”的后端目标架构。

## 2. 设计目标

后端目标架构应满足以下目标：

1. **清晰分层**
	- 区分宿主入口层、应用编排层、领域能力层、基础设施层。

2. **面向能力，而非面向页面**
	- 后端不应围绕前端页面组织，而应围绕稳定业务能力组织。

3. **前端调用边界稳定**
	- 前端只感知 command / event / query 这类稳定接口，不感知后端内部实现细节。

4. **AI 能力可纳入统一治理**
	- AI 不应绕过后端直接控制文件系统、前端或 sidecar，而应经过统一的能力注册、权限控制、日志与审计。

5. **sidecar 可替换**
	- Go sidecar 是 AI runtime 执行器，不应成为产品主状态中心。

6. **支持渐进式演进**
	- 目标架构必须允许在现有代码基础上逐步迁移，而不是一次性推倒重来。

## 3. 现状评估

### 3.1 当前已有的优点

当前后端已经具备几个非常有价值的基础：

- Tauri command 边界已经明确，前端通过 `invoke` 访问后端。
- vault 相关能力已经按子模块拆分，例如：
  - `search`
  - `graph`
  - `outline`
  - `frontmatter_query`
  - `wikilink`
- 已有共享状态模型 `AppState`。
- 已有 sidecar 生命周期与 gRPC 通信能力。
- 已有 vault config 持久化能力。
- 已有 watcher / log / trace 等运行时基础设施雏形。

这些说明当前代码不是“混乱不可救”，而是已经具备进入架构化阶段的基础。

### 3.2 当前主要问题

当前主要问题不在“功能是否可用”，而在“边界不稳定”：

1. **入口层过重**
	- `lib.rs` 注册了大量命令，也承担状态装配与插件装配，未来会继续膨胀。

2. **模块职责混合**
	- `ai_service.rs` 混合了：
	  - 设置存储
	  - vendor catalog
	  - sidecar 管理
	  - gRPC 通信
	  - 前端事件转发
	- 这些职责未来会继续扩大，不适合长期放在单文件中。

3. **命令层与应用层未分离**
	- 很多 `#[tauri::command]` 函数直接连接状态、配置和能力实现。
	- 这会导致测试时必须绕着 Tauri 命令入口走，而不是直接测试应用服务。

4. **缺少统一能力注册模型**
	- 当前 vault 能力、AI 能力、前端桥接能力彼此独立存在。
	- 未来 AI 需要调用“全部能力”时，如果没有统一工具注册层，会造成能力分散、权限不可控。

5. **sidecar 定位还偏粗粒度**
	- 当前 Go sidecar 负责 agent runtime 是合理的。
	- 但如果未来进一步承载对话持久化、工具权限、产品状态，会让 sidecar 越权。

## 4. 目标架构总览

建议将后端设计为四层：

1. **Host Layer 宿主入口层**
2. **Application Layer 应用编排层**
3. **Domain Layer 领域能力层**
4. **Infrastructure Layer 基础设施层**

并在这些层之上明确一条横切能力：

- **AI Capability & Tool Governance Layer**

它不是单独的技术层，而是贯穿命令、服务、sidecar、前端桥接的一套统一能力治理机制。

### 4.1 宿主入口层 Host Layer

职责：

- Tauri app 启动与装配
- command 注册
- event 名称注册
- 全局状态注入
- plugin 初始化
- sidecar 宿主绑定

这一层只做装配，不做业务逻辑。

建议保留在：

- `src-tauri/src/lib.rs`
- `src-tauri/src/main.rs`

但需要进一步瘦身，避免继续堆积业务逻辑。

### 4.2 应用编排层 Application Layer

职责：

- 组织一次完整用例
- 拼接状态、配置、领域服务、基础设施
- 处理事务顺序
- 处理日志、审计、事件发射
- 为 command 层提供稳定服务接口

例如：

- 设置当前 vault
- 启动一次 AI 聊天流
- 保存 AI 设置
- 执行一次“AI 工具调用”
- 触发索引刷新、事件广播、配置更新

这一层的核心不是“算法”，而是“用例编排”。

### 4.3 领域能力层 Domain Layer

职责：

- 提供稳定的产品能力模型
- 定义领域对象、输入输出、规则与约束
- 不依赖 Tauri，不依赖具体 UI

这里应沉淀 ofive 的核心能力，例如：

- Vault 能力域
- Search / Graph / Outline 能力域
- AI Conversation 能力域
- AI Tool 能力域
- Workspace / Settings 能力域

领域层是“产品语义”的承载层。

### 4.4 基础设施层 Infrastructure Layer

职责：

- 文件系统
- 配置读写
- watcher
- gRPC client
- sidecar process 管理
- HTTP client
- 日志
- 时间 / trace / ID 生成

它不定义产品能力，只提供技术实现。

## 5. 推荐目录结构

建议目标目录结构如下：

```text
src-tauri/src/
  lib.rs
  main.rs

  host/
	 commands/
		ai_commands.rs
		vault_commands.rs
		workspace_commands.rs
	 events/
		ai_events.rs
		vault_events.rs
	 bootstrap/
		app_setup.rs
		command_registry.rs

  app/
	 ai/
		chat_app_service.rs
		settings_app_service.rs
		tool_app_service.rs
	 vault/
		vault_app_service.rs
		search_app_service.rs
		graph_app_service.rs
	 workspace/
		workspace_app_service.rs

  domain/
	 ai/
		conversation.rs
		tool.rs
		tool_registry.rs
		tool_policy.rs
		vendor.rs
	 vault/
		vault_entry.rs
		wikilink.rs
		outline.rs
		graph.rs
		frontmatter.rs
	 workspace/
		workspace_config.rs

  infra/
	 fs/
		vault_fs.rs
		fs_paths.rs
		watcher.rs
	 persistence/
		vault_config_store.rs
		ai_conversation_store.rs
	 ai/
		sidecar_manager.rs
		grpc_client.rs
		vendor_model_fetcher.rs
	 logging/
		log_bridge.rs
		trace.rs
	 ids/
		id_generator.rs

  runtime/
	 app_state.rs
	 runtime_context.rs

  shared/
	 errors.rs
	 result.rs
	 serde.rs
```

这不是要求一次性重构到位，而是明确未来演进方向。

## 6. 推荐模块职责映射

基于现状，建议按以下映射逐步演进。

### 6.1 现有 `lib.rs`

目标职责：

- 仅负责：
  - 初始化 logging
  - 初始化 app state
  - 调用 bootstrap
  - 注册 commands

不再承载：

- 业务逻辑
- 大量 `pub use` 导出聚合
- 细节能力拼装

### 6.2 现有 `state.rs`

建议演进为两部分：

1. `runtime/app_state.rs`
	- 只保留运行时句柄与共享对象

2. `runtime/runtime_context.rs`
	- 提供统一上下文访问能力，例如：
	  - 当前 vault
	  - 当前 sidecar endpoint
	  - 当前 trace context
	  - 当前用户 / session 信息

关键原则：

- `AppState` 存的是“句柄和共享对象”
- `RuntimeContext` 表达的是“当前请求上下文”

### 6.3 现有 `vault_commands.rs`

建议拆成两层：

1. `host/commands/vault_commands.rs`
	- 只保留 `#[tauri::command]`
	- 做参数校验与错误映射

2. `app/vault/*.rs`
	- 编排具体用例

现有 `vault_commands/` 目录下的大部分模块可以继续保留，但其上层不应再由一个超大 `vault_commands.rs` 统领全部语义。

### 6.4 现有 `ai_service.rs`

建议拆为至少四块：

1. `host/commands/ai_commands.rs`
	- Tauri 命令入口

2. `app/ai/chat_app_service.rs`
	- 聊天启动、流转发、对话落库、事件发射编排

3. `app/ai/settings_app_service.rs`
	- vendor catalog、settings 读取、settings 存储

4. `infra/ai/sidecar_manager.rs`
	- sidecar 生命周期与健康检查

5. `infra/ai/grpc_client.rs`
	- gRPC 客户端连接与调用适配

6. `infra/ai/vendor_model_fetcher.rs`
	- 供应商模型列表 HTTP 获取

这样做的好处是：

- 测试可以直接针对 app service 和 infra adapter 进行
- sidecar 问题与 settings 问题不再混杂
- 为未来 AI tool system 留出自然扩展点

## 7. AI 在后端中的位置

### 7.1 核心判断

AI 的**产品核心**应在 Rust。

AI 的**agent runtime / model runtime**应在 Go。

前端只负责：

- 交互呈现
- 用户授权确认
- 流式内容展示
- 上下文选择与轻量交互辅助

### 7.2 原因

Rust 持有：

- vault 能力
- 本地文件系统访问能力
- 配置持久化能力
- Tauri command 边界
- 事件分发能力
- sidecar 生命周期控制

因此 Rust 才适合作为：

- AI capability governance
- AI conversation source of truth
- tool permission center
- audit / log / trace center

Go 持有：

- ADK
- agent loop
- vendor model 接入
- 流式推理执行

因此 Go 更适合作为：

- planner / runtime / model adapter
- transient memory holder

而不应成为：

- 主数据中心
- 产品能力中心
- 权限中心

## 8. 平台能力注册与 AI Tool 投影建议

如果未来目标是“AI agent 可以调用前后端的全部能力”，并且未来还可能出现其他非 AI sidecar / runtime，也不应让任何外部运行时直接接触：

- 所有 Tauri commands
- 所有前端插件内部方法
- 所有 Rust 内部函数

正确做法是：在 Rust 建立统一 **Capability Registry**，再为 AI 提供一层 **AI Tool Projection**。

### 8.1 Capability Registry 目标

每个平台能力应被建模为稳定能力，而不是临时 API：

- `name`
- `description`
- `input_schema`
- `output_schema`
- `risk_level`
- `requires_confirmation`
- `executor`
- `availability_scope`

并建议补充：

- `supported_consumers`
- `required_permissions`
- `api_version`

这样平台先定义“系统能做什么”，再根据消费者类型投影为不同形式：

- AI tool
- sidecar capability
- frontend capability

### 8.2 平台能力分类

建议分为三类：

1. **Read Tools**
	- 读取笔记
	- 搜索笔记
	- 获取 outline
	- 获取 backlinks
	- 获取 graph

2. **Write Tools**
	- 创建笔记
	- 修改笔记
	- 重命名
	- 删除
	- 修改 frontmatter

3. **UI Tools**
	- 打开某个面板
	- 聚焦某篇笔记
	- 展示 diff
	- 请求用户确认

### 8.3 AI Tool 调用链

推荐流程：

1. 前端向 Rust 发起聊天请求
2. Rust 组装上下文并调用 Go sidecar
3. Go 在推理过程中决定要不要调用工具
4. Go 不直接访问前端或文件系统，而是向 Rust 发起 tool call
5. Rust 执行工具：
	- Rust 本地能力：直接调用应用层服务
	- 前端能力：通过事件或桥接协议请求前端执行
6. Rust 将 tool result 返回给 Go
7. Go 继续推理
8. Rust 记录 tool history / audit / 会话数据

### 8.4 非 AI Sidecar 调用链

对于其他非 AI sidecar / runtime，不应复用“AI tool”语义本身，但应复用同一套 Capability Registry：

1. 外部 runtime 向 Rust 请求 capability catalog
2. Rust 按权限与消费者类型过滤可见能力
3. 外部 runtime 按 capability id 发起能力调用
4. Rust 在统一权限、确认、审计下执行能力
5. Rust 返回结构化结果

这样 AI tool 只是 capability 的一种投影，而不是整个平台能力模型的唯一形态。

### 8.5 关键原则

- Go 看见的是“工具”，不是“应用内部实现”
- 前端看见的是“确认请求 / 结果呈现”，不是“AI 主控制面”
- Rust 是唯一的工具权限裁决点
- 非 AI sidecar 看见的是“平台能力”，不是“Rust 内部函数”

## 9. 平台级稳定契约设计

如果目标是支持类似 VS Code / Obsidian 的高扩展性，后端不能只定义内部模块边界，还必须定义**平台级稳定契约**。

这一层契约的作用是：

- 让前端、sidecar、未来后端扩展都面对稳定接口
- 让内部实现可以持续重构而不破坏扩展
- 让能力注册、事件、工具、配置具备版本演进能力

### 9.1 需要稳定化的契约面

建议至少稳定以下六类契约：

1. **Command Contract**
	- 前端调用 Rust 的命令输入输出协议

2. **Event Contract**
	- Rust 发往前端、扩展、sidecar 的事件名称与 payload 协议

3. **Capability Contract**
	- 后端注册能力的描述模型与查询方式

4. **Tool Contract**
	- AI runtime 调用工具的输入输出 schema 与执行语义

5. **Extension Contract**
	- 后端扩展单元的 manifest、激活条件、权限声明、依赖声明

6. **Persistence Contract**
	- sidecar / runtime 请求宿主持久化能力时的命名空间、版本、并发控制与返回语义

### 9.2 推荐的扩展声明模型

建议后续为每个后端扩展单元引入 manifest 概念，例如：

- `id`
- `displayName`
- `version`
- `apiVersion`
- `activationEvents`
- `contributes`
- `requiredCapabilities`
- `requiredPermissions`
- `dependencies`

其中：

- `apiVersion` 用于约束平台兼容性
- `activationEvents` 决定扩展何时被激活
- `contributes` 描述该扩展向平台贡献了哪些 command / event / capability / tool
- `dependencies` 描述扩展之间的依赖关系

### 9.3 版本与兼容策略

建议平台级契约采用显式版本化策略：

1. command schema 版本化
2. event payload 版本化
3. tool schema 版本化
4. extension manifest 版本化
5. capability descriptor 版本化
6. persistence contract 版本化

建议遵循以下规则：

- 新增字段优先使用向后兼容方式
- 删除字段必须经过弃用期
- 高风险 breaking change 必须提升 `apiVersion`
- Rust 内部重构不得直接破坏已发布契约

### 9.4 当前阶段的落地建议

即使暂时还没有第三方扩展，也建议现在就做两件事：

1. 为 command / event / tool / persistence payload 建立明确的结构体边界
2. 在文档层开始引入 `apiVersion` 和 schema 兼容意识

这样后续从“内建模块”演化到“平台扩展”时不会返工。

## 10. 权限与安全模型建议

当前文档已经强调 AI tool 的风险控制，但如果目标是高扩展性平台，权限模型必须上升为**平台级权限系统**，而不是仅服务于 AI。

### 10.1 权限对象

建议将权限对象拆分为三类：

1. **Capability Permission**
	- 是否允许访问某类平台能力

2. **Tool Permission**
	- 是否允许 AI runtime 调用某个工具

3. **Extension Permission**
	- 是否允许某扩展访问文件、网络、UI bridge、sidecar、日志、后台任务等资源

### 10.2 权限作用域

建议至少支持以下作用域：

- `vault.read`
- `vault.write`
- `vault.delete`
- `vault.search`
- `ui.reveal`
- `ui.open_panel`
- `network.outbound`
- `runtime.sidecar.start`
- `runtime.sidecar.call`
- `task.background.run`
- `config.read`
- `config.write`

这样未来不管是前端触发、AI 触发，还是后端扩展触发，都能统一落在同一权限模型上。

### 10.3 用户授权与确认模型

建议将确认流程分为三层：

1. **静态授予**
	- 安装或启用扩展时授予的长期权限

2. **会话授予**
	- 当前运行会话内临时授权

3. **单次确认**
	- 针对高风险操作，例如删除文件、批量修改、外部网络请求、执行写操作

对于 AI 工具调用，建议默认策略：

- 读操作：可在低风险前提下自动执行
- 写操作：默认确认
- 删除/批量修改/跨文件重构：必须确认
- 网络请求/外部系统调用：必须有显式权限

### 10.4 安全边界原则

建议明确以下原则：

- Go sidecar 不直接拥有 vault 主权限
- 前端插件不直接拥有后端内部实现访问权
- 所有写操作必须经过 Rust 权限裁决
- 所有外部网络访问必须可审计
- 所有高风险操作必须可追踪到用户授权记录

## 11. 任务与运行时模型建议

当后端开始承载 AI、索引、watcher、同步、扩展后台任务时，单纯依赖 command + event 不足以表达完整运行时，需要建立统一的**任务与运行时模型**。

### 11.1 为什么需要任务模型

未来后端将同时存在以下任务：

- AI 对话流
- 索引重建
- graph 更新
- watcher 事件处理
- 扩展后台任务
- sidecar 健康检查与重连

如果不统一抽象任务模型，会出现：

- 无法取消
- 无法报告进度
- 无法做超时与重试
- 无法限制并发与资源竞争
- 无法统一审计与恢复

### 11.2 建议的任务抽象

建议引入统一 `Job` / `Task` 概念，每个任务至少包含：

- `job_id`
- `job_type`
- `owner`
- `status`
- `created_at`
- `started_at`
- `finished_at`
- `cancellable`
- `progress`
- `trace_id`
- `resource_scope`

### 11.3 建议的任务能力

平台级任务系统建议支持：

1. 任务创建
2. 任务取消
3. 任务超时
4. 任务重试
5. 任务进度事件
6. 任务结果与错误收集
7. 任务并发上限控制
8. 资源锁与背压

### 11.4 资源竞争与隔离

建议提前定义资源作用域，例如：

- 某个 vault
- 某个文件路径
- 某个 conversation
- 某个 sidecar runtime
- 某个索引构建过程

这样同一资源上的写操作、索引任务、AI 批量编辑任务可以有统一的串行/并行策略。

### 11.5 当前阶段的落地建议

即使还不马上做完整 job system，也建议现在先做到：

1. 为 AI stream、索引刷新、sidecar 启动引入统一的 task id / trace id
2. 让长任务具备取消与超时语义
3. 让事件中能区分“请求响应”和“后台任务进度”

## 12. 扩展存储与迁移模型建议

要做高扩展性后端，存储不能只有“产品配置”和“某个功能专属数据”两类，还必须明确扩展如何存储自己的状态。

### 12.1 建议的存储分类

建议将存储分为三层：

1. **Core Store**
	- 产品核心数据
	- 例如 vault config、conversation、message、approval record

2. **Extension Private Store**
	- 扩展自己的私有状态
	- 例如某个扩展的缓存、偏好、索引快照、运行元数据

3. **Shared Cache / Index Store**
	- 平台级缓存与共享索引
	- 例如全文索引、图缓存、模型缓存、临时快照

### 12.2 存储原则

建议遵循：

- 核心产品数据由 Rust 平台统一管理
- 扩展私有数据必须有命名空间隔离
- 共享缓存必须允许重建，不应成为唯一真源
- sidecar 不应持有长期权威存储

### 12.3 Schema Version 与 Migration

建议每类持久化数据都明确：

- `schema_version`
- `owner`
- `last_migrated_from`

并建立统一 migration 策略：

1. 平台升级时先迁移 core store
2. 扩展激活时按需迁移 extension private store
3. 共享 cache/index 可在必要时直接丢弃并重建

### 12.4 当前阶段的落地建议

建议尽早在以下对象上引入版本意识：

- `VaultConfig`
- AI conversation store
- AI tool history store
- 未来的 extension state store

这样未来引入更多扩展时，不会因为数据落盘格式缺乏演进机制而被迫一次性迁移全仓。

## 13. 会话与数据存储建议

### 补充：AI 作为扩展功能时的持久化归属

这里需要明确区分两个概念：

1. **谁拥有持久化基础设施**
2. **谁拥有这份数据的产品语义与命名空间**

如果 AI 被视为 ofive 的一个扩展能力，而不是宿主的唯一中心，那么合理边界不是“把持久化交给 Go sidecar”，而是：

- **持久化基础设施由 Rust 宿主提供**
- **AI 数据以扩展命名空间或能力命名空间的方式挂载在宿主持久层之下**
- **Go sidecar 只保留短期运行时状态，不拥有长期权威数据**

也就是说，**“由 Rust 持久化”并不等于“AI 占据了宿主持久化主权”**。真正的主权在于：

- 存储介质由谁控制
- schema 迁移由谁裁决
- 权限、审计、备份、清理由谁统一治理

在这三个问题上，答案都应当是 Rust 宿主，而不是 Go sidecar。

### 方案比较

#### 方案 A：由 Go sidecar 持久化 AI 会话与历史

优点：

- AI runtime 内部实现简单，session 与持久化模型贴近
- Go 可以直接复用 ADK/agent runtime 的内部会话结构

问题：

- sidecar 从“运行时执行器”膨胀为“长期状态拥有者”
- Rust 无法天然成为 conversation、tool history、approval record 的权威边界
- 后续替换 Go runtime、引入第二个 runtime、或者做跨 runtime 会话恢复时迁移成本高
- 权限、审计、备份、清理、schema migration 会分裂到 sidecar 内部
- 宿主很难保证 AI 数据与 vault、capability、user approval 的一致性

结论：

- **不推荐作为长期方案**

#### 方案 B：由 Rust 直接把 AI 数据作为 Core Store 持久化

优点：

- Rust 作为宿主主边界，便于统一权限、审计、trace、备份与迁移
- 可以天然与 capability execution、approval、vault write trace 串联
- sidecar 可替换，长期数据不依赖某个 agent runtime

问题：

- 如果 AI 仍只是“扩展功能”，一上来就放进 Core Store，容易过早把 AI 提升为平台主数据
- 会让宿主核心数据模型过早耦合 AI 专属字段与演进节奏

结论：

- **适合 AI 已被确认是平台核心能力后的终态**
- **不适合作为当前阶段的唯一落点**

#### 方案 C：由 Rust 宿主持久化，但放在 AI 扩展私有命名空间下

优点：

- 宿主仍掌握存储、迁移、权限、审计与备份能力
- AI 仍被视为扩展能力，不直接挤占 Core Store 边界
- 后续如果 AI 从扩展能力升级为平台核心能力，可以从 Extension Private Store 平滑迁移到 Core Store
- Go sidecar 仍可保持“可替换 runtime”的角色定位

问题：

- 需要宿主先建立扩展私有存储命名空间与迁移约束
- 需要明确哪些数据属于 AI 私有状态，哪些已经升级为平台级主数据

结论：

- **这是当前阶段最合理的方案**

### 推荐决策

当前建议采用：

- **Rust 宿主提供持久化能力**
- **AI 对话、草稿历史、调试轨迹索引、会话元数据先落在 AI 扩展私有存储中**
- **Go sidecar 仅保留 ADK session、短期 memory、当前推理上下文、未落盘的瞬时运行时状态**

当以下数据开始具有平台级一致性要求时，再从 AI 扩展私有存储提升为 Core Store：

- tool call history
- tool result summary
- user approval records
- execution trace id
- 跨 runtime / 跨 sidecar 可恢复的 conversation 主数据

换句话说：

- **短期运行时在 Go**
- **长期权威数据在 Rust**
- **当前阶段 AI 的长期数据应先作为“宿主托管的扩展私有数据”，而不是一开始就变成宿主核心数据**

### 当前实现的落地含义

从当前代码状态看，`aiChatHistory` 已经由 Rust 持久化到 vault config 中。这个方向在归属上是对的，但在存储分层上仍然只是过渡态。

截至 2026-03-22，第一步实现已经开始落地：

- Rust 宿主已新增 `extension private store` 基础设施。
- AI 设置与对话历史开始迁移到宿主托管的 `owner = ai-chat` 私有命名空间。
- 旧版 `vault config` 字段保留兼容读取，但新权威落点已经切换为扩展私有存储。
- 前端命令接口保持不变，AI 作为宿主后端模块接入，不要求宿主核心数据模型先为 AI 扩张字段。

后续建议将其从“塞在统一 vault config 里的一个字段”演进为更明确的宿主托管扩展存储，例如：

- `extensions/ai-chat/conversations.json`
- `extensions/ai-chat/history/`
- 或统一 extension private store 抽象下的 `owner = ai-chat`

这样可以同时满足两点：

- AI 不直接占据宿主 Core Store
- Go sidecar 也不成为长期状态中心

### 规划约束

后续规划中应明确以下约束：

1. Go sidecar 不允许拥有 AI 会话长期权威存储。
2. 宿主必须为扩展提供命名空间隔离的持久化能力。
3. AI 的持久化数据先进入 Extension Private Store，只有在出现平台级一致性诉求后才提升到 Core Store。
4. 任一 AI 持久化结构都必须具备 `schema_version`、`owner`、迁移路径与导出能力。
5. 与权限、审计、确认、工具调用强相关的数据，最终都应回到 Rust 宿主统一治理。

### 补充：sidecar 接入宿主持久化时必须有稳定协议

如果 sidecar 不再拥有自己的长期权威存储，而是依赖 Rust 宿主提供持久化，那么这件事不能只靠“当前 AI 模块内部约定”完成，必须上升为平台级稳定契约。

原因是：

- 后续不止一个 sidecar 会接入 Rust 宿主持久层
- 不同 sidecar 不应直接知道 Rust 内部文件布局、表结构、目录组织方式
- Rust 宿主需要保留替换存储介质、调整 schema、加入审计/权限/迁移的自由度
- sidecar 面对的应是稳定协议，而不是 Rust 内部实现细节

因此，正确边界不是：

- sidecar 直接读写 `extensions/<owner>/...` 文件

而是：

- sidecar 通过 Rust 暴露的 **Persistence Contract** 请求自己的宿主持久化能力
- Rust 在协议后面决定真实存储介质、schema 迁移、权限校验与审计记录

推荐把这层协议视为：

- sidecar 看见的是“命名空间化存储服务”
- Rust 内部实现的可以是 JSON 文件、SQLite、cache store、未来对象存储或其他 backend

### 推荐的持久化协议边界

建议每个 sidecar / runtime 只能在自己的 `module_id` 或 `owner` 命名空间下请求持久化能力，禁止直接跨模块读写。

协议至少需要回答以下问题：

1. **谁在请求**
	- `module_id`
	- `runtime_id`
	- `session_id` / `task_id`

2. **要访问哪份数据**
	- `store_scope`：`core` / `module_private` / `cache`
	- `owner`
	- `state_key`
	- `schema_version`

3. **要执行什么动作**
	- `load`
	- `save`
	- `delete`
	- `list`
	- `migrate`

4. **宿主如何返回结果**
	- `status`
	- `revision` / `etag`
	- `data`
	- `error_code`
	- `error_message`

其中最关键的是：

- `owner + state_key` 用于命名空间隔离
- `schema_version` 用于数据演进
- `revision/etag` 用于并发保护与乐观更新
- `runtime_id/session_id/task_id` 用于审计和 trace 关联

### 推荐的最小 Persistence Contract

宿主可以统一定义一组不带 AI 语义的持久化能力，例如：

- `persistence.state.load`
- `persistence.state.save`
- `persistence.state.delete`
- `persistence.state.list`

最小请求结构建议类似：

```json
{
  "apiVersion": 1,
  "moduleId": "ai-chat",
  "runtimeId": "go-sidecar",
  "sessionId": "session-123",
  "scope": "module_private",
  "owner": "ai-chat",
  "stateKey": "history",
  "schemaVersion": 1,
  "expectedRevision": "rev-42",
  "payload": {}
}
```

对应响应结构建议类似：

```json
{
  "status": "ok",
  "owner": "ai-chat",
  "stateKey": "history",
  "schemaVersion": 1,
  "revision": "rev-43",
  "payload": {}
}
```

这层协议的重点不是“让 sidecar 看见文件”，而是：

- 让 sidecar 只看见稳定的状态读写语义
- 让 Rust 可以在不破坏 sidecar 的前提下替换底层存储实现
- 让其他 future sidecar 复用同一套宿主持久化接入方式

### 13.1 对话主数据

建议由 Rust 持久化：

- conversation
- message
- tool call history
- tool result summary
- user approval records
- execution trace id

原因：

- Rust 是宿主主边界
- Rust 掌握 vault 存储
- Rust 更适合做跨 sidecar 的稳定持久层

### 13.2 Go 会话数据

Go 只保留：

- ADK session
- 短期 memory
- 当前推理上下文
- 当前 turn 内部状态

即：

- **短期运行时状态在 Go**
- **长期权威数据在 Rust**

## 14. 后端事件模型建议

当前已经有 Tauri event 模式，这是对的。

建议后续明确区分三类事件：

1. **Domain Events**
	- 例如：
	  - note_created
	  - note_saved
	  - conversation_updated

2. **UI Bridge Events**
	- 例如：
	  - open_panel
	  - reveal_note
	  - request_user_confirmation

3. **Runtime Events**
	- 例如：
	  - ai_stream_delta
	  - sidecar_started
	  - watcher_changed

这样前端能更清楚区分：

- 哪些事件是业务变化
- 哪些事件是界面控制
- 哪些事件是运行时反馈

## 15. 错误与日志设计建议

后端架构要可扩展，错误模型必须统一。

建议引入统一错误分层：

1. **DomainError**
	- 规则错误、非法状态、数据不满足约束

2. **ApplicationError**
	- 用例执行失败、上下文不完整、权限拒绝

3. **InfrastructureError**
	- 文件系统、HTTP、gRPC、sidecar、watcher、序列化失败

Tauri command 层负责将其映射为前端可消费的错误响应。

日志建议统一包含：

- trace_id
- module
- operation
- target resource
- outcome

尤其是 AI tool 调用链，必须能串起：

- 用户请求
- 模型输出
- 工具调用
- 用户确认
- 最终结果

## 16. 测试架构建议

目标架构需要天然支持三类测试：

1. **Domain Unit Tests**
	- 不依赖 Tauri，不依赖真实文件系统

2. **Application Service Tests**
	- 使用 fake store / fake sidecar client / fake event emitter

3. **Integration Tests**
	- 使用真实 vault fixture
	- 验证 command 到文件系统 / sidecar / 前端协议之间的一致性

建议未来将测试重点逐步从“直接测 command 函数”迁移到“先测 app service，再保留必要 command 集成测试”。

## 17. 分阶段演进路线

### 阶段 1：边界整理

目标：不改能力，只整理结构。

- 将 `ai_service.rs` 按 settings / sidecar / stream / vendor model fetch 拆分
- 将 `vault_commands.rs` 缩减为纯 command 入口
- 将 `state.rs` 拆出 `app_state` 与上下文访问辅助
- 收敛 `lib.rs` 只做注册与装配

### 阶段 2：应用层建立

目标：建立 app service 层。

- 新增 `app/ai/*`
- 新增 `app/vault/*`
- command 层改为依赖 app service
- 对现有 root helper 做稳定封装

### 阶段 3：Capability Registry 与 AI Tool Projection 建立

目标：建立外部 runtime 调用后端/前端能力的统一治理层，并为 AI 提供 tool 投影。

- 定义 capability descriptor
- 定义 AI tool descriptor
- 定义 tool executor trait
- 定义 risk / confirmation policy
- 建立 Rust <-> Go 的 tool call 协议
- 引入基础 capability descriptor 与 schema version

### 阶段 4：对话与审计持久化

目标：建立完整 AI 运行主数据。

- 先建立 Rust 宿主托管的 AI extension private store
- conversation store
- message store
- tool history store
- approval store
- trace / replay 基础设施
- task id / trace id / progress model

补充原则：

- 此阶段不将 Go sidecar 设计为长期状态主中心
- AI 扩展私有数据与平台 core store 要有清晰提升路径
- 只有需要平台级一致性治理的数据才进入 Core Store

### 阶段 5：后端模块化能力

目标：让后端形成宿主内聚、自主演进的模块体系，而不是与前端插件模型做一一对齐。

- 前端插件继续负责 UI 能力注册与展示编排
- 后端以宿主模块方式注册 capability / tool / command / job
- 模块边界由宿主定义生命周期、配置、权限、审计与存储归属
- sidecar / in-process / remote service 只是模块内部的 runtime adapter，不等于模块本身
- 如需对外暴露扩展协作协议，应单独定义模块协作契约，而不是直接复用前端 plugin manifest 语义

### 阶段 6：扩展存储与运行时平台化

目标：让后端真正具备长期可演进的高扩展性平台基础。

- 建立 extension private store 命名空间机制
- 建立 shared cache / index store 与可重建策略
- 建立 migration 框架
- 建立统一后台 job / task runtime

## 18. 最终建议

基于现状，后端最合适的发展方向不是“继续往 `lib.rs + commands + service` 塞功能”，而是逐步演进为：

- **Rust 作为产品宿主与能力治理核心**
- **Go 作为 AI runtime 与模型执行核心**
- **前端作为交互与确认核心**

从后端结构上看，应优先形成：

- 清晰的 command 层
- 明确的 app service 层
- 稳定的 domain 能力层
- 可替换的 infra 层
- 统一的 capability registry 与 AI tool projection

这套设计既能承接当前 vault 与 AI sidecar 的现实代码，也能为后续“AI agent 调用前后端全部能力”提供足够清晰的演进路径。

## 19. 一句话原则

后端不应只是“前端命令的实现集合”，而应成为 ofive 的**能力内核、状态主边界与 AI 治理中心**。
