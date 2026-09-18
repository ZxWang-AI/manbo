import type { MaterialUiState } from "./processing-status";

export const MAX_LOCAL_MATERIAL_BYTES = 100 * 1024 * 1024;
export const MAX_MATERIAL_REFRESH_INTERVAL_MS = 60_000;

export interface LocalMaterialPreviewInput {
  name: string;
  size: number;
  lastModified: number;
  index: number;
}

export interface LocalMaterialPreview {
  id: string;
  name: string;
  size: number;
  state: MaterialUiState;
}

export function createLocalMaterialPreview(input: LocalMaterialPreviewInput): LocalMaterialPreview {
  return {
    id: `${input.name}-${input.lastModified}-${input.index}`,
    name: input.name,
    size: input.size,
    state: input.size > MAX_LOCAL_MATERIAL_BYTES ? "rejected_size" : "local_preview",
  };
}

export interface MaterialRefreshScheduleOptions {
  intervalMs?: number;
}

export function scheduleMaterialRefresh(
  refresh: () => void,
  options: MaterialRefreshScheduleOptions = {},
): () => void {
  const intervalMs = options.intervalMs;
  if (
    intervalMs !== undefined &&
    (!Number.isInteger(intervalMs) || intervalMs <= 0 || intervalMs > MAX_MATERIAL_REFRESH_INTERVAL_MS)
  ) {
    throw new TypeError(`intervalMs must be an integer between 1 and ${MAX_MATERIAL_REFRESH_INTERVAL_MS}`);
  }

  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = () => {
    if (cancelled) return;
    refresh();
    if (!cancelled && intervalMs !== undefined) timer = setTimeout(run, intervalMs);
  };

  timer = setTimeout(run, 0);
  return () => {
    cancelled = true;
    if (timer !== undefined) clearTimeout(timer);
  };
}
