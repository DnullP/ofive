---
title: "ofive 向量存储模块设计草案"
kind: "design"
status: "active"
updated: "2026-04-26"
owners:
  - "backend"
  - "ai"
tags:
  - "ofive"
  - "semantic-index"
  - "vector"
  - "embedding"
  - "design"
related:
  - "ofive-semantic-index"
  - "ofive-ai-sidecar-and-capabilities"
---

# ofive 向量存储模块设计草案 v1

> 本文档定义 ofive 后端“向量存储模块”的初版设计。
>
> 目标不是立即提交完整实现，而是先把模块边界、能力面、
> 生命周期和工程风险固定下来，保证后续实现能按当前仓库的
> manifest / contribution / capability 架构落地。

相关文档：

- `docs/feature-extension-workflow.md`
- `docs/backend-module-extension-workflow.md`
- `docs/sync-module-roadmap.md`
- [[ofive-semantic-index|语义索引]]
- [[ofive-ai-sidecar-and-capabilities|AI Sidecar 与 Capability]]

## 1. 设计结论

当前建议把“向量存储”落成一个**独立后端模块**，而不是继续挂到 AI
模块或 Vault 模块内部。

### 1.1 模块身份

- 产品语义名称：语义索引 / 向量检索模块
- 稳定 `module_id`：`semantic-index`
- 初始技术选型：`fastembed-rs` + `sqlite-vec`

为什么不用 `vector-store` 作为 `module_id`：

1. `vector-store` 更偏实现术语，容易把模块身份绑死在底层引擎上。
2. 当前模块真正对外提供的是“语义检索能力”，不只是“存向量”。
3. 后续即使底层从 `sqlite-vec` 切到其他引擎，`semantic-index` 仍成立。

### 1.2 初始目标

该模块的首要目标是为 AI runtime 提供稳定的本地语义检索能力，
用于在当前 Vault 中按语义召回 Markdown 内容片段。

初版只要求解决下面的问题：

1. 维护 Vault 持久态 Markdown 内容的 chunk 和 embedding 索引。
2. 通过平台 capability 暴露 AI 可调用的向量检索工具。
3. 在 Vault 切换、文件保存、重命名、删除、外部变更时维护索引一致性。
4. 把索引库和 Vault 绑定状态收敛到模块私有持久化目录。
5. 把 embedding 模型缓存与安装注册表收敛到应用级共享存储。
6. 为前端设置页提供正式用户功能所需的设置、模型安装和状态查询接口。

### 1.3 初版非目标

以下内容不进入 v1：

1. 不在初版支持 Canvas、图片、音频或多模态检索。
2. 不在初版让前端直接依赖模块私有索引实现。
3. 不在初版把向量检索和全文索引强行并表。
4. 不在初版暴露任意写入类 AI 工具。
5. 不在初版解决跨 Vault 的全局知识库合并检索。

## 2. 为什么要独立成模块

### 2.1 不应挂在 AI 模块内部

AI 模块当前主要负责：

- 聊天命令
- 流式事件桥接
- AI 配置和历史持久化
- tool catalog 投影

如果把 embedding 生成、chunk 管理、SQLite 向量库维护也放进去，
AI 模块会同时承担：

- 推理运行时职责
- 检索索引职责
- Vault 内容预处理职责

这会直接扩大 `ai-chat` 模块边界，并让其他模块以后只能通过
AI 私有实现间接访问检索能力，边界会变差。

### 2.2 也不应塞进 Vault 模块私有实现

Vault 模块当前已经承担：

- 文件读写
- 查询索引
- wikilink / backlinks / graph / outline
- 文件系统 watcher 协调

向量检索虽然依赖 Vault 内容，但其运行时形态、模型缓存、索引 schema、
更新成本和 AI tool 消费链路都明显不同于当前查询索引。

更合理的做法是：

1. Vault 继续拥有文件事实源和写入链路。
2. `semantic-index` 通过稳定 facade 订阅 Vault 生命周期。
3. AI 通过 capability 使用 `semantic-index`，而不是直接依赖 Vault 私有实现。

## 3. 模块职责边界

`semantic-index` 模块只负责以下职责：

1. 把持久态 Markdown 文本切分为可检索 chunk。
2. 使用 `fastembed-rs` 生成 query / passage embedding。
3. 使用 `sqlite-vec` 保存向量并执行 KNN 检索。
4. 管理索引 schema、模型版本、重建和增量更新。
5. 通过 capability 向 AI 暴露只读语义检索能力。

明确不负责：

