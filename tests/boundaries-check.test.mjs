import test from "node:test";
import assert from "node:assert/strict";
import { checkBoundaries, metadataBoundaryErrors } from "../scripts/boundaries-check.mjs";
test("bootstrap is a registered executable boundary", async () => { const result = await checkBoundaries(); assert.equal(result.packageCount, 15); assert.deepEqual(result.errors, []); });

const manifests = (version, specifier, isPrivate) => [
  { manifest: { name: "@horseness/domain", version, private: isPrivate, type: "module" } },
  { manifest: { name: "@horseness/sdk", version, private: isPrivate, type: "module", dependencies: { "@horseness/domain": specifier } } }
];

test("development metadata retains private workspace wildcard convention", () => {
  assert.deepEqual(metadataBoundaryErrors(manifests("0.0.0", "workspace:*", true)), []);
  assert.deepEqual(metadataBoundaryErrors(manifests("0.0.0", "workspace:0.0.0", true)), [
    "@horseness/sdk: @horseness/domain must use workspace:*"
  ]);
});

test("release metadata requires public coherent exact workspace pins", () => {
  assert.deepEqual(metadataBoundaryErrors(manifests("1.0.0", "workspace:1.0.0", false)), []);
  assert.deepEqual(metadataBoundaryErrors(manifests("1.0.0", "workspace:*", false)), [
    "@horseness/sdk: @horseness/domain must use workspace:1.0.0"
  ]);
  const mixed = manifests("1.0.0", "workspace:1.0.0", false);
  mixed[1].manifest.version = "1.0.1";
  assert.deepEqual(metadataBoundaryErrors(mixed), ["workspace manifests must use one coherent version"]);
});

test("release metadata rejects wildcard optional internal pins and retains external optional dependencies", () => {
  const releaseManifests = manifests("1.0.0", "workspace:1.0.0", false);
  releaseManifests[1].manifest.optionalDependencies = {
    "@horseness/domain": "workspace:*",
    "external-optional-package": "^2.0.0"
  };
  assert.deepEqual(metadataBoundaryErrors(releaseManifests), [
    "@horseness/sdk: @horseness/domain must use workspace:1.0.0"
  ]);

  releaseManifests[1].manifest.optionalDependencies["@horseness/domain"] = "workspace:1.0.0";
  assert.deepEqual(metadataBoundaryErrors(releaseManifests), []);
});
