---
title: "ofive App Event Bus"
kind: "architecture-term"
status: "active"
updated: "2026-04-27"
owners:
  - "frontend"
tags:
  - "ofive"
  - "frontend"
  - "event-bus"
  - "sync"
  - "runtime"
concepts:
  - "语义事件"
  - "后端事件桥"
  - "编辑器事件"
  - "持久态内容更新"
  - "事件订阅"
related:
  - "ofive-frontend-runtime"
  - "ofive-workbench-host"
  - "ofive-managed-store"
  - "ofive-vault-and-query-index"
  - "ofive-markdown-editor"
  - "ofive-backend-event-bridge"
  - "ofive-editor-event"
  - "ofive-business-refresh-event"
  - "ofive-event-subscription"
---

# ofive App Event Bus

App Event Bus 是 ofive 前端运行时的语义事件层。它把后端文件系统事件、配置事件、编辑器事件和业务刷新事件整理成可订阅、可测试、可治理的前端事件。

它不是状态管理工具，也不是业务事实源。它负责通知“发生了什么”，具体状态如何变化由对应 owner 决定。

## 事件来源

### [[ofive-backend-event-bridge|后端事件桥]]

后端事件来自桌面宿主运行时，例如 Vault 文件变化、配置变化和其他原生能力通知。App Event Bus 将这些事件桥接成前端可订阅语义。

治理要点：业务组件不应直接依赖底层后端事件名称。它们应订阅前端语义事件。

### [[ofive-editor-event|编辑器事件]]

编辑器事件描述当前编辑器内容变化、焦点变化、定位请求和原生命令请求。

治理要点：编辑器事件应表达用户编辑语义，而不是泄露编辑器内部实现细节。

### [[ofive-business-refresh-event|业务刷新事件]]

业务刷新事件描述持久态内容已变化、文件树需要刷新、读型组件需要重新读取等语义。

治理要点：读型组件优先订阅业务刷新事件，避免各自监听低层文件系统事件。

## 事件类型分层

```text
低层事件
  -> 前端语义事件
  -> 业务刷新事件
  -> 组件自有状态更新
```

这个分层避免了组件把事件来源当成业务含义。例如文件系统修改不等于编辑器立刻覆盖用户未保存内容；它需要先被转换为“外部持久态内容更新”，再由具体组件决定是否读取、合并或提示。

## 后端事件桥

[[ofive-backend-event-bridge|Backend Event Bridge]] 负责在应用生命周期中建立单点订阅，避免多个组件重复订阅后端事件。它把后端通知转发到 App Event Bus，再由插件和 store 消费。

治理要点：后端事件桥应保持单例语义。重复桥接会造成重复刷新、重复日志和难以诊断的状态抖动。

## 持久态内容更新

[[ofive-persisted-content-event|Persisted Content Event]] 表示某个文件的持久态内容已经改变。来源可以是前端保存成功，也可以是外部内容修改。

治理要点：读型组件应关心“持久态是否已更新”，而不是关心更新来自保存按钮、自动保存、外部编辑器还是 watcher。

## 与同步插件的关系

Vault 文件同步插件会消费文件系统语义事件，并把它们转换为持久态内容更新事件；当命中已缓存 Markdown 时，还会读取最新内容并刷新编辑器缓存。

治理要点：同步插件是事件转换者，不是事件总线本身。事件总线保持中立，插件负责领域语义转换。

## 与其他词条的关系

- [[ofive-event-subscription|Event Subscription]]：描述事件消费者的订阅和清理关系。
- [[ofive-frontend-runtime|前端运行时]]：App Event Bus 是前端运行时的事件语义层。
- [[ofive-workbench-host|Workbench Host]]：工作台通过事件感知激活、文件和布局相关变化。
- [[ofive-managed-store|Managed Store]]：store 可订阅事件，但状态事实源仍归 store owner。
- [[ofive-vault-and-query-index|Vault 与查询索引]]：Vault 文件变化会通过事件触发目录树和查询投影刷新。
- [[ofive-markdown-editor|Markdown 编辑器]]：编辑器通过事件发布内容变化、焦点变化和命令请求。

## 维护检查

1. 新增事件前，确认它表示稳定语义，而不是某个实现细节。
2. 新增订阅者前，确认订阅者会在生命周期结束时清理。
3. 同一个后端事件不应被多个业务组件各自解释成不同含义。
4. 读型组件应订阅持久态更新语义，而不是重复解析文件系统事件。
5. 对可能形成循环的事件，必须明确来源过滤或幂等处理。

## 反模式

- 把事件总线当成全局状态容器。
- 组件直接订阅低层后端事件并自行解释。
- 后端事件桥被重复启动。
- 事件没有清理函数，导致卸载后仍响应。
- 事件名表达实现细节，而不是业务语义。
