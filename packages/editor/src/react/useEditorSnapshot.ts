import { useSyncExternalStore } from "react";
import type { EditorService, EditorSnapshot } from "../core/types";

export function useEditorSnapshot(service: EditorService): EditorSnapshot {
  return useSyncExternalStore(
    (listener) => service.subscribe(listener),
    () => service.getSnapshot(),
    () => service.getSnapshot(),
  );
}
