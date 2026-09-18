"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ProcessingStatus, type MaterialUiState } from "./processing-status";
import { MaterialUploadClientError, uploadMaterialFile, type MaterialUploadStage } from "./material-upload-client";
import { createLocalMaterialPreview, MAX_LOCAL_MATERIAL_BYTES, scheduleMaterialRefresh } from "./material-upload-state";
import type { MaterialSourceLabel } from "../case-review/source-trace";

interface MaterialItem {
  id: string;
  name: string;
  size: number;
  state: MaterialUiState;
  file?: File | undefined;
  materialId?: string;
  retryRequested?: boolean | undefined;
  error?: string | undefined;
  aiContentRefs: string[];
  selectedForAi?: boolean | undefined;
}

interface MaterialSummary {
  materialId: string;
  originalFilename: string | null;
  declaredBytes: number;
  processingState: string;
  aiContentRefs: string[];
}

export function collectSelectedContentRefs(
  materials: ReadonlyArray<{ selectedForAi?: boolean | undefined; aiContentRefs: readonly string[] }>,
): string[] {
  return [...new Set(materials.flatMap((material) => material.selectedForAi ? material.aiContentRefs : []))];
}

const retryableStates = new Set<MaterialUiState>(["quarantined", "saved_unread", "scan_failed"]);
const processingStates = new Set<MaterialUiState>(["uploading", "scanning", "parse_queued"]);
const MATERIAL_REFRESH_INTERVAL_MS = 3_000;

export function readMaterialSummaries(payload: unknown): MaterialSummary[] | null {
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { materials?: unknown }).materials)) return null;
  const summaries = (payload as { materials: unknown[] }).materials.flatMap((material) => {
    if (!material || typeof material !== "object") return [];
    const item = material as Record<string, unknown>;
    if (
      typeof item.materialId !== "string" ||
      typeof item.originalFilename !== "string" && item.originalFilename !== null ||
      !Number.isSafeInteger(item.declaredBytes) ||
      (item.declaredBytes as number) <= 0 ||
      typeof item.processingState !== "string"
    ) return [];
    const aiContentRefs = item.aiContentRefs === undefined
      ? []
      : Array.isArray(item.aiContentRefs)
        && item.aiContentRefs.every((ref) => typeof ref === "string" && /^derived\/[A-Za-z0-9._-]{1,160}$/u.test(ref))
        ? item.aiContentRefs as string[]
        : null;
    if (!aiContentRefs) return [];
    return [{
      materialId: item.materialId,
      originalFilename: item.originalFilename as string | null,
      declaredBytes: item.declaredBytes as number,
      processingState: item.processingState,
      aiContentRefs,
    }];
  });
  return summaries.length === (payload as { materials: unknown[] }).materials.length ? summaries : null;
}

function toMaterialUiState(processingState: string): MaterialUiState {
  switch (processingState) {
    case "quarantined":
    case "scanning":
    case "saved_unread":
    case "parse_queued":
    case "parsed":
    case "blocked_malicious":
    case "scan_failed":
      return processingState;
    default:
      return "status_unavailable";
  }
}