1. 不直接读取编辑器草稿态。
2. 不直接维护 AI 会话上下文。
3. 不绕过 Vault 模块直接接管文件写入。
4. 不把自身 SQLite 实现暴露成跨模块公共 API。

## 4. 目录与层次设计

建议的后端目录结构：

```text
src-tauri/src/
  app/
    app_storage/
      mod.rs
      module_contribution.rs
      storage_registry_app_service.rs
      storage_registry_facade.rs
    semantic_index/
      mod.rs
      module_contribution.rs
      index_app_service.rs
      index_facade.rs
      capability_execution.rs
      indexing_jobs.rs
  domain/
    capability/
      semantic_index_catalog.rs
  infra/
    vector/
      mod.rs
      embedding_runtime.rs
      sqlite_vec_store.rs
      chunker.rs
      markdown_projection.rs
  shared/
    semantic_index_contracts.rs
```

职责划分：

- `app/semantic_index/`
  - 编排索引生命周期
  - 提供跨模块 facade
  - 提供 capability execution route
- `app/app_storage/`
  - 注册应用级共享存储 owner
  - 为业务模块分配跨仓库复用的应用级目录与状态空间
- `domain/capability/semantic_index_catalog.rs`
  - 维护 capability descriptor
- `infra/vector/embedding_runtime.rs`
  - 封装 `fastembed-rs` 模型初始化、缓存目录、批量 embed
- `infra/vector/sqlite_vec_store.rs`
  - 封装 `sqlite-vec` schema、查询和写事务
- `infra/vector/chunker.rs`
  - 负责 Markdown chunk 规则
- `shared/semantic_index_contracts.rs`
  - 对外稳定输入输出 DTO

## 5. 平台接入设计

### 5.1 Manifest / Contribution

模块需要提供：

- `semantic_index_backend_module_contribution()`
- `semantic_index_backend_module_manifest()`

其中 contribution 建议如下：

- `module_id`: `semantic-index`
- `command_ids`: 初版为空，或仅保留可选诊断命令
- `events`: 初版为空
- `persistence_owners`: `&["semantic-index"]`
- `capability_catalog`: `Some(semantic_index_capability_descriptors)`
- `capability_execute`: `Some(execute_semantic_index_capability)`

### 5.2 公共依赖面

初版建议只声明两类稳定公共面：

1. `crate::shared::semantic_index_contracts`
2. `crate::app::semantic_index::index_facade`

原因：

- 前者提供跨模块稳定 DTO
- 后者提供给 Vault / Host 的受控生命周期入口

不应把以下内容抬升为公共面：

1. `crate::infra::vector::sqlite_vec_store`
2. `crate::infra::vector::embedding_runtime`
3. `crate::app::semantic_index::index_app_service`

### 5.3 私有边界模板

建议的私有命名空间：

1. `crate::app::semantic_index::`
2. `crate::infra::vector::`

允许访问路径建议限制为：

1. `src/app/semantic_index/`
2. `src/infra/vector/`
3. `src/domain/capability/semantic_index_catalog.rs`
4. `src/test_support/`

如果 Vault 或 Host 需要调用该模块能力，应只通过
`crate::app::semantic_index::index_facade` 进入，不直接 import 私有实现。

## 6. 持久化与磁盘布局

### 6.1 Persistence Owner

模块私有持久化 owner 使用：`semantic-index`

这与当前仓库的 owner 对齐校验规则一致，避免后续被
`validate_backend_module_contributions()` 拒绝。

### 6.2 建议磁盘布局

Vault 绑定状态保留在当前 Vault 下；模型资产迁移到应用级目录：

```text
<app-data>/app-storage/
  extensions/
    semantic-index/
      model-installs.json
      models/
        intfloat-multilingual-e5-small/
          ...
        BAAI-bge-small-zh-v1-5/
          ...

.ofive/
  extensions/
    semantic-index/
      settings.json
      status.json
      queue-status.json
      vector-index.sqlite
```

说明：

1. `settings.json` 记录模型选择、chunk 策略、启用状态等。
2. `status.json` 记录最近一次构建状态、schema 版本、错误摘要。
3. `queue-status.json` 记录后台 worker 状态、待处理文件数与最近处理时间。
4. `vector-index.sqlite` 保存 chunk 元数据和向量表。
5. 应用级 `model-installs.json` 记录各模型的安装时间、维度与最近错误。
6. 应用级 `models/` 作为 `fastembed-rs` 的 `cache_dir` 根目录，并按模型分子目录缓存。

