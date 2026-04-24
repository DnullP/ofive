export type EditorTabRestoreMode = "viewport" | "cursor";

export function isEditorTabRestoreMode(value: unknown): value is EditorTabRestoreMode {
    return value === "viewport" || value === "cursor";
}