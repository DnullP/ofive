export type WorkbenchLayoutMode = "dockview" | "layout-v2";

const WORKBENCH_LAYOUT_MODE_QUERY_KEY = "layoutEngine";

function normalizeWorkbenchLayoutMode(value: string | null | undefined): WorkbenchLayoutMode | null {
    if (value === "dockview" || value === "layout-v2") {
        return value;
    }

    return null;
}

export function readWorkbenchLayoutMode(): WorkbenchLayoutMode {
    const envMode = normalizeWorkbenchLayoutMode(import.meta.env.VITE_WORKBENCH_LAYOUT_MODE);
    if (envMode) {
        return envMode;
    }

    if (typeof window === "undefined") {
        return "layout-v2";
    }

    const searchParams = new URLSearchParams(window.location.search);
    return normalizeWorkbenchLayoutMode(searchParams.get(WORKBENCH_LAYOUT_MODE_QUERY_KEY)) ?? "layout-v2";
}

export function isLayoutV2WorkbenchMode(): boolean {
    return readWorkbenchLayoutMode() === "layout-v2";
}