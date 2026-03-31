# ofive 测试体系与测试手册

本文档用于说明项目当前的测试体系、各测试面的职责边界、CI 质量门映射，以及日常开发与提测时应执行的 checklist。

## 1. 测试体系总览

当前仓库不是“单一测试套件”，而是多个测试面并行组成的质量体系。

| 测试面 | 主要命令 | 主要目录/配置 | 默认 CI | 主要目标 |
| --- | --- | --- | --- | --- |
| 前端单元测试 | `bun run test` / `bun run test:ci:unit` | [tests](../tests) | 是 | 覆盖纯前端逻辑、数据转换、局部交互规则 |
| 前端功能 E2E | `bun run test:e2e` / `bun run test:e2e:ci` | [e2e](../e2e), [playwright.config.ts](../playwright.config.ts) | 是 | 覆盖浏览器层回归、关键用户流程、布局与交互 |
| 真实鼠标拖拽 E2E 审计 | `bun run test:e2e:mouse-drag` | [e2e/dockview-split-animation.e2e.ts](../e2e/dockview-split-animation.e2e.ts), [.github/workflows/e2e-mouse-drag.yml](../.github/workflows/e2e-mouse-drag.yml) | 否，单独测试面 | 覆盖 Dockview 真实鼠标拖拽命中与动画观测 |
| 玻璃视觉专项测试 | 按需使用 `bunx playwright test --config playwright.glass.config.mjs` | [playwright.glass.config.mjs](../playwright.glass.config.mjs), [e2e/glass-visual.e2e.ts](../e2e/glass-visual.e2e.ts) | 否 | 验证毛玻璃/透明层视觉回归 |
| 前端性能 smoke | `bun run test:perf:frontend` | [perf/frontend](../perf/frontend), [playwright.perf.config.ts](../playwright.perf.config.ts) | 否 | 覆盖图谱与前端关键路径的性能退化 |
| Go sidecar 测试 | `bun run test:go` | [sidecars/go/ofive-ai-agent](../sidecars/go/ofive-ai-agent) | 是 | 覆盖 AI sidecar 内部逻辑与桥接行为 |
| Rust core 测试 | `bun run test:rust:core` | [src-tauri](../src-tauri), [scripts/run-rust-tests-with-tauri-config.mjs](../scripts/run-rust-tests-with-tauri-config.mjs) | 是 | 覆盖不依赖真实 sidecar 的 Rust 单元与集成测试 |
| Rust sidecar 集成测试 | `bun run test:rust:sidecar` | [src-tauri/tests](../src-tauri/tests) | 是 | 覆盖依赖真实 Go sidecar 的后端联动能力 |
| 后端性能基准 | `bun run test:perf:backend` | [src-tauri/benches](../src-tauri/benches) | 否 | 覆盖查询与索引类性能基线 |
| 生产构建校验 | `bun run build` | [package.json](../package.json) | 是 | 验证最终构建链路可用 |

### 1.1 关键理解

1. 主线 CI 跑的是“稳定阻塞面”，不是所有专项测试。
2. 真实鼠标拖拽审计已从主线 E2E 中拆出，避免 Linux CI 的输入时序抖动持续阻塞功能回归。
3. 性能测试和视觉专项测试目前更偏向专项验证，而非默认合并门禁。
4. Rust 测试按是否依赖真实 sidecar 拆成两条画像，以避免每次都强依赖 Go sidecar 构建。

### 1.2 Store 状态全流程 Guard

前端当前新增了一条静态质量门：`node scripts/check-store-state-tests.mjs`。

该 guard 的目标不是统计语句覆盖率，而是保证 store 治理声明和真实测试锚点之间没有脱节。当前它会同时检查两层约束：

1. 模块级约束：store 逻辑模块与使用 store 的业务模块都必须绑定到真实测试文件。
2. schema 级约束：每个已注册 managed store 声明的 `actions`、`flow`、`failureModes` 都必须显式映射到测试锚点。

实现方式：

