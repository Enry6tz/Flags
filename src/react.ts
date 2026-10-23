"use client";

import { useSyncExternalStore } from "react";
import { evaluateFlag, serverFlagsSnapshot } from "./client.js";
import type { FlagsClient } from "./contracts.js";

export function useFlagsSnapshot(client: FlagsClient) {
  return useSyncExternalStore(client.subscribe, client.getSnapshot, () => serverFlagsSnapshot);
}

export function useFlag(client: FlagsClient, key: string, fallback: boolean) {
  return evaluateFlag(useFlagsSnapshot(client), key, fallback);
}
