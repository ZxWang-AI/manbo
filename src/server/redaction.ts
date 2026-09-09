import { randomUUID } from "node:crypto";

export interface PersonalDataHint {
  hintId: string;
  kind: "phone" | "email" | "identity_document" | "precise_address";
  spanStart: number;
  spanEnd: number;
  maskedPreview: string;
}

type Candidate = Omit<PersonalDataHint, "hintId">;

const patterns: ReadonlyArray<{
  kind: Candidate["kind"];
  pattern: RegExp;
  mask: (value: string) => string;
}> = [
  {
    kind: "email",
    pattern: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu,
    mask: (value) => {
      const [local = "", domain = ""] = value.split("@");
      const visible = local.slice(0, 1);
      return `${visible}${"*".repeat(Math.max(2, local.length - 1))}@${domain}`;
    },
  },
  {
    kind: "phone",
    pattern: /(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d{9}(?!\d)/gu,
    mask: (value) => `${value.slice(0, 3)}****${value.slice(-2)}`,
  },
  {
    kind: "identity_document",
    pattern: /(?<![\w])[1-9]\d{5}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?![\w])/gu,
    mask: (value) => `${value.slice(0, 3)}***********${value.slice(-2)}`,
  },
  {
    kind: "precise_address",
    pattern: /[^，。；;\n]{2,80}(?:省|市|自治区|自治州|县|区|镇|乡|街道|路|号|栋|单元|室)[^，。；;\n]{0,40}/gu,
    mask: (value) => `${value.slice(0, 1)}${"*".repeat(Math.max(3, value.length - 2))}${value.slice(-1)}`,
  },
];

function overlaps(left: Candidate, right: Candidate): boolean {
  return left.spanStart < right.spanEnd && right.spanStart < left.spanEnd;
}

/**
 * Finds likely personal-data spans locally. The function returns masked
 * previews only; callers must ask the user before replacing or discarding any
 * source text.
 */
export function detectPotentialPersonalData(text: string): PersonalDataHint[] {
  if (text.length === 0) return [];
  const candidates: Candidate[] = [];
  for (const entry of patterns) {
    entry.pattern.lastIndex = 0;
    for (const match of text.matchAll(entry.pattern)) {
      const value = match[0];
      const start = match.index ?? -1;
      if (start < 0 || value.length === 0) continue;
      candidates.push({
        kind: entry.kind,
        spanStart: start,
        spanEnd: start + value.length,
        maskedPreview: entry.mask(value),
      });
    }
  }

  const selected = candidates
    .sort((left, right) => left.spanStart - right.spanStart || right.spanEnd - left.spanEnd)
    .filter((candidate, index, all) => !all.slice(0, index).some((previous) => overlaps(previous, candidate)));

  return selected.map((candidate) => ({ hintId: randomUUID(), ...candidate }));
}

export function maskPersonalData(text: string, hints: readonly PersonalDataHint[]): string {
  return [...hints]
    .sort((left, right) => right.spanStart - left.spanStart)
    .reduce((result, hint) => result.slice(0, hint.spanStart) + hint.maskedPreview + result.slice(hint.spanEnd), text);
}
