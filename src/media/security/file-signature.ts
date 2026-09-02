import path from "node:path";

import type { MaterialSignatureStatus } from "@/domain/material";

export interface FileSignatureInput {
  declaredMime: string | null;
  originalFilename: string;
  bytes: Uint8Array;
}

export interface FileSignatureResult {
  declaredMime: string | null;
  detectedMime: string | null;
  signatureStatus: MaterialSignatureStatus;
  dangerous: boolean;
  container: "pdf" | "image" | "archive" | "audio" | "executable" | "unknown";
}

const executableExtensions = new Set([".exe", ".dll", ".scr", ".bat", ".cmd", ".com", ".js", ".vbs", ".ps1", ".sh"]);

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function detectMagic(bytes: Uint8Array): Pick<FileSignatureResult, "detectedMime" | "container" | "dangerous"> {
  if (startsWith(bytes, [0x4d, 0x5a])) {
    return { detectedMime: "application/vnd.microsoft.portable-executable", container: "executable", dangerous: true };
  }
  if (new TextDecoder().decode(bytes.subarray(0, 16)).startsWith("%PDF-")) {
    return { detectedMime: "application/pdf", container: "pdf", dangerous: false };
  }
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { detectedMime: "image/png", container: "image", dangerous: false };
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return { detectedMime: "image/jpeg", container: "image", dangerous: false };
  }
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])) {
    return { detectedMime: "application/zip", container: "archive", dangerous: false };
  }
  if (startsWith(bytes, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07])) {
    return { detectedMime: "application/vnd.rar", container: "archive", dangerous: false };
  }
  if (startsWith(bytes, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) {
    return { detectedMime: "application/x-7z-compressed", container: "archive", dangerous: false };
  }
  if (startsWith(bytes, [0x49, 0x44, 0x33]) || startsWith(bytes, [0xff, 0xfb])) {
    return { detectedMime: "audio/mpeg", container: "audio", dangerous: false };
  }
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && new TextDecoder().decode(bytes.subarray(8, 12)) === "WAVE") {
    return { detectedMime: "audio/wav", container: "audio", dangerous: false };
  }
  return { detectedMime: null, container: "unknown", dangerous: false };
}

export function detectFileSignature(input: FileSignatureInput): FileSignatureResult {
  const magic = detectMagic(input.bytes);
  const extension = path.extname(input.originalFilename).toLowerCase();
  const dangerous = magic.dangerous || executableExtensions.has(extension);
  const signatureStatus: MaterialSignatureStatus = magic.detectedMime === null
    ? "unknown"
    : input.declaredMime === magic.detectedMime && !executableExtensions.has(extension)
      ? "match"
      : "mismatch";
  return { declaredMime: input.declaredMime, ...magic, dangerous, signatureStatus };
}
