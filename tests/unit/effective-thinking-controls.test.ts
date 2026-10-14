import assert from "node:assert/strict";
import test from "node:test";

// Failure modes: catalog controls disagree with wire caps; max is downgraded
// across Chat -> Responses; aliases pretend to be configurable; new providers
// need client edits; budget aliases invent native tiers; Kiro effort or native
// tool history disappears; unsupported Kiro schemas receive adaptive fields.
const core = await import("../../src/lib/db/core.ts");
const registry = await import("../../src/lib/modelMetadataRegistry.ts");
const { CodexExecutor } = await import("../../open-sse/executors/codex.ts");
const { openaiToOpenAIResponsesRequest } =
  await import("../../open-sse/translator/request/openai-responses.ts");
const { buildKiroPayload } = await import("../../open-sse/translator/request/openai-to-kiro.ts");

test.after(() => core.resetDbInstance());

function controls(provider: string, model: string) {
  const entry = registry.enrichCatalogModelEntry({
    id: `${provider}/${model}`,
    root: model,
    owned_by: provider,
  }) as Record<string, unknown>;
  return (entry.capabilities as Record<string, unknown>).thinking_controls as {
    kind: string;
    level_map?: Record<string, string | null>;
  };
}

function codexWire(model: string, effort: string) {
  const translated = openaiToOpenAIResponsesRequest(
    `codex/${model}`,
    { messages: [{ role: "user", content: "Inspect the constraint." }], reasoning_effort: effort },
    true,
    {}
  );
  return new CodexExecutor().transformRequest(model, translated, false, {
    requestEndpointPath: "/responses",
  }) as Record<string, unknown>;
}

test("catalog max survives Chat -> Responses -> Codex for Astra, Luna, and GPT-6.1 Sol", () => {
  for (const model of ["gpt-6-astra", "gpt-6-luna", "gpt-6.1-sol"]) {
    const advertised = controls("codex", model);
    assert.equal(advertised.level_map?.max, "max", model);
    const wire = codexWire(model, "max");
    assert.equal((wire.reasoning as Record<string, unknown>).effort, "max", model);
  }
});

test("lower Codex caps and fixed aliases agree with catalog controls", () => {
  assert.equal(controls("codex", "gpt-5-mini").level_map?.max, null);
  assert.equal(
    (codexWire("gpt-5-mini", "max").reasoning as Record<string, unknown>).effort,
    "high"
  );
  const fixed = controls("codex", "gpt-6-astra-high");
  assert.equal(fixed.kind, "fixed");
  assert.equal(fixed.level_map?.high, "high");
  assert.equal(fixed.level_map?.max, null);
  assert.equal(
    (codexWire("gpt-6-astra-high", "max").reasoning as Record<string, unknown>).effort,
    "high"
  );
  assert.equal(controls("codex", "gpt-5.1-codex-max").kind, "native");
});

test("documented Kiro controls preserve adaptive effort, output windows, and tool history", () => {
  const profiles = [
    ["claude-opus-4.6", 64000, false],
    ["claude-opus-4.7", 64000, true],
    ["claude-opus-4.8", 128000, true],
    ["claude-opus-5", 128000, true],
    ["claude-opus-5.5", 128000, true],
    ["claude-sonnet-4.6", 64000, false],
    ["claude-sonnet-5", 128000, true],
    ["claude-sonnet-5.5", 64000, true],
  ] as const;
  for (const [model, cap, xhigh] of profiles) {
    const advertised = controls("kiro", model);
    assert.equal(advertised.level_map?.max, "max", model);
    assert.equal(advertised.level_map?.xhigh, xhigh ? "xhigh" : null, model);
    const payload = buildKiroPayload(
      model,
      {
        reasoning_effort: "max",
        max_tokens: 128000,
        temperature: 0.2,
        top_p: 0.8,
        tools: [
          {
            type: "function",
            function: {
              name: "read",
              description: "Read a file",
              parameters: {
                type: "object",
                properties: { path: { type: "string" } },
                required: ["path"],
              },
            },
          },
        ],
        messages: [
          { role: "user", content: "Inspect the file." },
          {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "call_read",
                type: "function",
                function: { name: "read", arguments: '{"path":"config.json"}' },
              },
            ],
          },
          { role: "tool", tool_call_id: "call_read", content: '{"mode":"max"}' },
          { role: "user", content: "Explain the constraint." },
        ],
      },
      true,
      null
    );
    assert.equal(payload.additionalModelRequestFields?.output_config?.effort, "max", model);
    assert.equal(payload.additionalModelRequestFields?.max_tokens, cap, model);
    assert.equal(payload.additionalModelRequestFields?.thinking?.type, "adaptive", model);
    assert.equal(payload.inferenceConfig?.temperature, undefined, model);
    assert.equal(payload.inferenceConfig?.topP, undefined, model);
    assert.ok(payload.conversationState.history.length >= 2, model);
    assert.ok(
      payload.conversationState.currentMessage.userInputMessage.userInputMessageContext?.tools
        ?.length,
      model
    );
  }
});

test("unsupported Kiro schemas do not gain adaptive fields or advertised max", () => {
  const payload = buildKiroPayload(
    "claude-sonnet-4.5",
    {
      messages: [{ role: "user", content: "Inspect the constraint." }],
      reasoning_effort: "max",
    },
    false,
    null
  );
  assert.equal(payload.additionalModelRequestFields, undefined);
  assert.equal(controls("kiro", "claude-sonnet-4.5").kind, "unknown");
});

test("future provider declarations, budget aliases, and unknown/dynamic routes stay distinct", async () => {
  const { resolveEffectiveThinkingControls: resolve } =
    await import("../../src/shared/reasoning/effectiveThinkingControls.ts");
  const future = resolve({
    provider: "future-provider",
    model: "new-reasoner",
    reasoning: true,
    declaredEfforts: ["low", "high", "xhigh", "max"],
  });
  assert.equal(future.level_map?.max, "max");
  assert.equal(future.level_map?.medium, null);
  const budget = resolve({
    provider: "antigravity",
    model: "gemini-3.8-flash-tiered",
    reasoning: true,
    thinkingBudgetCap: 24576,
    defaultThinkingBudget: 8192,
  });
  assert.equal(budget.kind, "budget");
  assert.equal(budget.level_map?.max, null);
  assert.equal(budget.level_map?.xhigh, null);
  assert.equal(budget.budgets?.high, 24576);
  assert.deepEqual(budget.aliases, { xhigh: "high", max: "high" });
  assert.equal(resolve({ provider: "unknown", model: "new", reasoning: true }).kind, "unknown");
  assert.equal(
    resolve({ provider: "kiro", model: "constructor", reasoning: true }).kind,
    "unknown"
  );
  assert.equal(resolve({ provider: "auto", model: "smart", reasoning: true }).level_map, undefined);
  const disabled = resolve({
    id: "no-think/kiro/claude-opus-4.6",
    provider: "kiro",
    reasoning: true,
  });
  assert.equal(disabled.level_map?.off, "none");
  assert.equal(disabled.level_map?.max, null);
});