1. guard 优先基于 [src/host/store/storeRegistry.ts](../src/host/store/storeRegistry.ts) 的注册结果发现 managed store，并补充少量仍处于显式治理名单中的状态模块。
2. 每个 store 逻辑模块、store 使用模块都必须在 [scripts/store-state-flow-coverage.config.mjs](../scripts/store-state-flow-coverage.config.mjs) 中声明覆盖它的测试文件。
3. 每个已注册 store 还必须在 `storeSchemaCoverage` 中为 schema 声明的每个 action、flow 条目、failure mode 提供测试文件映射。
4. 测试锚点既可以是单元测试，也可以是 E2E/性能专项测试，但路径必须指向真实存在的测试文件。

这意味着新增一个 managed store 时，不能只完成注册本身，还必须同步完成三件事：

1. 在 store registration 中声明完整 schema，至少包含状态摘要、actions、flow 与 failure modes。
2. 在对应测试中覆盖这些状态变化路径。
3. 在 [scripts/store-state-flow-coverage.config.mjs](../scripts/store-state-flow-coverage.config.mjs) 里把模块级 coverage 和 schema 级 coverage 都登记完整。

当前 guard 仍然主要校验“治理声明是否完整且可追踪到真实测试文件”，并不直接理解测试断言是否足够强。因此它解决的是“有没有覆盖声明缺口”，不是“测试语义一定正确”。后者仍需通过单测/E2E 设计质量来保证。

这条 guard 已经接入 [scripts/check-guards.mjs](../scripts/check-guards.mjs)，因此会跟随 `bun run build` 和主线 guard 一起执行。

## 2. 当前测试目录与覆盖对象

### 2.1 前端单元测试

当前前端单测位于 [tests](../tests)：

- [tests/imageEmbedSyntaxExtension.test.ts](../tests/imageEmbedSyntaxExtension.test.ts)
- [tests/knowledgeGraphInteractions.test.ts](../tests/knowledgeGraphInteractions.test.ts)
- [tests/knowledgeGraphLabelSelector.test.ts](../tests/knowledgeGraphLabelSelector.test.ts)
- [tests/panelOrderUtils.test.ts](../tests/panelOrderUtils.test.ts)

适合覆盖的内容：

- 纯函数
- 选择器/转换器
- 排序、过滤、布局计算逻辑
- 与 DOM 或浏览器时序无强依赖的前端状态逻辑

### 2.2 前端功能 E2E

当前功能 E2E 位于 [e2e](../e2e)：

- [e2e/calendar-convertible-view.e2e.ts](../e2e/calendar-convertible-view.e2e.ts)
- [e2e/custom-activity.e2e.ts](../e2e/custom-activity.e2e.ts)
- [e2e/dockview-split-animation.e2e.ts](../e2e/dockview-split-animation.e2e.ts)
- [e2e/frontmatter-visibility.e2e.ts](../e2e/frontmatter-visibility.e2e.ts)
- [e2e/glass-visual.e2e.ts](../e2e/glass-visual.e2e.ts)
- [e2e/sidebar-motion.e2e.ts](../e2e/sidebar-motion.e2e.ts)
- [e2e/sidebar-panel-drag.e2e.ts](../e2e/sidebar-panel-drag.e2e.ts)
- [e2e/task-board.e2e.ts](../e2e/task-board.e2e.ts)
- [e2e/vault-switch-regression.e2e.ts](../e2e/vault-switch-regression.e2e.ts)

适合覆盖的内容：

- 用户路径是否能走通
- 多面板、多 tab、多 sidebar 的真实交互
- 由 UI 驱动的状态恢复、布局恢复、回归问题
- 前端与 mock/宿主接口的联动可用性

### 2.3 真实鼠标拖拽 E2E 审计

这是一类特殊测试面。

特点：

- 聚焦 Dockview 真实鼠标拖拽与动画观测
- 当前集中在 [e2e/dockview-split-animation.e2e.ts](../e2e/dockview-split-animation.e2e.ts)
- 使用 `@mouse-drag` 标签识别
- 默认 CI 通过 `test:e2e:ci` 排除，单独由 [.github/workflows/e2e-mouse-drag.yml](../.github/workflows/e2e-mouse-drag.yml) 执行

适合覆盖的内容：

- 真实鼠标路径命中正确性
- 真实拖拽下 Dockview drop zone / anchor 命中情况
- 动画观测是否在真实拖拽下仍正确触发

不适合作为默认阻塞面覆盖的原因：

- 在 Linux CI 上更容易受到浏览器/窗口系统/时序影响而抖动
- 它验证的是“高保真输入路径”，而不是基础功能是否可用

