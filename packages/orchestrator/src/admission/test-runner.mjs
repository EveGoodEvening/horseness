#!/usr/bin/env node
import {spawnSync} from "node:child_process";
const result=spawnSync(process.execPath,["--import","tsx","--test","test/admission/**/*.test.ts","test/authorization/**/*.test.ts","test/revisions/**/*.test.ts"],{cwd:new URL("../..",import.meta.url),stdio:"inherit"});
if(result.error)throw result.error;
process.exit(result.status??1);