这样用户切换 Vault 时无需重新下载 embedding 模型，同时仍保持
向量索引库与队列状态按 Vault 隔离。

## 7. 存储模型设计

建议把向量索引库与现有 query index 分离，避免：

1. 让普通查询索引被 `sqlite-vec` 扩展耦合。
2. 让 schema 迁移和性能调优互相干扰。
3. 把向量引擎风险扩散到所有 Vault 查询路径。

### 7.1 建议表结构

普通表：

1. `index_meta`
   - 保存 `schema_version`、`engine`、`model_id`、`dimension`
   - 保存 `chunk_strategy_version`、`last_rebuild_at`
2. `indexed_documents`
   - `relative_path`
   - `content_hash`
   - `mtime_ms`
   - `chunk_count`
   - `indexed_at_ms`
   - `last_error`
3. `indexed_chunks`
   - `chunk_id`
   - `relative_path`
   - `chunk_ordinal`
   - `heading_path`
   - `start_line`
   - `end_line`
   - `text`
   - `text_hash`

向量表：

1. `chunk_embeddings`
   - 使用 `sqlite-vec` 的 `vec0` virtual table
   - 行主键与 `indexed_chunks.chunk_id` 对齐
   - 存储定长 float embedding

建议做法：

1. chunk 元数据和向量分表。
2. 查询时先从 `chunk_embeddings` 拿 top-k rowid。
3. 再 join `indexed_chunks` 和 `indexed_documents` 返回语义结果。

### 7.2 Schema Version 规则

以下变化应直接触发全量 rebuild：

1. embedding 模型变化
2. 向量维度变化
3. chunk 规则版本变化
4. `sqlite-vec` schema 不兼容升级

模块不得尝试在不兼容场景下做隐式局部迁移。

## 8. Chunk 设计

### 8.1 输入范围

初版只索引：

1. 当前 Vault 中的 Markdown 文件
2. 已持久化到磁盘的内容

不索引：

1. 编辑器未保存草稿
2. Canvas
3. 二进制附件
4. 前端临时态拼装内容

### 8.2 文本清洗原则

建议：

1. 去掉 frontmatter
2. 默认跳过围栏代码块和 LaTeX block
3. 保留标题文本，作为 chunk heading context
4. 保留普通段落、列表项、引用块中的可读文本

原因：

1. frontmatter 对语义召回价值低，噪声高
2. 代码块会显著污染一般问答检索结果
3. 标题路径对召回后的可解释性非常重要

### 8.3 Chunk 切分规则

初版建议：

1. 先按标题 section 切分
2. 单个 section 过长时再按段落切分
3. 为相邻 chunk 加固定 overlap
4. 每个 chunk 附带 `heading_path`、`start_line`、`end_line`

建议把 chunk 策略做成显式版本：`chunk_strategy_version = 1`

这样后续规则变化时可以稳定触发 rebuild。

## 9. Embedding 运行时设计

### 9.1 模型选择

初版建议默认模型优先选择**轻量多语言文本 embedding 模型**，
而不是英语默认模型。

推荐优先级：

1. `intfloat/multilingual-e5-small`
2. `BAAI/bge-small-zh-v1.5`

理由：

1. 当前项目和用户语境明显存在中英混合内容。
2. 桌面端 CPU 本地推理更需要体积和延迟可控。
3. 初版以“先可用、可缓存、可重建”为优先，而不是追求最大模型。

最终选定哪个模型，应进入 `settings.json`，并记录到 `index_meta`。

### 9.2 用户配置行为

为了把 semantic-index 正式接入为用户功能，embedding 行为必须显式进入设置体系。

用户侧行为约束如下：

1. 默认 `enabled = false`，新 Vault 不主动下载模型，也不主动启动 embedding。
2. 当用户在设置页开启语义索引后，界面展示当前 provider 支持的模型列表。
3. 模型列表左侧提供“安装”按钮；未安装模型不可直接作为活跃模型。
4. 安装完成后，模型进入 `installed` 状态，用户才可以将其选为当前 embedding 模型。
5. 当前模型切换属于显式配置变更，必须触发索引兼容性检查，并在必要时安排全量 rebuild。

因此设置层至少需要暴露以下稳定接口：

1. `get_semantic_index_settings`
2. `save_semantic_index_settings`
3. `get_semantic_index_model_catalog`
4. `install_semantic_index_model`
5. `get_semantic_index_status`

### 9.3 模型安装语义

模型安装不是“设置保存”的副作用，而是独立后台任务。

安装流程建议定义为：

