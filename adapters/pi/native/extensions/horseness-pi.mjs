const OUTPUT_MEDIA_TYPES = new Set(["text/plain", "application/json"]);
const EVIDENCE_MEDIA_TYPES = new Set(["application/json"]);
const MAX_OUTPUT_BYTES = 1_048_576;
const MAX_EVIDENCE_BYTES = 262_144;
const RUNTIME_KEY = Symbol.for("horseness.adapter.pi.native-runtime.v1");

const validateObject = (object, mediaTypes, maximum, label) => {
  if (!object || typeof object.digest !== "string" || !/^[A-Za-z0-9][A-Za-z0-9:._-]{2,255}$/.test(object.digest) || typeof object.mediaType !== "string" || !Number.isSafeInteger(object.byteLength) || object.byteLength < 0 || object.byteLength > maximum || !mediaTypes.has(object.mediaType)) throw new Error(`invalid ${label} publication`);
};

export default function horsenessPiNativeExtension(pi) {
  const runtime = globalThis[RUNTIME_KEY];
  if (!runtime || typeof runtime.deliver !== "function" || typeof runtime.state !== "function" || typeof runtime.shutdown !== "function") throw new Error("trusted Horseness Pi adapter runtime is unavailable");
  let activeForkPinDigest = null;
  let enabled = true;

  pi.registerTool({
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
      if (!enabled) throw new Error("Horseness contribution credential is disabled");
      if (typeof input?.attemptCapabilityReference !== "string" || !/^[A-Za-z0-9][A-Za-z0-9:._-]{2,255}$/.test(input.attemptCapabilityReference)) throw new Error("invalid opaque attempt capability reference");
      validateObject(input.output, OUTPUT_MEDIA_TYPES, MAX_OUTPUT_BYTES, "output");
      validateObject(input.evidence, EVIDENCE_MEDIA_TYPES, MAX_EVIDENCE_BYTES, "evidence");
      const delivered = await runtime.deliver(input.attemptCapabilityReference, structuredClone(input.output), structuredClone(input.evidence));
      activeForkPinDigest = delivered.workerReturn.binding.forkPinDigest;
      return { content: [{ type: "text", text: `Horseness worker return delivered with authority decision ${delivered.delivery.decision}.` }], details: structuredClone(delivered) };
    },
  });

  pi.registerTool({ name: "horseness_native_state", label: "Horseness Native State", description: "Report native reattachment state without exposing credentials.", parameters: { type: "object", additionalProperties: false, properties: {} }, async execute() { return { content: [{ type: "text", text: "Horseness native state observed." }], details: { ...await runtime.state(), activeForkPinDigest, credentialEnabled: enabled } }; } });
  pi.on("session_before_fork", async event => { if (typeof event?.nextForkPinDigest === "string" && event.nextForkPinDigest.length > 0) activeForkPinDigest = event.nextForkPinDigest; return { cancel: false }; });
  pi.on("session_start", async event => { if (["reload", "resume", "fork"].includes(event?.reason) && typeof event?.forkPinDigest === "string") activeForkPinDigest = event.forkPinDigest; });
  pi.on("session_shutdown", async event => { if (event?.reason === "uninstall") { enabled = false; activeForkPinDigest = null; await runtime.shutdown(); } });
}