### 2.4 玻璃视觉专项测试

当前玻璃视觉专项配置与用例：

- [playwright.glass.config.mjs](../playwright.glass.config.mjs)
- [e2e/glass-visual.e2e.ts](../e2e/glass-visual.e2e.ts)

适合覆盖的内容：

- 透明背景是否仍然透明
- 插件面板是否保持磨砂层样式
- 视觉层级和样式回归

### 2.5 前端性能测试

当前前端性能 smoke 位于 [perf/frontend](../perf/frontend)：

- [perf/frontend/knowledge-graph-labels.perf.ts](../perf/frontend/knowledge-graph-labels.perf.ts)
- [perf/frontend/knowledge-graph-scale.perf.ts](../perf/frontend/knowledge-graph-scale.perf.ts)
- [perf/frontend/perf-smoke.perf.ts](../perf/frontend/perf-smoke.perf.ts)

适合覆盖的内容：

- 知识图谱规模与交互的性能退化
- 前端关键路径的基础性能 smoke

### 2.6 Rust 集成测试

当前 Rust 集成测试位于 [src-tauri/tests](../src-tauri/tests)：

- [src-tauri/tests/ai_sidecar_grpc_integration.rs](../src-tauri/tests/ai_sidecar_grpc_integration.rs)
- [src-tauri/tests/backend_log_command_integration.rs](../src-tauri/tests/backend_log_command_integration.rs)
- [src-tauri/tests/query_index_file_consistency_integration.rs](../src-tauri/tests/query_index_file_consistency_integration.rs)
- [src-tauri/tests/resolve_wikilink_target_integration.rs](../src-tauri/tests/resolve_wikilink_target_integration.rs)
- [src-tauri/tests/segment_chinese_text_integration.rs](../src-tauri/tests/segment_chinese_text_integration.rs)
- [src-tauri/tests/vault_consistency_integration.rs](../src-tauri/tests/vault_consistency_integration.rs)
- [src-tauri/tests/vault_file_commands_integration.rs](../src-tauri/tests/vault_file_commands_integration.rs)
- [src-tauri/tests/vault_frontmatter_query_integration.rs](../src-tauri/tests/vault_frontmatter_query_integration.rs)
- [src-tauri/tests/vault_graph_commands_integration.rs](../src-tauri/tests/vault_graph_commands_integration.rs)
- [src-tauri/tests/vault_markdown_ast_integration.rs](../src-tauri/tests/vault_markdown_ast_integration.rs)
- [src-tauri/tests/vault_search_commands_integration.rs](../src-tauri/tests/vault_search_commands_integration.rs)
- [src-tauri/tests/vault_setup_config_integration.rs](../src-tauri/tests/vault_setup_config_integration.rs)
- [src-tauri/tests/vault_task_query_resource_integration.rs](../src-tauri/tests/vault_task_query_resource_integration.rs)
- [src-tauri/tests/wikilink_suggest_integration.rs](../src-tauri/tests/wikilink_suggest_integration.rs)

适合覆盖的内容：

- 前端可调用后端接口的真实可用性
- Vault 文件、查询、图谱、frontmatter、AST、索引一致性
- sidecar 联动能力

### 2.7 Go sidecar 测试

Go sidecar 测试位于 [sidecars/go/ofive-ai-agent](../sidecars/go/ofive-ai-agent) 内部，统一通过 `bun run test:go` 执行。

适合覆盖的内容：

- LLM provider 封装
- capability bridge
- persistence bridge
- sidecar 内部 runtime 规则

## 3. 命令手册

### 3.1 日常常用命令

```bash
bun run test
bun run test:ci:unit
bun run test:e2e
bun run test:e2e:ci
bun run test:e2e:mouse-drag
bun run test:go
bun run test:rust:core
bun run test:rust:sidecar
bun run test:rust
bun run test:perf:frontend
bun run test:perf:backend
bun run test:perf
bun run build
```

### 3.2 命令职责说明