1. 前端显式发起 `install_semantic_index_model(model_id)`。
2. 后端在后台线程中初始化目标模型，触发真实下载与缓存落盘。
3. 下载成功后刷新 `model-installs.json`，并把模型标记为 `installed`。
4. 下载失败后记录 `failed` 状态和错误摘要，供设置页重试。
5. 安装命令不得阻塞 UI 主线程，也不得把模型初始化塞进 Vault 保存主链路。

### 9.4 Runtime 形态

建议封装一个模块内单例 `EmbeddingRuntime`：

1. 首次使用时惰性初始化模型
2. 使用模块私有 `cache_dir`
3. 批量 embed，避免逐 chunk 单条调用
4. 明确区分 `query:` 和 `passage:` 前缀

不允许：

1. 在 capability execution 内反复创建模型实例
2. 每次查询都触发模型下载检查
3. 让 AI 模块自己持有 embedding runtime
4. 在 Tauri 主线程上同步执行模型安装或大批量 embedding

## 10. 索引生命周期设计

### 10.1 Vault 激活

在 Vault 激活或切换后，`Host` 只通过
`crate::app::semantic_index::index_facade` 调用：

1. `ensure_semantic_index_current(vault_root)`

该入口职责：

1. 检查 schema / model / chunk 版本是否兼容
2. 检查 `status.json` 和 `index_meta` 是否需要 rebuild
3. 必要时安排后台重建任务

初版不建议在 Vault 激活主链路上同步全量 embed，避免启动阻塞过重。

### 10.2 Vault 写入链路

Vault 模块在以下时机通过 facade 通知 `semantic-index`：

1. Markdown 保存或创建后：`enqueue_markdown_upsert(relative_path)`
2. Markdown 删除后：`enqueue_markdown_remove(relative_path)`
3. Markdown 重命名后：`enqueue_markdown_move(old_path, new_path)`
4. 目录重命名后：`enqueue_directory_move(old_prefix, new_prefix)`
5. 目录删除后：`enqueue_directory_remove(prefix)`

重要约束：

1. Vault 不直接 import `infra::vector::*`
2. 只能 import `index_facade`
3. facade 内部再决定同步还是异步执行

### 10.3 外部文件变更

`watcher` 捕获外部修改后，同样只通过 facade 入队。

入队载荷不应只包含路径，还应至少携带：

1. `relative_path`
2. `event_kind`
3. `changed_at_ms`
4. `content_hash` 或可选的重新读取 hint

这样可以保持：

1. 应用内写入
2. 外部编辑器修改
3. Git / sync 导致的文件变化

最终都走同一条索引协调通道。

### 10.4 执行模型

建议初版采用**单写者后台队列**：

1. 写入事件先入队并按路径去重
2. 队列记录最近一次 `changed_at_ms`，后写事件覆盖前写事件，避免陈旧更新回写
3. worker 串行更新 `vector-index.sqlite`
4. embedding 生成通过后台 worker 或 `spawn_blocking` 执行，不进入程序主线程
5. 查询使用独立只读连接

这里的“后台”有两个明确含义：

1. Markdown 保存、重命名、删除等主链路只负责入队，不等待 embedding 完成
2. 真正的 embedding 和 sqlite 写事务在独立 worker 中执行，避免阻塞主进程交互路径

原因：

1. embedding 生成明显重于现有 query index 写入
2. 不应把 Markdown 保存路径变成阻塞式模型推理
3. `sqlite-vec` 与 SQLite 写事务更适合单写者模型

### 10.5 存量一致性方案

新增文件只需要新建索引记录，但正式用户功能不能只覆盖增量场景；
存量与增量必须共享一套可自修复的一致性方案。

建议参考当前 sqlite index 的同步思路，分三层处理：

1. **启动校验层**：`ensure_semantic_index_current(vault_root)` 在 Vault 激活时检查 `settings.json`、`status.json`、`index_meta`、模型版本、chunk 版本是否兼容。
2. **增量同步层**：文件保存、创建、删除、移动、watcher 变更统一进入单写者队列，按路径去重与合并。
3. **对账修复层**：worker 周期性扫描 Vault Markdown 清单与 `indexed_documents`，发现缺失、孤儿、mtime 倒挂、模型切换后脏数据时，升级为局部修复或全量 rebuild。

建议沿用 sqlite index 常见的对账字段：

1. `relative_path`
2. `content_hash`
3. `mtime_ms`
4. `indexed_at_ms`
5. `model_id`
6. `chunk_strategy_version`

