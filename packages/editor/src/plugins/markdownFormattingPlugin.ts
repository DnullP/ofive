import type { EditorCommand, EditorPlugin } from "../core/types";

function replaceSelection(command: {
  label: string;
  left: string;
  right?: string;
  placeholder?: string;
}): EditorCommand["run"] {
  return ({ view }) => {
    if (!view) {
      return;
    }

    const right = command.right ?? command.left;
    const selection = view.state.selection.main;
    const selectedText = view.state.sliceDoc(selection.from, selection.to);
    const content = selectedText || command.placeholder || command.label.toLowerCase();
    const insert = `${command.left}${content}${right}`;
    const cursorFrom = selection.from + command.left.length;
    const cursorTo = cursorFrom + content.length;

    view.dispatch({
      changes: {
        from: selection.from,
        to: selection.to,
        insert,
      },
      selection: {
        anchor: cursorFrom,
        head: cursorTo,
      },
      scrollIntoView: true,
    });
    view.focus();
  };
}

const commands: EditorCommand[] = [
  {
    id: "markdown.bold",
    label: "Bold",
    group: "format",
    icon: "bold",
    run: replaceSelection({ label: "Bold", left: "**", placeholder: "bold" }),
  },
  {
    id: "markdown.italic",
    label: "Italic",
    group: "format",
    icon: "italic",
    run: replaceSelection({ label: "Italic", left: "*", placeholder: "italic" }),
  },
  {
    id: "markdown.inlineCode",
    label: "Inline code",
    group: "format",
    icon: "code",
    run: replaceSelection({ label: "Code", left: "`", placeholder: "code" }),
  },
  {
    id: "markdown.link",
    label: "Link",
    group: "insert",
    icon: "link",
    run: replaceSelection({ label: "Link", left: "[", right: "](https://example.com)", placeholder: "link" }),
  },
  {
    id: "markdown.task",
    label: "Task",
    group: "insert",
    icon: "check-square",
    run: ({ view }) => {
      if (!view) {
        return;
      }
      const line = view.state.doc.lineAt(view.state.selection.main.from);
      view.dispatch({
        changes: {
          from: line.from,
          insert: "- [ ] ",
        },
        selection: {
          anchor: line.from + 6,
        },
      });
      view.focus();
    },
  },
  {
    id: "markdown.table",
    label: "Table",
    group: "insert",
    icon: "table",
    run: ({ view }) => {
      if (!view) {
        return;
      }
      const insert = "\n| Column A | Column B |\n| --- | --- |\n| value | value |\n";
      const at = view.state.selection.main.from;
      view.dispatch({
        changes: { from: at, insert },
        selection: { anchor: at + insert.length },
        scrollIntoView: true,
      });
      view.focus();
    },
  },
];

export function createMarkdownFormattingPlugin(): EditorPlugin {
  return {
    id: "markdown-formatting",
    setup() {
      return { commands };
    },
  };
}
