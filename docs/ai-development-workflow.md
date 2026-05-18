---
title: "ofive AI 全流程开发与治理工作流"
kind: "workflow"
status: "active"
updated: "2026-05-19"
owners:
  - "maintainers"
  - "frontend"
  - "backend"
tags:
  - "ofive"
  - "ai-development"
  - "workflow"
  - "governance"
  - "testing"
related:
  - "ofive-architecture-overview"
  - "ofive-maintainer-dashboard"
  - "ofive-build-and-dev-workflow"
  - "ofive-testing-and-ci"
  - "ofive-plugin-system"
  - "ofive-backend-module-platform"
---

# ofive AI 全流程开发与治理工作流

本文档说明 ofive 如何以 AI 为主要执行者完成一个 20 万行级别项目的规划、开发、调试、测试、维护和治理。

它不是替代 [前后端功能扩展长期工作流](feature-extension-workflow.md)、[后端模块扩展标准流程](backend-module-extension-workflow.md) 或 [测试体系与测试手册](testing-handbook.md)，而是回答一个更上层的问题：

> 如何把需求、架构约束、资料、工具、测试和调试环境组织成一套 AI 可以持续执行的工程系统。

按当前仓库快照统计，`git ls-files` 下约 899 个文件，TypeScript、Rust、Go、Markdown、脚本和样式等文本文件约 195,726 行。这个规模已经不能依赖“一次性提示词 + 人工补锅”，而要依赖可被 AI 读取、验证和迭代的工程闭环。

## 1. 总原则

AI 能主导 ofive 开发，不是因为 AI 记住了全部代码，而是因为仓库把关键知识显式化了。

核心原则：

1. 先定位 owner，再写代码。
2. 先稳定边界，再扩展实现。
3. 先把约束写成注册、manifest、guard、测试，再依赖约定。
4. 先在 mock web 和聚焦测试中验证，再扩到 Tauri、sidecar、release gate。
5. 每次重复踩坑，都沉淀为文档、skill、guard、fixture 或测试。

这套模式把 AI 从“会写代码的补全器”变成“可以沿着项目约束执行的维护者”。

## 2. AI 开发闭环

一项需求从输入到推送，推荐按下面的闭环执行。

| 阶段 | AI 要回答的问题 | 主要产物 |
| --- | --- | --- |
| 需求归类 | 这是前端、后端、前后端联动、sidecar、性能还是发布治理问题？ | owner 判断、风险面 |
| 源码定位 | 真正拥有行为的文件在哪里？哪些只是 wiring？ | owner 文件、相邻注册点、测试锚点 |
| 方案设计 | 状态、命令、事件、capability、持久化 owner 和 UI 入口分别归谁？ | 设计小结、实现顺序 |
| 实现 | 在最小 owner 边界内改代码，不扩大公共面。 | 代码改动、fixture、必要文档 |
| 聚焦验证 | 哪个测试最快证伪当前假设？ | 单测、mock e2e、Rust/Go 聚焦测试 |
| 扩展验证 | 改动是否影响更高层质量门？ | build、CI 等价命令、性能/视觉专项 |
| 交付治理 | 文档、skill、guard、测试索引是否同步？ | commit、push、PR 说明、剩余风险 |

AI 的每个阶段都应留下可复查证据：文件路径、命令输出摘要、测试结果、未覆盖风险。没有证据的“应该没问题”不能算交付完成。

## 3. 规划与设计

### 3.1 Owner-first 设计

ofive 的第一条 AI 设计规则是：不要先想“在哪加代码”，先想“谁拥有这件事”。

常见 owner：

| 问题类型 | 默认 owner |
| --- | --- |
| activity、panel、tab、业务 UI | `src/plugins/<feature>/` |
| 工作台投影、布局持久化、文件打开、tab scope | `src/host/layout/**` |
| 跨组件共享状态 | `src/host/store/**` 或具体 owner store |
| 前端语义事件 | `src/host/events/appEventBus.ts` |
| Tauri command 消费 | `src/api/**` wrapper |
| Tauri command 桥接 | `src-tauri/src/host/commands/**` |
| 后端业务用例 | `src-tauri/src/app/<module>/` |
| 后端稳定语义 | `src-tauri/src/domain/**` |
| 文件、索引、sidecar、向量等技术实现 | `src-tauri/src/infra/**` |
| AI 可调用能力 | capability descriptor + module execution |

