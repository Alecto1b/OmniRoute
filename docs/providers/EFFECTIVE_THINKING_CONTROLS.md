---
title: "Effective thinking controls"
---

# Effective thinking controls

Catalog enrichment adds `capabilities.thinking_controls` to concrete model records when canonical metadata is available. Clients consume `level_map` without maintaining their own provider/model allowlist. The resolver is `src/shared/reasoning/effectiveThinkingControls.ts`; `src/lib/modelMetadataRegistry.ts` publishes its result. Existing capability fields remain compatible.

`kind` describes the effective control: `native`, `budget`, `fixed`, `none`, `unknown`, or `dynamic`. A `level_map` uses host keys `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`. Values are wire effort strings; `null` marks an unsupported control. For example, Codex GPT-6 Astra publishes:

```json
{
  "kind": "native",
  "level_map": {
    "off": null,
    "minimal": null,
    "low": "low",
    "medium": "medium",
    "high": "high",
    "xhigh": "xhigh",
    "max": "max"
  }
}
```

The Codex executor shares the resolver's effective wire cap. The Chat-to-Responses translator preserves native Max for GPT-6.1 Sol. Codex Ultra is a client preset sent as Max, so it is an alias rather than an extra host level. Fixed Codex effort aliases expose only their fixed tier; genuine model names such as `gpt-5.1-codex-max` remain configurable.

Kiro's adaptive gate and output cap use the same profile table as catalog controls. Profiles follow [Kiro's configuration schemas](https://kiro.dev/docs/models/effort/), with Opus 5.5 retained from installed-route verification. Opus/Sonnet 4.6 omit Xhigh; later documented profiles expose Xhigh and Max. Unsupported Kiro schemas retain `unknown` controls and do not receive adaptive fields merely because a generic Anthropic flag advertises thinking. Route output ceilings are applied by the translator; this change does not rewrite all existing catalog token-limit fields.

The current Gemini effort translator uses numeric budgets. Budget controls include `budgets` and `aliases`: when Xhigh and Max resolve to the High budget, the map disables the extra host choices. Equal numeric presets are collapsed. Generic advertised `effort_tiers` do not prove that every tier changes upstream behavior.

Unknown or dynamic controls may omit `level_map`; clients should retain their documented conservative fallback. Auto routes that bypass canonical enrichment can omit the entire field. No-think aliases publish a fixed Off control. Provider-declared native vocabularies can supply effective controls for additional providers without a client edit. Controls describe the adapter contract, do not prove account access, and do not prescribe a fixed number of reasoning tokens.

The focused test `tests/unit/effective-thinking-controls.test.ts` exercises catalog enrichment, Chat-to-Responses-to-Codex effort preservation, Kiro envelopes with prior tool history, output caps, and unknown/budget/declaration behavior. It uses the isolated test data directory:

```bash
node --import tsx/esm --import ./tests/_setup/isolateDataDir.ts tests/unit/effective-thinking-controls.test.ts
```

This fork preserves the source patch against installed baseline `v3.8.51`, without distribution chunks or personal configuration. Reconcile with the active upstream release before a contribution PR; the full CI/build matrix is separate from focused local verification. The changelog fragment uses prefix `0` until a PR number is assigned.

Local verification: 28 tests in seven focused files pass, including the five new catalog/adapter behavior tests. The new resolver typecheck and ESLint on changed TypeScript files pass, as does `npm run check:docs-all`. The repository-wide `npm run lint` exits with unused-suppression entries; the same gate reports no such failure on the changed files. No blanket suppression pruning or full CI/build success is claimed for this fork snapshot.
