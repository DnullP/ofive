import type { ReactNode } from "react";
import {
    MarkdownReadView as ObeditorMarkdownReadView,
    revealMarkdownReadViewLine,
    shouldKeepReadModeWikiLinkPreviewHovered,
} from "obeditor";
import { createOfiveEditorCapabilities } from "../../../host/editor/ofiveEditorCapabilities";
import type { WorkbenchContainerApi } from "../../../host/layout/workbenchContracts";

export {
    revealMarkdownReadViewLine,
    shouldKeepReadModeWikiLinkPreviewHovered,
};

interface MarkdownReadViewProps {
    /** 阅读态 Markdown 正文。 */
    content: string;
    /** 当前文件相对路径。 */
    currentFilePath: string;
    /** Workbench 容器 API。 */
    containerApi: WorkbenchContainerApi;
    /** 阅读态中需要滚动定位的原始行号。 */
    initialRevealLine?: number | null;
}

export function MarkdownReadView(props: MarkdownReadViewProps): ReactNode {
    return (
        <ObeditorMarkdownReadView
            capabilities={createOfiveEditorCapabilities({
                containerApi: props.containerApi,
                getCurrentFilePath: () => props.currentFilePath,
                getCurrentDocumentContent: () => props.content,
            })}
            content={props.content}
            currentFilePath={props.currentFilePath}
            initialRevealLine={props.initialRevealLine}
        />
    );
}