| 命令 | 说明 |
| --- | --- |
| `bun run test` | 前端 Bun 单元测试 |
| `bun run test:ci:unit` | CI 友好的前端单元测试执行入口 |
| `bun run test:e2e` | 全量功能 E2E，包括 `@mouse-drag` |
| `bun run test:e2e:ci` | CI 默认功能 E2E，排除 `@mouse-drag` |
| `bun run test:e2e:mouse-drag` | 仅执行 `@mouse-drag` 真实鼠标拖拽审计 |
| `bun run test:go` | Go sidecar 测试 |
| `bun run test:rust:core` | 不依赖真实 sidecar 的 Rust core 测试 |
| `bun run test:rust:sidecar` | 依赖真实 sidecar 的 Rust 集成测试 |
| `bun run test:rust` | 全量 Rust 测试 |
| `bun run test:perf:frontend` | 前端性能 smoke |
| `bun run test:perf:backend` | 后端性能 benchmark |
| `bun run test:perf` | 前后端性能 + 汇总报告 |
| `bun run build` | 前端生产构建校验 |

## 4. CI 测试面映射

当前默认 CI 在 [.github/workflows/ci.yml](../.github/workflows/ci.yml) 中拆成以下质量门：

| CI Job | 主要内容 | 是否默认阻塞 |
| --- | --- | --- |
| `go-sidecar` | Go sidecar 测试 + sidecar 构建 + proto 漂移检查 | 是 |
| `frontend-unit` | 前端 Bun 单元测试 | 是 |
| `rust-tests-core` | Rust core 测试 | 是 |
| `rust-tests-sidecar` | Rust sidecar 集成测试 | 是 |
| `e2e-tests` | Playwright 功能 E2E，排除 `@mouse-drag` | 是 |
| `production-build` | 构建校验 | 是 |

当前单独测试面：

| Workflow | 主要内容 | 触发方式 |
| --- | --- | --- |
| [e2e-mouse-drag.yml](../.github/workflows/e2e-mouse-drag.yml) | 真实鼠标拖拽 E2E 审计 | `workflow_dispatch` |

### 4.1 Release 测试门

发布流程定义在 [release.yml](../.github/workflows/release.yml)。

它与日常主线 CI 的一个关键差异是：

1. Release `test-gate` 跑的是 `bun run test:e2e`，不是 `bun run test:e2e:ci`。
2. 这意味着发版前会重新纳入全量功能 E2E，包括 `@mouse-drag` 真实鼠标拖拽审计。
3. Release gate 还会串行执行 Go sidecar 测试、sidecar 构建、proto 漂移检查、前端单测、全量 Rust 测试和生产构建校验。

因此，主线 CI 通过并不等于发版测试门一定通过。对于涉及高保真拖拽、sidecar、proto 或全量 Rust 行为的改动，发版前应主动按 release 流程自检。

## 5. 测试执行策略建议

### 5.1 只改前端纯逻辑

建议最少执行：

- [ ] `bun run test`
- [ ] 相关文件的类型检查或构建校验

如果影响 UI 可见行为，再补：

- [ ] `bun run test:e2e:ci`

### 5.2 改了 Dockview、拖拽、动画、布局命中

建议至少执行：

- [ ] `bun run test`
- [ ] `bun run test:e2e:ci`
- [ ] `bun run test:e2e:mouse-drag`

如果改动涉及 drop zone、anchor、拖拽路径、命中容忍度：

- [ ] 本地多次重复执行目标 `@mouse-drag` 用例
- [ ] 确认 Linux 行为不会仅在真实鼠标路径下失真

### 5.3 改了前端面板、sidebar、activity、tab 恢复逻辑

建议至少执行：

- [ ] `bun run test`
- [ ] `bun run test:e2e:ci`

重点关注：

- [ ] sidebar motion
- [ ] sidebar panel drag
- [ ] custom activity
- [ ] vault switch
- [ ] calendar convertible view

### 5.4 改了 Markdown 渲染、frontmatter、知识图谱、编辑器语法层

建议至少执行：

- [ ] `bun run test`
- [ ] 相关单测或新增单测
- [ ] `bun run test:e2e:ci`

如果改动与性能相关：

- [ ] `bun run test:perf:frontend`

### 5.5 改了前端调用后端的能力、命令、返回结构

建议至少执行：

- [ ] `bun run test`
- [ ] `bun run test:e2e:ci`
- [ ] `bun run test:rust:core`

如果改动依赖 AI sidecar 或跨进程能力：

- [ ] `bun run build:sidecar`
- [ ] `bun run test:rust:sidecar`
- [ ] `bun run test:go`

