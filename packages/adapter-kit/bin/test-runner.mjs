#!/usr/bin/env node
import {spawnSync} from "node:child_process";
const forwarded=process.argv.slice(2).filter(argument=>argument!=="--runInBand"&&argument!=="--");
const result=spawnSync(process.execPath,["--import","tsx","--test","test/**/*.test.ts",...forwarded],{cwd:new URL("..",import.meta.url),stdio:"inherit"});
if(result.error)throw result.error;
process.exit(result.status??1);
