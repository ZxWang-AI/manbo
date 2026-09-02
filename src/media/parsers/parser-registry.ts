import type { FileSignatureResult } from "@/media/security/file-signature";

export interface ParsedMaterialDerivative {
  contentRef: string;
  text: string;
  sourceSpans?: Array<{ start: number; end: number }>;
}

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
