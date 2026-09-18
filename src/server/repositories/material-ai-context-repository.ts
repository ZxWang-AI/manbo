import type { PrismaClient } from "@prisma/client";

import type {
  MaterialDerivativeContentCipher,
  MaterialDerivativePayload,
} from "@/media/security/material-derivative-content";
import type { ConversationMaterialContext } from "@/ai/provider";

const MAX_CONTEXT_CHARACTERS = 200_000;

export interface MaterialAiContextRepository {
  resolveAiContext(
    accountId: string,
    caseId: string,
    contentRefs: readonly string[],
  ): Promise<ConversationMaterialContext[]>;
}

function isPayload(value: MaterialDerivativePayload): value is ConversationMaterialContext {
  return typeof value.text === "string";
}

/**
 * Resolves opaque derivative references inside the server trust boundary.
 * Queries always include the owner/case and parsed/eligible predicates; the
 * decrypted text is never returned by an HTTP material-list endpoint.
 */
export class PrismaMaterialAiContextRepository implements MaterialAiContextRepository {
  constructor(
    private readonly database: PrismaClient,
    private readonly contentCipher: MaterialDerivativeContentCipher,
  ) {}

  async resolveAiContext(
    accountId: string,
    caseId: string,
    contentRefs: readonly string[],
  ): Promise<ConversationMaterialContext[]> {
    const uniqueRefs = [...new Set(contentRefs)];
    if (uniqueRefs.length === 0) return [];
    if (uniqueRefs.length > 32 || uniqueRefs.some((ref) => !/^derived\/[A-Za-z0-9._-]{1,160}$/u.test(ref))) {
      throw new Error("MATERIAL_CONTEXT_UNAVAILABLE");
    }

    const rows = await this.database.materialDerivative.findMany({
      where: {
        accountId,
        caseId,
        contentRef: { in: uniqueRefs },
        material: {
          is: {
            accountId,
            caseId,
            processingState: "parsed",
            eligibleForAi: true,
            status: "uploaded",
            deletedAt: null,
            case: { is: { accountId, caseId, visibility: "private", deletedAt: null } },
          },
        },
      },
      select: {
        contentRef: true,
        materialId: true,
        encryptedContent: true,
      },
    });

    const byRef = new Map(rows.map((row) => [row.contentRef, row]));
    if (byRef.size !== uniqueRefs.length) throw new Error("MATERIAL_CONTEXT_UNAVAILABLE");

    const contexts: ConversationMaterialContext[] = [];
    let totalCharacters = 0;
    for (const contentRef of uniqueRefs) {
      const row = byRef.get(contentRef);
      if (!row || row.encryptedContent === null || row.encryptedContent === undefined) {
        throw new Error("MATERIAL_CONTEXT_UNAVAILABLE");
      }
      let payload: MaterialDerivativePayload;
      try {
        payload = await this.contentCipher.decrypt(row.encryptedContent);
      } catch {
        throw new Error("MATERIAL_CONTEXT_UNAVAILABLE");
      }
      if (!isPayload(payload)) throw new Error("MATERIAL_CONTEXT_UNAVAILABLE");
      totalCharacters += payload.text.length;
      if (totalCharacters > MAX_CONTEXT_CHARACTERS) throw new Error("MATERIAL_CONTEXT_TOO_LARGE");
      contexts.push({
        contentRef,
        materialId: row.materialId,
        text: payload.text,
        ...(payload.sourceSpans ? { sourceSpans: payload.sourceSpans } : {}),
      });
    }
    return contexts;
  }
}
