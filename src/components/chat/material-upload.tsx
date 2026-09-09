"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ProcessingStatus, type MaterialUiState } from "./processing-status";
import { MaterialUploadClientError, uploadMaterialFile, type MaterialUploadStage } from "./material-upload-client";
import { createLocalMaterialPreview, MAX_LOCAL_MATERIAL_BYTES, scheduleMaterialRefresh } from "./material-upload-state";

interface MaterialItem {
  id: string;
  name: string;
  size: number;
  state: MaterialUiState;
  file?: File | undefined;
  materialId?: string;
  retryRequested?: boolean | undefined;
  error?: string | undefined;
}

interface MaterialSummary {
  materialId: string;
  originalFilename: string | null;
  declaredBytes: number;
  processingState: string;
}

const retryableStates = new Set<MaterialUiState>(["quarantined", "saved_unread", "scan_failed"]);

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
    return [{
      materialId: item.materialId,
      originalFilename: item.originalFilename as string | null,
      declaredBytes: item.declaredBytes as number,
      processingState: item.processingState,
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
}: {
  caseId?: string | undefined;
  onPendingChange?: (pending: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadingIdsRef = useRef(new Set<string>());
  const [materials, setMaterials] = useState<MaterialItem[]>([]);
  const [error, setError] = useState<string>();

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
        const refreshed = summaries.map((summary): MaterialItem => ({
          id: summary.materialId,
          materialId: summary.materialId,
          name: summary.originalFilename ?? "未命名材料",
          size: summary.declaredBytes,
          state: toMaterialUiState(summary.processingState),
        }));
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
    onPendingChange?.(materials.some((material) => material.state === "uploading" || material.state === "scanning"));
  }, [materials, onPendingChange]);

  useEffect(() => {
    return scheduleMaterialRefresh(() => { void refreshMaterials(); });
  }, [refreshMaterials]);

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
      return { ...preview, file };
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
