import {
  Bold,
  CheckSquare,
  Code,
  Columns2,
  Edit3,
  Eye,
  Italic,
  Link,
  Save,
  SplitSquareHorizontal,
  Table,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { EditorCommandDescriptor, EditorMode, EditorService } from "../core/types";
import { useEditorSnapshot } from "../react/useEditorSnapshot";

const commandIcons: Record<string, LucideIcon> = {
  bold: Bold,
  italic: Italic,
  code: Code,
  link: Link,
  table: Table,
  "check-square": CheckSquare,
};

function CommandButton({
  command,
  service,
}: {
  command: EditorCommandDescriptor;
  service: EditorService;
}) {
  const Icon = command.icon ? commandIcons[command.icon] : null;
  return (
    <button
      type="button"
      className="oe-toolbar-button"
      title={command.label}
      disabled={!command.enabled}
      onClick={() => void service.executeCommand(command.id)}
    >
      {Icon ? <Icon size={16} /> : <span>{command.label}</span>}
    </button>
  );
}

function ModeButton({
  mode,
  activeMode,
  service,
  label,
  Icon,
}: {
  mode: EditorMode;
  activeMode: EditorMode;
  service: EditorService;
  label: string;
  Icon: LucideIcon;
}) {
  return (
    <button
      type="button"
      className="oe-toolbar-button"
      aria-pressed={activeMode === mode}
      title={label}
      onClick={() => service.setMode(mode)}
    >
      <Icon size={16} />
    </button>
  );
}

export interface EditorToolbarProps {
  service: EditorService;
}

export function EditorToolbar({ service }: EditorToolbarProps) {
  const snapshot = useEditorSnapshot(service);
  const formatCommands = snapshot.commands.filter((command) => command.group === "format");
  const insertCommands = snapshot.commands.filter((command) => command.group === "insert");

  return (
    <div className="oe-toolbar">
      <div className="oe-toolbar-section">
        <ModeButton mode="edit" activeMode={snapshot.mode} service={service} label="Edit" Icon={Edit3} />
        <ModeButton mode="read" activeMode={snapshot.mode} service={service} label="Read" Icon={Eye} />
        <ModeButton mode="split" activeMode={snapshot.mode} service={service} label="Split" Icon={SplitSquareHorizontal} />
      </div>
      <div className="oe-toolbar-section">
        {formatCommands.map((command) => (
          <CommandButton key={command.id} command={command} service={service} />
        ))}
      </div>
      <div className="oe-toolbar-section">
        {insertCommands.map((command) => (
          <CommandButton key={command.id} command={command} service={service} />
        ))}
      </div>
      <div className="oe-toolbar-spacer" />
      <div className="oe-toolbar-title" title={snapshot.document.path ?? snapshot.document.title}>
        <Columns2 size={15} />
        <span>{snapshot.document.title}</span>
      </div>
      <button
        type="button"
        className="oe-toolbar-button oe-toolbar-save"
        title="Save"
        disabled={snapshot.status === "saving" || !snapshot.dirty}
        onClick={() => void service.save()}
      >
        <Save size={16} />
      </button>
    </div>
  );
}