AI 不应该把新能力塞进 `App.tsx`、registry 聚合文件、`lib.rs` 或中央大 `match`，除非这些文件本身就是当前任务的 owner。

### 3.2 面向 AI 和约束的设计

面向 AI 的架构不是“写更多说明”，而是把约束放到 AI 不容易绕过的位置。

推荐做法：

1. 稳定 ID 显式化：command id、event id、module id、capability id、store id 都有唯一事实源。
2. 生命周期显式化：插件返回 dispose，订阅返回 cleanup，store 暴露 snapshot/subscribe。
3. 边界显式化：前端 API wrapper、后端 module contribution、public surface、private boundary 都可搜索。
4. 风险显式化：配置、状态流、failure mode、测试锚点不只存在于人脑里。
5. 验证显式化：guard 和测试要能在本地和 CI 执行。

AI 最擅长沿着结构执行，最容易在隐式约定、跨文件双写和临时状态里迷路。因此 ofive 应继续把“正确路径”做成结构，而不是口头约定。

### 3.3 注册式设计

注册式设计是 ofive 支撑 AI 开发的核心模式。

前端注册面：

| 注册面 | 用途 |
| --- | --- |
| `src/host/pluginRuntime.ts` | 自动发现并激活 `src/plugins/**/*Plugin.ts(x)` |
| `src/host/registry/activityRegistry.ts` | activity bar 入口 |
| `src/host/registry/panelRegistry.ts` | sidebar panel |
| `src/host/registry/tabComponentRegistry.ts` | tab component 类型 |
| `src/host/registry/fileOpenerRegistry.ts` | 文件打开策略 |
| `src/host/registry/overlayRegistry.ts` | command palette、quick switcher 等 overlay |
| `src/host/commands/commandSystem.ts` | 前端命令和快捷键 |
| `src/host/store/storeRegistry.ts` | managed store 治理元数据 |
| `src/host/settings/**` | 设置项贡献 |

后端注册面：

| 注册面 | 用途 |
| --- | --- |
| `src-tauri/src/backend_module_manifest.rs` | 内建后端模块 manifest |
| `src-tauri/src/module_contribution.rs` | command、event、persistence owner、capability contribution |
| `src-tauri/src/host/command_registry.rs` | Tauri command 显式 handler |
| `src-tauri/src/host/events/**` | UI bridge event 清单 |
| `src-tauri/src/platform_public_surface.rs` | 允许跨模块依赖的公共面 |
| `src-tauri/src/module_boundary_template.rs` | 模块私有命名空间边界 |
| capability catalog/execution | AI、sidecar、frontend 的受控能力入口 |

注册式设计的价值是让 AI 能快速回答：

1. 这个能力是否已经存在？
2. 它由哪个模块贡献？
3. 它有没有 cleanup、测试和文档？
4. 新增入口是否破坏唯一事实源？

## 4. 资料层

AI 要长期维护项目，需要多层资料，而不是只靠 README。

### 4.1 项目级上下文

[AGENTS.md](../AGENTS.md) 是 AI 修改代码前应优先读取的项目级上下文。它适合放：

1. 跨任务稳定的架构警告。
2. 容易被 AI 误改的关键机制。
3. 必须遵守的代码规范。
4. 文档、测试、日志要求的入口。

`AGENTS.md` 不适合堆大量临时任务记录。临时问题应进入 issue、PR、任务记录或专项文档，稳定经验再回流到 `AGENTS.md`。

### 4.2 专项开发文档

专项文档回答“开发时怎么做”。

当前关键入口：

