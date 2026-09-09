import { describe, expect, it, vi } from "vitest";

import {
  createMaterialUploadPostHandler,
} from "@/app/api/cases/[caseId]/materials/uploads/route";
import {
  createMaterialUploadCompletePostHandler,
} from "@/app/api/cases/[caseId]/materials/uploads/[uploadId]/complete/route";
import { makeCaseRecordFixture } from "../fixtures/case-record";

const accountId = "a".repeat(32);
const caseId = "36ee7b31-8590-4afe-995e-0e360714d647";
const uploadId = "2b130ede-c0ad-4396-b885-a9eca4026d02";
const objectKey = `materials/${"3".repeat(32)}`;

function request(url: string, body: unknown, cookie = "manbo_session=opaque-session") {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

function owner() {
  return { accountId, sessionId: "opaque-session", expiresAt: "2026-09-02T12:30:00.000Z" };
}

function record() {
  return { ...makeCaseRecordFixture(), caseId, accountId };
}

describe("POST /api/cases/[caseId]/materials/uploads", () => {
  it("passes safe filename and declared MIME metadata into the reservation", async () => {
    const reserve = vi.fn().mockResolvedValue({
      reservation: {
        uploadId,
        materialId: "457e08e0-e496-4d42-8d84-ae4f82ec68b4",
        caseId,
        objectKey,
        reservedBytes: 1024,
        expiresAt: "2026-09-02T12:15:00.000Z",
      },
      uploadTarget: { transport: "platform_encrypted_multipart", uploadId, objectKey, parts: [] },
    });
    const handler = createMaterialUploadPostHandler({
      accounts: { resumeSession: async () => owner() },
      cases: { getPrivate: async () => record() },
      uploads: { reserve },
      isPersistenceAvailable: true,
      isObjectStorageAvailable: true,
    });

    const response = await handler(
      request(`http://localhost/api/cases/${caseId}/materials/uploads`, {
        byteLength: 1024,
        originalFilename: "工资单.pdf",
        declaredMime: "application/pdf",
      }),
      { params: Promise.resolve({ caseId }) },
    );

    expect(response.status).toBe(201);
    expect(reserve).toHaveBeenCalledWith({
      accountId,
      caseId,
      byteLength: 1024,
      originalFilename: "工资单.pdf",
      declaredMime: "application/pdf",
    });
  });

  it("reserves an encrypted upload only after session and private-case ownership checks", async () => {
    const reserve = vi.fn().mockResolvedValue({
      reservation: {
        uploadId,
        materialId: "457e08e0-e496-4d42-8d84-ae4f82ec68b4",
        caseId,
        objectKey,
        reservedBytes: 1024,
        expiresAt: "2026-09-02T12:15:00.000Z",
      },
      uploadTarget: { transport: "platform_encrypted_multipart", uploadId, objectKey, parts: [] },
    });
    const handler = createMaterialUploadPostHandler({
      accounts: { resumeSession: async () => owner() },
      cases: { getPrivate: async () => record() },
      uploads: { reserve },
      isPersistenceAvailable: true,
      isObjectStorageAvailable: true,
    });

    const response = await handler(
      request(`http://localhost/api/cases/${caseId}/materials/uploads`, { byteLength: 1024 }),
      { params: Promise.resolve({ caseId }) },
    );

    expect(response.status).toBe(201);
    expect(reserve).toHaveBeenCalledWith({ accountId, caseId, byteLength: 1024 });
    await expect(response.json()).resolves.toEqual({
      upload: {
        uploadId,
        materialId: "457e08e0-e496-4d42-8d84-ae4f82ec68b4",
        reservedBytes: 1024,
        expiresAt: "2026-09-02T12:15:00.000Z",
        uploadTarget: { transport: "platform_encrypted_multipart", uploadId, objectKey, parts: [] },
      },
    });
  });

  it("returns the private-case 404 without reserving storage for another account", async () => {
    const reserve = vi.fn();
    const handler = createMaterialUploadPostHandler({
      accounts: { resumeSession: async () => owner() },
      cases: { getPrivate: async () => null },
      uploads: { reserve },
      isPersistenceAvailable: true,
      isObjectStorageAvailable: true,
    });

    const response = await handler(
      request(`http://localhost/api/cases/${caseId}/materials/uploads`, { byteLength: 1024 }),
      { params: Promise.resolve({ caseId }) },
    );

    expect(response.status).toBe(404);
    expect(reserve).not.toHaveBeenCalled();
  });

  it("rejects an oversized or malformed reservation before touching storage", async () => {
    const reserve = vi.fn();
    const handler = createMaterialUploadPostHandler({
      accounts: { resumeSession: async () => owner() },
      cases: { getPrivate: async () => record() },
      uploads: { reserve },
      isPersistenceAvailable: true,
      isObjectStorageAvailable: true,
    });

    const response = await handler(
      request(`http://localhost/api/cases/${caseId}/materials/uploads`, { byteLength: 100 * 1024 * 1024 + 1 }),
      { params: Promise.resolve({ caseId }) },
    );

    expect(response.status).toBe(413);
    expect(reserve).not.toHaveBeenCalled();
  });

  it("fails closed when persistence or private object storage is unavailable", async () => {
    const reserve = vi.fn();
    const handler = createMaterialUploadPostHandler({
      accounts: { resumeSession: async () => owner() },
      cases: { getPrivate: async () => record() },
      uploads: { reserve },
      isPersistenceAvailable: true,
      isObjectStorageAvailable: false,
      requestId: () => "request-material-unavailable",
    });

    const response = await handler(
      request(`http://localhost/api/cases/${caseId}/materials/uploads`, { byteLength: 1024 }),
      { params: Promise.resolve({ caseId }) },
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "DEGRADED",
      requestId: "request-material-unavailable",
    });
    expect(reserve).not.toHaveBeenCalled();
  });
});