### 5.6 改了 Vault 文件、查询、图谱、frontmatter、索引、解析逻辑

建议至少执行：

- [ ] `bun run test:rust:core`
- [ ] 相关 Rust 集成测试

如果改动涉及 sidecar 触发或 AI 查询链路：

- [ ] `bun run build:sidecar`
- [ ] `bun run test:rust:sidecar`

### 5.7 改了 proto、Go sidecar、AI bridge、persistence bridge

建议至少执行：

- [ ] `bun run proto:generate`
- [ ] `bun run proto:check`
- [ ] `bun run test:go`
- [ ] `bun run build:sidecar`
- [ ] `bun run test:rust:sidecar`

### 5.8 改了视觉层、透明层、玻璃效果

建议至少执行：

- [ ] `bun run test:e2e:ci`
- [ ] `bunx playwright test --config playwright.glass.config.mjs`

### 5.9 改了性能敏感路径

建议至少执行：

- [ ] `bun run test:perf:frontend`
- [ ] `bun run test:perf:backend`
- [ ] 对比生成报告是否有明显回退

## 6. 全面测试手册 Checklist

下面是一份可直接执行的全面测试手册。不是每次都要全跑，但在大改动、联调完成、提测前、准备合并复杂 PR 时应按需勾选。

### 6.1 开发前 Checklist

- [ ] 明确改动属于哪个测试面：前端单测、功能 E2E、真实鼠标拖拽、后端 Rust、Go sidecar、性能、视觉专项。
- [ ] 明确改动是否会影响前端调用后端的接口契约。
- [ ] 明确改动是否会影响布局、拖拽、动画、命中路径。
- [ ] 明确改动是否会影响 vault 文件、索引、frontmatter、query、graph。
- [ ] 明确改动是否涉及 proto / sidecar / persistence / capability bridge。

### 6.2 开发中最小回归 Checklist

- [ ] 至少补齐对应层的最小自动化测试，而不是只做编译通过。
- [ ] 新增前端纯逻辑时补 Bun 单测。
- [ ] 新增后端导出能力时补 Rust 单测或集成测试。
- [ ] 新增前端可见流程时补 Playwright E2E。
- [ ] 新增真实鼠标高保真交互时评估是否应进入 `@mouse-drag` 测试面。
- [ ] 新增前后端联动流程时评估是否需要同时补前端 E2E 与 Rust 集成测试。

### 6.3 提交前 Checklist

- [ ] `bun run test`
- [ ] `bun run test:e2e:ci`
- [ ] `bun run build`
- [ ] 如果改了 Rust，执行 `bun run test:rust:core`
- [ ] 如果改了 Go sidecar 或 AI 链路，执行 `bun run test:go`
- [ ] 如果改了真实拖拽/布局命中，执行 `bun run test:e2e:mouse-drag`
- [ ] 如果改了 sidecar 依赖链路，执行 `bun run build:sidecar`
- [ ] 如果改了 proto，执行 `bun run proto:check`

### 6.4 提测前 Checklist

- [ ] 前端单测通过。
- [ ] 主线 E2E 通过。
- [ ] 对应后端测试通过。
- [ ] 对应 sidecar 测试通过。
- [ ] 构建校验通过。
- [ ] 如果改了 UI 外观，玻璃视觉专项已验证。
- [ ] 如果改了拖拽/动画，`@mouse-drag` 面已验证。
- [ ] 如果改了性能敏感路径，性能 smoke/benchmark 已验证。
- [ ] 文档已同步更新。

### 6.5 合并复杂 PR 前 Checklist

- [ ] `bun run test`
- [ ] `bun run test:e2e:ci`
- [ ] `bun run test:rust:core`
- [ ] `bun run build`
- [ ] 若涉及 AI/sidecar，再执行 `bun run test:go`、`bun run build:sidecar`、`bun run test:rust:sidecar`
- [ ] 若涉及 Dockview 高保真拖拽，再执行 `bun run test:e2e:mouse-drag`
- [ ] 若涉及视觉层，再执行 `bunx playwright test --config playwright.glass.config.mjs`
- [ ] 若涉及性能，再执行 `bun run test:perf`

### 6.6 发布前建议 Checklist

