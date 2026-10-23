export const flagsLimits = Object.freeze({ items: 64, responseBytes: 64 * 1024, ttlMs: 60_000, keyLength: 64, timeoutMs: 10_000 });

export interface FlagValue {
  readonly key: string;
  readonly value: boolean;
}

export interface FlagsDelivery {
  readonly revision: string;
  readonly validUntil: string;
  readonly flags: readonly FlagValue[];
}

export type FlagsProvider = (options: { readonly signal: AbortSignal }) => Promise<unknown>;

export interface FlagsSnapshot {
  readonly state: "idle" | "loading" | "ready" | "expired" | "unavailable" | "disposed";
  readonly value: FlagsDelivery | null;
  readonly errorCode: string | null;
  readonly expiresAt: number | null;
}

export interface FlagEvaluation {
  readonly key: string;
  readonly value: boolean;
  readonly source: "remote" | "fallback";
  readonly reason: "REMOTE" | "UNKNOWN_KEY" | "NOT_READY" | "EXPIRED" | "UNAVAILABLE" | "DISPOSED";
  readonly revision: string | null;
}

export interface FlagsClient {
  getSnapshot(): FlagsSnapshot;
  getBooleanDetails(key: string, fallback: boolean): FlagEvaluation;
  getBooleanValue(key: string, fallback: boolean): boolean;
  load(): Promise<FlagsSnapshot>;
  refresh(): Promise<FlagsSnapshot>;
  abort(): void;
  subscribe(observer: () => void): () => void;
  dispose(): void;
}

export interface FlagsClientOptions {
  readonly provider: FlagsProvider;
  readonly timeoutMs?: number;
  readonly now?: () => number;
}

export class FlagsError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "FlagsError";
  }
}
