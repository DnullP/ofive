# ofive Editor 优化方案

## 1. 文档定位

本文档用于回答一个已经明确的问题：

在当前仓库已经深度定制 CodeMirror 的前提下，ofive 的 editor 后续应该如何优化，才能更接近 Obsidian 式编辑体验，同时避免继续跨越维护边界。

本文不讨论完整编辑器换底座实施细节，也不直接给出逐文件改造方案；它的目标是先把产品边界、架构方向、优先级和阶段性动作统一下来，作为后续重构与评审的依据。

## 2. 当前结论

当前最重要的结论有四个：

1. 若目标是 Obsidian 式编辑体验，编辑器底座继续使用 CodeMirror 是正确方向。
2. 当前复杂度的根因，不是 CodeMirror 本身不够强，而是 editor 正在同时承载“源码编辑器”“块级组件容器”“读写态渲染契约”“Vim 焦点入口”四种职责。
3. 对常规 Markdown 行内语法，例如 bold、italic、strikethrough、inline code，继续使用当前“轻装饰 + 光标进入即回退源码”的做法是正确的。
4. 对表格这类特例能力，可以保留源码隐藏和可视化操作，但不应继续演化为长期持有独立焦点和独立快捷键体系的 mini editor。

换句话说，当前不需要优先更换底座，而需要先把产品模型收回到 Obsidian 式 Live Preview 的边界内。

## 3. 当前架构现状

当前 editor 已经形成一套清晰但复杂的双轨机制。

### 3.1 行级语法渲染

行级增强由共享注册表统一承载，入口是：

- [src/plugins/markdown-codemirror/editor/syntaxRenderRegistry.ts](../src/plugins/markdown-codemirror/editor/syntaxRenderRegistry.ts)

这一层适合处理：

- bold
- italic
- strikethrough
- inline code
- tag
- highlight
- link
- wikilink

这类语法的共同点是：

1. 仍然以 Markdown 源码为唯一事实源。
2. 增强渲染只影响局部显示，不引入独立编辑上下文。
3. 当光标进入语法范围时，装饰可撤销，源码重新可见。

这正是 Obsidian 式 Live Preview 最应该保留的能力层。

### 3.2 块级语法接管

块级结构由独立 ViewPlugin 接管，依赖排斥区系统防止冲突，核心入口是：

- [src/plugins/markdown-codemirror/editor/syntaxExclusionZones.ts](../src/plugins/markdown-codemirror/editor/syntaxExclusionZones.ts)
- [src/plugins/markdown-codemirror/editor/CodeMirrorEditorTab.tsx](../src/plugins/markdown-codemirror/editor/CodeMirrorEditorTab.tsx)

当前被块级插件接管的内容包括：

- frontmatter
- code fence
- latex block
- markdown table
- image embed

这套机制本身没有问题，但它把 editor 的复杂性从“显示增强”推进到了“局部结构接管”。

### 3.3 已出现的维护边界

当前维护边界主要体现在三类问题：

1. 组件一旦获取真实 DOM focus，就会脱离主文本编辑模型。
2. Vim、快捷键分发、输入法、自动保存、焦点切换开始需要跨 editor 和 widget 协同。
3. 新增块级结构时，不仅要写插件，还要接入排斥区优先级、注册顺序、读写态对齐和测试契约。

这说明当前真正需要优化的，不是“再多做几个 widget”，而是“重新界定哪些能力应该是 editor 内增强，哪些能力不该继续内嵌”。

## 4. 目标体验定义

后续 editor 优化应以 Obsidian 式体验为目标，而不是继续追求“正文区一切都组件化”。

这里的目标体验定义为：

1. Source mode：完整显示 Markdown 源码，行为最可预测。
2. Live Preview：在不破坏文本模型的前提下隐藏部分语法标记，提供有限结构增强。
3. Reading view：完全脱离编辑语义，追求稳定阅读展示。

对于 Live Preview，需要坚持两个原则：

1. Markdown 源码仍然是唯一事实源。
2. 用户一旦进入编辑，就应尽量自然地回到文本编辑，而不是进入一个完全独立的局部应用。

## 5. 优化原则

### 5.1 保留行内轻装饰路线

对 bold、italic、strikethrough、inline code 这类常规行内语法，继续使用当前做法。

原因如下：

1. 这类语法只需要隐藏定界符和增加视觉样式。
2. 它们不需要独立焦点。
3. 光标进入时回退源码，心智模型稳定。
4. 这类能力与 Obsidian Live Preview 高度一致。

