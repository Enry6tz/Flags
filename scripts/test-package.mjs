import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const npm = process.env.npm_execpath;
assert.ok(npm, "Run this check with npm run test:package");
const scratch = await mkdtemp(join(tmpdir(), "flags-package-"));
console.log(`Package check scratch directory (retained): ${scratch}`);

function run(args, cwd = scratch) {
  const result = spawnSync(process.execPath, args, {
    cwd, encoding: "utf8", windowsHide: true,
    env: { ...process.env, npm_config_cache: join(scratch, "npm-cache") },
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

const [packed] = JSON.parse(run([npm, "pack", "--ignore-scripts", "--json", "--pack-destination", scratch], root));
assert.equal(packed.name, "@e6tz/flags");
const files = packed.files.map(file => file.path);
for (const entry of ["package.json", "README.md", "LICENSE", "dist/index.js", "dist/index.d.ts", "dist/react.js", "dist/react.d.ts"]) {
  assert.ok(files.includes(entry), `Missing packed file: ${entry}`);
}
assert.ok(files.every(path => path.startsWith("dist/") || ["README.md", "LICENSE", "package.json"].includes(path)), "Unexpected published source or fixture");
await writeFile(join(scratch, "package.json"), JSON.stringify({ private: true, type: "module" }));
run([npm, "install", join(scratch, packed.filename), "--ignore-scripts", "--no-audit", "--no-fund"]);
const manifest = JSON.parse(await readFile(join(scratch, "node_modules/@e6tz/flags/package.json"), "utf8"));
assert.equal(manifest.name, "@e6tz/flags");
assert.equal(manifest.license, "MIT");
assert.equal(await readFile(join(scratch, 'node_modules/@e6tz/flags/LICENSE'), 'utf8'), await readFile(join(root, 'LICENSE'), 'utf8'));
assert.equal(manifest.publishConfig.access, "public");

await writeFile(join(scratch, "consumer.mjs"), `
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createFlagsClient, createHttpFlagsProvider, FlagsError } from "@e6tz/flags";
const require = createRequire(import.meta.url);
assert.throws(() => require.resolve("react"), { code: "MODULE_NOT_FOUND" });
let calls = 0;
const client = createFlagsClient({ provider: async () => {
  calls += 1;
  return { revision: "consumer", validUntil: new Date(Date.now() + 30000).toISOString(), flags: [{ key: "checkout", value: true }] };
} });
try {
  assert.equal(client.getBooleanValue("checkout", false), false);
  assert.throws(() => client.getBooleanValue("checkout"), FlagsError);
  assert.equal(calls, 0);
  assert.equal((await client.load()).state, "ready");
  assert.deepEqual(client.getBooleanDetails("checkout", false), { key: "checkout", value: true, source: "remote", reason: "REMOTE", revision: "consumer" });
  assert.equal(client.getBooleanValue("unknown", true), true);
  assert.equal(client.getBooleanDetails("unknown", false).reason, "UNKNOWN_KEY");
  assert.equal(calls, 1);
  assert.equal(typeof createHttpFlagsProvider({ endpoint: "/flags" }), "function");
} finally {
  client.dispose();
}
assert.equal(client.getSnapshot().state, "disposed");
assert.equal(client.getBooleanDetails("checkout", false).reason, "DISPOSED");
assert.equal(client.getBooleanValue("checkout", false), false);
console.log("Packed core works without React");
`);
console.log(run(["consumer.mjs"]).trim());

await writeFile(join(scratch, "consumer.ts"), `
import { createFlagsClient, createHttpFlagsProvider, type FlagsClient, type FlagEvaluation } from "@e6tz/flags";
import { useFlag, useFlagsSnapshot } from "@e6tz/flags/react";
const client: FlagsClient = createFlagsClient({ provider: createHttpFlagsProvider({ endpoint: "/flags" }) });
const value: boolean = client.getBooleanValue("checkout", false);
const details: FlagEvaluation = client.getBooleanDetails("checkout", value);
// @ts-expect-error Every evaluation requires an explicit fallback.
client.getBooleanValue("checkout");
client.dispose();
void details;
const hook: (client: FlagsClient, key: string, fallback: boolean) => FlagEvaluation = useFlag;
void hook;
void useFlagsSnapshot;
`);
run([require.resolve("typescript/bin/tsc"), "--noEmit", "--strict", "--module", "NodeNext", "--moduleResolution", "NodeNext", "consumer.ts"]);
console.log("Packed declarations resolve in an independent consumer");

run([npm, "install", "--no-save", "react@19", "--ignore-scripts", "--no-audit", "--no-fund"]);
await writeFile(join(scratch, "react-consumer.mjs"), `
import assert from "node:assert/strict";
import { useFlag, useFlagsSnapshot } from "@e6tz/flags/react";
assert.equal(typeof useFlag, "function");
assert.equal(typeof useFlagsSnapshot, "function");
console.log("Packed optional React entrypoint imports with its peer");
`);
console.log(run(["react-consumer.mjs"]).trim());
