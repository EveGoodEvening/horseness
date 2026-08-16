import test from "node:test";
import assert from "node:assert/strict";
import { checkBoundaries, metadataBoundaryErrors } from "../scripts/boundaries-check.mjs";

test("bootstrap remains a registered private executable boundary", async () => {
  const result = await checkBoundaries();
  assert.equal(result.packageCount, 15);
  assert.deepEqual(result.errors, []);
});

const publicManifests = (specifier = "workspace:1.0.0") => [
  { manifest: { name: "@horseness/domain", version: "1.0.0", private: false, type: "module" } },
  { manifest: { name: "@horseness/sdk", version: "1.0.0", private: false, type: "module", dependencies: { "@horseness/domain": specifier } } },
];

const privateManifests = (specifier = "workspace:*") => [
  { manifest: { name: "@horseness/domain", version: "0.0.0", private: true, type: "module" } },
  { manifest: { name: "@horseness/sdk", version: "0.0.0", private: true, type: "module", dependencies: { "@horseness/domain": specifier } } },
];

test("development metadata retains private workspace wildcard convention", () => {
  assert.deepEqual(metadataBoundaryErrors(privateManifests()), []);
  assert.deepEqual(metadataBoundaryErrors(privateManifests("workspace:0.0.0")), [
    "@horseness/sdk: @horseness/domain must use workspace:*",
  ]);
});

test("release metadata requires coherent exact workspace pins", () => {
  assert.deepEqual(metadataBoundaryErrors(publicManifests()), []);
  assert.deepEqual(metadataBoundaryErrors(publicManifests("workspace:*")), [
    "@horseness/sdk: @horseness/domain must use workspace:1.0.0",
  ]);
  const mixedVersions = publicManifests();
  mixedVersions[1].manifest.version = "1.0.1";
  assert.deepEqual(metadataBoundaryErrors(mixedVersions), ["public workspace manifests must use one coherent version"]);
});

test("release metadata allows a private deferred package", () => {
  const mixed = [
    ...publicManifests(),
    { manifest: { name: "@horseness/bootstrap", version: "0.0.0", private: true, type: "module", dependencies: { "@horseness/domain": "workspace:*" } } },
  ];
  assert.deepEqual(metadataBoundaryErrors(mixed), []);
});

test("public packages cannot depend on deferred private packages", () => {
  const mixed = [
    { manifest: { name: "@horseness/bootstrap", version: "0.0.0", private: true, type: "module" } },
    { manifest: { name: "@horseness/cli", version: "1.0.0", private: false, type: "module", dependencies: { "@horseness/bootstrap": "workspace:1.0.0" } } },
  ];
  assert.deepEqual(metadataBoundaryErrors(mixed), [
    "@horseness/cli: public package cannot depend on private @horseness/bootstrap",
  ]);
});

test("deferred packages must stay private development metadata", () => {
  const mixed = [
    ...publicManifests(),
    { manifest: { name: "@horseness/bootstrap", version: "1.0.0", private: true, type: "module", publishConfig: { access: "public" } } },
  ];
  assert.deepEqual(metadataBoundaryErrors(mixed), [
    "@horseness/bootstrap: private workspace must use 0.0.0 without publishConfig",
  ]);
});