| 文档 | 作用 |
| --- | --- |
| [feature-extension-workflow.md](feature-extension-workflow.md) | 前端、后端、联动功能的总流程 |
| [plugin-development-guide.md](plugin-development-guide.md) | 前端插件开发和注册点 |
| [backend-module-extension-workflow.md](backend-module-extension-workflow.md) | 后端模块、capability、persistence、event 接入 |
| [testing-handbook.md](testing-handbook.md) | 测试面、CI、release gate、执行矩阵 |
| [sync-module-roadmap.md](sync-module-roadmap.md) | 长期模块的续做上下文 |
| [vector-storage-module-design.md](vector-storage-module-design.md) | 复杂能力的设计草案样板 |

专项文档应包含路径、命令、checklist 和例外条件。AI 执行任务时优先使用专项文档，而不是从 wiki 概念页猜实现步骤。

### 4.3 Wiki

Wiki 回答“系统是什么、边界是什么、为什么这样设计”。

关键入口：

| Wiki | 作用 |
| --- | --- |
| [[ofive-architecture-overview|架构总览]] | 系统分层和核心设计判断 |
| [[ofive-feature-owner-map|功能 Owner 地图]] | 功能归属 |
| [[ofive-frontend-runtime|前端运行时]] | 前端宿主、插件、store、event bus 的概念层 |
| [[ofive-backend-module-platform|后端模块平台]] | 后端模块治理概念 |
| [[ofive-maintainer-dashboard|维护者视图]] | 维护风险和质量门入口 |
| [[ofive-testing-and-ci|测试与质量治理]] | 测试面的概念关系 |
| [[ofive-documentation-map|文档地图]] | wiki 与专项文档分工 |

原则：wiki 不做路径索引，不写临时命令。路径和命令进入专项文档；概念和边界进入 wiki。

### 4.4 Skill

Skill 是“给 AI 执行的操作手册”，它比普通文档更偏向流程、判断和工具选择。

ofive 的 AI 工作区已经有几类高价值 skill：

| Skill 类型 | 解决的问题 |
| --- | --- |
| 工作区导航 | 判断先进入 `ofive`、`layout-v2` 还是 `far-api` |
| 功能源码搜索 | 从 UI 文案、命令、面板、事件追到 owner |
| 前端架构 | 判断插件、host、store、registry、API wrapper 的边界 |
| 后端架构 | 判断 app/domain/infra/host/shared、manifest、contribution 的边界 |
| 前后端交互 | 判断 command、event、sourceTraceId、mock fallback 和 store sync |
| 前端调试 | 要求优先在 `web-mock` 复现和验证 |
| 交互回归测试 | 为拖拽、hover、resize 等连续交互设计 mock/e2e 回归 |

Skill 的更新标准：

1. 当同类问题重复出现 2 到 3 次，沉淀为 skill。
2. 当 AI 经常误判 owner，把判断规则写入 skill。
3. 当调试路径稳定，把复现和验证路径写入 skill。
4. 当 skill 内容变成长期概念，再同步到 wiki 或专项文档。

Skill 不应替代仓库内文档。仓库内文档保证团队和 CI 上下文可见；skill 保证 AI 执行时拿到正确工作流。

### 4.5 代码注释

代码注释面向 AI 时应服务三个目标：

1. 标明模块职责和边界。
2. 解释非显然的不变量。
3. 暴露测试和调试时应关注的契约。

ofive 当前大量使用 JSDoc 和 Rust doc comment，这对 AI 读代码很友好。例如插件运行时、事件总线、store registry、Playwright 配置、后端 module contribution 都能在文件头看到职责描述。

不推荐的注释：

1. 重复代码表面含义。
2. 把已经过期的业务规则留在局部文件。
3. 在实现文件里写大段未来计划，导致 AI 把计划当作事实。

## 5. 工具层

### 5.1 架构 guard

ofive 的架构约束已经有一部分变成可执行 guard。

