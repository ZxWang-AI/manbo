import { z } from "zod";

import type { FileSignatureResult } from "@/media/security/file-signature";

export const parsedMaterialDerivativeSchema = z.strictObject({
  contentRef: z.string().regex(/^derived\/[A-Za-z0-9._-]{1,160}$/u),
  text: z.string().min(1),
  sourceSpans: z.array(z.strictObject({
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
  })).optional(),
});

export type ParsedMaterialDerivative = z.infer<typeof parsedMaterialDerivativeSchema>;

export interface MaterialParser {
  id: string;
  supports(signature: FileSignatureResult): boolean;
  parse(input: { bytes: Uint8Array; signature: FileSignatureResult }): Promise<ParsedMaterialDerivative>;
}

export class ParserRegistry {
  constructor(private readonly parsers: readonly MaterialParser[]) {}

  find(signature: FileSignatureResult): MaterialParser | null {
    return this.parsers.find((parser) => parser.supports(signature)) ?? null;
  }
}