因此，这一层不是重构重点，而是今后 editor 设计的正向基线。

### 5.2 收缩块级 widget 的默认使用范围

不是所有“看起来能可视化”的 Markdown 结构都应该做成 editor 内 widget。

建议把块级增强分成三类：

1. A 类：文本忠实型增强
2. B 类：受约束结构增强
3. C 类：独立交互型组件

对应策略如下：

1. A 类默认允许，优先保留在 editor 内。
2. B 类按特例评估，可以保留，但要限制交互深度。
3. C 类默认不应继续进入 Live Preview 正文区。

### 5.3 只让少数结构成为 Live Preview 特例

当前建议的归类如下：

#### A 类：应继续保持当前轻增强路线

- bold
- italic
- strikethrough
- inline code
- tag
- highlight
- 普通链接
- wikilink

这些能力应继续走行级 decoration 路线。

#### B 类：可以作为 Obsidian 式特例保留

- markdown table
- image embed
- block latex
- frontmatter 摘要态

这些能力可以在 Live Preview 中保留增强，但应限制为“可视化辅助 + 轻交互”，不应默认成为完整局部编辑器。

#### C 类：默认不应继续内嵌到正文区

- 长期持有焦点的 React 表单
- 拥有独立快捷键体系的子编辑器
- 需要复杂状态机和独立提交时机的组件
- 未来可能加入的复杂面板型对象，如数据库视图、复杂属性编辑器、流程图配置器

这类能力更适合外部 panel、dialog、split editor，或 Reading view/专用视图。

## 6. 针对具体能力的建议

### 6.1 常规 Markdown 语法

继续保持当前做法。

重点不是重写，而是补强一致性：

1. 统一语法边界规则。
2. 统一“进入选择后回退源码”的交互。
3. 对嵌套强调、边界歧义和列表上下文补更多测试。

### 6.2 表格

表格是特殊情况。

根据 Obsidian 公共文档，Live Preview 下的表格可以不展开源码，同时支持行列增删、排序和移动。这说明表格可以保留在 CodeMirror 路线下，但实现目标应调整为“受约束特例”，而不是“正文里的独立表格应用”。

当前建议：

1. 保留源码隐藏。
2. 保留单元格直编能力，但收缩独立输入系统的复杂度。
3. 优先通过上下文菜单、命令和有限快捷动作完成行列操作。
4. 避免表格长期持有自己的全局快捷键逻辑。
5. 避免表格拥有与主 editor 平行的焦点注册体系。

如果后续发现当前实现的复杂度主要来自“独立 input + 独立 suggestion + 独立 focus registry”，则应把表格从 mini editor 收回到更轻的 Live Preview 结构交互模型。

### 6.3 Frontmatter

需要明确一点：Obsidian 本身也有 frontmatter 编辑器，更准确地说，是一个基于 properties 的 frontmatter 编辑界面。

根据 Obsidian 公共文档，properties 仍然存储在文件顶部的 YAML frontmatter 中，但它提供了多种显示模式：

1. Visible：在笔记顶部显示 properties 编辑界面。
2. Hidden：正文中隐藏，通过侧边属性视图查看。
3. Source：直接显示 YAML 源码。

因此，这里的建议不是“不要做 frontmatter 编辑器”，而是“不要继续把它做成一个脱离正文文本模型、长期与正文并列持有复杂焦点和快捷键语义的大型 YAML 表单 widget”。

更合适的方向是：

1. 在 Live Preview 中显示更接近 Obsidian properties 的精简属性编辑界面。
2. 让该界面优先覆盖常见原子类型，例如 text、list、number、checkbox、date、tags。
3. 对复杂、嵌套或非标准 YAML，显式回退到 Source mode 编辑，而不是强行在可视化表单里兜底。
4. 提供清晰的显示模式切换，例如 Visible / Hidden / Source，而不是只有一种正文内 widget 形态。
5. 不再默认把 frontmatter widget 当作与正文同等级的长期可聚焦区域。

这更接近 Obsidian 的 properties 思路，也能显著降低 Vim、快捷键和焦点管理的冲突。

### 6.4 Code fence / LaTeX / Image embed

这三类内容继续保留块级特例是合理的，但需要坚持“显示优先、深编辑回源码”的原则。

建议：

1. code fence 主要做只读预览、折叠、语言提示，不做复杂嵌入式代码 IDE。
2. LaTeX 主要做公式显示和轻量切换，不做独立公式编辑器。
3. image embed 主要做展示与点击交互，不做正文内复杂管理面板。

