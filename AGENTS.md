# AGENTS.md

本文件为 AI 编程助手提供项目级上下文，确保在修改代码时遵循关键架构约束。

## 项目概览

ofive 是一个基于 Tauri + React + CodeMirror 6 的桌面笔记应用。前端使用 TypeScript + Vite 构建，后端使用 Rust。

## 编辑器语法渲染架构

### 双轨装饰系统

编辑器存在两种并行的装饰机制，修改任何语法渲染相关代码前必须理解它们的关系：

| 机制 | 载体 | 成员 |
|---|---|---|
| **行级注册表** (`syntaxRenderRegistry.ts`) | 1 个共享 ViewPlugin | header, bold, italic, strikethrough, inline-code, wikilink, tag, blockquote, hr, link, highlight |
| **独立 ViewPlugin** | 各自独立的 ViewPlugin | frontmatter, code-block-highlight, latex, image-embed |

### 排斥区域系统（Exclusion Zones）—— 核心注意事项

**`src/layout/editor/syntaxExclusionZones.ts`** 是解决多种块级语法结构嵌套冲突的通用机制。

#### 问题背景

多种块级结构（frontmatter / code fence / LaTeX block）各自独立扫描文档文本。如果不加协调，代码块内的 `# comment` 会被标题渲染器装饰，`$$` LaTeX 块内的 markdown 语法也会被错误渲染。

#### 优先级体系

| Owner | 优先级 | 含义 |
|---|---|---|
| `frontmatter` | 0（最高） | YAML 头信息 |
| `code-fence` | 1 | 围栏代码块 |
| `latex-block` | 2 | LaTeX 公式块 |

#### 工作原理

1. 每个块级插件在 `build()` 方法中调用 `setExclusionZones(view, owner, zones[])` 声明自己管辖的文档区间。
2. 块级插件通过 `isRangeInsideHigherPriorityZone()` 检查自己的候选区域是否被更高优先级插件覆盖，是则跳过。
3. 行级注册表通过 `isInsideExclusionZone()` 跳过任何被块级插件占据的行。

#### 扩展注册顺序

在 `CodeMirrorEditorTab.tsx` 中，**块级插件必须在行级注册表之前注册**，确保排斥区域在行级渲染器运行前已声明：

```
createFrontmatterSyntaxExtension()     // 优先级 0
createCodeBlockHighlightExtension()    // 优先级 1
...createLatexSyntaxExtension()        // 优先级 2
registeredLineSyntaxRenderExtension    // 行级渲染，查询排斥区域
```

#### 新增块级语法结构时的操作清单

如果要新增一种块级语法结构（如 Mermaid 图表、admonition 等），必须：

1. 在 `syntaxExclusionZones.ts` 的 `ExclusionZoneOwner` 类型中新增标识。
2. 在 `OWNER_PRIORITY` 中定义其优先级数值。
3. 在该插件的 `build()` 方法中：
   - 调用 `setExclusionZones(view, owner, zones[])` 声明区域。
   - 调用 `isRangeInsideHigherPriorityZone()` 过滤被更高优先级覆盖的块。
4. 在 `CodeMirrorEditorTab.tsx` 中将该扩展注册在 `registeredLineSyntaxRenderExtension` **之前**。

**不遵循以上步骤将导致嵌套语法冲突（如代码块内的注释被渲染为标题）。**

## 代码规范

详见 `.github/instructions/` 目录下的规范文件：

- `SPEC.instructions.md` — Rust 后端代码规范
- `SPEC-FRONTEND.instructions.md` — 前端代码规范
- `integration_test.instructions.md` — 集成测试要求

核心要点：
- 遵循"代码即文档"原则，所有模块/函数/结构体必须有文档注释
- 前端通过 Tauri 日志桥接记录日志，关键操作（后端调用、状态变化、空值）必须记录
- 模块间依赖应清晰，导出过多时评估拆分
- 后端导出方法必须有单元测试，覆盖率 ≥ 80%
- 前后端接口和状态管理需有集成测试
