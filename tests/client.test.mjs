import assert from "node:assert/strict";
import test from "node:test";
import { createFlagsClient, createHttpFlagsProvider, FlagsError } from "../dist/index.js";

const timestamp = Date.parse("2026-10-22T12:00:00.000Z");
const delivery = (now = timestamp, flags = [{ key: "checkout", value: true }]) => ({ revision: "r1", validUntil: new Date(now + 30_000).toISOString(), flags });
const deferred = () => {
  let resolve;
  const promise = new Promise(complete => { resolve = complete; });
  return { promise, resolve };
};
function clientFor(context, options) {
  const client = createFlagsClient({ now: () => timestamp, ...options });
  context.after(() => client.dispose());
  return client;
}

test("fallback is mandatory and construction or evaluation never contacts a provider", context => {
  let calls = 0;
  const client = clientFor(context, { provider: async () => { calls += 1; return delivery(); } });
  assert.equal(client.getBooleanValue("checkout", false), false);
  assert.equal(client.getBooleanDetails("checkout", false).reason, "NOT_READY");
  assert.throws(() => client.getBooleanValue("checkout"), FlagsError);
  assert.throws(() => client.getBooleanValue("invalid key", true), FlagsError);
  assert.equal(calls, 0);
});

test("load deduplicates concurrent requests and reuses only unexpired data", async context => {
  const pending = deferred();
  let calls = 0;
  const client = clientFor(context, { provider: async () => { calls += 1; return pending.promise; } });
  const first = client.load();
  assert.equal(first, client.load());
  assert.equal(first, client.refresh());
  pending.resolve(delivery());
  assert.equal((await first).state, "ready");
  assert.equal(client.getBooleanValue("checkout", false), true);
  assert.equal(client.getBooleanDetails("unknown", true).reason, "UNKNOWN_KEY");
  await client.load();
  assert.equal(calls, 1);
  await client.refresh();
  assert.equal(calls, 2);
});

test("false remote flags are distinguishable from a true fallback", async context => {
  const client = clientFor(context, { provider: async () => delivery(timestamp, [{ key: "checkout", value: false }]) });
  await client.load();
  assert.deepEqual(client.getBooleanDetails("checkout", true), { key: "checkout", value: false, source: "remote", reason: "REMOTE", revision: "r1" });
});

test("mutating options cannot replace an instance's configured provider", async context => {
  const options = { provider: async () => delivery(), now: () => timestamp };
  const client = createFlagsClient(options);
  context.after(() => client.dispose());
  options.provider = async () => ({ ...delivery(), revision: "changed", flags: [] });
  await client.load();
  assert.equal(client.getSnapshot().value.revision, "r1");
  assert.equal(client.getBooleanValue("checkout", false), true);
});

test("expired data immediately falls back and requires explicit reload", async context => {
  let now = timestamp;
  let calls = 0;
  const client = clientFor(context, { now: () => now, provider: async () => { calls += 1; return delivery(now); } });
  await client.load();
  now += 30_001;
  assert.equal(client.getBooleanValue("checkout", false), false);
  assert.equal(client.getBooleanDetails("checkout", false).reason, "EXPIRED");
  assert.equal(calls, 1);
  await client.load();
  assert.equal(calls, 2);
  assert.equal(client.getBooleanValue("checkout", false), true);
});

test("expiry notifies subscribers without another provider request", async context => {
  const states = [];
  const client = clientFor(context, { now: Date.now, provider: async () => ({ ...delivery(Date.now()), validUntil: new Date(Date.now() + 15).toISOString() }) });
  client.subscribe(() => states.push(client.getSnapshot().state));
  await client.load();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.deepEqual(states, ["loading", "ready", "expired"]);
});

for (const invalid of [
  {},
  { ...delivery(), flags: [{ key: "checkout", value: "true" }] },
  { ...delivery(), flags: [{ key: "checkout", value: true }, { key: "checkout", value: false }] },
  { ...delivery(), validUntil: new Date(timestamp - 1).toISOString() },
  { ...delivery(), validUntil: new Date(timestamp + 60_001).toISOString() },
  { ...delivery(), flags: Array.from({ length: 65 }, (_value, index) => ({ key: `flag${index}`, value: true })) },
  { ...delivery(), flags: [{ key: "contains spaces", value: true }] },
]) {
  test(`invalid provider data falls back: ${JSON.stringify(invalid).slice(0, 130)}`, async context => {
    const client = clientFor(context, { provider: async () => invalid });
    assert.equal((await client.load()).state, "unavailable");
    assert.equal(client.getBooleanValue("checkout", false), false);
    assert.equal(client.getBooleanDetails("checkout", false).reason, "UNAVAILABLE");
  });
}

test("abort settles even an uncooperative provider and fences its late result", async context => {
  const firstProvider = deferred();
  let calls = 0;
  let firstSignal;
  const client = clientFor(context, { provider: async ({ signal }) => {
    calls += 1;
    if (calls === 1) { firstSignal = signal; return firstProvider.promise; }
    return { ...delivery(), revision: "new", flags: [{ key: "checkout", value: false }] };
  } });
  const old = client.load();
  await Promise.resolve();
  await Promise.resolve();
  client.abort();
  assert.equal(firstSignal.aborted, true);
  await old;
  await client.load();
  firstProvider.resolve(delivery());
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(client.getSnapshot().value.revision, "new");
  assert.equal(client.getBooleanValue("checkout", true), false);
});

