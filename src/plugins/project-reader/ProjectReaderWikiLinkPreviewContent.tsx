import type { ReactNode } from "react";
import type { ProjectReaderWikiLinkPreview } from "./projectReaderLinks";
import { highlightProjectCodeLine } from "./projectReaderHighlight";
import "./projectReaderPlugin.css";

interface ProjectReaderWikiLinkPreviewContentProps {
    preview: ProjectReaderWikiLinkPreview;
}

export function ProjectReaderWikiLinkPreviewContent(
    props: ProjectReaderWikiLinkPreviewContentProps,
): ReactNode {
    const language = props.preview.language ?? "plaintext";

    return (
        <div className="project-reader-wikilink-preview">
            {props.preview.snippetLines.map((line) => (
                <div
                    key={line.lineNumber}
                    className={[
                        "project-reader-wikilink-preview__line",
                        line.isTargetLine ? "is-target-line" : "",
                    ].filter(Boolean).join(" ")}
                    data-line-number={String(line.lineNumber)}
                >
                    <span className="project-reader-wikilink-preview__gutter">
                        {line.lineNumber}
                    </span>
                    <code
                        className={`project-reader-wikilink-preview__code language-${language}`}
                        dangerouslySetInnerHTML={{
                            __html: highlightProjectCodeLine(line.text, language),
                        }}
                    />
                </div>
            ))}
        </div>
    );
}
