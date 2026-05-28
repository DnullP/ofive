import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type MutableRefObject,
} from "react";
import type {
    WorkbenchApi,
    WorkbenchTabDragPayload,
    WorkbenchTabDragPointer,
} from "layout-v2";
import {
    createDetachedTabWindow,
    destroyCurrentOfiveWindow,
    destroyOfiveWindowByLabel,
    emitTabWindowDragAccepted,
    emitTabWindowDragCancel,
    emitTabWindowDragDrop,
    emitTabWindowDragMove,
    getCurrentOfiveWindowLabel,
    listenTabWindowDragAccepted,
    listenTabWindowDragCancel,
    listenTabWindowDragDrop,
    listenTabWindowDragMove,
    type DetachedTabWindowTab,
    type OfiveWindowKind,
    type TabWindowDragAcceptedPayload,
    type TabWindowDragEventPayload,
} from "../../api/windowApi";

interface TabDragPointerEvent {
    clientX: number;
    clientY: number;
    screenX: number;
    screenY: number;
}

interface TabDragEndEvent extends TabDragPointerEvent {
    droppedInside: boolean;
}

interface SourceTabDragState {
    dragId: string;
    tab: WorkbenchTabDragPayload;
    detachedWindowLabel: string | null;
    detachedCreatePromise: Promise<string | null> | null;
    sourceClosed: boolean;
    cancelled: boolean;
}

export interface UseTabWindowDragBridgeOptions {
    workbenchApiRef: MutableRefObject<WorkbenchApi | null>;
    windowKind: OfiveWindowKind;
    onTabsChanged?: () => void;
}

export interface TabWindowDragBridge {
    workbenchId: string;
    windowLabel: string | null;
    onTabDragOutside: (payload: WorkbenchTabDragPayload, event: TabDragPointerEvent) => void;
    onTabDragInside: (payload: WorkbenchTabDragPayload, event: TabDragPointerEvent) => void;
    onTabDragEnd: (payload: WorkbenchTabDragPayload, event: TabDragEndEvent) => void;
}