test("abort before dispatch performs no provider call", async context => {
  let calls = 0;
  const client = clientFor(context, { provider: async () => { calls += 1; return delivery(); } });
  const pending = client.load();
  client.abort();
  await pending;
  assert.equal(calls, 0);
  assert.equal(client.getSnapshot().state, "idle");
});

test("timeout and a rejecting provider preserve the caller's fallback", async context => {
  const stalled = clientFor(context, { timeoutMs: 5, provider: () => new Promise(() => {}) });
  assert.equal((await stalled.load()).state, "unavailable");
  assert.equal(stalled.getBooleanValue("checkout", true), true);
  const failed = clientFor(context, { provider: async () => { throw new Error("network"); } });
  await failed.load();
  assert.equal(failed.getBooleanValue("checkout", false), false);
});

test("dispose aborts work, clears values and cannot be reversed by a late result", async context => {
  const provider = deferred();
  const client = clientFor(context, { provider: () => provider.promise });
  const pending = client.load();
  client.dispose();
  assert.equal((await pending).state, "disposed");
  provider.resolve(delivery());
  assert.equal(client.getBooleanDetails("checkout", false).reason, "DISPOSED");
  assert.equal((await client.refresh()).state, "disposed");
});

test("delivery is copied and frozen and unknown account fields are discarded", async context => {
  const source = { ...delivery(), accountId: "private" };
  const client = clientFor(context, { provider: async () => source });
  await client.load();
  source.flags[0].value = false;
  assert.equal(client.getBooleanValue("checkout", false), true);
  assert.equal("accountId" in client.getSnapshot().value, false);
  assert.equal(Object.isFrozen(client.getSnapshot().value.flags[0]), true);
});

test("HTTP provider uses GET without credentials, events or visitor context", async context => {
  let request;
  const client = clientFor(context, { provider: createHttpFlagsProvider({ endpoint: "https://receiver.example/flags", fetch: async (url, init) => { request = { url, init }; return Response.json({ data: delivery() }); } }) });
  await client.load();
  assert.equal(client.getBooleanValue("checkout", false), true);
  assert.equal(request.init.method, "GET");
  assert.equal(request.init.body, undefined);
  assert.equal(request.init.credentials, "omit");
  assert.equal(request.init.redirect, "error");
  assert.equal(request.init.headers.has("Authorization"), false);
});

test("HTTP provider preserves relative and absolute endpoints and rejects invalid endpoints", async context => {
  for (const endpoint of ["/flags?environment=test", "https://receiver.example/flags", "http://localhost:3000/flags"]) {
    let requested;
    const client = clientFor(context, { provider: createHttpFlagsProvider({ endpoint, fetch: async url => {
      requested = url;
      return Response.json({ data: delivery() });
    } }) });
    assert.equal((await client.load()).state, "ready");
    assert.equal(requested, endpoint);
  }
  for (const endpoint of ["flags", "//receiver.example/flags", "https://user:password@receiver.example/flags", "https://receiver.example/flags#fragment", "file:///flags"]) {
    assert.throws(() => createHttpFlagsProvider({ endpoint }), error => error instanceof FlagsError && error.code === "INVALID_ENDPOINT");
  }
});

test("HTTP provider copies static headers and retains the selected fetch implementation", async context => {
  let header;
  const options = { endpoint: "/flags", headers: { "X-Provider": "original" }, fetch: async (_url, init) => { header = init.headers.get("X-Provider"); return Response.json({ data: delivery() }); } };
  const provider = createHttpFlagsProvider(options);
  options.headers["X-Provider"] = "changed";
  options.fetch = async () => { throw new Error("changed fetch"); };
  const client = clientFor(context, { provider });
  assert.equal((await client.load()).state, "ready");
  assert.equal(header, "original");
});

for (const response of [() => new Response(null, { status: 204 }), () => Response.json({ data: { ...delivery(), extra: "x".repeat(65536) } }), () => new Response("broken", { headers: { "Content-Type": "application/json" } }), () => new Response(null, { status: 500 })]) {
  test("HTTP empty, oversized, malformed or failed delivery falls back", async context => {
    const client = clientFor(context, { provider: createHttpFlagsProvider({ endpoint: "/flags", fetch: async () => response() }) });
    assert.equal((await client.load()).state, "unavailable");
    assert.equal(client.getBooleanValue("checkout", false), false);
  });
}

test("HTTP abort during asynchronous headers prevents a late fetch", async context => {
  const pendingHeaders = deferred();
  let calls = 0;
  const client = clientFor(context, { provider: createHttpFlagsProvider({ endpoint: "/flags", headers: () => pendingHeaders.promise, fetch: async () => { calls += 1; return Response.json({ data: delivery() }); } }) });
  const pending = client.load();
  await Promise.resolve();
  await Promise.resolve();
  client.abort();
  pendingHeaders.resolve({});
  await pending;
  assert.equal(calls, 0);
});
