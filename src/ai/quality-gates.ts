/**
 * Internal, pass/fail-only aggregation for AI release checks.
 *
 * This deliberately has no score, probability, rank, or user-facing status.
 * The caller supplies the evidence produced by focused tests and the runner
 * returns a defensive snapshot that CI can inspect.
 */
export interface AiQualityGateCheck {
  readonly id: string;
  readonly passed: boolean;
  readonly evidence: string;
}

export interface AiQualityGateReport {
  readonly passed: boolean;
  readonly checks: AiQualityGateCheck[];
}

export function runAiQualityGates(
  checks: readonly AiQualityGateCheck[],
): AiQualityGateReport {
  if (checks.length === 0) {
    throw new RangeError("At least one AI quality gate check is required");
  }

  const ids = new Set<string>();
  const snapshot = checks.map((check) => {
    const id = check.id.trim();
    const evidence = check.evidence.trim();
    if (!id || !evidence) {
      throw new Error("AI quality gate checks require a non-empty id and evidence");
    }
    if (ids.has(id)) {
      throw new Error(`Duplicate AI quality gate id: ${id}`);
    }
    ids.add(id);
    return { id, passed: check.passed, evidence };
  });

  return {
    passed: snapshot.every((check) => check.passed),
    checks: snapshot,
  };
}