| Guard | 入口 | 作用 |
| --- | --- | --- |
| 后端私有边界 | `src-tauri/src/architecture_guard.rs` | 禁止跨模块直接依赖私有 app/infra |
| 模块 manifest 一致性 | `src-tauri/src/backend_module_manifest.rs` | module id、contribution、boundary template 对齐 |
| 模块 contribution 一致性 | `src-tauri/src/module_contribution.rs` | command、event、persistence owner、capability 唯一性 |
| 公共面治理 | `src-tauri/src/platform_public_surface.rs` | 限制公共依赖面使用范围 |
| 后端日志 guard | `scripts/check-backend-logs.mjs` | 禁止后端业务代码散落 `println!/eprintln!` |
| 主题色 guard | `scripts/check-theme-colors.mjs` | 约束主题颜色来源 |
| i18n 文案 guard | `scripts/check-i18n-copy.mjs` | 约束用户可见文案治理 |
| 编辑态/阅读态一致性 | `scripts/check-editor-read-parity.mjs` | 防止编辑增强渲染和阅读态漂移 |
| store 状态测试 guard | `scripts/check-store-state-tests.mjs` | 确保 managed store schema 有真实测试锚点 |
| settings 测试 guard | `scripts/check-settings-tests.mjs` | 确保设置面有测试锚点 |

统一入口是：

```bash
bun run check:guards
```

`bun run build` 和 `bun run web:build` 会执行主要 guard。AI 改动越靠近公共边界，越应该优先跑对应 guard，而不是等 CI 才暴露问题。

### 5.2 Mock Web

`web-mock` 是 AI 开发前端行为的关键工具。

入口：

```bash
bun run web:dev
# http://127.0.0.1:4173/web-mock/mock-tauri-test.html?showControls=0
```

核心文件：

| 文件 | 作用 |
| --- | --- |
| `web-mock/mock-tauri-test.html` | 浏览器 mock 入口 |
| `web-mock/mockMain.tsx` | mock React 入口 |
| `web-mock/mock/MockApp.tsx` | 复用主工作台、编辑器、插件、mock runtime |
| `web-mock/mock/MockVaultPanel.tsx` | mock vault、fixture、可见文件入口 |

AI 前端调试默认流程：

1. 先在 mock web 复现可见行为。
2. 如果 mock 缺入口，补最小 mock activity、panel、tab 或 fixture。
3. 修 owner 文件，不在 mock 里掩盖真实问题。
4. 用 Playwright 固化复现故事。
5. 只有 native-only 差异再进入 Tauri 手工或桌面验证。

这使 AI 不需要每次启动完整桌面应用，也能覆盖大多数 UI、编辑器、侧边栏、tab、布局和插件行为。

### 5.3 构建与依赖工具

当前关键脚本：

| 命令 | 作用 |
| --- | --- |
| `bun run build:layout-v2` | 构建本地共享布局依赖 |
| `bun run check:layout-v2-update` | 检查本地布局依赖更新 |
| `bun run build:sidecar` | 构建 AI sidecar |
| `bun run proto:generate` | 生成 sidecar proto 产物 |
| `bun run proto:check` | 检查 proto 生成产物漂移 |
| `bun run package:windows-portable` | Windows portable 打包 |
| `bun run report:perf` | 汇总性能报告 |

AI 需要把构建脚本视为工程边界。修改 sidecar、proto、layout-v2、发布脚本时，必须同步评估测试文档和 CI gate。

## 6. 测试层

### 6.1 测试面分层

ofive 不依赖单一测试套件，而是按风险面分层。

| 测试面 | 命令 | AI 何时使用 |
| --- | --- | --- |
| 前端单测 | `bun run test` / `bun run test:ci:unit` | 纯函数、store、registry、event bus、命令系统 |
| mock/web 功能 E2E | `bun run test:e2e:ci` | UI、panel、tab、editor、layout、插件流程 |
| 真实鼠标拖拽审计 | `bun run test:e2e:mouse-drag` | Dockview、拖拽、drop zone、动画命中 |
| 玻璃视觉专项 | `bunx playwright test --config playwright.glass.config.mjs` | 透明层、毛玻璃、视觉层级 |
| 前端性能 smoke | `bun run test:perf:frontend` | 图谱、编辑器、前端关键路径性能 |
| Rust core | `bun run test:rust:core` | 后端 command、query、vault、capability、架构 guard |
| Rust sidecar | `bun run test:rust:sidecar` | 主应用和真实 Go sidecar 联动 |
| Go sidecar | `bun run test:go` | provider、agent runtime、capability/persistence bridge |
| 后端性能 | `bun run test:perf:backend` | 查询、索引、向量等性能敏感路径 |
| 生产构建 | `bun run build` | guard、layout-v2、tsc、vite build |

