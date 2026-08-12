#!/usr/bin/env node
import { readFile } from "node:fs/promises";
const record = JSON.parse(await readFile(process.argv[2], "utf8"));
const required = ["native", "contextInjected", "attempt", "receiptBinding", "restartReconcile", "resume", "forkSwitch", "uninstall"];
const ok = required.every((key) => Object.hasOwn(record, key)) && record.native === true && record.contextInjected === true && record.resume?.supported === true;
console.log(JSON.stringify({ validator: "omp-official-plugin-doctor/17.2.15", status: ok ? "pass" : "fail" }));
process.exit(ok ? 0 : 1);
