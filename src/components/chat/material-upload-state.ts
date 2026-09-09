import type { MaterialUiState } from "./processing-status";

export const MAX_LOCAL_MATERIAL_BYTES = 100 * 1024 * 1024;

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

export function scheduleMaterialRefresh(refresh: () => void): () => void {
  const timer = setTimeout(refresh, 0);
  return () => clearTimeout(timer);
}
