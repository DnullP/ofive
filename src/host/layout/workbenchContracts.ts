import type { ReactNode } from "react";
import type { CommandId } from "../commands/commandSystem";

export type PanelPosition = "left" | "right";

export interface WorkbenchPanelApi {
    close?(): void;
    setActive(): void;
    setTitle?(title: string): void;
    updateParameters?(params: Record<string, unknown>): void;
    markContentReady?(): void;
}

export interface WorkbenchPanelHandle {
    id: string;
    params?: Record<string, unknown>;
    api: WorkbenchPanelApi;
}

export interface WorkbenchContainerApi {
    getPanel(panelId: string): WorkbenchPanelHandle | undefined | null;
    panels?: WorkbenchPanelHandle[];
    addPanel(options: {
        id: string;
        title: string;
        component: string;
        params?: Record<string, unknown>;
    }): void;
}

export interface WorkbenchTabApi {
    id: string;
    close(): void;
    setActive(): void;
    setTitle?(title: string): void;
    updateParameters?(params: Record<string, unknown>): void;
    markContentReady?(): void;
}

export interface WorkbenchTabProps<TParams extends Record<string, unknown> = Record<string, unknown>> {
    params: TParams;
    api: WorkbenchTabApi;
    containerApi: WorkbenchContainerApi;
}

export interface TabComponentDefinition {
    key: string;
    component: (props: WorkbenchTabProps<Record<string, unknown>>) => ReactNode;
}

export interface TabInstanceDefinition {
    id: string;
    title: string;
    component: string;
    params?: Record<string, unknown>;
}

export interface ConvertiblePanelRenderState {
    descriptorId: string;
    mode: "panel";
    panelId: string;
    stateKey: string;
    sourceParams?: Record<string, unknown>;
    sourceTabId?: string;
}

export interface PanelRenderContext {
    activeTabId: string | null;
    workbenchApi: WorkbenchContainerApi | null;
    hostPanelId: string | null;
    convertibleView: ConvertiblePanelRenderState | null;
    openTab: (tab: TabInstanceDefinition) => void;
    openFile: (options: {
        relativePath: string;
        contentOverride?: string;
        preferredOpenerId?: string;
    }) => Promise<void>;
    closeTab: (tabId: string) => void;
    setActiveTab: (tabId: string) => void;
    activatePanel: (panelId: string) => void;
    markContentReady?: () => void;
    executeCommand: (commandId: CommandId) => void;
    requestMoveFileToDirectory: (relativePath: string) => void;
}

export interface PanelDefinition {
    id: string;
    title: string;
    icon?: ReactNode;
    position?: PanelPosition;
    order?: number;
    activityId?: string;
    activityTitle?: string;
    activityIcon?: ReactNode;
    activitySection?: "top" | "bottom";
    deferPresentationUntilReady?: boolean;
    render: (context: PanelRenderContext) => ReactNode;
}