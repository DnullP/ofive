/**
 * @module plugins/markdown-codemirror/editor/editPlugins/wikilinkSuggestEditPlugin
 * @description WikiLink 自动补全编辑插件。
 *
 *   功能：当用户键入 `[[` 或 `【【` 时触发自动补全，
 *   基于已输入的文本查询后端获取候选笔记列表，
 *   用户可通过方向键选择、回车确认补全。
 *
 *   触发规则：
 *   - 检测到光标左侧存在 `[[` 且尚未闭合 `]]`
 *   - 在编辑器输入变更时实时更新候选列表
 *   - 中文全角方括号 `【【` 会被自动替换为 `[[`
 *
 *   候选排序：
 *   - 关键字匹配度（主维度）
 *   - 笔记被引用次数/热度（次维度）
 *
 *   实现要点：
 *   - 弹窗使用 ViewPlugin 手动管理的浮动 DOM 元素 + `coordsAtPos` 定位，
 *     而非 Decoration.widget（后者会在行内插入节点，干扰文档布局）。
 *   - 键盘拦截使用 `Prec.highest(keymap(...))` 以确保优先级高于
 *     vim 模式和默认编辑器快捷键。
 *
 * @dependencies
 *   - ./wikilinkSuggestUtils（detectOpenWikiLink）
 *   - ../editPluginRegistry（EditPluginRegistration）
 *   - ../../../api/vaultApi（suggestWikiLinkTargets）
 *   - @codemirror/state
 *   - @codemirror/view
 *
 * @exports
 *   - registerWikiLinkSuggestEditPlugin  注册本插件到 editPluginRegistry
 */

import {
    type Extension,
    Prec,
    StateEffect,
    StateField,
    type Transaction,
} from "@codemirror/state";
import {
    EditorView,
    ViewPlugin,
    type ViewUpdate,
    keymap,
} from "@codemirror/view";
import { registerEditPlugin } from "../editPluginRegistry";
import i18n from "../../../../i18n";
import {
    suggestWikiLinkTargets,
    type WikiLinkSuggestionItem,
} from "../../../../api/vaultApi";
import {
    detectOpenWikiLink,
    resolveWikiLinkSuggestionAcceptanceAtCursor,
} from "./wikilinkSuggestUtils";

/* ================================================================== */
/*  常量                                                               */
/* ================================================================== */

/** 插件唯一标识 */
const PLUGIN_ID = "wikilink-suggest";

/** 补全列表最大展示条数 */
const MAX_SUGGESTIONS = 15;

/** 查询防抖延时（ms） */
const DEBOUNCE_MS = 150;

/* ================================================================== */
/*  StateEffect / StateField：补全状态                                 */
/* ================================================================== */

/**
 * @interface SuggestState
 * @description 补全浮层状态。
 *   - active 是否激活
 *   - query 当前查询关键字
 *   - items 候选列表
 *   - selectedIndex 当前选中索引
 *   - anchorPos 文档中 `[[` 后的偏移位置，用于定位浮层和替换范围计算
 */
interface SuggestState {
    /** 补全面板是否激活 */
    active: boolean;
    /** 当前查询关键字 */
    query: string;
    /** 候选列表 */
    items: WikiLinkSuggestionItem[];
    /** 当前选中项索引 */
    selectedIndex: number;
    /** `[[` 之后的文档偏移位置（即查询文本起始位置） */
    anchorPos: number;
    /** 当前补全替换区间的结束偏移（不含） */
    replaceTo: number;
    /** 替换后是否保留已有的 `]]` */
    preserveClosingBrackets: boolean;
    /** `]]` 是否紧贴在替换区间后面 */
    closingBracketsImmediatelyAfterReplaceTo: boolean;
}

/** 空状态 */
const INACTIVE_STATE: SuggestState = {
    active: false,
    query: "",
    items: [],
    selectedIndex: 0,
    anchorPos: 0,
    replaceTo: 0,
    preserveClosingBrackets: false,
    closingBracketsImmediatelyAfterReplaceTo: false,
};

