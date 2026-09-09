export type MaterialUiState =
  | "local_preview"
  | "rejected_size"
  | "uploading"
  | "upload_failed"
  | "quarantined"
  | "scanning"
  | "saved_unread"
  | "parse_queued"
  | "parsed"
  | "blocked_malicious"
  | "scan_failed"
  | "status_unavailable";

const labels: Record<MaterialUiState, string> = {
  local_preview: "本地预览，尚未上传",
  rejected_size: "文件超过 100 MB，未添加",
  uploading: "正在上传",
  upload_failed: "上传失败，可重试",
  quarantined: "已隔离，等待安全检查",
  scanning: "正在安全扫描",
  saved_unread: "已保存、尚未读取",
  parse_queued: "正在安全解析",
  parsed: "已安全解析，可供 AI 整理",
  blocked_malicious: "已隔离，不能使用",
  scan_failed: "扫描未完成，可安全重试",
  status_unavailable: "处理状态暂不可用；不会进入 AI",
};

export function ProcessingStatus({ state }: { state: MaterialUiState }) {
  return (
    <span className={`processing-status processing-status--${state}`} role="status">
      <span className="processing-status__dot" aria-hidden="true" />
      {labels[state]}
    </span>
  );
}
