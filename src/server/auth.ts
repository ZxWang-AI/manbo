import { createHash, randomBytes, randomInt } from "node:crypto";

export const SESSION_IDLE_MILLISECONDS = 30 * 60 * 1000;
export const SESSION_ABSOLUTE_MILLISECONDS = 12 * 60 * 60 * 1000;
export const RECOVERY_SECRET_WARNING =
  "请将恢复密钥保存在安全位置；平台不会保存原文，密钥丢失后账户将无法恢复。";

const aliasAdjectives = ["calm", "clear", "gentle", "quiet", "steady", "warm"] as const;
const aliasNouns = ["cedar", "harbor", "lantern", "river", "willow", "wren"] as const;
const aliasSuffixAlphabet = "abcdefghjkmnpqrstuvwxyz23456789";

export interface PseudonymousCredentials {
  accountId: string;
  alias: string;
  recoverySecret: string;
}

export function normalizeAlias(alias: string): string {
  return alias.trim().toLowerCase();
}

export function hashOpaqueToken(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function randomAliasSuffix(): string {
  return Array.from(
    { length: 4 },
    () => aliasSuffixAlphabet[randomInt(aliasSuffixAlphabet.length)],
  ).join("");
}

export function createPseudonymousCredentials(): PseudonymousCredentials {
  const adjective = aliasAdjectives[randomInt(aliasAdjectives.length)];
  const noun = aliasNouns[randomInt(aliasNouns.length)];

  return {
    accountId: randomBytes(16).toString("hex"),
    alias: `${adjective}-${noun}-${randomAliasSuffix()}`,
    recoverySecret: randomBytes(32).toString("base64url"),
  };
}

export function createOpaqueSessionId(): string {
  return randomBytes(32).toString("base64url");
}

export function buildSessionCookie(
  sessionId: string,
  nodeEnvironment: "development" | "test" | "production",
): string {
  const attributes = [
    `manbo_session=${encodeURIComponent(sessionId)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_IDLE_MILLISECONDS / 1000}`,
  ];

  if (nodeEnvironment === "production") {
    attributes.push("Secure");
  }

  return attributes.join("; ");
}
