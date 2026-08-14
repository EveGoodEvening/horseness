#!/usr/bin/env node
process.env.HORSENESS_BOOTSTRAP_BUNDLE ??= new URL("./runtime/generated/fixture-release.json", import.meta.url).pathname;
process.env.HORSENESS_PROJECT_TRUST_ROOT ??= new URL("./runtime/generated/fixture-trust-root.json", import.meta.url).pathname;
process.env.HORSENESS_DAEMON_EXECUTABLE ??= new URL("./runtime/node_modules/@horseness/daemon/bin/horseness-daemon.mjs", import.meta.url).pathname;
await import(new URL("./runtime/bin/horseness-bootstrap.mjs", import.meta.url));