/** 更新补全状态的 StateEffect */
const setSuggestState = StateEffect.define<SuggestState>();

/** 补全状态 StateField */
const suggestStateField = StateField.define<SuggestState>({
    create() {
        return INACTIVE_STATE;
    },
    update(value, transaction: Transaction) {
        for (const effect of transaction.effects) {
            if (effect.is(setSuggestState)) {
                return effect.value;
            }
        }
        return value;
    },
});

/* ================================================================== */
/*  弹窗 DOM 构建（纯函数，供 ViewPlugin 调用）                        */
/* ================================================================== */

/**
 * 构建弹窗内部 DOM 内容。
 * @param popup 弹窗根节点，函数会清空并重新填充。
 * @param items 候选列表。
 * @param query 当前查询关键字。
 * @param selectedIndex 当前选中索引。
 */
function renderPopupContent(
    popup: HTMLElement,
    items: WikiLinkSuggestionItem[],
    query: string,
    selectedIndex: number,
): void {
    popup.innerHTML = "";

    if (items.length === 0) {
        /* 空状态提示 — 样式 .cm-wikilink-suggest-empty */
        const emptyHint = document.createElement("div");
        emptyHint.className = "cm-wikilink-suggest-empty";
        emptyHint.textContent = i18n.t("editorPlugins.noMatchingNote");
        popup.appendChild(emptyHint);
        return;
    }

    for (let i = 0; i < items.length; i++) {
        const item = items[i]!;
        /* 候选项行 — 样式 .cm-wikilink-suggest-item / -selected */
        const row = document.createElement("div");
        row.className =
            i === selectedIndex
                ? "cm-wikilink-suggest-item cm-wikilink-suggest-item-selected"
                : "cm-wikilink-suggest-item";
        row.dataset.index = String(i);

        /* 标题文本 — 样式 .cm-wikilink-suggest-title */
        const titleSpan = document.createElement("span");
        titleSpan.className = "cm-wikilink-suggest-title";
        titleSpan.appendChild(buildSuggestHighlightedFragment(item.title, query));
        row.appendChild(titleSpan);

        /* 路径文本 — 样式 .cm-wikilink-suggest-path */
        const pathSpan = document.createElement("span");
        pathSpan.className = "cm-wikilink-suggest-path";
        pathSpan.appendChild(buildSuggestHighlightedFragment(item.relativePath, query));
        row.appendChild(pathSpan);

        /* 引用次数 — 样式 .cm-wikilink-suggest-ref-count（仅 >0 时显示） */
        if (item.referenceCount > 0) {
            const refSpan = document.createElement("span");
            refSpan.className = "cm-wikilink-suggest-ref-count";
            refSpan.textContent = String(item.referenceCount);
            row.appendChild(refSpan);
        }

        popup.appendChild(row);
    }
}

/**
 * 将候选文本拆成普通片段与高亮片段。
 * @param text 原始文本。
 * @param query 当前查询关键字。
 * @returns 可直接插入 DOM 的片段。
 */
function buildSuggestHighlightedFragment(text: string, query: string): DocumentFragment {
    const fragment = document.createDocumentFragment();
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
        fragment.append(text);
        return fragment;
    }

    const terms = Array.from(new Set(
        normalizedQuery
            .split(/\s+/)
            .map((term) => term.trim())
            .filter((term) => term.length > 0),
    )).sort((left, right) => right.length - left.length);

    if (terms.length === 0) {
        fragment.append(text);
        return fragment;
    }

    const expression = new RegExp(`(${terms.map(escapeSuggestHighlightTerm).join("|")})`, "giu");
    let lastIndex = 0;

    for (const match of text.matchAll(expression)) {
        const matchText = match[0] ?? "";
        const matchIndex = match.index ?? -1;
        if (!matchText || matchIndex < 0) {
            continue;
        }

        if (matchIndex > lastIndex) {
            fragment.append(text.slice(lastIndex, matchIndex));
        }

        const mark = document.createElement("mark");
        mark.className = "cm-wikilink-suggest-match";
        mark.textContent = matchText;
        fragment.appendChild(mark);

        lastIndex = matchIndex + matchText.length;
    }

    if (lastIndex < text.length) {
        fragment.append(text.slice(lastIndex));
    }

    if (!fragment.hasChildNodes()) {
        fragment.append(text);
    }

    return fragment;
}

