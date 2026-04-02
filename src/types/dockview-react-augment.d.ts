import type { IDockviewPanel } from "dockview";

export type DockviewMovePanelCommitEvent = {
    panel: IDockviewPanel;
    from: {
        id: string;
    };
};

declare module "dockview" {
    interface IDockviewReactProps {
        onDidMovePanel?: (event: DockviewMovePanelCommitEvent) => void;
    }
}