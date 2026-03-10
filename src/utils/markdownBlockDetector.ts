/**
 * @module utils/markdownBlockDetector
 * @description 纯文本级 Markdown 块级结构检测器：从原始 Markdown 文本中识别
 *   frontmatter、围栏代码块、LaTeX 块等结构，并提供行级排斥查询。
 *
 *   与编辑器绑定的 `syntaxExclusionZones.ts`（基于 EditorView + 文档偏移）不同，
 *   本模块是纯函数实现，不依赖任何编辑器 API，适用于所有需要解析 Markdown
 *   内容的前端组件（OutlinePanel、QuickSwitcher、知识图谱等）。
 *
 *   检测的块级结构（按优先级）：
 *   1. frontmatter — 文档开头的 `---` YAML 块
 *   2. code-fence  — ``` 或 ~~~ 围栏代码块
 *   3. latex-block — `$$` 行级 LaTeX 公式块
 *
 *   用法：
 *   ```ts
 *   import { detectExcludedLineRanges, isLineExcluded } from "../utils/markdownBlockDetector";
 *
 *   const ranges = detectExcludedLineRanges(markdownText);
 *   // 解析标题时跳过排斥行
 *   if (!isLineExcluded(lineNumber, ranges)) { ... }
 *   ```
 *
 * @dependencies 无外部依赖
 *
 * @exports
 *   - ExcludedLineRange — 排斥行范围
 *   - BlockType — 块类型标识
 *   - detectExcludedLineRanges — 检测所有排斥行范围
 *   - isLineExcluded — 查询某行是否在排斥范围内
 */

/* ================================================================== */
/*  类型定义                                                           */
/* ================================================================== */

/**
 * @type BlockType
 * @description 块级结构类型标识。与 syntaxExclusionZones 的 ExclusionZoneOwner 对齐。
 */
export type BlockType = "frontmatter" | "code-fence" | "latex-block";

/**
 * @interface ExcludedLineRange
 * @description 一段被块级结构占据的行范围。
 *   - fromLine  起始行号（1-based，含）
 *   - toLine    结束行号（1-based，含）
 *   - type      块类型标识
 */
export interface ExcludedLineRange {
    /** 起始行号（1-based，含）。 */
    fromLine: number;
    /** 结束行号（1-based，含）。 */
    toLine: number;
    /** 块类型标识。 */
    type: BlockType;
}

/* ================================================================== */
/*  正则                                                               */
/* ================================================================== */

/** 匹配围栏开始行 ```lang 或 ~~~lang */
const FENCE_OPEN_RE = /^(`{3,}|~{3,})\s*(\S*)\s*$/;

/** 匹配 frontmatter 分隔符 --- */
const FRONTMATTER_DELIMITER_RE = /^---\s*$/;

/** 匹配 LaTeX 块分隔符 $$ */
const LATEX_BLOCK_DELIMITER_RE = /^\$\$\s*$/;

/* ================================================================== */
/*  公共 API                                                           */
/* ================================================================== */

/**
 * @function detectExcludedLineRanges
 * @description 从原始 Markdown 文本中检测所有被块级结构占据的行范围。
 *   按文档顺序单次遍历，优先级内含：frontmatter 只在文档开头检测，
 *   code-fence 开启后内部的 $$ 不会被识别为 LaTeX 块。
 * @param text 原始 Markdown 文本。
 * @returns 排斥行范围数组（按文档顺序）。
 */
export function detectExcludedLineRanges(text: string): ExcludedLineRange[] {
    const lines = text.split("\n");
    const ranges: ExcludedLineRange[] = [];
    let i = 0;

    /* ---- frontmatter（仅文档开头） ---- */
    if (lines.length > 0 && FRONTMATTER_DELIMITER_RE.test(lines[0])) {
        for (let j = 1; j < lines.length; j++) {
            if (FRONTMATTER_DELIMITER_RE.test(lines[j])) {
                ranges.push({ fromLine: 1, toLine: j + 1, type: "frontmatter" });
                i = j + 1;
                break;
            }
        }
    }

    /* ---- 扫描 code-fence 和 latex-block ---- */
    while (i < lines.length) {
        const line = lines[i];
        const lineNumber = i + 1; /* 1-based */

        /* 尝试匹配围栏代码块开始 */
        const fenceMatch = line.match(FENCE_OPEN_RE);
        if (fenceMatch) {
            const fenceChar = (fenceMatch[1] ?? "```").charAt(0);
            const fenceLen = (fenceMatch[1] ?? "```").length;
            const closeRe = new RegExp(
                `^${fenceChar === "\`" ? "`" : "~"}{${String(fenceLen)},}\\s*$`,
            );

            let closed = false;
            for (let j = i + 1; j < lines.length; j++) {
                if (closeRe.test(lines[j])) {
                    ranges.push({
                        fromLine: lineNumber,
                        toLine: j + 1,
                        type: "code-fence",
                    });
                    i = j + 1;
                    closed = true;
                    break;
                }
            }
            if (!closed) {
                /* 未闭合围栏 — 不视为代码块 */
                i += 1;
            }
            continue;
        }

        /* 尝试匹配 LaTeX 块开始 */
        if (LATEX_BLOCK_DELIMITER_RE.test(line)) {
            let closed = false;
            for (let j = i + 1; j < lines.length; j++) {
                if (LATEX_BLOCK_DELIMITER_RE.test(lines[j])) {
                    ranges.push({
                        fromLine: lineNumber,
                        toLine: j + 1,
                        type: "latex-block",
                    });
                    i = j + 1;
                    closed = true;
                    break;
                }
            }
            if (!closed) {
                i += 1;
            }
            continue;
        }

        i += 1;
    }

    return ranges;
}

/**
 * @function isLineExcluded
 * @description 查询某行是否处于排斥范围内。
 * @param lineNumber 行号（1-based）。
 * @param ranges 由 detectExcludedLineRanges 返回的排斥范围列表。
 * @returns 若该行在排斥范围内则返回 true。
 */
export function isLineExcluded(
    lineNumber: number,
    ranges: ExcludedLineRange[],
): boolean {
    for (const range of ranges) {
        if (lineNumber >= range.fromLine && lineNumber <= range.toLine) {
            return true;
        }
    }
    return false;
}
