import type { ReactNode } from "react";
import { FilePlus2, FolderOpen, Search, Shuffle } from "lucide-react";
import i18n from "../../i18n";

export interface WorkbenchHomeEmptyStateProps {
    vaultLabel: string;
    markdownNoteCount: number;
    isVaultLoading: boolean;
    canCreateNote: boolean;
    canOpenRandomNote: boolean;
    onCreateNote: () => void;
    onOpenRandomNote: () => void;
    onOpenVault: () => void;
}

export function WorkbenchHomeEmptyState(props: WorkbenchHomeEmptyStateProps): ReactNode {
    const noteCountLabel = props.markdownNoteCount === 1
        ? i18n.t("app.homeNoteCountOne")
        : i18n.t("app.homeNoteCount", { count: props.markdownNoteCount });

    return (
        <div className="workbench-home-empty" role="region" aria-label={i18n.t("app.homeAriaLabel")}>
            <div className="workbench-home-empty__inner">
                <div className="workbench-home-empty__hero">
                    <div className="workbench-home-empty__eyebrow">{i18n.t("app.homeEyebrow")}</div>
                    <h1>{i18n.t("app.homeTitle")}</h1>
                    <p>{i18n.t("app.homeDescription")}</p>
                    <div className="workbench-home-empty__actions" aria-label={i18n.t("app.homeQuickStartLabel")}>
                        <button
                            type="button"
                            className="workbench-home-empty__button workbench-home-empty__button--primary"
                            onClick={props.onCreateNote}
                            disabled={!props.canCreateNote}
                        >
                            <FilePlus2 size={16} strokeWidth={1.9} aria-hidden="true" />
                            <span>{i18n.t("app.homeCreateNote")}</span>
                        </button>
                        <button
                            type="button"
                            className="workbench-home-empty__button"
                            onClick={props.onOpenRandomNote}
                            disabled={!props.canOpenRandomNote}
                        >
                            <Shuffle size={16} strokeWidth={1.9} aria-hidden="true" />
                            <span>{i18n.t("app.homeRandomNote")}</span>
                        </button>
                        <button
                            type="button"
                            className="workbench-home-empty__button"
                            onClick={props.onOpenVault}
                        >
                            <FolderOpen size={16} strokeWidth={1.9} aria-hidden="true" />
                            <span>{i18n.t("app.homeOpenVault")}</span>
                        </button>
                    </div>
                    <div className="workbench-home-empty__status" aria-live="polite">
                        <span>{props.vaultLabel}</span>
                        <span>{props.isVaultLoading ? i18n.t("app.homeLoadingVault") : noteCountLabel}</span>
                    </div>
                </div>
                <div className="workbench-home-empty__guide" aria-label={i18n.t("app.homeGuideLabel")}>
                    <div className="workbench-home-empty__guide-item">
                        <FolderOpen size={17} strokeWidth={1.8} aria-hidden="true" />
                        <div>
                            <strong>{i18n.t("app.homeGuideOpenTitle")}</strong>
                            <span>{i18n.t("app.homeGuideOpenDesc")}</span>
                        </div>
                    </div>
                    <div className="workbench-home-empty__guide-item">
                        <FilePlus2 size={17} strokeWidth={1.8} aria-hidden="true" />
                        <div>
                            <strong>{i18n.t("app.homeGuideWriteTitle")}</strong>
                            <span>{i18n.t("app.homeGuideWriteDesc")}</span>
                        </div>
                    </div>
                    <div className="workbench-home-empty__guide-item">
                        <Search size={17} strokeWidth={1.8} aria-hidden="true" />
                        <div>
                            <strong>{i18n.t("app.homeGuideExploreTitle")}</strong>
                            <span>{i18n.t("app.homeGuideExploreDesc")}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
