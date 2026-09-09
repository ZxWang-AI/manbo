import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { uploadMaterialFile } from "@/components/chat/material-upload-client";

function makeFile(bytes: Uint8Array, name = "evidence.txt") {
  const blob = new Blob([bytes as unknown as BlobPart], { type: "text/plain" });
  return Object.assign(blob, { name, lastModified: 123 });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("uploadMaterialFile", () => {
  it("reserves, uploads every target part, hashes the file, and completes it", async () => {
    const file = makeFile(Uint8Array.from([1, 2, 3, 4, 5]), "notes.txt");
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit | undefined }> = [];
    const stages: string[] = [];
    const expectedSha256 = createHash("sha256").update(Buffer.from([1, 2, 3, 4, 5])).digest("hex");

    const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      calls.push({ input, init });
      const url = String(input);
      if (url.endsWith("/materials/uploads")) {
        return jsonResponse({
          upload: {
            uploadId: "upload-1",
            materialId: "material-1",
            reservedBytes: 5,
            objectKey: "materials/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            uploadTarget: {
              transport: "platform_encrypted_multipart",
              uploadId: "upload-1",
              objectKey: "materials/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              partSizeBytes: 3,
              parts: [
                { partNumber: 1, url: "/parts/1", expiresAt: "2099-01-01T00:00:00.000Z" },
                { partNumber: 2, url: "/parts/2", expiresAt: "2099-01-01T00:00:00.000Z" },
              ],
            },
          },
        }, 201);
      }
      if (url.endsWith("/parts/1") || url.endsWith("/parts/2")) return new Response(null, { status: 204 });
      if (url.endsWith("/complete")) return new Response(null, { status: 204 });
      throw new Error(`unexpected URL ${url}`);
    };

    const result = await uploadMaterialFile(file, "case-1", {
      fetcher,
      onStage: (stage) => stages.push(stage),
    });

    expect(result).toEqual({ materialId: "material-1", uploadId: "upload-1", objectKey: "materials/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
    expect(stages).toEqual(["uploading", "scanning", "saved_unread"]);
    expect(calls).toHaveLength(4);
    expect(calls[0]?.init?.body).toBe(JSON.stringify({
      byteLength: 5,
      originalFilename: "notes.txt",
      declaredMime: "text/plain",
    }));
    expect(await new Response(calls[1]?.init?.body).arrayBuffer()).toEqual(Uint8Array.from([1, 2, 3]).buffer);
    expect(await new Response(calls[2]?.init?.body).arrayBuffer()).toEqual(Uint8Array.from([4, 5]).buffer);
    expect(calls[3]?.init?.body).toBe(JSON.stringify({
      objectKey: "materials/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      expectedBytes: 5,
      expectedSha256,
    }));
  });

  it("surfaces a failed part without calling complete so the UI can retry", async () => {
    const file = makeFile(Uint8Array.from([9, 8, 7, 6]), "photo.bin");
    let partAttempts = 0;
    const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      if (url.endsWith("/materials/uploads")) {
        return jsonResponse({
          upload: {
            uploadId: "upload-2",
            materialId: "material-2",
            reservedBytes: 4,
            objectKey: "materials/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            uploadTarget: {
              transport: "platform_encrypted_multipart",
              uploadId: "upload-2",
              objectKey: "materials/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              partSizeBytes: 4,
              parts: [{ partNumber: 1, url: "/parts/1", expiresAt: "2099-01-01T00:00:00.000Z" }],
            },
          },
        }, 201);
      }
      if (url.endsWith("/parts/1")) {
        partAttempts += 1;
        return new Response("temporarily unavailable", { status: 503 });
      }
      if (url.endsWith("/materials/uploads/upload-2")) return new Response(null, { status: 204 });
      throw new Error("complete must not be called after part failure");
    };

    await expect(uploadMaterialFile(file, "case-1", { fetcher })).rejects.toMatchObject({
      code: "PART_UPLOAD_FAILED",
    });
    expect(partAttempts).toBe(1);
  });
});
