import test from "node:test";
import { requirePackageTests } from "../system/process-helper.mjs";

const groups = [
  {
    name: "protocol rejects hostile authentication, scope, cursor, receipt, proposal, framing, and substitution inputs",
    packageName: "@horseness/protocol",
    files: ["test/security.test.ts", "test/protocol.test.ts", "test/method-mappings.test.ts", "test/transports/framing.test.ts", "test/transports/server.test.ts"],
  },
  {
    name: "adapter public edge binds returns and confines, redacts, times, and bounds secure subprocesses",
    packageName: "@horseness/adapter-kit",
    files: ["test/conformance.test.ts"],
  },
  {
    name: "policy and authority preserve quota, revocation, approval, admission, and duplicate-delivery invariants",
    packageName: "@horseness/policy",
    files: ["test/policy.test.ts"],
  },
  {
    name: "orchestration rejects authorization, receipt, admission, dispatch, lease, and recovery races",
    packageName: "@horseness/orchestrator",
    files: ["test/authorization/authorization.test.ts", "test/authorization/authority-loading.test.ts", "test/receipts/receipt-projection.test.ts", "test/admission/admission.test.ts", "test/admission/service-transitions.test.ts", "test/admission/durable-decisions.test.ts", "test/dispatch/dispatch.test.ts", "test/leases/leases.test.ts", "test/recovery/recovery.test.ts"],
  },
  {
    name: "SQLite authority rejects artifact, path, symlink, import, retention, and recovery attacks",
    packageName: "@horseness/store-sqlite",
    files: ["test/context-publication.test.ts", "test/trusted-reader.test.ts", "test/import/import-security.test.ts", "test/import/import-retention.test.ts", "test/recovery/authority-integrity.test.ts", "test/recovery/recovery-authority.test.ts", "test/crash-matrix.test.ts"],
  },
  {
    name: "installer trust, hostile inspection, journal, migration, repair, and uninstall edges fail closed",
    packageName: "@horseness/installer",
    files: ["test/trust/trust.test.ts", "test/operations/bootstrap-trust.test.ts", "test/inspectors/inspectors.test.ts", "test/doctor/doctor.test.ts", "test/journal/journal.test.ts", "test/migrations/migrations.test.ts", "test/repair/repair.test.ts", "test/uninstall/uninstall.test.ts"],
  },
];

for (const group of groups) {
  test(group.name, { timeout: 240_000 }, async () => {
    await requirePackageTests(group);
  });
}