只有当这些事实与当前配置一致时，某个文档记录才算“已同步”。

## 11. AI 能力面设计

### 11.1 初版 Capability

初版建议只公开一个核心只读 capability：

- `semantic.search_markdown_chunks`

建议 descriptor：

- `kind`: `Read`
- `risk_level`: `Low`
- `requires_confirmation`: `false`
- `supported_consumers`: `vec![CapabilityConsumer::AiTool]`

输入 schema 建议：

```json
{
  "type": "object",
  "required": ["query"],
  "properties": {
    "query": { "type": "string" },
    "limit": { "type": "integer", "minimum": 1, "maximum": 20, "default": 8 },
    "relativePathPrefix": { "type": "string" },
    "excludePaths": {
      "type": "array",
      "items": { "type": "string" }
    },
    "scoreThreshold": { "type": "number" }
  }
}
```

输出 schema 建议：

```json
{
  "type": "object",
  "required": ["status", "results"],
  "properties": {
    "status": {
      "type": "string",
      "enum": ["ready", "building", "disabled", "empty"]
    },
    "modelId": { "type": "string" },
    "results": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["relativePath", "chunkText", "distance"],
        "properties": {
          "relativePath": { "type": "string" },
          "headingPath": { "type": "string" },
          "startLine": { "type": "integer" },
          "endLine": { "type": "integer" },
          "chunkText": { "type": "string" },
          "distance": { "type": "number" },
          "indexedAtMs": { "type": "integer" }
        }
      }
    }
  }
}
```

### 11.2 为什么只先做一个 Tool

AI 当前已有：

1. `vault.read_markdown_file`
2. `vault.search_markdown_files`
3. `vault.get_markdown_outline`
4. 其他结构化读写能力

因此 `semantic-index` 初版不需要再复制：

1. 读取全文
2. 打开文件
3. 写回文件

只需要补足“按语义召回局部上下文”这一块即可。

### 11.3 返回结构化状态，而不是把可预期冷态当错误

对于下面这些可预期状态，建议 capability 返回 `Ok(Value)`：

1. 索引尚在构建中
2. 当前 Vault 尚未建立向量索引
3. 模块被显式禁用

只有基础设施异常才返回 `Err(String)`：

1. SQLite 打开失败
2. `sqlite-vec` 扩展不可用
3. 模型加载失败
4. schema 读取失败

这与当前仓库“已知协议状态优先结构化返回”的治理方向一致。

## 12. 与 AI 模块的集成方式

当前 AI tool catalog 是 capability registry 的投影，因此 `semantic-index`
不需要向 AI 模块新增私有依赖。

接入方式：

1. `semantic-index` 把 descriptor 挂到自己的 `capability_catalog`
2. 平台 capability registry 收集全部模块贡献
3. AI tool catalog 自动投影 `CapabilityConsumer::AiTool`
4. Go sidecar 继续消费统一 tool catalog

这样可以保持：

1. AI 模块不直接 import `semantic-index` 私有实现
2. tool catalog 仍只有一个事实源
3. 后续 frontend / sidecar 若需要复用，也可以在 descriptor 层扩展 consumer

## 13. 命令与事件设计

### 13.1 正式用户命令面

当 semantic-index 作为正式用户功能接入时，前端命令面不再是“可选诊断面”，
而是设置页和状态面板的标准后端接口。

建议命令集合：

1. `get_semantic_index_backend_catalog`
2. `get_semantic_index_settings`
3. `save_semantic_index_settings`
4. `get_semantic_index_status`
5. `get_semantic_index_model_catalog`
6. `install_semantic_index_model`

可选二阶段命令：

1. `rebuild_semantic_index`
2. `pause_semantic_index_worker`
3. `resume_semantic_index_worker`

这些命令服务正式用户设置页、状态页和诊断页；
AI 主消费路径仍然只走 capability，不直接依赖这些命令。

### 13.2 设置页集成要求

前端设置页建议按现有 `host/settings` 注册体系接入一个自定义 section：

1. 默认展示“开关关闭”的说明，不渲染模型操作按钮。
2. 开关开启后，异步拉取 `get_semantic_index_model_catalog`。
3. 列表左侧渲染安装按钮；右侧展示模型名、维度、安装状态和当前选中状态。
4. 仅当模型处于 `installed` 时，允许用户把它设置为当前模型并保存配置。
5. 状态区展示 `get_semantic_index_status` 返回的 worker/queue 摘要。

### 13.3 事件与进度

初版不需要新增 `UiBridge` 事件。