export function MaterialUpload({
  caseId,
  onPendingChange,
  onAiContentRefsChange,
  onMaterialSourcesChange,
}: {
  caseId?: string | undefined;
  onPendingChange?: (pending: boolean) => void;
  onAiContentRefsChange?: (contentRefs: string[]) => void;
  onMaterialSourcesChange?: (sources: MaterialSourceLabel[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadingIdsRef = useRef(new Set<string>());
  const [materials, setMaterials] = useState<MaterialItem[]>([]);
  const [error, setError] = useState<string>();
  const hasProcessingPending = materials.some((material) => processingStates.has(material.state));
  // Keep the derived array referentially stable while the material state is
  // unchanged. The parent receives it from an effect; returning a fresh array
  // on every render would cause that effect to update the parent forever.
  const selectedContentRefs = useMemo(() => collectSelectedContentRefs(materials), [materials]);
  const materialSources = useMemo(() => {
    const sources = new Map<string, MaterialSourceLabel>();
    for (const material of materials) {
      for (const contentRef of material.aiContentRefs) {
        sources.set(contentRef, {
          contentRef,
          name: material.name,
          state: material.state,
        });
      }
    }
    return [...sources.values()];
  }, [materials]);

  function updateMaterial(id: string, patch: Partial<MaterialItem>) {
    setMaterials((current) => current.map((material) => material.id === id ? { ...material, ...patch } : material));
  }

  const refreshMaterials = useCallback(async () => {
    if (!caseId) return;
    try {
      const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/materials`, { cache: "no-store" });
      if (!response.ok) return;
      const summaries = readMaterialSummaries(await response.json().catch(() => null));
      if (!summaries) return;
      setMaterials((current) => {
        const serverMaterialIds = new Set(summaries.map(({ materialId }) => materialId));
        const localOnly = current.filter((material) => !material.materialId || !serverMaterialIds.has(material.materialId));
        const refreshed = summaries.map((summary): MaterialItem => {
          const previous = current.find((item) => item.materialId === summary.materialId);
          const state = toMaterialUiState(summary.processingState);
          // A retry acknowledgement can race with the first poll, which may
          // still return the pre-retry state. Keep the acknowledgement while
          // the server reports a retryable or in-progress state, but clear it
          // once processing reaches a terminal/non-retryable state.
          const retryRequested = previous?.retryRequested === true
            && (retryableStates.has(state) || processingStates.has(state));
          return {
            id: summary.materialId,
            materialId: summary.materialId,
            name: summary.originalFilename ?? "未命名材料",
            size: summary.declaredBytes,
            state,
            aiContentRefs: summary.aiContentRefs,
            selectedForAi: previous?.selectedForAi === true && summary.aiContentRefs.length > 0,
            ...(retryRequested ? { retryRequested: true } : {}),
          };
        });
        return [...localOnly, ...refreshed];
      });
    } catch {
      // The material list is a convenience view. Do not replace a known local
      // state with an unverified error, and never imply that a material is AI-ready.
    }
  }, [caseId]);

  const uploadOne = useCallback(async (material: MaterialItem, ownerCaseId: string) => {
    if (
      material.state !== "local_preview" ||
      !material.file ||
      material.file.size > MAX_LOCAL_MATERIAL_BYTES ||
      uploadingIdsRef.current.has(material.id)
    ) return;
    uploadingIdsRef.current.add(material.id);
    try {
      const result = await uploadMaterialFile(material.file, ownerCaseId, {
        onStage: (stage: MaterialUploadStage) => updateMaterial(material.id, { state: stage, error: undefined }),
      });
      updateMaterial(material.id, { state: "saved_unread", materialId: result.materialId, error: undefined });
      void refreshMaterials();
    } catch (caught) {
      const message = caught instanceof MaterialUploadClientError
        ? caught.message
        : "材料上传失败，请稍后重试。";
      updateMaterial(material.id, { state: "upload_failed", error: message });
    } finally {
      uploadingIdsRef.current.delete(material.id);
    }
  }, [refreshMaterials]);

  const retryMaterial = useCallback(async (material: MaterialItem) => {
    if (!caseId || !material.materialId || !retryableStates.has(material.state)) return;
    updateMaterial(material.id, { error: undefined, retryRequested: false });
    try {
      const response = await fetch(
        `/api/cases/${encodeURIComponent(caseId)}/materials/${encodeURIComponent(material.materialId)}/process`,
        { method: "POST" },
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { message?: unknown } | null;
        throw new Error(typeof payload?.message === "string" ? payload.message : "材料重新处理暂时不可用，请稍后重试。");
      }
      updateMaterial(material.id, { state: "scanning", retryRequested: true });
    } catch (caught) {
      updateMaterial(material.id, {
        error: caught instanceof Error ? caught.message : "材料重新处理暂时不可用，请稍后重试。",
      });
    }
  }, [caseId]);

  useEffect(() => {
    onPendingChange?.(hasProcessingPending);
  }, [hasProcessingPending, onPendingChange]);

  useEffect(() => {
    onAiContentRefsChange?.(selectedContentRefs);
  }, [onAiContentRefsChange, selectedContentRefs]);

  useEffect(() => {
    onMaterialSourcesChange?.(materialSources);
  }, [materialSources, onMaterialSourcesChange]);

  useEffect(() => {
    if (!caseId) return;
    return scheduleMaterialRefresh(
      () => { void refreshMaterials(); },
      hasProcessingPending ? { intervalMs: MATERIAL_REFRESH_INTERVAL_MS } : undefined,
    );
  }, [caseId, hasProcessingPending, refreshMaterials]);

  useEffect(() => {
    if (!caseId) return;
    const pending = materials.filter((material) => material.state === "local_preview");
    if (pending.length === 0) return;
    const timer = window.setTimeout(() => {
      for (const material of pending) void uploadOne(material, caseId);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [caseId, materials, uploadOne]);

  function addFiles(fileList: FileList | null) {
    if (!fileList) return;
    setError(undefined);
    const next = Array.from(fileList).map((file, index) => {
      const preview = createLocalMaterialPreview({
        name: file.name,
        size: file.size,
        lastModified: file.lastModified,
        index: materials.length + index,
      });
      return { ...preview, file, aiContentRefs: [] };
    });
    setMaterials((current) => [...current, ...next]);
    if (next.some((item) => item.size > MAX_LOCAL_MATERIAL_BYTES)) {
      setError("单个材料不能超过 100 MB；超出限制的文件不会进入 AI。");
    }
  }

  return (
    <section className="material-upload" aria-labelledby="materials-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">MATERIALS</p>
          <h2 id="materials-title">材料</h2>
        </div>
        <button type="button" className="secondary-button" onClick={() => inputRef.current?.click()}>
          添加材料
        </button>
      </div>
      <input
        ref={inputRef}
        className="sr-only"
        type="file"
        multiple
        aria-label="添加材料"
        onChange={(event) => addFiles(event.target.files)}
      />
      <p className="section-copy">
        {caseId
          ? "材料会通过私有加密通道上传，并在安全扫描完成前不会进入 AI。你可以继续补充材料。"
          : "请先开始对话或保存私密档案。档案创建前，文件只保留在本地预览，不会上传或进入 AI。"}
      </p>
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
      {materials.length === 0 ? (
        <p className="empty-state">还没有添加材料。你可以先对话，之后再补充。</p>
      ) : (
        <ul className="material-list">
          {materials.map((material) => (
            <li key={material.id} className="material-item">
              <div>
                <strong>{material.name}</strong>
                <span>{(material.size / 1024 / 1024).toFixed(1)} MB</span>
                {material.error ? <span className="inline-error" role="alert">{material.error}</span> : null}
                {material.state === "parsed" && material.aiContentRefs.length > 0 ? (
                  <label className="material-ai-toggle">
                    <input
                      type="checkbox"
                      checked={material.selectedForAi === true}
                      aria-label={`将${material.name}用于本轮 AI`}
                      onChange={(event) => {
                        const selected = event.target.checked;
                        updateMaterial(material.id, { selectedForAi: selected });
                      }}
                    />
                    用于本轮 AI（仅发送安全解析文本）
                  </label>
                ) : null}
              </div>
              <div className="material-item__actions">
                <ProcessingStatus state={material.state} />
                {material.retryRequested ? <span className="material-retry-note" role="status">已请求重新处理</span> : null}
                {material.state === "upload_failed" && caseId ? (
                  <button type="button" className="message-action" onClick={() => {
                    updateMaterial(material.id, { state: "local_preview", error: undefined });
                  }}>
                    重试
                  </button>
                ) : null}
                {caseId && material.materialId && retryableStates.has(material.state) ? (
                  <button type="button" className="message-action" onClick={() => { void retryMaterial(material); }}>
                    重新处理材料
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