## 7. Vim 优化边界

若目标是 Obsidian 式编辑体验，Vim 的职责边界应明确收缩。

推荐边界：

1. Vim 完整负责主文本编辑区。
2. 行内增强语法应对 Vim 透明。
3. 表格等特例结构只提供有限 handoff，而不追求“组件内部仍然完整 Vim 化”。
4. 任何真实 DOM input/textarea/select 一旦获得焦点，都应被视为临时脱离 Vim 主循环的区域。

这不是能力退化，而是避免把 CodeMirror Live Preview 推向不再像 Obsidian 的方向。

## 8. 架构调整建议

### 8.1 明确 editor 内增强分层

建议把 editor 内增强统一分成三层：

1. 行内 decoration 层
2. 块级 preview 层
3. 外部深编辑层

其中：

1. 行内 decoration 层继续由 `syntaxRenderRegistry.ts` 统一承载。
2. 块级 preview 层继续由独立 ViewPlugin 承载，但必须遵守排斥区和注册顺序规则。
3. 外部深编辑层不再进入正文区，而由 panel、dialog、tab 或 split editor 承担。

### 8.2 给块级能力增加准入规则

新增块级增强前，先做准入判断：

1. 它是否保持 Markdown 源码作为唯一事实源。
2. 它是否可以在光标进入后自然回退到源码编辑。
3. 它是否需要长期独立焦点。
4. 它是否会引入独立快捷键、独立提交时机或独立 suggestion 系统。

如果第 3 或第 4 条答案为“是”，默认不应放进 Live Preview 正文区。

### 8.3 让读写态契约回到稳定边界

当前读写态已通过契约保护：

- [src/plugins/markdown-codemirror/editor/renderParityContract.ts](../src/plugins/markdown-codemirror/editor/renderParityContract.ts)

后续建议：

1. 不再轻易把复杂 widget 能力纳入编辑态支持集合。
2. 只有确认 Reading view 可以稳定对齐时，再扩展增强特性。
3. 避免形成“编辑态越来越强，阅读态被迫追赶”的持续欠账。

## 9. 分阶段实施方案

### 阶段一：稳定当前正确方向

目标：保留正确的行内增强路线，停止继续扩大 editor 正文区的职责。

动作：

1. 冻结新增重交互 widget 类型。
2. 明确表格、frontmatter、image、latex 各自属于哪一类增强。
3. 为常规行内语法补齐边界测试和交互一致性测试。
4. 评估现有 markdown table 和 frontmatter 的复杂度来源。

### 阶段二：收缩当前越界实现

目标：把最重的 widget 从“独立子应用”收回到“受约束增强”。

动作：

1. 表格优先收缩焦点与快捷键体系。
2. frontmatter 评估改为摘要态 + 外部深编辑入口。
3. 清理 editor 内独立 focus registry 的扩张趋势。
4. 明确哪些操作必须回到源码态完成。

### 阶段三：建立长期演化规则

目标：避免 editor 再次回到无约束增长。

动作：

1. 把块级能力准入规则写入开发文档与评审 checklist。
2. 新增编辑增强时，先判断属于 A/B/C 哪一类。
3. 任何新能力都先回答“这是 Live Preview 特例，还是应属于外部深编辑层”。

## 10. 推荐优先级

当前推荐的优化优先级如下：

1. 保持并补强常规行内语法的轻装饰路线。
2. 收缩 frontmatter 的重表单化方向。
3. 把 markdown table 从 mini editor 收回到受约束特例。
4. 明确 Vim 只对主文本区负责。
5. 把新增块级增强纳入准入规则，不再无边界扩张。

不推荐作为当前优先动作的事项：

1. 立即更换编辑器底座。
2. fork CodeMirror 内核。
3. 为更多语法结构继续引入长期独立焦点 widget。
4. 追求“所有 editor 内组件都能完整 Vim 化”。

## 11. 最终建议

ofive 的 editor 后续优化，不应继续沿着“把更多复杂组件塞进正文区”的方向演化。

正确方向是：

1. 继续使用 CodeMirror。
2. 以 Obsidian 式 Source / Live Preview / Reading 三层模型为目标。
3. 让常规 Markdown 语法继续走轻装饰路线。
4. 让表格成为受约束特例，而不是普遍模板。
5. 把真正重交互的能力迁回 editor 外部深编辑层。

这样可以同时保住三个关键目标：

1. Markdown 源码可预测。
2. Live Preview 足够好用。
3. editor 架构复杂度回到可长期维护的区间。