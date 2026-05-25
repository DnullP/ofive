import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

const WorkbenchOverlayLayerContext = createContext<HTMLElement | null>(null);

export interface WorkbenchOverlayLayerProviderProps {
    children: ReactNode;
    target: HTMLElement | null;
}

export function WorkbenchOverlayLayerProvider(props: WorkbenchOverlayLayerProviderProps): ReactNode {
    return (
        <WorkbenchOverlayLayerContext.Provider value={props.target}>
            {props.children}
        </WorkbenchOverlayLayerContext.Provider>
    );
}

export function useWorkbenchOverlayLayer(): HTMLElement | null {
    return useContext(WorkbenchOverlayLayerContext);
}

export interface WorkbenchOverlayPortalProps {
    children: ReactNode;
    interactive?: boolean;
}

export function WorkbenchOverlayPortal(props: WorkbenchOverlayPortalProps): ReactNode {
    const target = useWorkbenchOverlayLayer();
    if (!target) {
        return null;
    }

    return createPortal(
        <div
            data-workbench-overlay-portal="true"
            data-workbench-overlay-interactive={props.interactive === true ? "true" : undefined}
        >
            {props.children}
        </div>,
        target,
    );
}

export interface OptionalWorkbenchOverlayPortalProps extends WorkbenchOverlayPortalProps {
    fallback?: ReactNode;
}

export function OptionalWorkbenchOverlayPortal(props: OptionalWorkbenchOverlayPortalProps): ReactNode {
    const target = useWorkbenchOverlayLayer();
    if (!target) {
        return props.fallback ?? props.children;
    }

    return createPortal(
        <div
            data-workbench-overlay-portal="true"
            data-workbench-overlay-interactive={props.interactive === true ? "true" : undefined}
        >
            {props.children}
        </div>,
        target,
    );
}
