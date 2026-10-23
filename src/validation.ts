import { flagsLimits, FlagsError, type FlagsDelivery } from "./contracts.js";

export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validFlagKey(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(value);
}

export function parseFlagsDelivery(value: unknown, now: number): FlagsDelivery {
  if (!record(value) || typeof value.revision !== "string" || !/^[a-zA-Z0-9._:-]{1,128}$/.test(value.revision) || typeof value.validUntil !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value.validUntil) || !Array.isArray(value.flags) || value.flags.length > flagsLimits.items) throw new FlagsError("INVALID_DELIVERY");
  const expiresAt = Date.parse(value.validUntil);
  if (!Number.isFinite(expiresAt) || expiresAt <= now || expiresAt > now + flagsLimits.ttlMs || new Date(value.validUntil).toISOString().slice(0, 19) !== value.validUntil.slice(0, 19)) throw new FlagsError("INVALID_EXPIRY");
  const keys = new Set<string>();
  const flags = value.flags.map((flag: unknown) => {
    if (!record(flag) || !validFlagKey(flag.key) || typeof flag.value !== "boolean" || keys.has(flag.key)) throw new FlagsError("INVALID_FLAG");
    keys.add(flag.key);
    return Object.freeze({ key: flag.key, value: flag.value });
  });
  return Object.freeze({ revision: value.revision, validUntil: value.validUntil, flags: Object.freeze(flags) });
}
