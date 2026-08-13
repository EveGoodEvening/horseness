const REQUIRED_BINDING_FIELDS = ["workspaceId", "runId", "taskId", "attemptId", "generation", "forkPinDigest", "contextManifestCoreDigest", "attemptContextBindingDigest", "providerIdempotencyKeyDigest", "attemptCapability"];

export default function horsenessPiNativeExtension(pi) {
  const attempts = new Map();
  pi.registerTool({
    name: "horseness_worker_return",
    label: "Horseness Worker Return",
    description: "Return adapter-owned output, evidence, receipt, and a sealed proposal to the local Horseness coordinator.",
    parameters: { type: "object", additionalProperties: false, required: ["binding", "output", "evidence", "receipt", "proposal"], properties: { binding: { type: "object" }, output: { type: "object" }, evidence: { type: "object" }, receipt: { type: "object" }, proposal: { type: "object" } } },
    async execute(_toolCallId, input) {
      for (const field of REQUIRED_BINDING_FIELDS) if (input.binding?.[field] === undefined) throw new Error(`missing immutable binding field: ${field}`);
      const attemptKey = `${input.binding.attemptId}:${input.binding.generation}`;
      const prior = attempts.get(attemptKey);
      if (prior && JSON.stringify(prior.binding) !== JSON.stringify(input.binding)) throw new Error("immutable binding substitution");
      attempts.set(attemptKey, structuredClone(input));
      return { content: [{ type: "text", text: "Horseness worker return captured for adapter delivery." }], details: { attemptKey, sealedProposalDigest: input.proposal.proposalDigest, receiptDigest: input.receipt.receiptDigest } };
    },
  });
  pi.on("session_before_fork", async () => ({ cancel: false }));
  pi.on("session_shutdown", async () => { attempts.clear(); });
}
