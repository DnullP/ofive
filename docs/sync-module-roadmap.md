---
title: "ofive 同步模块续做清单"
kind: "roadmap"
status: "roadmap"
updated: "2026-04-26"
owners:
  - "backend"
tags:
  - "ofive"
  - "sync"
  - "roadmap"
  - "backend-module"
related:
  - "ofive-backend-module-platform"
  - "ofive-maintainer-dashboard"
---

# ofive 同步模块续做清单 v1

## 1. 文档定位

本文档用于记录多端同步模块当前已经落地的边界，以及后续待实现事项。

项目 wiki 入口：[[ofive-backend-module-platform|后端模块平台]]、[[ofive-maintainer-dashboard|维护者管理视图]]。

目标不是一次性把同步方案设计到最终形态，而是把“已经决定的边界”和“接下来应该继续做的最小步”固定下来，避免中断后重新梳理上下文。

适用场景：

- 暂停当前同步模块实现，后续继续接力
- 需要快速了解 Sync 模块已经落了哪些治理边界
- 需要判断下一步应优先做协议、状态、命令还是运行时编排

不适用场景：

- 完整服务端设计
- 实时协同或 CRDT 级别方案设计
- 前端 UI 交互细节设计

## 2. 当前已完成边界

以下内容已经落地，可作为后续实现起点：

1. 已新增 `sync` 后端模块骨架。
2. 已将 `sync` 模块接入 builtin backend manifests。
3. 已为 `sync` 模块声明 `module_id = sync`。
4. 已为 `sync` 模块声明 `persistence_owner = sync`。
5. 已为 `sync` 模块声明边界模板，后续私有实现必须收敛在 `src-tauri/src/app/sync/` 下。
6. 已新增 Vault 对同步模块的受管控消费入口：`src-tauri/src/app/vault/sync_facade.rs`。
7. 已将 `crate::app::vault::sync_facade` 声明为 Vault 稳定公共依赖面，仅允许 `src/app/sync/` 与 `src/app/vault/` 使用。

当前已经存在的关键文件：

- `src-tauri/src/app/sync/mod.rs`
- `src-tauri/src/app/sync/module_contribution.rs`
- `src-tauri/src/app/vault/sync_facade.rs`
- `src-tauri/src/app/vault/module_contribution.rs`

## 3. 当前明确不做的事

以下内容在当前阶段明确不进入本轮实现：

1. 不实现服务端。
2. 不实现实时协同。
3. 不直接引入 CRDT、OT 或块级合并。
4. 不在前端暴露完整同步 UI。
5. 不让同步模块直接依赖 Vault 私有 infra 或 watcher 实现。

## 4. 下一阶段待办

### 4.1 模块内状态与契约

- [ ] 定义 Sync 模块自己的 shared/domain 契约，至少覆盖：
  - 远端仓库标识
  - 同步配置
  - 上次成功同步点
  - 本地同步状态
  - 同步方向与结果摘要
- [ ] 评估这些结构哪些应该进入 `shared/`，哪些只属于 `sync` 模块私有状态。
- [ ] 定义同步错误模型，避免早期继续扩散裸 `String`。

### 4.2 私有持久化

- [ ] 通过已有 persistence protocol 为 `sync` 模块落本地私有状态。
- [ ] 明确 `sync` owner 下需要保存的状态键，例如：
  - `settings`
  - `cursor`
  - `session`
  - `last-result`
- [ ] 补对应单测，覆盖 save/load/list/revision conflict。

### 4.3 最小同步协议

- [ ] 定义客户端与外部同步服务之间的第一版最小协议。
- [ ] 明确请求/响应中哪些字段由服务端权威决定，哪些由客户端本地决定。
- [ ] 明确第一版只支持的操作集：
  - 拉取远端变更
  - 推送本地变更
  - 文件新增
  - 文件覆盖
  - 文件删除
  - 目录新增/删除/移动
- [ ] 明确第一版暂不支持的复杂语义，例如三方合并、并发协作、块级冲突解决。

### 4.4 Sync App Service

- [ ] 在 `src-tauri/src/app/sync/` 下增加最小 app service。
- [ ] 第一版建议至少具备以下入口：
  - `preview_sync_plan`
  - `pull_remote_changes`
  - `push_local_changes`
  - `apply_remote_changes`
  - `get_sync_status`
- [ ] 这些入口内部只能通过 `crate::app::vault::sync_facade` 访问 Vault。

### 4.5 Host 边界

- [ ] 评估是否需要对前端暴露 Tauri command。
- [ ] 如果需要，优先定义最小命令面，而不是一开始就把完整流程都暴露出去。
- [ ] 评估是否需要同步状态事件；若需要，只接 `UiBridge` 事件。

### 4.6 运行时与回环控制

- [ ] 设计“同步应用远端变更”与 watcher 事件之间的关系。
- [ ] 复用现有 `source_trace_id` 思路，避免同步写入再次被当作新的本地变更回传。
- [ ] 明确批量同步时是否需要新的 task/batch 语义，而不是逐文件独立副作用。
- [ ] 明确同步期间 query index 重建策略，避免每个文件单独触发后台重建造成抖动。

### 4.7 测试

- [ ] 为 `sync` 模块 contribution/manifest 增加最小回归测试。
- [ ] 为 Sync app service 增加单元测试。
- [ ] 为“通过 Vault sync facade 应用远端变更”增加集成测试。
- [ ] 至少覆盖以下场景：
  - 首次全量拉取
  - 本地已有文件时的覆盖/冲突
  - 删除与移动操作
  - 回环抑制
  - 批量应用后的索引一致性

## 5. 推荐实施顺序

后续恢复开发时，建议按以下顺序继续：

1. 先补 `sync` 模块私有状态契约与 persistence state keys。
2. 再补 Sync app service 的最小入口，不急着接前端。
3. 再定义第一版客户端/服务端协议。
4. 再打通“拉取远端变更并应用到本地 Vault”的最小闭环。
5. 最后才考虑前端命令、状态展示和更复杂的运行时调度。

## 6. 实施约束

后续继续做同步模块时，默认遵守以下约束：

1. Sync 模块不得直接依赖 Vault 私有 infra。
2. Sync 模块对 Vault 的消费默认只走 `sync_facade`。
3. 若需要扩大 Vault 暴露能力，应优先扩 `sync_facade`，不要直接绕过去调用更底层模块。
4. 若新增公共依赖面，必须同步更新 manifest/public surface/architecture guard 路径白名单。
5. 若新增命令、事件、capability、persistence owner，必须同步更新 contribution 与测试。

## 7. 恢复开发时的最小检查

恢复开发同步模块前，先确认：

- [ ] `sync` 模块骨架仍在 builtin manifests 中。
- [ ] `crate::app::vault::sync_facade` 仍是唯一 Vault 消费入口。
- [ ] architecture guard 与 module contribution 测试仍通过。
- [ ] 没有新增绕过 sync facade 的临时依赖。

一句话原则：先把同步模块自己的状态、协议和最小 app service 落稳，再继续扩大命令面和运行时复杂度。