/**
 * 转义正则特殊字符，避免查询文本破坏匹配表达式。
 * @param term 待转义关键字。
 * @returns 可安全拼入正则的关键字。
 */
function escapeSuggestHighlightTerm(term: string): string {
    return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* ================================================================== */
/*  全角方括号自动替换                                                 */
/* ================================================================== */

/**
 * @function makeFullWidthBracketReplacer
 * @description 创建一个 CodeMirror inputHandler 扩展，
 *   将 `【【` 自动替换为 `[[`。
 * @returns CodeMirror Extension
 */
function makeFullWidthBracketReplacer(): Extension {
    return EditorView.inputHandler.of(
        (view, from, to, insertedText) => {
            // 检查是否输入了 `【`
            if (insertedText !== "【") {
                return false;
            }

            // 检查前一个字符是否也是 `【`
            if (from <= 0) {
                return false;
            }

            const prevChar = view.state.doc.sliceString(from - 1, from);
            if (prevChar !== "【") {
                return false;
            }

            // 将 `【【` 替换为 `[[`
            view.dispatch({
                changes: { from: from - 1, to, insert: "[[" },
                selection: { anchor: from + 1 },
            });

            console.debug("[wikilink-suggest] replaced 【【 with [[");
            return true;
        },
    );
}

/* ================================================================== */
/*  ViewPlugin：核心交互逻辑                                          */
/* ================================================================== */

/**
 * @function createWikiLinkSuggestExtensions
 * @description 创建 WikiLink 补全插件的全部 CodeMirror 扩展。
 *   弹窗通过 ViewPlugin 管理的浮动 DOM 元素实现，使用 coordsAtPos 定位。
 *   按键使用 Prec.highest(keymap) 确保优先级高于 vim 等其他扩展。
 * @returns Extension 数组
 */
function createWikiLinkSuggestExtensions(): Extension[] {
    /** 异步查询计数器，用于丢弃过时的请求结果 */
    let querySeq = 0;
    /** 防抖定时器 */
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    /**
     * 插件是否已销毁。
     * EditorView 销毁后置为 true，用于守卫延迟回调（queueMicrotask / setTimeout / Promise），
     * 防止在已销毁的视图上调用 dispatch / coordsAtPos 导致 TypeError。
     */
    let pluginDestroyed = false;

    /**
     * 发起异步查询（带防抖）。
     * @param view 编辑器视图
     * @param query 查询关键字
     * @param anchorPos 锚点位置
     */
    function scheduleQuery(
        view: EditorView,
        query: string,
        anchorPos: number,
    ): void {
        if (debounceTimer !== null) {
            clearTimeout(debounceTimer);
        }

        const seq = ++querySeq;

        debounceTimer = setTimeout(() => {
            debounceTimer = null;

            if (pluginDestroyed) {
                return;
            }

            void suggestWikiLinkTargets(query, MAX_SUGGESTIONS)
                .then((items) => {
                    // 视图已销毁或请求过时，丢弃结果
                    if (pluginDestroyed || seq !== querySeq) {
                        return;
                    }

                    const currentState = view.state.field(suggestStateField);
                    // 如果补全已关闭则不再更新
                    if (!currentState.active) {
                        return;
                    }

                    view.dispatch({
                        effects: setSuggestState.of({
                            ...currentState,
                            active: true,
                            query,
                            items,
                            selectedIndex: 0,
                            anchorPos,
                        }),
                    });
                })
                .catch((error) => {
                    console.warn("[wikilink-suggest] query failed", {
                        query,
                        message: error instanceof Error ? error.message : String(error),
                    });
                });
        }, DEBOUNCE_MS);
    }

    /**
     * ViewPlugin：监听文档/选区变化，驱动补全生命周期，
     * 并管理弹窗 DOM 元素（创建、定位、销毁）。
     *
     * 重要：update() 回调中不能直接 dispatch 或读取 layout（coordsAtPos）。
     *   - dispatch → queueMicrotask 延迟
     *   - coordsAtPos → requestMeasure 延迟
     */
    const suggestViewPlugin = ViewPlugin.fromClass(
        class {
            /** 弹窗 DOM 元素，挂载在 view.dom 上 */
            popup: HTMLElement;
            /** 上一次渲染时的状态快照，用于避免无谓 DOM 刷新 */
            private lastRenderedState: SuggestState = INACTIVE_STATE;

            constructor(readonly view: EditorView) {
                // 创建弹窗 DOM，挂载到编辑器根容器下
                this.popup = document.createElement("div");
                this.popup.className = "cm-wikilink-suggest-popup";
                this.popup.dataset.floatingSurface = "true";
                this.popup.style.display = "none";
                // 点击弹窗项时处理选中逻辑
                this.popup.addEventListener("mousedown", (event) => {
                    this.handleMouseDown(event);
                });
                view.dom.appendChild(this.popup);
            }

            /**
             * CM6 ViewPlugin.update 回调。
             * 仅做状态检测（deferred dispatch）和调度弹窗同步（requestMeasure）。
             * **不能** 在此直接 dispatch 或读取 layout。
             */
            update(update: ViewUpdate): void {
                // —— 第一步：检测 wikilink 意图并更新 State ——
                if (update.docChanged || update.selectionSet) {
                    const { state } = update.view;
                    const cursor = state.selection.main.head;
                    const docText = state.doc.toString();
                    const detected = detectOpenWikiLink(docText, cursor);

                    if (!detected) {
                        const current = state.field(suggestStateField);
                        if (current.active) {
                            queueMicrotask(() => {
                                if (pluginDestroyed) return;
                                this.view.dispatch({
                                    effects: setSuggestState.of(INACTIVE_STATE),
                                });
                            });
                        }
                    } else {
                        const currentState = state.field(suggestStateField);
                        if (
                            !(
                                currentState.active &&
                                currentState.query === detected.query &&
                                currentState.anchorPos === detected.anchorPos &&
                                currentState.replaceTo === detected.replaceTo &&
                                currentState.preserveClosingBrackets === detected.preserveClosingBrackets &&
                                currentState.closingBracketsImmediatelyAfterReplaceTo === detected.closingBracketsImmediatelyAfterReplaceTo
                            )
                        ) {
                            const pendingItems = currentState.active
                                ? currentState.items
                                : [];
                            queueMicrotask(() => {
                                if (pluginDestroyed) return;
                                this.view.dispatch({
                                    effects: setSuggestState.of({
                                        active: true,
                                        query: detected.query,
                                        items: pendingItems,
                                        selectedIndex: 0,
                                        anchorPos: detected.anchorPos,
                                        replaceTo: detected.replaceTo,
                                        preserveClosingBrackets: detected.preserveClosingBrackets,
                                        closingBracketsImmediatelyAfterReplaceTo: detected.closingBracketsImmediatelyAfterReplaceTo,
                                    }),
                                });
                            });
                            scheduleQuery(
                                this.view,
                                detected.query,
                                detected.anchorPos,
                            );
                        }
                    }
                }

                // —— 第二步：调度弹窗 DOM 同步（延迟到 update 完成后） ——
                this.scheduleSyncPopup();
            }

            /**
             * 通过 requestMeasure 将弹窗位置计算（coordsAtPos）和
             * DOM 更新推迟到 update 事务结束后执行，避免
             * "Reading the editor layout isn't allowed during an update" 错误。
             */
            private scheduleSyncPopup(): void {
                if (pluginDestroyed) return;
                /* 捕获 this 到局部变量，供 read/write 回调使用 */
                const self = this;
                this.view.requestMeasure({
                    key: "wikilink-suggest-popup",
                    read(view) {
                        if (pluginDestroyed) {
                            return { state: INACTIVE_STATE, coords: null };
                        }
                        const state = view.state.field(suggestStateField);
                        if (!state.active) {
                            return { state, coords: null };
                        }
                        const coords = view.coordsAtPos(state.anchorPos);
                        return { state, coords };
                    },
                    write({ state, coords }, view) {
                        self.syncPopup(state, coords, view);
                    },
                });
            }

            /**
             * 同步弹窗 DOM 的可见性、内容和位置。
             * 在 requestMeasure 的 write 阶段调用，此时允许修改 DOM。
             * @param state 当前补全状态
             * @param coords coordsAtPos 返回的坐标，null 表示不可见
             * @param view 编辑器视图
             */
            private syncPopup(
                state: SuggestState,
                coords: { left: number; right: number; top: number; bottom: number } | null,
                view: EditorView,
            ): void {
                if (!state.active) {
                    if (this.lastRenderedState.active) {
                        this.popup.style.display = "none";
                    }
                    this.lastRenderedState = state;
                    return;
                }

                // 判断是否需要重新渲染内容
                const needRender =
                    !this.lastRenderedState.active ||
                    state.selectedIndex !== this.lastRenderedState.selectedIndex ||
                    state.items !== this.lastRenderedState.items;

                if (needRender) {
                    renderPopupContent(
                        this.popup,
                        state.items,
                        state.query,
                        state.selectedIndex,
                    );
                }

                // 定位弹窗
                if (!coords) {
                    this.popup.style.display = "none";
                } else {
                        const editorRect = view.dom.getBoundingClientRect();
                        let left = coords.left - editorRect.left;
                        // default prefer below the anchor
                        const spacing = 4; // px
                        let top = coords.bottom - editorRect.top + spacing;

                        // measure popup size (offsetHeight/Width are available because popup is attached)
                        const popupHeight = this.popup.offsetHeight || 0;
                        const popupWidth = this.popup.offsetWidth || 0;

                        // If the popup would overflow the bottom of the editor, flip it above the anchor
                        if (top + popupHeight > editorRect.height) {
                            top = coords.top - editorRect.top - popupHeight - spacing;
                        }

                        // Clamp top to editor bounds
                        if (top < 0) top = 0;

                        // Adjust horizontal position to avoid right overflow
                        if (left + popupWidth > editorRect.width) {
                            left = Math.max(0, editorRect.width - popupWidth - 8);
                        }

                        this.popup.style.display = "";
                        this.popup.style.left = `${left}px`;
                        this.popup.style.top = `${top}px`;
                }

                this.lastRenderedState = state;
            }

            /** 鼠标点击弹窗候选项 */
            private handleMouseDown(event: MouseEvent): void {
                const target = event.target;
                if (!(target instanceof HTMLElement)) {
                    return;
                }
                const itemEl = target.closest(
                    ".cm-wikilink-suggest-item",
                ) as HTMLElement | null;
                if (!itemEl) {
                    return;
                }
                const indexStr = itemEl.dataset.index;
                if (indexStr === undefined) {
                    return;
                }
                const index = Number.parseInt(indexStr, 10);
                const state = this.view.state.field(suggestStateField);
                if (
                    !state.active ||
                    index < 0 ||
                    index >= state.items.length
                ) {
                    return;
                }
                event.preventDefault();
                event.stopPropagation();
                const selected = state.items[index];
                if (selected) {
                    acceptSuggestion(this.view, state, selected);
                }
            }

            destroy(): void {
                pluginDestroyed = true;
                if (debounceTimer !== null) {
                    clearTimeout(debounceTimer);
                    debounceTimer = null;
                }
                this.popup.remove();
            }
        },
    );

    /**
     * 最高优先级键盘拦截：确保 ArrowUp/Down、Enter、Tab、Escape
     * 在补全激活时优先于 vim 和其他编辑器快捷键。
     */
    const highPriorityKeymap = Prec.highest(
        keymap.of([
            {
                key: "ArrowDown",
                run(view) {
                    const state = view.state.field(suggestStateField);
                    if (!state.active || state.items.length === 0) {
                        return false;
                    }
                    const next =
                        (state.selectedIndex + 1) % state.items.length;
                    view.dispatch({
                        effects: setSuggestState.of({
                            ...state,
                            selectedIndex: next,
                        }),
                    });
                    return true;
                },
            },
            {
                key: "ArrowUp",
                run(view) {
                    const state = view.state.field(suggestStateField);
                    if (!state.active || state.items.length === 0) {
                        return false;
                    }
                    const prev =
                        (state.selectedIndex - 1 + state.items.length) %
                        state.items.length;
                    view.dispatch({
                        effects: setSuggestState.of({
                            ...state,
                            selectedIndex: prev,
                        }),
                    });
                    return true;
                },
            },
            {
                key: "Enter",
                run(view) {
                    const state = view.state.field(suggestStateField);
                    if (!state.active || state.items.length === 0) {
                        return false;
                    }
                    const selected = state.items[state.selectedIndex];
                    if (selected) {
                        acceptSuggestion(view, state, selected);
                    }
                    return true;
                },
            },
            {
                key: "Tab",
                run(view) {
                    const state = view.state.field(suggestStateField);
                    if (!state.active || state.items.length === 0) {
                        return false;
                    }
                    const selected = state.items[state.selectedIndex];
                    if (selected) {
                        acceptSuggestion(view, state, selected);
                    }
                    return true;
                },
            },
            {
                key: "Escape",
                run(view) {
                    const state = view.state.field(suggestStateField);
                    if (!state.active) {
                        return false;
                    }
                    view.dispatch({
                        effects: setSuggestState.of(INACTIVE_STATE),
                    });
                    return true;
                },
            },
        ]),
    );

    return [
        suggestStateField,
        suggestViewPlugin,
        highPriorityKeymap,
        makeFullWidthBracketReplacer(),
    ];
}

/* ================================================================== */
/*  接受补全选中项                                                     */
/* ================================================================== */

/**
 * @function acceptSuggestion
 * @description 接受选中的补全建议：替换 `[[query` 为 `[[title]]`。
 * @param view 编辑器视图。
 * @param suggestState 当前补全状态。
 * @param item 被选中的建议项。
 */
function acceptSuggestion(
    view: EditorView,
    suggestState: SuggestState,
    item: WikiLinkSuggestionItem,
): void {
    const cursor = view.state.selection.main.head;
    const acceptance = resolveWikiLinkSuggestionAcceptanceAtCursor(
        view.state.doc.toString(),
        cursor,
        item.title,
        suggestState,
    );

    view.dispatch({
        changes: {
            from: acceptance.from,
            to: acceptance.to,
            insert: acceptance.insert,
        },
        selection: {
            anchor: acceptance.selectionAnchor,
        },
        effects: setSuggestState.of(INACTIVE_STATE),
    });

    console.info("[wikilink-suggest] accepted suggestion", {
        title: item.title,
        relativePath: item.relativePath,
    });
}

/* ================================================================== */
/*  插件注册                                                           */
/* ================================================================== */

/**
 * @function registerWikiLinkSuggestEditPlugin
 * @description 注册 WikiLink 自动补全编辑插件到 editPluginRegistry。
 * @returns 取消注册的清理函数。
 */
export function registerWikiLinkSuggestEditPlugin(): () => void {
    return registerEditPlugin({
        id: PLUGIN_ID,
        createExtensions: () => createWikiLinkSuggestExtensions(),
    });
}