如果后续需要显示构建进度，可考虑新增语义明确的桥接事件，
但也应等真正有前端消费者时再做，不要先引入无消费方事件。

## 14. 工程风险与缓解

### 14.1 `sqlite-vec` 仍是 pre-v1

风险：

1. schema 或 SQL 语义可能变动
2. 桌面端绑定或扩展装配方式可能调整

缓解：

1. 把 `sqlite-vec` 细节限制在 `infra/vector/sqlite_vec_store.rs`
2. 在 `index_meta` 中记录 `engine` 和 `schema_version`
3. 不把任何 `sqlite-vec` SQL 暴露到模块外部

### 14.2 首次模型下载

风险：

1. 首次启动会有明显冷启动成本
2. 离线环境下模型可能不可用

缓解：

1. 使用模块私有 `cache_dir`
2. 使用“先安装、后可选”的显式用户流程，避免设置页误选未安装模型
3. 在 `status.json` 与 `model-installs.json` 中明确记录模型准备状态
4. capability 冷态返回 `building` / `disabled` 而不是直接崩溃

### 14.3 CPU 推理开销

风险：

1. 大 Vault 全量 embed 成本高
2. 保存后立即同步更新会拖慢写入路径

缓解：

1. 初版采用后台单写者队列
2. 默认使用轻量模型
3. 批量 embed 而不是逐条 embed

### 14.4 索引一致性

风险：

1. 应用内写入和 watcher 外部变更存在双重触发
2. 重命名 / 目录移动易造成脏数据

缓解：

1. 全部通过 `index_facade` 汇总去重
2. 队列里按路径和 `changed_at_ms` 合并事件，后写覆盖前写
3. 定期支持 `ensure_semantic_index_current` 做自修复
4. 保留对账扫描，确保存量与增量最终收敛到一致状态

## 15. 测试设计

根据当前仓库要求，至少需要：

### 15.1 单元测试

1. module contribution / manifest / boundary template 对齐测试
2. capability catalog / execution route 校验测试
3. chunker 对 frontmatter / code fence / LaTeX 的过滤测试
4. chunk overlap 与 heading path 生成测试
5. SQLite schema 初始化和查询映射测试
6. 冷态、空索引、禁用态的结构化返回测试

### 15.2 集成测试

1. 基于 `src-tauri/tests/fixtures/Notes` 的全量重建测试
2. 单文件保存后的增量 upsert 测试
3. 文件删除后的向量清理测试
4. 重命名 / 目录移动后的检索命中迁移测试
5. AI capability 执行返回 top-k 结果测试
6. 真实模型安装命令测试：模型缓存落盘、安装状态刷新、模型可选中
7. 后台队列测试：文件变更按 `changed_at_ms` 合并，确保陈旧事件不会覆盖新内容
8. 存量对账测试：预置脏索引后执行 `ensure_semantic_index_current` 可恢复一致性

### 15.3 性能基线

建议补最小基准：

1. 1600+ 笔记库首次全量构建耗时
2. 单文件增量更新耗时
3. top-k 检索延迟

## 16. 分阶段落地顺序

### Phase 1: 契约和骨架

1. 建模块目录和 manifest / contribution
2. 建 shared contracts
3. 建 capability descriptor 和 execution 路由
4. 建空的 facade 与状态 DTO

### Phase 2: 基础索引能力

1. 接入 `fastembed-rs`
2. 接入 `sqlite-vec`
3. 实现 Markdown chunker
4. 实现全量重建与 top-k 查询

### Phase 3: 生命周期接线

1. 接 Vault 激活
2. 接 Vault 写入链路
3. 接 watcher 外部变更链路
4. 加入后台单写者队列

### Phase 4: 用户功能接线

1. 提供设置页命令面与模型安装入口
2. 接入设置页 section，支持开关、模型列表、安装、选择
3. 状态页展示 worker 与 queue 摘要

### Phase 5: AI tool 上线

1. capability 对 AI tool catalog 可见
2. 调整 tool 描述文案
3. 补冷态和异常态行为

### Phase 6: 诊断与可观测性

1. 增加状态命令或 DevTools 面板
2. 增加 rebuild 入口
3. 增加更完整的日志和性能统计

## 17. 一句话原则

向量存储不应作为 AI 的私有实现，也不应污染 Vault 现有查询索引；
它应作为独立的 `semantic-index` 后端模块存在，内部封装
`fastembed-rs` + `sqlite-vec`，对外只通过 capability 和受控 facade
提供“语义检索”这一稳定能力。
