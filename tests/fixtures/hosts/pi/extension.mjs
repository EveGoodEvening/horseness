import { readFile, writeFile } from "node:fs/promises";

export default function horsenessPiExtension(pi) {
  const input = JSON.parse(process.env.HORSENESS_PI_INPUT);
  const provider = JSON.parse(process.env.HORSENESS_PI_PROVIDER);
  const statePath = process.env.HORSENESS_PI_STATE;
  const record = async (event, details = {}) => {
    let state = { events: [], installed: true };
    try { state = JSON.parse(await readFile(statePath, "utf8")); } catch {}
    state.events.push({ event, ...details });
    await writeFile(statePath, `${JSON.stringify(state)}\n`);
  };

  pi.on("session_start", async (event) => {
    await record("session_start", { reason: event.reason, contextManifestDigest: input.contextManifestDigest, forkPinDigest: input.forkPinDigest });
  });
  pi.on("before_agent_start", async () => {
    await record("attempt", { attemptId: input.attemptId, generation: input.generation, provider: provider.identity, output: provider.output });
    return { message: { customType: "horseness-receipt", content: provider.output, display: false, details: provider.receipt } };
  });
  pi.on("session_before_fork", async (event) => {
    await record("fork_switch", { entryId: event.entryId, nextForkPinDigest: input.nextForkPinDigest });
  });
  pi.on("session_shutdown", async () => {
    await record("uninstall", { installed: false });
  });
}
