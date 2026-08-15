const EXPECTED_NATIVE_VERSIONS = Object.freeze({
  pi: "0.73.1",
  omp: "17.2.15",
  claude: "2.1.228",
  codex: "0.144.1-linux-x64",
});

export function expectedNativeVersion(host) {
  const version = EXPECTED_NATIVE_VERSIONS[host];
  if (version === undefined) throw new Error(`unsupported closed-loop host ${String(host)}`);
  return version;
}