AI 执行测试的原则：

1. 第一轮跑最窄、最能证伪假设的测试。
2. 第一处实质修改后尽早验证，不要攒到最后。
3. 可见前端行为必须优先考虑 mock web 或 Playwright。
4. 前后端 contract 改动不能只跑前端或只跑 Rust。
5. 性能、视觉、真实拖拽属于专项测试面，不默认混入所有任务，但相关改动必须主动跑。

### 6.2 测试设计

AI 补测试时应按行为选择测试层。

| 行为 | 推荐测试 |
| --- | --- |
| 纯解析、排序、转换、状态 reducer | Bun 单测 |
| registry 注册/注销、plugin lifecycle | Bun 单测 |
| editor 键盘、语法渲染、阅读态一致性 | 单测 + mock Playwright |
| panel、sidebar、tab、layout persistence | mock Playwright |
| 文件系统、query、frontmatter、graph、task | Rust integration |
| command/event/sourceTraceId | 前端 API 测试 + Rust command/event 测试 |
| AI tool、sidecar stream、proto | Go + Rust sidecar + proto check |
| 大规模图谱、索引、编辑器性能 | perf smoke / benchmark |

测试不是为了堆数量，而是为了让 AI 可以在后续修改中快速定位失败归属。

### 6.3 CI 与 release gate

默认 CI 阻塞面包括：

1. Go sidecar 测试、构建和 proto 漂移检查。
2. 前端单测。
3. Rust core 测试。
4. Rust sidecar 集成测试。
5. Playwright E2E，默认排除 `@mouse-drag`。
6. 生产构建。

Release gate 比默认 CI 更严格，会重新纳入全量 E2E 和 macOS ARM64 打包。AI 在准备发布或修改高风险交互时，不能把主线 CI 通过误认为 release gate 一定通过。

## 7. 调试层

### 7.1 面向 AI 的日志

日志对 AI 的价值不只是“给人看”，而是把异步系统状态变成可检索证据。

推荐日志形态：

1. 有稳定 tag，例如 `[pluginRuntime]`、`[guard-runner]`。
2. 结构化字段包含 path、moduleId、commandId、eventId、sourceTraceId、duration、error。
3. command wrapper 记录调用、耗时、成功/失败。
4. 前端日志通过 `setupFrontendLogBridge()` 进入后端日志桥。
5. 后端业务代码使用统一日志系统，不散落 `println!/eprintln!`。

本地写入和 watcher 回环尤其依赖 `sourceTraceId`。AI 调试保存、外部文件变化、重复 reload、自动保存覆盖时，应沿着 `sourceTraceId`、`persisted.content.updated` 和 `vault.fs` 事件链排查。

### 7.2 调试环境

推荐调试梯度：

1. Bun 单测：最快定位纯逻辑。
2. `web-mock`：最快复现前端可见行为。
3. Playwright trace/screenshot：固化用户路径和回归证据。
4. Tauri dev：验证 native-only 差异，例如文件系统、窗口、dialog、sidecar。
5. Rust/Go 聚焦测试：验证后端和 sidecar contract。
6. 性能/视觉专项：验证非功能性回归。

真实 vault 可以作为排查资源，但进入仓库时应抽成最小 fixture、mock 场景或测试样本，避免把个人环境当作测试前提。

### 7.3 AI 调试流程

AI 调试不应从“猜一个修复”开始，而应先形成可验证假设。

标准流程：

