import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("package and lockfile declare the approved public identity", async () => {
  const manifest = JSON.parse(await read("package.json"));
  const lock = JSON.parse(await read("package-lock.json"));
  assert.equal(manifest.name, "@e6tz/flags");
  assert.equal(lock.name, manifest.name);
  assert.equal(lock.packages[""].name, manifest.name);
  assert.equal(manifest.publishConfig.access, "public");
  assert.equal(manifest.version, "0.1.1");
  assert.equal(manifest.license, "MIT");
  assert.equal(lock.packages[''].license, 'MIT');
  const license = await read('LICENSE');
  assert.match(license, /^MIT License\r?$/m);
  assert.match(license, /Copyright \(c\) 2026 Enry6tz/);
  assert.match(license, /Permission is hereby granted, free of charge/);
  assert.match(license, /THE SOFTWARE IS PROVIDED "AS IS"/);
  assert.doesNotMatch(await read('README.md'), /UNLICENSED/);
  assert.deepEqual(Object.keys(manifest.exports), [".", "./react", "./package.json"]);
});

test("published documentation and runtime sources contain no retired product brand", async () => {
  for (const path of ["README.md", "package.json", "package-lock.json", "src/http.ts"]) {
    assert.doesNotMatch(await read(path), /aside/i, path);
  }
  assert.match(await read("README.md"), /^# Flags\r?$/m);
});

test("CI checks types, behavior and packed consumers without publication", async () => {
  const workflow = await read(".github/workflows/test.yml");
  assert.match(workflow, /push:/);
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /node: \[22, 24\]/);
  for (const command of ["npm ci --ignore-scripts --no-audit --no-fund", "npm run typecheck", "npm test", "npm run test:package"]) {
    assert.ok(workflow.includes(command), command);
  }
  assert.doesNotMatch(workflow, /secrets\.|npm publish|deploy/i);
  const manifest = JSON.parse(await read("package.json"));
  assert.equal(manifest.scripts["test:package"], "npm run build && node scripts/test-package.mjs");
});
