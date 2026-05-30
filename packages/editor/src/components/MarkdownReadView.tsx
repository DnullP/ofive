import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

export interface MarkdownReadViewProps {
  content: string;
}

export function MarkdownReadView({ content }: MarkdownReadViewProps) {
  return (
    <article className="oe-read-view">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
        {content}
      </ReactMarkdown>
    </article>
  );
}