1. 用最具体锚点搜索：错误信息、UI 文案、command id、event tag、测试名、路径。
2. 找到 owner，而不是停在 registry、runtime、barrel 或 shell。
3. 在 mock 或聚焦测试里复现。
4. 修改 owner 文件。
5. 立即跑最小验证。
6. 如果失败，先判断是复现不对、owner 不对、fixture 不对，还是设计假设不对。
7. 成功后补更高层验证和文档。

## 8. 维护与治理

### 8.1 把重复经验转成工程资产

AI 全流程开发的关键不是每次让 AI 更努力，而是让仓库越来越适合 AI 工作。

经验沉淀顺序：

| 重复出现的问题 | 应沉淀为 |
| --- | --- |
| AI 总找错 owner | skill 或 feature owner 文档 |
| AI 总忘记测试面 | testing handbook 或 guard |
| AI 总破坏架构边界 | Rust guard、脚本 guard、manifest 校验 |
| AI 总漏 cleanup | plugin/runtime 单测或 registry lifecycle 测试 |
| AI 总误解概念 | wiki 原子词条 |
| AI 总漏复现步骤 | mock fixture、Playwright、专项调试文档 |
| AI 总漏文案或设置 | i18n/settings guard |

### 8.2 防止 AI 退化项目结构

AI 容易把复杂项目退化成几个“万能文件”。ofive 需要持续防止这些趋势：

1. 业务逻辑回流到 `App.tsx`、`WorkbenchLayoutHost.tsx`、`lib.rs`。
2. registry 从“注册表”退化成“业务分发器”。
3. 后端 module contribution 之外又出现新的命令、事件、capability 事实源。
4. 组件直接 `invoke()` 或 `listen()`。
5. 多个 store 各自维护同一事实。
6. mock 只为测试造假，不复用真实 owner。
7. 文档写了原则，但没有 guard 或测试支撑。

治理手段应优先自动化：能做测试就做测试，能做 guard 就做 guard，最后才依赖 review 记忆。

### 8.3 文档治理

文档更新规则：

1. 新概念、新边界、新模块：更新 wiki。
2. 新开发流程、新命令、新测试面：更新专项文档。
3. 新 AI 操作套路：更新 skill。
4. 新局部不变量：更新代码注释。
5. 新质量门：更新测试手册、CI 说明和相关 package script。

文档不应只描述理想状态。它要么对应现有代码，要么明确标注为 roadmap / design draft。

### 8.4 依赖、发布、安全和数据治理

AI 全流程开发还需要覆盖容易遗漏的治理面：

| 治理面 | AI 应检查 |
| --- | --- |
| 依赖升级 | 是否影响 `layout-v2`、Tauri、CodeMirror、Playwright、Go/Rust toolchain |
| 发布 | version、release tag、DMG、sidecar 产物、release gate |
| 安全/权限 | AI tool 是否需要 confirmation、capability risk、文件写入范围 |
| 数据迁移 | vault config、module-private persistence、store schema 是否兼容 |
| 隐私 | 本地 vault 内容、日志、debug export 是否泄漏敏感数据 |
| 回滚 | AI edit rollback、持久化回滚、sidecar 失败降级 |
| 性能预算 | 图谱规模、索引时间、编辑器响应、sidecar stream 延迟 |

这些内容不一定每次都修改，但 AI 在设计和 review 时应主动扫描。

## 9. 典型任务路径

### 9.1 新增前端插件

1. 用 owner 判断确认是插件功能，而不是 host service。
2. 在 `src/plugins/<feature>/` 新增入口和实现。
3. 入口导出 `activatePlugin()`，注册 activity/panel/tab/command/settings。
4. 状态留在插件内部；需要宿主治理时注册 managed store。
5. 后端调用只经过 `src/api/**`。
6. 在 `web-mock` 暴露最小入口。
7. 补 Bun 单测或 Playwright。
8. 更新插件文档或 wiki 关系。

### 9.2 新增后端能力

1. 判断扩展现有模块还是新增模块。
2. 在模块内部 app/domain/infra 收敛实现。
3. command/event/capability/persistence owner 只保留一个事实源。
4. 更新 module manifest/contribution。
5. 如形成跨模块依赖，走 shared contract、capability、facade 或 public surface。
6. 补架构 guard 相关测试和 Rust 单测/集成测试。
7. 前端消费时补 API wrapper 和 mock fallback。

