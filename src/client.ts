import { abortable } from "./async.js";
import { FlagsError, flagsLimits, type FlagEvaluation, type FlagsClient, type FlagsClientOptions, type FlagsSnapshot } from "./contracts.js";
import { parseFlagsDelivery, validFlagKey } from "./validation.js";

export const serverFlagsSnapshot: FlagsSnapshot = Object.freeze({ state: "idle", value: null, errorCode: null, expiresAt: null });

export function evaluateFlag(snapshot: FlagsSnapshot, key: string, fallback: boolean): FlagEvaluation {
  if (!validFlagKey(key) || typeof fallback !== "boolean") throw new FlagsError("INVALID_FLAG_ARGUMENT");
  const flag = snapshot.state === "ready" ? snapshot.value?.flags.find(item => item.key === key) : undefined;
  const reason = flag ? "REMOTE" : snapshot.state === "ready" ? "UNKNOWN_KEY" : snapshot.state === "expired" ? "EXPIRED" : snapshot.state === "unavailable" ? "UNAVAILABLE" : snapshot.state === "disposed" ? "DISPOSED" : "NOT_READY";
  return Object.freeze({ key, value: flag?.value ?? fallback, source: flag ? "remote" : "fallback", reason, revision: snapshot.value?.revision ?? null });
}

export function createFlagsClient(options: FlagsClientOptions): FlagsClient {
  if (typeof options.provider !== "function") throw new FlagsError("INVALID_PROVIDER");
  const provider = options.provider;
  const timeoutMs = options.timeoutMs ?? flagsLimits.timeoutMs;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new FlagsError("INVALID_TIMEOUT");
  const now = options.now ?? Date.now;
  let snapshot = serverFlagsSnapshot;
  let disposed = false;
  let generation = 0;
  let flight: Promise<FlagsSnapshot> | null = null;
  let controller: AbortController | null = null;
  let expiry: ReturnType<typeof setTimeout> | null = null;
  const observers = new Set<() => void>();
  function clearExpiry() {
    if (expiry !== null) clearTimeout(expiry);
    expiry = null;
  }
  function publish(value: FlagsSnapshot) {
    snapshot = Object.freeze(value);
    for (const observer of [...observers]) {
      try { observer(); } catch {}
    }
  }
  function getSnapshot(): FlagsSnapshot {
    if (snapshot.state === "ready" && snapshot.expiresAt !== null && snapshot.expiresAt <= now()) {
      clearExpiry();
      snapshot = Object.freeze({ state: "expired", value: null, errorCode: null, expiresAt: null });
    }
    return snapshot;
  }
  function request(refresh: boolean): Promise<FlagsSnapshot> {
    if (flight) return flight;
    if (disposed || (!refresh && getSnapshot().state === "ready")) return Promise.resolve(getSnapshot());
    const active = ++generation;
    const abort = new AbortController();
    controller = abort;
    clearExpiry();
    const timeout = setTimeout(() => abort.abort(), timeoutMs);
    const current = () => !disposed && generation === active;
    const work = async (): Promise<FlagsSnapshot> => {
      try {
        const value = await abortable(Promise.resolve().then(() => {
          if (abort.signal.aborted || !current()) throw new FlagsError("REQUEST_ABORTED");
          return provider({ signal: abort.signal });
        }), abort.signal);
        if (!current() || abort.signal.aborted) return getSnapshot();
        const delivery = parseFlagsDelivery(value, now());
        const expiresAt = Date.parse(delivery.validUntil);
        expiry = setTimeout(() => {
          expiry = null;
          if (current() && snapshot.state === "ready") publish({ state: "expired", value: null, errorCode: null, expiresAt: null });
        }, Math.max(0, expiresAt - now()));
        publish({ state: "ready", value: delivery, errorCode: null, expiresAt });
      } catch (error: unknown) {
        if (current()) publish({ state: "unavailable", value: null, errorCode: error instanceof FlagsError ? error.code : "PROVIDER_UNAVAILABLE", expiresAt: null });
      } finally {
        clearTimeout(timeout);
        if (generation === active) controller = null;
      }
      return getSnapshot();
    };
    const promise = Promise.resolve().then(work);
    flight = promise;
    publish({ state: "loading", value: null, errorCode: null, expiresAt: null });
    void promise.then(() => { if (flight === promise) flight = null; });
    return promise;
  }
  return Object.freeze({
    getSnapshot,
    getBooleanDetails: (key: string, fallback: boolean) => evaluateFlag(getSnapshot(), key, fallback),
    getBooleanValue: (key: string, fallback: boolean) => evaluateFlag(getSnapshot(), key, fallback).value,
    load: () => request(false),
    refresh: () => request(true),
    abort() {
      if (disposed) return;
      generation += 1;
      controller?.abort();
      controller = null;
      flight = null;
      clearExpiry();
      publish(serverFlagsSnapshot);
    },
    subscribe(observer: () => void) {
      if (disposed) return () => {};
      observers.add(observer);
      return () => { observers.delete(observer); };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      controller?.abort();
      controller = null;
      flight = null;
      clearExpiry();
      publish({ state: "disposed", value: null, errorCode: null, expiresAt: null });
      observers.clear();
    },
  });
}
