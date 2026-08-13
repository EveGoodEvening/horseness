const OUTPUT_MEDIA_TYPES = new Set(["text/plain", "application/json"]);
const EVIDENCE_MEDIA_TYPES = new Set(["application/json"]);
const MAX_OUTPUT_BYTES = 1_048_576;
const MAX_EVIDENCE_BYTES = 262_144;
const RUNTIME_KEY = Symbol.for("horseness.adapter.omp.native-runtime.v1");

const validateObject = (object, mediaTypes, maximum, label) => {
  if (!object || typeof object.digest !== "string" || !/^[A-Za-z0-9][A-Za-z0-9:._-]{2,255}$/.test(object.digest) || typeof object.mediaType !== "string" || !Number.isSafeInteger(object.byteLength) || object.byteLength < 0 || object.byteLength > maximum || !mediaTypes.has(object.mediaType)) throw new Error(`invalid ${label} publication`);
};

export default function horsenessOMPNativeExtension(omp) {
  const runtime = globalThis[RUNTIME_KEY];
  if (!runtime || typeof runtime.deliver !== "function" || typeof runtime.state !== "function" || typeof runtime.contextForAttempt !== "function") throw new Error("trusted Horseness OMP adapter runtime is unavailable");
  let activeForkPinDigest = null;
  let enabled = true;
  const nativeState = async () => ({ ...await runtime.state(), activeForkPinDigest, credentialEnabled: enabled });
  const requireEnabled = () => { if (!enabled) throw new Error("Horseness contribution credential is disabled"); };
  omp.registerTool({
    name: "horseness_worker_return",
    label: "Horseness Worker Return",
    description: "Deliver bounded provider output through the trusted attempt-scoped Horseness adapter runtime.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["attemptCapabilityReference", "output", "evidence"],
      properties: {
        attemptCapabilityReference: { type: "string", minLength: 3, maxLength: 256, pattern: "^[A-Za-z0-9][A-Za-z0-9:._-]+$" },
        output: { type: "object", additionalProperties: false, required: ["digest", "mediaType", "byteLength"], properties: { digest: { type: "string" }, mediaType: { enum: [...OUTPUT_MEDIA_TYPES] }, byteLength: { type: "integer", minimum: 0, maximum: MAX_OUTPUT_BYTES } } },
        evidence: { type: "object", additionalProperties: false, required: ["digest", "mediaType", "byteLength"], properties: { digest: { type: "string" }, mediaType: { enum: [...EVIDENCE_MEDIA_TYPES] }, byteLength: { type: "integer", minimum: 0, maximum: MAX_EVIDENCE_BYTES } } },
      },
    },
    async execute(_toolCallId, input) {
      requireEnabled();
      if (typeof input?.attemptCapabilityReference !== "string" || !/^[A-Za-z0-9][A-Za-z0-9:._-]{2,255}$/.test(input.attemptCapabilityReference)) throw new Error("invalid opaque attempt capability reference");
      validateObject(input.output, OUTPUT_MEDIA_TYPES, MAX_OUTPUT_BYTES, "output");
      validateObject(input.evidence, EVIDENCE_MEDIA_TYPES, MAX_EVIDENCE_BYTES, "evidence");
      const delivered = await runtime.deliver(input.attemptCapabilityReference, structuredClone(input.output), structuredClone(input.evidence));
      activeForkPinDigest = delivered.workerReturn.binding.forkPinDigest;
      return { content: [{ type: "text", text: `Horseness worker return delivered with authority decision ${delivered.delivery.decision}.` }], details: structuredClone(delivered) };
    },
  });

  omp.registerTool({ name: "horseness_native_state", label: "Horseness Native State", description: "Report native reattachment state without exposing credentials.", parameters: { type: "object", additionalProperties: false, properties: {} }, async execute() { requireEnabled(); return { content: [{ type: "text", text: "Horseness native state observed." }], details: await nativeState() }; } });
  omp.registerCommand("horseness-state", { description: "Report trusted Horseness native reattachment state.", async handler(_args, context) { requireEnabled(); const state = await nativeState(); context?.ui?.notify?.(`Horseness retained attempts: ${state.attemptKeys.length}`, "info"); return state; } });
  omp.on("before_agent_start", async () => {
    requireEnabled();
    const injected = await runtime.contextForAttempt();
    if (!injected) return undefined;
    const immutable = structuredClone(injected);
    return { message: { customType: "horseness-attempt-context-v1", content: JSON.stringify(immutable), display: false, details: immutable } };
  });
  omp.on("agent_start", async () => { requireEnabled(); await runtime.state(); });
  omp.on("session_before_branch", async event => { requireEnabled(); if (typeof runtime.beforeBranch === "function") await runtime.beforeBranch(event.entryId); });
  omp.on("session_branch", async event => { requireEnabled(); const selected = typeof runtime.activateSession === "function" ? await runtime.activateSession(event.previousSessionFile) : null; activeForkPinDigest = selected?.forkPinDigest ?? null; });
  omp.on("session_start", async () => { requireEnabled(); const selected = typeof runtime.activateSession === "function" ? await runtime.activateSession(null) : null; activeForkPinDigest = selected?.forkPinDigest ?? null; });
  omp.on("session_shutdown", async () => { if (typeof runtime.sessionShutdown === "function") await runtime.sessionShutdown(); });
  if (typeof runtime.registerRevoker === "function") runtime.registerRevoker(async () => { enabled = false; activeForkPinDigest = null; if (typeof runtime.shutdown === "function") await runtime.shutdown(); });
}