### 9.3 新增前后端联动功能

1. 先稳定 contract：command、event、payload、sourceTraceId、错误语义。
2. 后端 command wrapper 保持薄桥接，业务进入 app service。
3. 前端只通过 API wrapper 消费。
4. 后端事件进入 API wrapper 或 backend bridge，再转语义事件。
5. 状态由唯一 store owner 归一。
6. 前端 mock fallback 保持异步形状一致。
7. 同时补前端测试、Rust 测试和必要 e2e。

### 9.4 修复 UI 回归

1. 先用功能源码搜索找到 owner。
2. 优先在 `web-mock/mock-tauri-test.html?showControls=0` 复现。
3. mock 缺场景时补最小 fixture。
4. 修 owner，不在测试里规避真实行为。
5. 用 Playwright 固化复现故事。
6. 如涉及 Tauri-only 行为，再补桌面验证说明。

### 9.5 性能回归

1. 判断是前端渲染、查询索引、sidecar、向量、还是布局问题。
2. 使用现有 perf smoke 或 backend benchmark 建立基线。
3. 避免只放宽阈值；先确认渲染量、查询次数、缓存、索引规模是否结构性变化。
4. 将复现数据抽成稳定 mock/bench fixture。
5. 更新性能文档或测试阈值说明。

## 10. AI 交付标准

AI 交付前应完成这份 checklist。

### 10.1 设计检查

- [ ] 已说明 owner。
- [ ] 已说明事实源。
- [ ] 已说明状态和副作用归属。
- [ ] 新增公共面有长期理由。
- [ ] 没有把业务逻辑塞进壳层或中央注册表。

### 10.2 实现检查

- [ ] 前端后端调用经过 `src/api/**`。
- [ ] 后端 command/event/capability/persistence owner 接入 contribution。
- [ ] 插件、订阅、事件监听有 cleanup。
- [ ] mock fallback 与真实 API 形状一致。
- [ ] Markdown 解析遵守 exclusion / detector 规则。

### 10.3 验证检查

- [ ] 已跑最小聚焦测试。
- [ ] 可见前端行为已在 mock web 或 Playwright 验证。
- [ ] 前后端 contract 改动已覆盖前端和 Rust 两侧。
- [ ] sidecar/proto 改动已跑 Go、sidecar、proto 相关检查。
- [ ] 性能/视觉/真实拖拽改动已跑对应专项测试，或明确说明未跑原因。

### 10.4 治理检查

- [ ] 文档、wiki、skill、代码注释按变更性质同步。
- [ ] 新测试面或 guard 已接入脚本/CI 或说明为什么暂不接入。
- [ ] 提交前检查 `git status` 和 diff，避免混入无关修改。
- [ ] commit message 描述用户价值和治理面。
- [ ] push 后确认远端分支更新。

## 11. 人、AI、CI 的分工

在 ofive 这种规模的项目里，“完全通过 AI 开发”不等于人完全退出，而是让人从逐行实现转为目标、取舍和验收。

| 角色 | 责任 |
| --- | --- |
| 人 | 提供目标、优先级、产品取舍、凭据授权、最终验收 |
| AI | 检索、设计、实现、测试、调试、文档、提交和推送 |
| 仓库 | 提供 owner、约束、guard、测试、文档和 mock 环境 |
| CI | 提供独立质量门 |
| Release gate | 提供发布前完整验证 |

这套分工的理想状态是：人提出“要什么”和“接受什么风险”，AI 负责把仓库已有的工程约束完整走完。

## 12. 结论

ofive 的 AI 开发模式可以总结成一句话：

> 把架构约束做成注册，把注册做成 guard，把行为做成测试，把经验做成文档和 skill。

当这四件事持续运转时，20 万行级别项目也能让 AI 稳定承担从需求拆解、架构设计、实现、验证、调试、维护到推送的完整工作流。