function createWorkbenchInstanceId(): string {
    return `ofive-workbench-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createDragId(workbenchId: string, tabId: string): string {
    return `${workbenchId}:${tabId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function toDetachedTabWindowTab(payload: WorkbenchTabDragPayload): DetachedTabWindowTab {
    return {
        id: payload.id,
        title: payload.title,
        component: payload.component,
        params: payload.params,
    };
}

function buildWindowDragPayload(params: {
    state: SourceTabDragState;
    pointer: WorkbenchTabDragPointer;
    workbenchId: string;
    windowLabel: string | null;
}): TabWindowDragEventPayload {
    return {
        dragId: params.state.dragId,
        sourceWorkbenchId: params.workbenchId,
        sourceWindowLabel: params.windowLabel,
        detachedWindowLabel: params.state.detachedWindowLabel,
        tab: {
            ...params.state.tab,
            sourceWorkbenchId: params.workbenchId,
            sourceWindowLabel: params.windowLabel,
        },
        pointer: params.pointer,
    };
}

function isSameTabDrag(
    state: SourceTabDragState | null,
    payload: WorkbenchTabDragPayload,
): state is SourceTabDragState {
    return Boolean(state && state.tab.id === payload.id && !state.cancelled);
}

export function useTabWindowDragBridge(
    options: UseTabWindowDragBridgeOptions,
): TabWindowDragBridge {
    const { workbenchApiRef, windowKind, onTabsChanged } = options;
    const [workbenchId] = useState(createWorkbenchInstanceId);
    const [windowLabel, setWindowLabel] = useState<string | null>(null);
    const windowLabelRef = useRef<string | null>(null);
    const sourceDragRef = useRef<SourceTabDragState | null>(null);

    useEffect(() => {
        let cancelled = false;
        void getCurrentOfiveWindowLabel().then((label) => {
            if (cancelled) {
                return;
            }
            windowLabelRef.current = label;
            setWindowLabel(label);
        });

        return () => {
            cancelled = true;
        };
    }, []);

    const closeSourceTab = useCallback(async (state: SourceTabDragState): Promise<void> => {
        if (state.sourceClosed) {
            return;
        }

        const api = workbenchApiRef.current;
        if (!api?.getTab(state.tab.id)) {
            state.sourceClosed = true;
            return;
        }

        api.closeTab(state.tab.id);
        state.sourceClosed = true;
        onTabsChanged?.();

        if (windowKind === "detached" && api.getTabs().length === 0) {
            await destroyCurrentOfiveWindow();
        }
    }, [onTabsChanged, windowKind, workbenchApiRef]);

    const destroyAutoDetachedWindow = useCallback(async (
        state: SourceTabDragState,
        preserveLabel?: string | null,
    ): Promise<void> => {
        const label = state.detachedWindowLabel ?? await state.detachedCreatePromise;
        if (label && label !== preserveLabel) {
            await destroyOfiveWindowByLabel(label);
        }
    }, []);

    const ensureDetachedWindowForDrag = useCallback((
        state: SourceTabDragState,
        event: TabDragPointerEvent,
    ): void => {
        if (state.detachedCreatePromise) {
            return;
        }

        const request = {
            tab: toDetachedTabWindowTab(state.tab),
            screenX: event.screenX,
            screenY: event.screenY,
        };
        state.detachedCreatePromise = createDetachedTabWindow(request)
            .then((label) => {
                if (!label) {
                    return null;
                }

                const current = sourceDragRef.current;
                if (current?.dragId !== state.dragId || current.cancelled) {
                    void destroyOfiveWindowByLabel(label);
                    return null;
                }

                current.detachedWindowLabel = label;
                return label;
            })
            .catch((error) => {
                console.warn("[tab-window-bridge] create detached tab window failed", {
                    message: error instanceof Error ? error.message : String(error),
                });
                return null;
            });
    }, []);

    const isOwnDragEvent = useCallback((payload: TabWindowDragEventPayload): boolean => (
        payload.sourceWorkbenchId === workbenchId ||
        Boolean(payload.sourceWindowLabel && payload.sourceWindowLabel === windowLabelRef.current)
    ), [workbenchId]);

    const handleIncomingDragMove = useCallback((payload: TabWindowDragEventPayload): void => {
        if (isOwnDragEvent(payload)) {
            return;
        }

        const api = workbenchApiRef.current;
        if (!api) {
            return;
        }

        if (!api.previewDraggedTab(payload.tab, payload.pointer)) {
            api.cancelDraggedTab({ id: payload.tab.id });
        }
    }, [isOwnDragEvent, workbenchApiRef]);

    const handleIncomingDragDrop = useCallback((payload: TabWindowDragEventPayload): void => {
        if (isOwnDragEvent(payload)) {
            return;
        }

        const api = workbenchApiRef.current;
        if (!api) {
            return;
        }

        const didDrop = api.dropDraggedTab(payload.tab, payload.pointer);
        if (!didDrop) {
            return;
        }

        onTabsChanged?.();
        void emitTabWindowDragAccepted({
            dragId: payload.dragId,
            tabId: payload.tab.id,
            targetWindowLabel: windowLabelRef.current,
        });
    }, [isOwnDragEvent, onTabsChanged, workbenchApiRef]);

    const handleIncomingDragCancel = useCallback((payload: TabWindowDragEventPayload): void => {
        if (isOwnDragEvent(payload)) {
            return;
        }

        workbenchApiRef.current?.cancelDraggedTab({ id: payload.tab.id });
    }, [isOwnDragEvent, workbenchApiRef]);

    const handleIncomingDragAccepted = useCallback((payload: TabWindowDragAcceptedPayload): void => {
        const state = sourceDragRef.current;
        if (!state || state.dragId !== payload.dragId || state.tab.id !== payload.tabId) {
            return;
        }

        state.cancelled = true;
        sourceDragRef.current = null;
        void closeSourceTab(state);
        void destroyAutoDetachedWindow(state, payload.targetWindowLabel);
    }, [closeSourceTab, destroyAutoDetachedWindow]);

    useEffect(() => {
        let disposed = false;
        const unlisteners: Array<() => void> = [];

        void Promise.all([
            listenTabWindowDragMove(handleIncomingDragMove),
            listenTabWindowDragDrop(handleIncomingDragDrop),
            listenTabWindowDragCancel(handleIncomingDragCancel),
            listenTabWindowDragAccepted(handleIncomingDragAccepted),
        ]).then((nextUnlisteners) => {
            if (disposed) {
                nextUnlisteners.forEach((unlisten) => unlisten());
                return;
            }
            unlisteners.push(...nextUnlisteners);
        });

        return () => {
            disposed = true;
            unlisteners.forEach((unlisten) => unlisten());
        };
    }, [
        handleIncomingDragAccepted,
        handleIncomingDragCancel,
        handleIncomingDragDrop,
        handleIncomingDragMove,
    ]);

    const handleTabDragOutside = useCallback((
        payload: WorkbenchTabDragPayload,
        event: TabDragPointerEvent,
    ): void => {
        let state = sourceDragRef.current;
        if (!isSameTabDrag(state, payload)) {
            state = {
                dragId: createDragId(workbenchId, payload.id),
                tab: payload,
                detachedWindowLabel: null,
                detachedCreatePromise: null,
                sourceClosed: false,
                cancelled: false,
            };
            sourceDragRef.current = state;
            ensureDetachedWindowForDrag(state, event);
        }

        void emitTabWindowDragMove(buildWindowDragPayload({
            state,
            pointer: event,
            workbenchId,
            windowLabel: windowLabelRef.current,
        }));
    }, [ensureDetachedWindowForDrag, workbenchId]);

    const handleTabDragInside = useCallback((
        payload: WorkbenchTabDragPayload,
        event: TabDragPointerEvent,
    ): void => {
        const state = sourceDragRef.current;
        if (!isSameTabDrag(state, payload)) {
            return;
        }

        state.cancelled = true;
        sourceDragRef.current = null;
        void emitTabWindowDragCancel(buildWindowDragPayload({
            state,
            pointer: event,
            workbenchId,
            windowLabel: windowLabelRef.current,
        }));
        void destroyAutoDetachedWindow(state);
    }, [destroyAutoDetachedWindow, workbenchId]);

    const handleTabDragEnd = useCallback((
        payload: WorkbenchTabDragPayload,
        event: TabDragEndEvent,
    ): void => {
        const state = sourceDragRef.current;
        if (!isSameTabDrag(state, payload)) {
            return;
        }

        if (event.droppedInside) {
            state.cancelled = true;
            sourceDragRef.current = null;
            void emitTabWindowDragCancel(buildWindowDragPayload({
                state,
                pointer: event,
                workbenchId,
                windowLabel: windowLabelRef.current,
            }));
            void destroyAutoDetachedWindow(state);
            return;
        }

        void (async () => {
            await emitTabWindowDragDrop(buildWindowDragPayload({
                state,
                pointer: event,
                workbenchId,
                windowLabel: windowLabelRef.current,
            }));

            const detachedLabel = state.detachedWindowLabel ?? await state.detachedCreatePromise;
            if (sourceDragRef.current?.dragId !== state.dragId) {
                return;
            }

            if (detachedLabel) {
                await closeSourceTab(state);
                sourceDragRef.current = null;
                return;
            }
            window.setTimeout(() => {
                if (sourceDragRef.current?.dragId === state.dragId) {
                    sourceDragRef.current = null;
                }
            }, 600);
        })();
    }, [closeSourceTab, destroyAutoDetachedWindow, workbenchId]);

    return {
        workbenchId,
        windowLabel,
        onTabDragOutside: handleTabDragOutside,
        onTabDragInside: handleTabDragInside,
        onTabDragEnd: handleTabDragEnd,
    };
}