describe("POST /api/cases/[caseId]/materials/uploads/[uploadId]/complete", () => {
  it("completes a verified owned upload and never accepts a recovery secret", async () => {
    const complete = vi.fn().mockResolvedValue(undefined);
    const handler = createMaterialUploadCompletePostHandler({
      accounts: { resumeSession: async () => owner() },
      cases: { getPrivate: async () => record() },
      uploads: { complete },
      isPersistenceAvailable: true,
      isObjectStorageAvailable: true,
    });

    const response = await handler(
      request(
        `http://localhost/api/cases/${caseId}/materials/uploads/${uploadId}/complete`,
        { objectKey, expectedBytes: 1024, expectedSha256: "a".repeat(64) },
      ),
      { params: Promise.resolve({ caseId, uploadId }) },
    );

    expect(response.status).toBe(204);
    expect(complete).toHaveBeenCalledWith({
      accountId,
      caseId,
      uploadId,
      objectKey,
      expectedBytes: 1024,
      expectedSha256: "a".repeat(64),
    });
  });

  it("does not complete a missing or differently owned private case", async () => {
    const complete = vi.fn();
    const handler = createMaterialUploadCompletePostHandler({
      accounts: { resumeSession: async () => owner() },
      cases: { getPrivate: async () => null },
      uploads: { complete },
      isPersistenceAvailable: true,
      isObjectStorageAvailable: true,
    });

    const response = await handler(
      request(
        `http://localhost/api/cases/${caseId}/materials/uploads/${uploadId}/complete`,
        { objectKey, expectedBytes: 1024, expectedSha256: "a".repeat(64) },
      ),
      { params: Promise.resolve({ caseId, uploadId }) },
    );

    expect(response.status).toBe(404);
    expect(complete).not.toHaveBeenCalled();
  });

  it("rejects recovery secrets and any extra completion fields", async () => {
    const complete = vi.fn();
    const handler = createMaterialUploadCompletePostHandler({
      accounts: { resumeSession: async () => owner() },
      cases: { getPrivate: async () => record() },
      uploads: { complete },
      isPersistenceAvailable: true,
      isObjectStorageAvailable: true,
    });

    const response = await handler(
      request(
        `http://localhost/api/cases/${caseId}/materials/uploads/${uploadId}/complete`,
        {
          objectKey,
          expectedBytes: 1024,
          expectedSha256: "a".repeat(64),
          recoverySecret: "must-not-cross-boundary",
        },
      ),
      { params: Promise.resolve({ caseId, uploadId }) },
    );

    expect(response.status).toBe(400);
    expect(complete).not.toHaveBeenCalled();
  });

  it("fails closed when completion storage is unavailable", async () => {
    const complete = vi.fn();
    const handler = createMaterialUploadCompletePostHandler({
      accounts: { resumeSession: async () => owner() },
      cases: { getPrivate: async () => record() },
      uploads: { complete },
      isPersistenceAvailable: true,
      isObjectStorageAvailable: false,
      requestId: () => "request-complete-unavailable",
    });

    const response = await handler(
      request(
        `http://localhost/api/cases/${caseId}/materials/uploads/${uploadId}/complete`,
        { objectKey, expectedBytes: 1024, expectedSha256: "a".repeat(64) },
      ),
      { params: Promise.resolve({ caseId, uploadId }) },
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "DEGRADED",
      requestId: "request-complete-unavailable",
    });
    expect(complete).not.toHaveBeenCalled();
  });

  it("returns a conflict when the object version is already finalized", async () => {
    const complete = vi.fn().mockRejectedValue(new Error("LOCAL_OBJECT_ALREADY_EXISTS"));
    const handler = createMaterialUploadCompletePostHandler({
      accounts: { resumeSession: async () => owner() },
      cases: { getPrivate: async () => record() },
      uploads: { complete },
      isPersistenceAvailable: true,
      isObjectStorageAvailable: true,
    });

    const response = await handler(
      request(
        `http://localhost/api/cases/${caseId}/materials/uploads/${uploadId}/complete`,
        { objectKey, expectedBytes: 1024, expectedSha256: "a".repeat(64) },
      ),
      { params: Promise.resolve({ caseId, uploadId }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "VERSION_CONFLICT" });
  });
});
