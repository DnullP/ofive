/**
 * @module plugins/canvas/CanvasTab
 * @description 基于 xyflow 的 Canvas 编辑 Tab。
 *   当前版本负责：
 *   - 加载与保存 `.canvas` 文档
 *   - 提供文本节点、文件节点、分组节点的基础编辑
 *   - 提供边连接、缩放、缩略图与外部文件变更刷新
 *
 * @dependencies
 *   - react
 *   - dockview
 *   - @xyflow/react
 *   - ../../api/vaultApi
 *   - ../../host/events/appEventBus
 *
 * @example
 *   通过 canvas opener 打开 `boards/example.canvas` 时挂载。
 */

import {
    addEdge,
    applyEdgeChanges,
    applyNodeChanges,
    Background,
    Controls,
    Handle,
    MiniMap,
    NodeResizer,
    Position,
    ReactFlow,
    ReactFlowProvider,
    type Connection,
    type EdgeChange,
    type NodeChange,
    type NodeProps,
    type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { FilePlus2, SquarePen, Workflow } from "lucide-react";
import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type DragEvent as ReactDragEvent,
    type MouseEvent as ReactMouseEvent,
    type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import type { IDockviewPanelProps } from "dockview";
import {
    readVaultCanvasFile,
    saveVaultCanvasFile,
} from "../../api/vaultApi";
import {
    emitPersistedContentUpdatedEvent,
    subscribePersistedContentUpdatedEvent,
} from "../../host/events/appEventBus";
import { CreateEntryModal } from "../../host/layout/CreateEntryModal";
import {
    hasWorkspaceFileDragPayloadFiles,
    notifyWorkspaceFileDragLocalScope,
    readWorkspaceFileDragPayload,
} from "../../host/layout/workspaceFileDragPayload";
import { showNativeContextMenu } from "../../host/layout/nativeContextMenu";
import { openFileInDockview } from "../../host/layout/openFileService";
import {
    createEmptyCanvasDocument,
    createFileNode,
    createGroupNode,
    createTextNode,
    parseCanvasDocument,
    serializeCanvasDocument,
    type CanvasDocument,
    type CanvasFlowEdge,
    type CanvasFlowNode,
    type CanvasNodeData,
} from "./canvasDocument";
import { CanvasMarkdown } from "./CanvasMarkdown";
import "./CanvasTab.tokens.css";
import "./CanvasTab.css";

interface CanvasNodeRendererProps extends NodeProps<CanvasFlowNode> {
    data: CanvasNodeData;
}

interface EdgeEditorState {
    edgeId: string;
    label: string;
    color: string;
    x: number;
    y: number;
}

interface FileNodeModalState {
    x: number;
    y: number;
    initialValue: string;
}

const AUTOSAVE_DELAY_MS = 800;

const NODE_MIN_SIZE_BY_KIND: Record<CanvasNodeData["kind"], { minWidth: number; minHeight: number }> = {
    text: { minWidth: 220, minHeight: 120 },
    file: { minWidth: 220, minHeight: 96 },
    group: { minWidth: 280, minHeight: 160 },
};

interface CanvasTextEditRuntime {
    onTextEditChange: (value: string) => void;
    onTextEditCompositionStart: () => void;
    onTextEditCompositionEnd: () => void;
    onTextEditCommit: (value: string) => void;
    onTextEditCancel: () => void;
}

const canvasTextEditRuntimeRegistry = new Map<string, CanvasTextEditRuntime>();

/**
 * @function CanvasNodeRenderer
 * @description 自定义节点渲染器，统一承载文本、文件与分组节点视觉。
 * @param props 节点渲染属性。
 * @returns 节点内容。
 */
function CanvasNodeRenderer(props: CanvasNodeRendererProps): ReactNode {
    const { t } = useTranslation();
    const {
        id,
        data,
        selected,
    } = props;
    const isEditingText = data.isEditingText === true;
    const [draftTextValue, setDraftTextValue] = useState<string>(data.text ?? "");
    const pendingLineBreakActionRef = useRef<"commit" | "newline" | null>(null);
    const isComposingRef = useRef(false);
    const lastCompositionEndAtRef = useRef(0);
    const textEditorRef = useRef<HTMLTextAreaElement | null>(null);
    const hasClosedEditorRef = useRef(false);
    const kindClassName = `canvas-tab__node canvas-tab__node--${data.kind}`;
    const minimumNodeSize = NODE_MIN_SIZE_BY_KIND[data.kind];
    const textEditRuntime = data.runtimeKey
        ? canvasTextEditRuntimeRegistry.get(data.runtimeKey)
        : undefined;
    const resolveCurrentDraftValue = (): string => textEditorRef.current?.value ?? draftTextValue;

    useEffect(() => {
        if (!isEditingText) {
            return;
        }

        hasClosedEditorRef.current = false;
        setDraftTextValue(data.text ?? "");
    }, [data.text, id, isEditingText]);

    const commitEditor = (): void => {
        if (hasClosedEditorRef.current) {
            return;
        }

        hasClosedEditorRef.current = true;
        textEditRuntime?.onTextEditCommit(resolveCurrentDraftValue());
    };

    const cancelEditor = (): void => {
        if (hasClosedEditorRef.current) {
            return;
        }

        hasClosedEditorRef.current = true;
        textEditRuntime?.onTextEditCancel();
    };

    return (
        <div
            className={[
                kindClassName,
                selected ? "canvas-tab__node--selected" : "",
                isEditingText ? "canvas-tab__node--editing" : "",
            ].filter(Boolean).join(" ")}
            style={{
                borderColor: data.color ?? undefined,
                background: data.kind === "group" ? data.background : undefined,
            }}
        >
            <NodeResizer
                isVisible={selected && !isEditingText}
                minWidth={minimumNodeSize.minWidth}
                minHeight={minimumNodeSize.minHeight}
                lineClassName="canvas-tab__node-resizer-line"
                handleClassName="canvas-tab__node-resizer-handle"
            />
            <Handle type="target" id="top" position={Position.Top} />
            <Handle type="target" id="right" position={Position.Right} />
            <Handle type="target" id="bottom" position={Position.Bottom} />
            <Handle type="target" id="left" position={Position.Left} />
            <Handle type="source" id="top" position={Position.Top} />
            <Handle type="source" id="right" position={Position.Right} />
            <Handle type="source" id="bottom" position={Position.Bottom} />
            <Handle type="source" id="left" position={Position.Left} />
            {data.kind === "text" ? (
                isEditingText ? (
                    <textarea
                        ref={textEditorRef}
                        className="canvas-tab__node-text-editor nodrag nopan nowheel"
                        value={draftTextValue}
                        onBeforeInput={(event) => {
                            const nativeEvent = event.nativeEvent as InputEvent;
                            if (
                                nativeEvent.isComposing
                                || (nativeEvent.inputType !== "insertLineBreak"
                                    && nativeEvent.inputType !== "insertParagraph")
                            ) {
                                return;
                            }

                            if (performance.now() - lastCompositionEndAtRef.current < 40) {
                                pendingLineBreakActionRef.current = null;
                                event.preventDefault();
                                return;
                            }

                            const nextAction = pendingLineBreakActionRef.current;
                            pendingLineBreakActionRef.current = null;
                            if (nextAction === "newline") {
                                return;
                            }

                            event.preventDefault();
                            commitEditor();
                        }}
                        onChange={(event) => {
                            setDraftTextValue(event.target.value);
                            textEditRuntime?.onTextEditChange(event.target.value);
                        }}
                        onCompositionStart={() => {
                            isComposingRef.current = true;
                            textEditRuntime?.onTextEditCompositionStart();
                        }}
                        onCompositionEnd={() => {
                            isComposingRef.current = false;
                            lastCompositionEndAtRef.current = performance.now();
                            textEditRuntime?.onTextEditCompositionEnd();
                        }}
                        onBlur={() => {
                            commitEditor();
                        }}
                        onKeyDown={(event) => {
                            const nativeKeyboardEvent = event.nativeEvent as KeyboardEvent;
                            const isNativeComposing = nativeKeyboardEvent.isComposing || nativeKeyboardEvent.keyCode === 229;

                            if (event.key === "Enter") {
                                pendingLineBreakActionRef.current = event.shiftKey ? "newline" : "commit";
                            } else {
                                pendingLineBreakActionRef.current = null;
                            }

                            if (isComposingRef.current || isNativeComposing) {
                                return;
                            }

                            if (
                                event.key === "Enter"
                                && performance.now() - lastCompositionEndAtRef.current < 40
                            ) {
                                return;
                            }

                            if (event.key === "Enter" && !event.shiftKey) {
                                pendingLineBreakActionRef.current = null;
                                event.preventDefault();
                                commitEditor();
                                return;
                            }

                            if (event.key === "Escape") {
                                event.preventDefault();
                                cancelEditor();
                            }
                        }}
                        onKeyUp={() => {
                            pendingLineBreakActionRef.current = null;
                        }}
                        placeholder={t("canvas.emptyTextNode")}
                        autoFocus
                    />
                ) : (
                    <div className="canvas-tab__node-body canvas-tab__node-body--text nowheel">
                        <CanvasMarkdown
                            content={data.text}
                            placeholder={t("canvas.emptyTextNode")}
                        />
                    </div>
                )
            ) : null}
            {data.kind !== "text" ? <div className="canvas-tab__node-header">{data.label}</div> : null}
            {data.kind === "file" ? (
                <div className="canvas-tab__node-body">{data.filePath?.trim() || t("canvas.noLinkedFile")}</div>
            ) : null}
            {data.kind === "group" ? (
                <div className="canvas-tab__node-body">{t("canvas.groupHint")}</div>
            ) : null}
        </div>
    );
}

const CANVAS_NODE_TYPES = {
    ofiveCanvasNode: CanvasNodeRenderer,
} as const;

/**
 * @function CanvasTab
 * @description Dockview Canvas Tab 渲染函数。
 * @param props Dockview 面板属性，支持 params.path 与 params.content。
 * @returns Canvas 编辑器视图。
 */
export function CanvasTab(props: IDockviewPanelProps<Record<string, unknown>>): ReactNode {
    const { t } = useTranslation();
    const path = String(props.params.path ?? "");
    const contentOverride = typeof props.params.content === "string"
        ? props.params.content
        : null;
    const [document, setDocument] = useState<CanvasDocument>(() => createEmptyCanvasDocument());
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [dirty, setDirty] = useState<boolean>(false);
    const [, setSelectedNodeId] = useState<string | null>(null);
    const [, setSelectedEdgeId] = useState<string | null>(null);
    const [editingTextNodeId, setEditingTextNodeId] = useState<string | null>(null);
    const [editingTextValue, setEditingTextValue] = useState<string>("");
    const [edgeEditor, setEdgeEditor] = useState<EdgeEditorState | null>(null);
    const [fileNodeModal, setFileNodeModal] = useState<FileNodeModalState | null>(null);
    const [fileNodeValidationMessage, setFileNodeValidationMessage] = useState<string>("");
    const flowRef = useRef<ReactFlowInstance<CanvasFlowNode, CanvasFlowEdge> | null>(null);
    const surfaceRef = useRef<HTMLDivElement | null>(null);
    const loadSequenceRef = useRef(0);
    const hydratingRef = useRef(false);
    const pendingTextEditCommitRef = useRef(false);
    const isEditingTextComposingRef = useRef(false);
    const canvasRuntimeIdRef = useRef<string>(`canvas-runtime-${Math.random().toString(36).slice(2)}`);

    const cancelTextEditing = useCallback((): void => {
        pendingTextEditCommitRef.current = false;
        isEditingTextComposingRef.current = false;
        setEditingTextValue("");
        setEditingTextNodeId(null);
    }, []);

    const markUnsaved = useCallback((): void => {
        setDirty(true);
    }, []);

    const commitEditingTextNode = useCallback((nextValue?: string): void => {
        setEditingTextNodeId((currentEditingNodeId) => {
            if (!currentEditingNodeId) {
                return currentEditingNodeId;
            }

            const nextTextValue = typeof nextValue === "string"
                ? nextValue
                : editingTextValue;
            pendingTextEditCommitRef.current = false;
            isEditingTextComposingRef.current = false;
            setEditingTextValue("");
            setDocument((currentDocument) => ({
                ...currentDocument,
                nodes: currentDocument.nodes.map((node) => {
                    if (node.id !== currentEditingNodeId) {
                        return node;
                    }

                    return {
                        ...node,
                        data: {
                            ...node.data,
                            text: nextTextValue,
                        },
                    };
                }),
            }));
            setDirty(true);
            return null;
        });
    }, [editingTextValue]);

    const updateEditingTextNode = useCallback((nodeId: string, nextText: string): void => {
        if (editingTextNodeId !== nodeId) {
            return;
        }

        setEditingTextValue(nextText);
    }, [editingTextNodeId]);

    useEffect(() => {
        const runtimeKeys = new Set<string>();

        document.nodes.forEach((node) => {
            if (node.data.kind !== "text") {
                return;
            }

            const runtimeKey = `${canvasRuntimeIdRef.current}:${node.id}`;
            runtimeKeys.add(runtimeKey);
            canvasTextEditRuntimeRegistry.set(runtimeKey, {
                onTextEditChange: (nextValue: string) => {
                    updateEditingTextNode(node.id, nextValue);
                },
                onTextEditCompositionStart: () => {
                    isEditingTextComposingRef.current = true;
                },
                onTextEditCompositionEnd: () => {
                    isEditingTextComposingRef.current = false;
                    if (pendingTextEditCommitRef.current) {
                        commitEditingTextNode(editingTextValue);
                    }
                },
                onTextEditCommit: (nextValue: string) => {
                    setEditingTextValue(nextValue);
                    if (isEditingTextComposingRef.current) {
                        pendingTextEditCommitRef.current = true;
                        return;
                    }

                    commitEditingTextNode(nextValue);
                },
                onTextEditCancel: cancelTextEditing,
            });
        });

        for (const key of Array.from(canvasTextEditRuntimeRegistry.keys())) {
            if (!key.startsWith(`${canvasRuntimeIdRef.current}:`)) {
                continue;
            }

            if (!runtimeKeys.has(key)) {
                canvasTextEditRuntimeRegistry.delete(key);
            }
        }

        return () => {
            for (const key of runtimeKeys) {
                canvasTextEditRuntimeRegistry.delete(key);
            }
        };
    }, [cancelTextEditing, commitEditingTextNode, document.nodes, editingTextValue, updateEditingTextNode]);

    const flowNodes = useMemo(() => document.nodes.map((node) => {
        if (node.data.kind !== "text") {
            return node;
        }

        return {
            ...node,
            data: {
                ...node.data,
                text: editingTextNodeId === node.id ? editingTextValue : node.data.text,
                isEditingText: editingTextNodeId === node.id,
                runtimeKey: `${canvasRuntimeIdRef.current}:${node.id}`,
            },
        } satisfies CanvasFlowNode;
    }), [document.nodes, editingTextNodeId, editingTextValue]);

    const closeEdgeEditor = (): void => {
        setEdgeEditor(null);
    };

    const closeFileNodeModal = (): void => {
        setFileNodeModal(null);
        setFileNodeValidationMessage("");
    };

    const updateDocument = (nextDocument: CanvasDocument): void => {
        setDocument(nextDocument);
        if (!hydratingRef.current) {
            markUnsaved();
        }
    };

    const commitEdgeEditor = (): void => {
        if (!edgeEditor) {
            return;
        }

        updateDocument({
            ...document,
            edges: document.edges.map((edge) => {
                if (edge.id !== edgeEditor.edgeId) {
                    return edge;
                }

                return {
                    ...edge,
                    label: edgeEditor.label,
                    style: {
                        ...(edge.style ?? {}),
                        stroke: edgeEditor.color || undefined,
                    },
                    data: {
                        ...edge.data,
                        label: edgeEditor.label,
                        color: edgeEditor.color,
                    },
                };
            }),
        });
        closeEdgeEditor();
    };

    const resolveFlowPosition = (clientX: number, clientY: number): { x: number; y: number } => {
        if (!flowRef.current) {
            return { x: 120, y: 120 };
        }

        return flowRef.current.screenToFlowPosition({ x: clientX, y: clientY });
    };

    const addTextAt = (x: number, y: number): void => {
        const nextNode = createTextNode(`text-${Date.now()}`, x, y);
        updateDocument({
            ...document,
            nodes: [...document.nodes, nextNode],
        });
        setSelectedNodeId(nextNode.id);
        setSelectedEdgeId(null);
        console.info("[canvasTab] add text node", { path, nodeId: nextNode.id, x, y });
    };

    const addFileAt = (x: number, y: number): void => {
        closeEdgeEditor();
        cancelTextEditing();
        setFileNodeValidationMessage("");
        setFileNodeModal({
            x,
            y,
            initialValue: "",
        });
        console.info("[canvasTab] open file node modal", { path, x, y });
    };

    const addGroupAt = (x: number, y: number): void => {
        const nextNode = createGroupNode(`group-${Date.now()}`, x, y);
        updateDocument({
            ...document,
            nodes: [...document.nodes, nextNode],
        });
        setSelectedNodeId(nextNode.id);
        setSelectedEdgeId(null);
        console.info("[canvasTab] add group node", { path, nodeId: nextNode.id, x, y });
    };

    const addDroppedFilesAt = (filePaths: string[], x: number, y: number): void => {
        if (filePaths.length === 0) {
            return;
        }

        const timestamp = Date.now();
        const nextNodes = filePaths.map((filePath, index) => createFileNode(
            `file-${timestamp}-${String(index)}`,
            x + index * 32,
            y + index * 28,
            filePath,
        ));

        updateDocument({
            ...document,
            nodes: [...document.nodes, ...nextNodes],
        });
        setSelectedNodeId(nextNodes[nextNodes.length - 1]?.id ?? null);
        setSelectedEdgeId(null);
        console.info("[canvasTab] add dropped file nodes", {
            path,
            fileCount: nextNodes.length,
            filePaths,
            x,
            y,
        });
    };

    const openCanvasCreateMenu = async (clientX: number, clientY: number): Promise<void> => {
        const selectedAction = await showNativeContextMenu([
            { id: "create-text", text: t("canvas.addText") },
            { id: "create-file", text: t("canvas.addFile") },
            { id: "create-group", text: t("canvas.addGroup") },
        ]);

        if (!selectedAction) {
            return;
        }

        const position = resolveFlowPosition(clientX, clientY);
        if (selectedAction === "create-text") {
            addTextAt(position.x, position.y);
            return;
        }

        if (selectedAction === "create-file") {
            addFileAt(position.x, position.y);
            return;
        }

        if (selectedAction === "create-group") {
            addGroupAt(position.x, position.y);
        }
    };

    /**
     * @function loadCanvasDocument
     * @description 加载磁盘中的 Canvas 文档或消费 opener 传入的覆盖内容。
     */
    const loadCanvasDocument = (nextContentOverride?: string | null): void => {
        const requestId = loadSequenceRef.current + 1;
        loadSequenceRef.current = requestId;
        setLoading(true);
        setError(null);

        const source = typeof nextContentOverride === "string"
            ? Promise.resolve({ relativePath: path, content: nextContentOverride })
            : readVaultCanvasFile(path);

        void source
            .then((response) => {
                if (loadSequenceRef.current !== requestId) {
                    return;
                }

                hydratingRef.current = true;
                const nextDocument = parseCanvasDocument(response.content);
                setDocument(nextDocument);
                cancelTextEditing();
                closeEdgeEditor();
                setDirty(false);
                setLoading(false);
                console.info("[canvasTab] load success", {
                    path: response.relativePath,
                    nodeCount: nextDocument.nodes.length,
                    edgeCount: nextDocument.edges.length,
                });
                queueMicrotask(() => {
                    hydratingRef.current = false;
                });
            })
            .catch((loadError) => {
                if (loadSequenceRef.current !== requestId) {
                    return;
                }

                const message = loadError instanceof Error ? loadError.message : String(loadError);
                setError(message);
                setLoading(false);
                console.error("[canvasTab] load failed", {
                    path,
                    message,
                });
            });
    };

    useEffect(() => {
        if (!path) {
            setLoading(false);
            setError(t("canvas.pathEmpty"));
            return;
        }

        loadCanvasDocument(contentOverride);
    }, [path, contentOverride, t]);

    useEffect(() => {
        const unlisten = subscribePersistedContentUpdatedEvent((event) => {
            if (event.relativePath !== path || event.source !== "external") {
                return;
            }

            console.info("[canvasTab] external persisted update detected", {
                path,
                eventId: event.eventId,
            });
            loadCanvasDocument(null);
        });

        return unlisten;
    }, [path]);

    useEffect(() => {
        if (!dirty || loading || !path) {
            return;
        }

        const timer = window.setTimeout(() => {
            const serialized = serializeCanvasDocument(document);
            console.info("[canvasTab] autosave start", {
                path,
                nodeCount: document.nodes.length,
                edgeCount: document.edges.length,
            });
            void saveVaultCanvasFile(path, serialized)
                .then(() => {
                    setDirty(false);
                    emitPersistedContentUpdatedEvent({
                        relativePath: path,
                        source: "save",
                    });
                    console.info("[canvasTab] autosave success", { path });
                })
                .catch((saveError) => {
                    const message = saveError instanceof Error ? saveError.message : String(saveError);
                    console.error("[canvasTab] autosave failed", {
                        path,
                        message,
                    });
                });
        }, AUTOSAVE_DELAY_MS);

        return () => {
            window.clearTimeout(timer);
        };
    }, [document, dirty, loading, path]);

    const addText = (): void => {
        addTextAt(80, 80);
    };

    const addFile = (): void => {
        addFileAt(120, 120);
    };

    const addGroup = (): void => {
        addGroupAt(160, 160);
    };

    const onNodesChange = (changes: NodeChange<CanvasFlowNode>[]): void => {
        const nextNodes = applyNodeChanges<CanvasFlowNode>(changes, document.nodes);
        updateDocument({
            ...document,
            nodes: nextNodes,
        });
    };

    const onEdgesChange = (changes: EdgeChange<CanvasFlowEdge>[]): void => {
        const nextEdges = applyEdgeChanges<CanvasFlowEdge>(changes, document.edges);
        updateDocument({
            ...document,
            edges: nextEdges,
        });
    };

    const onConnect = (connection: Connection): void => {
        const nextEdges = addEdge<CanvasFlowEdge>({
            ...connection,
            id: `edge-${Date.now()}`,
            data: {
                color: "var(--canvas-edge-stroke)",
            },
        }, document.edges);
        updateDocument({
            ...document,
            edges: nextEdges,
        });
        console.info("[canvasTab] connect nodes", {
            path,
            source: connection.source,
            target: connection.target,
        });
    };

    const onNodeDoubleClick = (_event: ReactMouseEvent, node: CanvasFlowNode): void => {
        if (node.data.kind === "text") {
            setEditingTextValue(node.data.text ?? "");
            isEditingTextComposingRef.current = false;
            setEditingTextNodeId(node.id);
            closeEdgeEditor();
            return;
        }

        if (node.data.kind !== "file" || !node.data.filePath?.trim()) {
            return;
        }

        void openFileInDockview({
            containerApi: props.containerApi,
            relativePath: node.data.filePath,
        });
        console.info("[canvasTab] open linked file", {
            canvasPath: path,
            linkedFilePath: node.data.filePath,
        });
    };

    const onEdgeDoubleClick = (event: ReactMouseEvent, edge: CanvasFlowEdge): void => {
        const surfaceRect = surfaceRef.current?.getBoundingClientRect();
        const nextX = surfaceRect ? event.clientX - surfaceRect.left : 180;
        const nextY = surfaceRect ? event.clientY - surfaceRect.top : 180;
        cancelTextEditing();
        setEdgeEditor({
            edgeId: edge.id,
            label: edge.data?.label ?? (typeof edge.label === "string" ? edge.label : ""),
            color: edge.data?.color ?? "var(--canvas-edge-stroke)",
            x: nextX,
            y: nextY,
        });
    };

    const onCanvasContextMenu = (event: MouseEvent | ReactMouseEvent): void => {
        event.preventDefault();
        void openCanvasCreateMenu(event.clientX, event.clientY);
    };

    const consumeWorkspaceFileDrag = (event: ReactDragEvent<HTMLDivElement>): boolean => {
        if (!hasWorkspaceFileDragPayloadFiles(event.dataTransfer)) {
            return false;
        }

        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "copy";
        notifyWorkspaceFileDragLocalScope(event.type === "drop" ? "drop" : event.type === "dragenter" ? "enter" : "over");
        return true;
    };

    const onCanvasDragEnter = (event: ReactDragEvent<HTMLDivElement>): void => {
        void consumeWorkspaceFileDrag(event);
    };

    const onCanvasDragOver = (event: ReactDragEvent<HTMLDivElement>): void => {
        if (!consumeWorkspaceFileDrag(event)) {
            return;
        }
    };

    const onCanvasDrop = (event: ReactDragEvent<HTMLDivElement>): void => {
        if (!consumeWorkspaceFileDrag(event)) {
            return;
        }

        const droppedFiles = readWorkspaceFileDragPayload(event.dataTransfer)
            .filter((item) => !item.isDir)
            .map((item) => item.path);
        if (droppedFiles.length === 0) {
            return;
        }

        closeEdgeEditor();
        closeFileNodeModal();
        cancelTextEditing();
        const position = resolveFlowPosition(event.clientX, event.clientY);
        addDroppedFilesAt(droppedFiles, position.x, position.y);
    };

    const confirmFileNodeModal = (draftPath: string): void => {
        if (!fileNodeModal) {
            return;
        }

        const normalizedFilePath = draftPath.trim().replace(/\\/g, "/");
        if (!normalizedFilePath) {
            setFileNodeValidationMessage(t("canvas.filePathRequired"));
            console.warn("[canvasTab] add file node blocked: empty file path", { path });
            return;
        }

        const nextNode = createFileNode(
            `file-${Date.now()}`,
            fileNodeModal.x,
            fileNodeModal.y,
            normalizedFilePath,
        );
        updateDocument({
            ...document,
            nodes: [...document.nodes, nextNode],
        });
        closeFileNodeModal();
        console.info("[canvasTab] add file node", {
            path,
            nodeId: nextNode.id,
            filePath: normalizedFilePath,
            x: fileNodeModal.x,
            y: fileNodeModal.y,
        });
    };

    const baseDirectory = useMemo(() => {
        const segments = path.split("/").filter(Boolean);
        return segments.slice(0, -1).join("/");
    }, [path]);

    return (
        <ReactFlowProvider>
            <div
                className="canvas-tab"
                data-workspace-file-drop-scope="local"
                onDragEnter={onCanvasDragEnter}
                onDragOver={onCanvasDragOver}
                onDrop={onCanvasDrop}
            >
                <div
                    className="canvas-tab__surface"
                    ref={surfaceRef}
                >
                    {error ? <div className="canvas-tab__overlay">{error}</div> : null}
                    {loading ? <div className="canvas-tab__overlay">{t("canvas.loadingCanvas")}</div> : null}
                    {edgeEditor ? (
                        <div
                            className="canvas-tab__edge-editor"
                            style={{
                                left: `${String(edgeEditor.x)}px`,
                                top: `${String(edgeEditor.y)}px`,
                            }}
                        >
                            <div className="canvas-tab__edge-editor-title">{t("canvas.editEdge")}</div>
                            <label className="canvas-tab__field">
                                <span>{t("canvas.label")}</span>
                                <input
                                    value={edgeEditor.label}
                                    onChange={(event) => {
                                        setEdgeEditor((current) => current ? {
                                            ...current,
                                            label: event.target.value,
                                        } : null);
                                    }}
                                    onKeyDown={(event) => {
                                        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                                            event.preventDefault();
                                            commitEdgeEditor();
                                            return;
                                        }

                                        if (event.key === "Escape") {
                                            event.preventDefault();
                                            closeEdgeEditor();
                                        }
                                    }}
                                    autoFocus
                                />
                            </label>
                            <label className="canvas-tab__field">
                                <span>{t("canvas.color")}</span>
                                <input
                                    value={edgeEditor.color}
                                    onChange={(event) => {
                                        setEdgeEditor((current) => current ? {
                                            ...current,
                                            color: event.target.value,
                                        } : null);
                                    }}
                                />
                            </label>
                            <div className="canvas-tab__edge-editor-actions">
                                <button type="button" onClick={closeEdgeEditor}>{t("common.cancel")}</button>
                                <button type="button" onClick={commitEdgeEditor}>{t("common.save")}</button>
                            </div>
                        </div>
                    ) : null}
                    <ReactFlow<CanvasFlowNode, CanvasFlowEdge>
                        nodes={flowNodes}
                        edges={document.edges}
                        nodeTypes={CANVAS_NODE_TYPES}
                        onInit={(instance) => {
                            flowRef.current = instance;
                        }}
                        onNodesChange={onNodesChange}
                        onEdgesChange={onEdgesChange}
                        onConnect={onConnect}
                        onPaneClick={() => {
                            closeEdgeEditor();
                        }}
                        onPaneContextMenu={onCanvasContextMenu}
                        onNodeContextMenu={onCanvasContextMenu}
                        onEdgeContextMenu={onCanvasContextMenu}
                        onNodeDoubleClick={onNodeDoubleClick}
                        onEdgeDoubleClick={onEdgeDoubleClick}
                        fitView
                    >
                        <Background gap={18} size={1} />
                        <Controls />
                        <MiniMap />
                    </ReactFlow>
                    <div className="canvas-tab__actions" aria-label={t("canvas.document")}>
                        <button type="button" className="canvas-tab__action-button" onClick={addText}>
                            <SquarePen size={16} strokeWidth={1.8} aria-hidden="true" />
                            <span>{t("canvas.addText")}</span>
                        </button>
                        <button type="button" className="canvas-tab__action-button" onClick={addFile}>
                            <FilePlus2 size={16} strokeWidth={1.8} aria-hidden="true" />
                            <span>{t("canvas.addFile")}</span>
                        </button>
                        <button type="button" className="canvas-tab__action-button" onClick={addGroup}>
                            <Workflow size={16} strokeWidth={1.8} aria-hidden="true" />
                            <span>{t("canvas.addGroup")}</span>
                        </button>
                    </div>
                </div>
            </div>
            <CreateEntryModal
                isOpen={fileNodeModal !== null}
                kind="file"
                baseDirectory={baseDirectory}
                title={t("canvas.fileNodeModalTitle")}
                placeholder={t("canvas.fileNodeModalPlaceholder")}
                initialValue={fileNodeModal?.initialValue ?? ""}
                confirmLabel={t("canvas.attachFile")}
                validationMessage={fileNodeValidationMessage}
                onClose={closeFileNodeModal}
                onConfirm={confirmFileNodeModal}
            />
        </ReactFlowProvider>
    );
}