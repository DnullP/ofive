---
title: "ofive Code Simplification Governance"
kind: "governance"
status: "active"
updated: "2026-05-26"
owners:
  - "maintainers"
  - "frontend"
tags:
  - "ofive"
  - "ai-development"
  - "code-simplification"
  - "guard"
  - "ci"
related:
  - "ofive-content-source-of-truth"
  - "ofive-app-event-bus"
  - "ofive-managed-store"
  - "ofive-testing-and-ci"
---

# ofive Code Simplification Governance

本文档记录 2026-05-24 的代码收敛迭代结果，以及后续 AI agent 继续推进时必须遵守的门禁和交接点。

## 目标

ofive 的主要开发者是 AI agent，因此代码治理不能只依赖口头约定。重复出现的问题要收敛成三类硬资产：

1. 脚本扫描：先发现复杂度、重复入口和违规边界。
2. guard/CI：阻止新增非预期复杂度。
3. 测试：锁住用户可见行为和跨组件同步契约。

本轮收敛重点是持久内容同源同步、直接 mutation 入口治理、历史兼容代码清理，以及代码简化基线。

## 当前新增入口

| 入口 | 用途 |
| --- | --- |
| `bun run scan:code-simplification` | 输出代码简化对象清单。 |
| `bun run check:code-simplification` | 阻止新增超大文件、类型逃逸、raw Tauri、旧 store 入口和重复 entrypoint。 |
| `bun run check:persisted-content` | 阻止业务组件绕过受控服务直接执行持久内容 mutation。 |
| `bun run check:guards` | CI 统一静态门禁入口。 |

核心脚本：

- `scripts/scan-code-simplification-targets.mjs`
- `scripts/check-code-simplification-guards.mjs`
- `scripts/code-simplification-baseline.config.mjs`
- `scripts/check-persisted-content-guards.mjs`

## 已完成的收敛

### 代码简化扫描与硬门禁

新增扫描脚本后，agent 可以先用同一套指标识别优化对象。当前指标包括：

- 文件行数和历史超大文件基线。
- React hook 密度。
- TypeScript escape hatch。
- raw Tauri import。
- persisted content mutation 调用。
- legacy store import。
- duplicate store entrypoint。
- 文档治理引用漂移。

`check:code-simplification` 当前采用“历史债务允许存在，但不允许增加”的策略。每清掉一个历史债务，应同时收紧 baseline 或 guard，防止它回来。

2026-05-26 发版前同步了一次当前主分支高水位 baseline，覆盖前序 overlay、UI、AI sidecar 与任务看板改动已经形成的行数增长。该同步不改变策略：后续提交仍不得超过新的 baseline，清理历史债务时仍应同步收紧对应条目。

### 持久内容 mutation 服务

新增 `src/host/vault/vaultMutationService.ts`，接管 Markdown/Canvas 文件的 rename/move/delete。

业务组件和命令入口不应直接调用：

- `renameVaultMarkdownFile`
- `renameVaultCanvasFile`
- `moveVaultMarkdownFileToDirectory`
- `moveVaultCanvasFileToDirectory`
- `deleteVaultMarkdownFile`
- `deleteVaultCanvasFile`

应使用：

- `renamePersistedMarkdownFile`
- `renamePersistedCanvasFile`
- `movePersistedMarkdownFileToDirectory`
- `movePersistedCanvasFileToDirectory`
- `deletePersistedMarkdownFile`
- `deletePersistedCanvasFile`

这些服务会在底层 API 成功后发布 `persisted.content.updated`，并带上可选字段：

- `operation`: `renamed` / `moved` / `deleted`
- `oldRelativePath`: rename/move 的旧路径

保存路径仍由 `src/host/editor/persistedMarkdownContentSync.ts` 管理。

### 旧 store 兼容入口删除

已删除这些过时文件：

- `src/host/store/configStore.ts`
- `src/host/store/vaultStore.ts`
- `src/host/store/themeStore.ts`
- `src/host/store/shortcutStore.ts`

canonical 入口为：

- `src/host/config/configStore.ts`
- `src/host/vault/vaultStore.ts`
- `src/host/theme/themeStore.ts`
- `src/host/commands/shortcutStore.ts`

两个 E2E 的动态 import 已改到 canonical 路径。`check:code-simplification` 会阻止旧 entrypoint 文件或旧 import 复活。

## 后续优先级

1. 把 AI backend rollback 和后端写入回滚纳入统一 mutation 语义，避免后端恢复内容后只靠局部通知。
2. 为 `persisted.content.updated` 的 `operation` 增加更多消费侧策略，例如 rename/move 后刷新旧路径和新路径相关派生视图。
3. 拆分 `src/api/vaultApi.ts`，优先分离内容 mutation、read/query、watch/config。
4. 继续减少超大 React 文件。优先顺序以 `bun run scan:code-simplification` 的 top targets 为准。
5. 处理 `AGENTS.md`、docs、skill、guard 之间的治理引用漂移；发现一次修一次。

## 交接验证命令

本轮交接前已跑通过：

```bash
bun scripts/run-unit-tests-with-summary.mjs scripts/check-code-simplification-guards.test.mjs src/host/vault/vaultMutationService.test.ts src/host/commands/commandSystem.delete.test.ts
bun run check:persisted-content
bun run check:code-simplification
bunx tsc --noEmit --pretty false
bun run check:guards
bunx playwright test --config playwright.config.ts e2e/frontmatter-visibility.e2e.ts e2e/custom-activity.e2e.ts --reporter=line
```

## Skill

后续继续此类工作时，使用工作区 skill：

- `/Users/kaiqiu/Documents/projects/rust/tauris/.agents/skills/ofive-code-governance/SKILL.md`

该 skill 记录了当前 guard、扫描、mutation 服务、旧兼容入口清理规则和推荐验证命令。