- [ ] 至少过一遍与本次改动相关的全部测试面。
- [ ] 检查默认 CI 所有阻塞 job 都已通过。
- [ ] 对照 [release.yml](../.github/workflows/release.yml) 确认 release gate 涉及的命令都已提前自检。
- [ ] 若本次发布涉及 E2E 交互，确认已执行过 `bun run test:e2e`，而不是只执行 `bun run test:e2e:ci`。
- [ ] 若本次发布涉及高风险交互，补跑非默认专项测试面。
- [ ] 检查是否存在只在本地通过、但未进入任何 CI 测试面的改动。
- [ ] 检查是否需要新增新的专项测试面，而不是继续把高波动 case 混入主线。

## 7. 故障排查 Checklist

### 7.1 前端单测失败

- [ ] 先确认是逻辑断言失败还是运行环境问题。
- [ ] 先最小化到单文件运行。
- [ ] 确认是否是 mock、fixture、选择器或类型漂移造成。

### 7.2 Playwright E2E 失败

- [ ] 先确认失败的是主线 E2E 还是 `@mouse-drag`。
- [ ] 如果是主线 E2E，优先修功能或稳定性，不要直接降级断言。
- [ ] 如果是 `@mouse-drag`，先确认是不是 Linux 输入时序/命中路径抖动。
- [ ] 检查是否有 stale state、等待不足、错误点击 toggle、错误 drop zone 命中。
- [ ] 必要时使用 `--list`、`-g`、`--repeat-each` 做定向定位。

### 7.3 Rust 测试失败

- [ ] 先确认失败的是 core 画像还是 sidecar 画像。
- [ ] 如果是 sidecar 画像，先确认是否先执行了 `bun run build:sidecar`。
- [ ] 检查是否绕过仓库脚本直接调用了 cargo，导致 `PROTOC` / `TAURI_CONFIG` 未注入。

### 7.4 Go sidecar 测试失败

- [ ] 确认 proto 是否已同步生成。
- [ ] 确认 bridge 行为是否与 Rust 端契约一致。
- [ ] 确认 mock confirmation / capability 路径是否发生协议漂移。

### 7.5 性能测试失败或回退

- [ ] 先确认是否是环境噪音导致。
- [ ] 确认是否引入了数据规模、渲染量、查询次数的结构性上升。
- [ ] 如果只是专项指标变化，避免在没有分析的情况下直接放宽阈值。

## 8. 当前体系的已知边界

1. 默认 CI 不跑所有专项测试面，尤其不默认跑真实鼠标拖拽与性能测试。
2. 当前体系已经按稳定阻塞面与专项测试面分层，但并不代表覆盖已经完全充分。
3. 根据仓库规范，前后端联动功能和状态管理仍应持续补足集成测试，而不能只依赖局部单测或单边测试。
4. 如果未来再出现一类高波动但高价值的测试，应优先评估是否拆成单独测试面，而不是直接污染主线 CI。

## 9. 推荐执行矩阵

| 改动类型 | 最少建议 |
| --- | --- |
| 前端纯逻辑 | `bun run test` |
| 前端可见行为 | `bun run test` + `bun run test:e2e:ci` |
| Dockview 拖拽/布局/动画 | `bun run test` + `bun run test:e2e:ci` + `bun run test:e2e:mouse-drag` |
| Markdown / frontmatter / 图谱 | `bun run test` + `bun run test:e2e:ci` + 按需 `bun run test:perf:frontend` |
| Rust 后端能力 | `bun run test:rust:core` |
| AI sidecar / proto / bridge | `bun run test:go` + `bun run build:sidecar` + `bun run test:rust:sidecar` |
| 视觉 / glass | `bun run test:e2e:ci` + `bunx playwright test --config playwright.glass.config.mjs` |
| 性能敏感路径 | `bun run test:perf` |

## 10. 结论

当前仓库测试体系已经具备“分层测试面”的结构：

1. 默认阻塞质量门负责稳定回归。
2. 专项测试面负责高价值但高波动的专项能力验证。
3. 文档、脚本和 CI 已经形成可维护的对应关系。

后续如果继续演进测试体系，应优先做两件事：

1. 继续补足前后端联动与状态一致性的集成测试。
2. 对新增高波动测试保持“单独测试面”的治理方式，而不是重新混入主线阻塞 CI。