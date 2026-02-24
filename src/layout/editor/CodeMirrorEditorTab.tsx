/**
 * @module layout/editor/CodeMirrorEditorTab
 * @description 基于 CodeMirror 6 的编辑器 Tab 组件，用于在 Dockview 中承载可编辑文本内容。
 * @dependencies
 *  - react
 *  - dockview
 *  - codemirror
 *  - @codemirror/lang-markdown
 *  - ./codemirrorTheme
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { IDockviewPanelProps } from "dockview";
import { EditorView } from "codemirror";
import { Compartment, EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { basicSetup } from "codemirror";
import { indentLess, indentMore, redo, selectAll, toggleComment, undo } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import { vim } from "@replit/codemirror-vim";
import "./CodeMirrorEditorTab.css";
import {
    reportArticleContent,
    reportArticleFocus,
    useArticleById,
} from "../../store/editorContextStore";
import {
    executeCommand,
    getCommandCondition,
    type CommandId,
    type EditorNativeCommandId,
} from "../../commands/commandSystem";
import { isConditionSatisfied } from "../../commands/focusContext";
import {
    notifyCommandPaletteOpenRequested,
    notifyQuickSwitcherOpenRequested,
    notifyTabCloseShortcutTriggered,
} from "../../commands/shortcutEvents";
import { matchShortcut, useShortcutState } from "../../store/shortcutStore";
import { resolveSystemShortcutCommand } from "../../commands/systemShortcutSubsystem";
import { useVaultState } from "../../store/vaultStore";
import {
    createVaultBinaryFile,
    renameVaultMarkdownFile,
    segmentChineseText,
    type ChineseSegmentToken,
} from "../../api/vaultApi";
import { useConfigState } from "../../store/configStore";
import { createRegisteredLineSyntaxRenderExtension } from "./syntaxRenderRegistry";
import { ensureBuiltinSyntaxRenderersRegistered } from "./registerBuiltinSyntaxRenderers";
import { createWikiLinkNavigationExtension } from "./syntaxPlugins/wikiLinkSyntaxRenderer";
import { createImageEmbedSyntaxExtension } from "./syntaxPlugins/imageEmbedSyntaxExtension";
import { createFrontmatterSyntaxExtension } from "./syntaxPlugins/frontmatterSyntaxExtension.ts";
import { resolveParentDirectory } from "./pathUtils";
import { createCodeMirrorThemeExtension } from "./codemirrorTheme";
import { collectManagedEditorShortcutCandidates } from "./editorShortcutPolicy";
import { attachPasteImageHandler } from "./editorPasteImageHandler";
import {
    containsChineseCharacter,
    resolveChinesePreviousWordBoundary,
    resolveEnglishPreviousWordBoundary,
} from "./editorWordBoundaries";
import {
    registerVimTokenProvider,
    unregisterVimTokenProvider,
    setupVimEnhancedMotions,
} from "./vimChineseMotionExtension";

ensureBuiltinSyntaxRenderersRegistered();

// 初始化 Vim 增强运动（全局仅一次）
setupVimEnhancedMotions();

const registeredLineSyntaxRenderExtension = createRegisteredLineSyntaxRenderExtension();

/**
 * @interface SegmentationCacheItem
 * @description 行分词缓存条目。
 */
interface SegmentationCacheItem {
    text: string;
    tokens: ChineseSegmentToken[];
}

/**
 * @function buildDefaultContent
 * @description 根据文件路径构建默认内容。
 * @param filePath 文件路径。
 * @returns 编辑器默认文本。
 */
function buildDefaultContent(filePath: string): string {
    return `# ${filePath.split("/").pop() ?? filePath}\n\n> 这是基于 CodeMirror 6 的编辑器示例内容。\n\n- 支持基础编辑\n- 支持 Markdown 语法高亮\n- 支持后续扩展语言和 LSP`;
}

/**
 * @function CodeMirrorEditorTab
 * @description Dockview Tab 渲染函数，挂载并管理 CodeMirror 实例生命周期。
 * @param props Dockview 面板参数，支持 params.path 与 params.content。
 * @returns 编辑器 Tab 视图。
 */
export function CodeMirrorEditorTab(props: IDockviewPanelProps<Record<string, unknown>>): ReactNode {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);
    const bindingsRef = useRef<Record<CommandId, string>>({
        "tab.closeFocused": "Ctrl+W",
        "app.quit": "Cmd+Q",
        "sidebar.left.toggle": "Cmd+Shift+J",
        "sidebar.right.toggle": "Cmd+Shift+K",
        "file.saveFocused": "Cmd+S",
        "file.moveFocusedToDirectory": "",
        "folder.createInFocusedDirectory": "",
        "file.renameFocused": "",
        "note.createNew": "",
        "editor.undo": "Cmd+Z",
        "editor.redo": "Cmd+Shift+Z",
        "editor.selectAll": "Cmd+A",
        "editor.find": "Cmd+F",
        "editor.toggleComment": "Cmd+/",
        "editor.indentMore": "Cmd+]",
        "editor.indentLess": "Cmd+[",
        "fileTree.copySelected": "Cmd+C",
        "fileTree.pasteInDirectory": "Cmd+V",
        "fileTree.deleteSelected": "Cmd+Backspace",
        "quickSwitcher.open": "Cmd+O",
        "commandPalette.open": "Cmd+J",
    });
    const managedEditorShortcutCandidatesRef = useRef<string[]>(
        collectManagedEditorShortcutCandidates(bindingsRef.current),
    );
    const vimModeEnabledRef = useRef<boolean>(false);
    const currentFilePathRef = useRef<string>(String(props.params.path ?? "未命名.md"));
    const fileNameInputRef = useRef<HTMLInputElement | null>(null);
    const segmentationCacheRef = useRef<Map<number, SegmentationCacheItem>>(new Map());
    const segmentationTimerRef = useRef<number | null>(null);
    const vimModeCompartmentRef = useRef<Compartment>(new Compartment());
    const executeEditorCommandRef = useRef<(commandId: CommandId) => void>(() => {
        // noop
    });
    const { bindings } = useShortcutState();
    const { files } = useVaultState();
    const { featureSettings } = useConfigState();
    const vimModeEnabled = featureSettings.vimModeEnabled;

    const [currentFilePath, setCurrentFilePath] = useState<string>(
        String(props.params.path ?? "未命名.md"),
    );
    const [isEditingFileName, setIsEditingFileName] = useState<boolean>(false);
    const [fileNameDraft, setFileNameDraft] = useState<string>(
        String(props.params.path ?? "未命名.md").split("/").pop() ?? "未命名.md",
    );
    const [renameError, setRenameError] = useState<string | null>(null);
    const articleId = props.api.id;
    const articleSnapshot = useArticleById(articleId);

    useEffect(() => {
        currentFilePathRef.current = currentFilePath;
    }, [currentFilePath]);

    useEffect(() => {
        if (!isEditingFileName) {
            return;
        }

        const inputElement = fileNameInputRef.current;
        if (!inputElement) {
            return;
        }

        inputElement.focus();
        const extensionMatch = inputElement.value.match(/\.(md|markdown)$/i);
        const selectEnd = extensionMatch
            ? inputElement.value.length - extensionMatch[0].length
            : inputElement.value.length;
        inputElement.setSelectionRange(0, Math.max(0, selectEnd));
    }, [isEditingFileName]);

    useEffect(() => {
        bindingsRef.current = bindings;
        managedEditorShortcutCandidatesRef.current = collectManagedEditorShortcutCandidates(bindings);
    }, [bindings]);

    useEffect(() => {
        vimModeEnabledRef.current = vimModeEnabled;
    }, [vimModeEnabled]);

    const executeEditorNativeCommand = (commandId: EditorNativeCommandId): boolean => {
        const view = viewRef.current;
        if (!view) {
            return false;
        }

        if (commandId === "editor.undo") {
            return undo(view);
        }

        if (commandId === "editor.redo") {
            return redo(view);
        }

        if (commandId === "editor.selectAll") {
            return selectAll(view);
        }

        if (commandId === "editor.find") {
            return openSearchPanel(view);
        }

        if (commandId === "editor.toggleComment") {
            return toggleComment(view);
        }

        if (commandId === "editor.indentMore") {
            return indentMore(view);
        }

        if (commandId === "editor.indentLess") {
            return indentLess(view);
        }

        return false;
    };

    const executeEditorCommand = (commandId: CommandId): void => {
        executeCommand(commandId, {
            activeTabId: props.api.id,
            closeTab: (tabId) => {
                props.containerApi.getPanel(tabId)?.api.close();
            },
            openQuickSwitcher: () => {
                notifyQuickSwitcherOpenRequested();
            },
            openCommandPalette: () => {
                notifyCommandPaletteOpenRequested();
            },
            openFileTab: (relativePath, content) => {
                const normalizedPath = relativePath.replace(/\\/g, "/");
                const fileName = normalizedPath.split("/").pop() ?? "untitled.md";
                props.containerApi.addPanel({
                    id: `file:${normalizedPath}`,
                    title: fileName,
                    component: "codemirror",
                    params: {
                        path: normalizedPath,
                        content,
                    },
                });
            },
            getExistingMarkdownPaths: () =>
                files
                    .filter((entry) => !entry.isDir)
                    .filter((entry) => entry.path.endsWith(".md") || entry.path.endsWith(".markdown"))
                    .map((entry) => entry.path),
            executeEditorNativeCommand,
        });
    };

    useEffect(() => {
        executeEditorCommandRef.current = executeEditorCommand;
    }, [executeEditorCommand]);

    const requestSegmentationForLine = (lineNumber: number, lineText: string): void => {
        if (!containsChineseCharacter(lineText)) {
            return;
        }

        const currentCache = segmentationCacheRef.current.get(lineNumber);
        if (currentCache && currentCache.text === lineText) {
            return;
        }

        void segmentChineseText(lineText)
            .then((tokens) => {
                segmentationCacheRef.current.set(lineNumber, {
                    text: lineText,
                    tokens,
                });
                console.debug("[editor] segmented line", {
                    articleId,
                    lineNumber,
                    tokenCount: tokens.length,
                });
            })
            .catch((error) => {
                console.warn("[editor] segment line failed", {
                    articleId,
                    lineNumber,
                    message: error instanceof Error ? error.message : String(error),
                });
            });
    };

    const scheduleActiveLineSegmentation = (state: EditorState): void => {
        if (segmentationTimerRef.current !== null) {
            window.clearTimeout(segmentationTimerRef.current);
        }

        segmentationTimerRef.current = window.setTimeout(() => {
            const activeLine = state.doc.lineAt(state.selection.main.head);
            requestSegmentationForLine(activeLine.number, activeLine.text);
        }, 120);
    };

    const getLineTokens = (lineNumber: number, lineText: string): ChineseSegmentToken[] | null => {
        const cacheItem = segmentationCacheRef.current.get(lineNumber);
        if (cacheItem && cacheItem.text === lineText) {
            return cacheItem.tokens;
        }

        requestSegmentationForLine(lineNumber, lineText);
        return null;
    };

    const getOrRequestLineTokens = async (
        lineNumber: number,
        lineText: string,
    ): Promise<ChineseSegmentToken[] | null> => {
        const cacheItem = segmentationCacheRef.current.get(lineNumber);
        if (cacheItem && cacheItem.text === lineText) {
            return cacheItem.tokens;
        }

        if (!containsChineseCharacter(lineText)) {
            return null;
        }

        try {
            const tokens = await segmentChineseText(lineText);
            segmentationCacheRef.current.set(lineNumber, {
                text: lineText,
                tokens,
            });
            return tokens;
        } catch (error) {
            console.warn("[editor] segment line for cmd+backspace failed", {
                articleId,
                lineNumber,
                message: error instanceof Error ? error.message : String(error),
            });
            return null;
        }
    };

    const executeSegmentedDeleteBackward = async (view: EditorView): Promise<void> => {
        const selection = view.state.selection.main;

        if (!selection.empty) {
            view.dispatch({
                changes: {
                    from: selection.from,
                    to: selection.to,
                    insert: "",
                },
                selection: {
                    anchor: selection.from,
                },
            });
            return;
        }

        const cursor = selection.head;
        if (cursor <= 0) {
            return;
        }

        const line = view.state.doc.lineAt(cursor);
        const lineOffset = cursor - line.from;
        if (lineOffset <= 0) {
            view.dispatch({
                changes: {
                    from: cursor - 1,
                    to: cursor,
                    insert: "",
                },
                selection: {
                    anchor: cursor - 1,
                },
            });
            return;
        }

        const previousChar = line.text.charAt(lineOffset - 1);
        const lineTokens = containsChineseCharacter(previousChar)
            ? await getOrRequestLineTokens(line.number, line.text)
            : null;

        const deleteFromOffset = containsChineseCharacter(previousChar)
            ? resolveChinesePreviousWordBoundary(line.text, lineOffset, lineTokens)
            : resolveEnglishPreviousWordBoundary(line.text, lineOffset);

        const safeFromOffset = Math.max(0, Math.min(deleteFromOffset, lineOffset));
        if (safeFromOffset === lineOffset) {
            return;
        }

        const deleteFrom = line.from + safeFromOffset;
        view.dispatch({
            changes: {
                from: deleteFrom,
                to: cursor,
                insert: "",
            },
            selection: {
                anchor: deleteFrom,
            },
        });
    };

    const initialDoc = useMemo(() => {
        const content = props.params.content;
        if (typeof content === "string" && content.length > 0) {
            return content;
        }
        return buildDefaultContent(currentFilePath);
    }, [props.params.content, currentFilePath]);

    useEffect(() => {
        if (!hostRef.current || viewRef.current) {
            return;
        }

        const state = EditorState.create({
            doc: initialDoc,
            extensions: [
                vimModeCompartmentRef.current.of(vimModeEnabled ? vim() : []),
                basicSetup,
                markdown(),
                createCodeMirrorThemeExtension(),
                EditorView.lineWrapping,
                registeredLineSyntaxRenderExtension,
                createFrontmatterSyntaxExtension(),
                createImageEmbedSyntaxExtension(() => currentFilePathRef.current),
                createWikiLinkNavigationExtension(
                    props.containerApi,
                    () => currentFilePathRef.current,
                ),
                EditorView.updateListener.of((update) => {
                    if (update.docChanged) {
                        reportArticleContent({
                            articleId,
                            path: currentFilePathRef.current,
                            content: update.state.doc.toString(),
                        });
                    }

                    if ((update.docChanged || update.selectionSet) && vimModeEnabledRef.current) {
                        scheduleActiveLineSegmentation(update.state);
                    }

                    if (update.focusChanged && update.view.hasFocus) {
                        reportArticleFocus({
                            articleId,
                            path: currentFilePathRef.current,
                            content: update.state.doc.toString(),
                        });
                    }
                }),
            ],
        });

        viewRef.current = new EditorView({
            state,
            parent: hostRef.current,
        });

        // 注册 Vim 分词 token 提供器，让增强运动能获取当前行的分词缓存
        registerVimTokenProvider(viewRef.current, getLineTokens);

        // 绑定粘贴图片处理器，拦截剪贴板图片并创建嵌入
        const cleanupPasteHandler = attachPasteImageHandler(
            viewRef.current,
            {
                getCurrentFilePath: () => currentFilePathRef.current,
                createBinaryFile: createVaultBinaryFile,
            },
        );

        reportArticleContent({
            articleId,
            path: currentFilePathRef.current,
            content: state.doc.toString(),
        });

        if (vimModeEnabledRef.current) {
            const activeLine = state.doc.lineAt(state.selection.main.head);
            requestSegmentationForLine(activeLine.number, activeLine.text);
        }

        return () => {
            if (segmentationTimerRef.current !== null) {
                window.clearTimeout(segmentationTimerRef.current);
                segmentationTimerRef.current = null;
            }
            cleanupPasteHandler();
            if (viewRef.current) {
                unregisterVimTokenProvider(viewRef.current);
                viewRef.current.destroy();
            }
            viewRef.current = null;
        };
    }, [initialDoc, articleId, props.containerApi]);

    useEffect(() => {
        const view = viewRef.current;
        if (!view) {
            return;
        }

        const handleKeydown = (event: KeyboardEvent): void => {
            const isComposing =
                event.isComposing ||
                event.keyCode === 229;
            if (isComposing) {
                return;
            }

            const isCmdBackspace =
                event.key === "Backspace" &&
                event.metaKey &&
                !event.ctrlKey &&
                !event.altKey &&
                !event.shiftKey;
            if (isCmdBackspace) {
                event.preventDefault();
                event.stopPropagation();
                void executeSegmentedDeleteBackward(view);
                return;
            }

            const systemShortcutResolution = resolveSystemShortcutCommand(event, bindingsRef.current);
            if (systemShortcutResolution) {
                event.preventDefault();
                event.stopPropagation();

                if (systemShortcutResolution.commandId === "tab.closeFocused") {
                    notifyTabCloseShortcutTriggered();
                }

                executeEditorCommandRef.current(systemShortcutResolution.commandId);
                return;
            }

            // 仅匹配条件满足当前编辑器上下文的命令，跳过其他组件条件的命令
            // (如 fileTreeFocused 的命令不在编辑器中执行)
            const commandId = (Object.entries(bindingsRef.current).find(([id, shortcut]) => {
                if (!matchShortcut(event, shortcut)) return false;
                const condition = getCommandCondition(id as CommandId);
                return isConditionSatisfied(condition, "tab:codemirror");
            })?.[0] ?? null) as CommandId | null;

            if (!commandId) {
                const shouldBlockNativeShortcut = managedEditorShortcutCandidatesRef.current.some((shortcut) =>
                    matchShortcut(event, shortcut),
                );

                if (shouldBlockNativeShortcut) {
                    event.preventDefault();
                    event.stopPropagation();
                }

                return;
            }

            event.preventDefault();
            event.stopPropagation();

            if (commandId === "tab.closeFocused") {
                notifyTabCloseShortcutTriggered();
            }

            executeEditorCommandRef.current(commandId);
        };

        view.dom.addEventListener("keydown", handleKeydown, true);
        return () => {
            view.dom.removeEventListener("keydown", handleKeydown, true);
        };
    }, [articleId]);

    useEffect(() => {
        const view = viewRef.current;
        if (!view) {
            return;
        }

        view.dispatch({
            effects: vimModeCompartmentRef.current.reconfigure(vimModeEnabled ? vim() : []),
        });

        console.info("[editor] vim mode changed", {
            articleId,
            filePath: currentFilePath,
            vimModeEnabled,
        });
    }, [vimModeEnabled, articleId, currentFilePath]);

    const currentFileName = currentFilePath.split("/").pop() ?? currentFilePath;

    const commitFileRename = async (): Promise<void> => {
        const trimmedName = fileNameDraft.trim();
        if (!trimmedName) {
            setRenameError("文件名不能为空");
            return;
        }

        const safeFileName =
            trimmedName.endsWith(".md") || trimmedName.endsWith(".markdown")
                ? trimmedName
                : `${trimmedName}.md`;
        const parentDirectory = resolveParentDirectory(currentFilePath);
        const nextRelativePath = parentDirectory
            ? `${parentDirectory}/${safeFileName}`
            : safeFileName;

        if (nextRelativePath === currentFilePath) {
            setIsEditingFileName(false);
            setRenameError(null);
            return;
        }

        try {
            await renameVaultMarkdownFile(currentFilePath, nextRelativePath);
            setCurrentFilePath(nextRelativePath);
            currentFilePathRef.current = nextRelativePath;
            props.api.setTitle(safeFileName);

            const currentDoc = viewRef.current?.state.doc.toString() ?? "";
            reportArticleContent({
                articleId,
                path: nextRelativePath,
                content: currentDoc,
            });
            reportArticleFocus({
                articleId,
                path: nextRelativePath,
                content: currentDoc,
            });

            setIsEditingFileName(false);
            setRenameError(null);
            console.info("[editor] rename file success", {
                articleId,
                from: currentFilePath,
                to: nextRelativePath,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : "重命名文件失败";
            setRenameError(message);
            console.error("[editor] rename file failed", {
                articleId,
                from: currentFilePath,
                to: nextRelativePath,
                message,
            });
        }
    };

    useEffect(() => {
        const view = viewRef.current;
        if (!view) {
            return;
        }

        const currentDoc = view.state.doc.toString();
        if (currentDoc === initialDoc) {
            return;
        }

        view.dispatch({
            changes: {
                from: 0,
                to: view.state.doc.length,
                insert: initialDoc,
            },
        });
    }, [initialDoc]);

    useEffect(() => {
        const view = viewRef.current;
        if (!view || !articleSnapshot) {
            return;
        }

        if (!articleSnapshot.hasContentSnapshot) {
            return;
        }

        if (articleSnapshot.path !== currentFilePathRef.current) {
            return;
        }

        const currentDoc = view.state.doc.toString();
        if (currentDoc === articleSnapshot.content) {
            return;
        }

        view.dispatch({
            changes: {
                from: 0,
                to: view.state.doc.length,
                insert: articleSnapshot.content,
            },
        });

        console.info("[editor] synced content from editor context state", {
            articleId,
            path: articleSnapshot.path,
            updatedAt: articleSnapshot.updatedAt,
        });
    }, [articleSnapshot?.updatedAt, articleSnapshot?.content, articleSnapshot?.path, articleId]);

    return (
        <div className="cm-tab">
            <div className="cm-tab-header" onClick={() => {
                setFileNameDraft(currentFileName);
                setIsEditingFileName(true);
                setRenameError(null);
            }}>
                {isEditingFileName ? (
                    <input
                        ref={fileNameInputRef}
                        className="cm-tab-header-input"
                        value={fileNameDraft}
                        onChange={(event) => {
                            setFileNameDraft(event.target.value);
                        }}
                        onClick={(event) => {
                            event.stopPropagation();
                        }}
                        onBlur={() => {
                            void commitFileRename();
                        }}
                        onKeyDown={(event) => {
                            const nativeEvent = event.nativeEvent;
                            const isComposing =
                                nativeEvent.isComposing ||
                                nativeEvent.keyCode === 229;
                            if (isComposing) {
                                return;
                            }

                            if (event.key === "Enter") {
                                event.preventDefault();
                                void commitFileRename();
                                return;
                            }

                            if (event.key === "Escape") {
                                event.preventDefault();
                                setIsEditingFileName(false);
                                setRenameError(null);
                            }
                        }}
                    />
                ) : (
                    currentFilePath
                )}
            </div>
            {renameError ? <div className="cm-tab-header-error">{renameError}</div> : null}
            <div ref={hostRef} className="cm-tab-editor" />
        </div>
    );
}
