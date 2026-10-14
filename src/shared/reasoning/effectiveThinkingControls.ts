/** Effective client controls, shared by catalog publication and installed adapters. */
export const HOST_THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export type ThinkingLevelMap = Record<string, string | null>;
export type EffectiveThinkingControls = {
  kind: "native" | "budget" | "fixed" | "none" | "unknown" | "dynamic";
  level_map?: ThinkingLevelMap;
  aliases?: Record<string, string>;
  budgets?: Record<string, number>;
};

// Kiro's configuration schemas differ from the direct Anthropic API.
// This is adapter data, not a client model allowlist.
export const KIRO_THINKING_PROFILES: Record<string, { efforts: string[]; maxTokens: number }> = {
  "claude-opus-4.6": { efforts: ["low", "medium", "high", "max"], maxTokens: 64000 },
  "claude-opus-4.7": { efforts: ["low", "medium", "high", "xhigh", "max"], maxTokens: 64000 },
  "claude-opus-4.8": { efforts: ["low", "medium", "high", "xhigh", "max"], maxTokens: 128000 },
  "claude-opus-5": { efforts: ["low", "medium", "high", "xhigh", "max"], maxTokens: 128000 },
  "claude-opus-5.5": { efforts: ["low", "medium", "high", "xhigh", "max"], maxTokens: 128000 },
  "claude-sonnet-4.6": { efforts: ["low", "medium", "high", "max"], maxTokens: 64000 },
  "claude-sonnet-5": { efforts: ["low", "medium", "high", "xhigh", "max"], maxTokens: 128000 },
  "claude-sonnet-5.5": { efforts: ["low", "medium", "high", "xhigh", "max"], maxTokens: 64000 },
};

export function getKiroThinkingProfile(model: string) {
  return Object.hasOwn(KIRO_THINKING_PROFILES, model) ? KIRO_THINKING_PROFILES[model] : null;
}

/** Codex's wire cap: Ultra is a client preset whose upstream effort is Max. */
export function getEffectiveCodexEffortCap(model: string): "high" | "xhigh" | "max" {
  const bare = model.replace(/^(?:codex|cx)\//, "");
  if (/^gpt-(?:6\.1-sol|6-(?:astra|sol|luna)|5\.6-(?:sol|terra|luna))$/.test(bare)) return "max";
  if (["gpt-5-mini", "gpt-5.1-mini", "gpt-4.1-mini"].includes(bare)) return "high";
  return "xhigh";
}

function mapEfforts(efforts: readonly string[]): ThinkingLevelMap {
  const map: ThinkingLevelMap = Object.fromEntries(
    HOST_THINKING_LEVELS.map((level) => [level, null])
  );
  for (const value of efforts) {
    const level = value === "none" ? "off" : value;
    if (HOST_THINKING_LEVELS.includes(level as (typeof HOST_THINKING_LEVELS)[number]))
      map[level] = value;
  }
  return map;
}

export function resolveEffectiveThinkingControls(input: {
  id?: string;
  provider?: string | null;
  model?: string;
  reasoning?: boolean;
  declaredEfforts?: readonly string[] | null;
  thinkingBudgetCap?: number | null;
  defaultThinkingBudget?: number;
}): EffectiveThinkingControls {
  const id = input.id ?? "";
  const provider = (input.provider ?? "").toLowerCase();
  const model = (input.model ?? id.split("/").slice(1).join("/")).toLowerCase();
  if (id.startsWith("no-think/")) return { kind: "fixed", level_map: mapEfforts(["none"]) };
  if (provider === "auto" || provider === "combo" || id === "auto" || id.startsWith("auto/"))
    return { kind: "dynamic" };
  if (!input.reasoning) return { kind: "none", level_map: mapEfforts(["none"]) };

  if (provider === "codex" || provider === "cx") {
    const candidate = /(?:-(none|low|medium|high|xhigh|max|ultra)|\((max|ultra)\))$/.exec(model);
    const candidateBase = candidate ? model.slice(0, -candidate[0].length) : model;
    const aliasTier = candidate?.[1] ?? candidate?.[2];
    const hasMaxAlias = /^gpt-(?:6-(?:astra|sol|luna)|5\.6-(?:sol|terra|luna))$/.test(
      candidateBase
    );
    const hasUltraAlias = /^gpt-(?:6-(?:astra|sol)|5\.6-(?:sol|terra))$/.test(candidateBase);
    // Match the executor's suffix contract: e.g. gpt-5.1-codex-max is a
    // genuine model name, whereas gpt-6-astra-max is a fixed-effort alias.
    let supportedAlias = true;
    if (candidate?.[2] || aliasTier === "max") supportedAlias = hasMaxAlias;
    else if (aliasTier === "ultra") supportedAlias = hasUltraAlias;
    const suffix = candidate && supportedAlias ? candidate : null;
    const base = suffix ? candidateBase : model;
    const cap = getEffectiveCodexEffortCap(base);
    const order = ["none", "low", "medium", "high", "xhigh", "max"];
    const wire = (effort: string) => {
      const native = effort === "ultra" ? "max" : effort;
      return order.indexOf(native) > order.indexOf(cap) ? cap : native;
    };
    if (suffix && aliasTier)
      return {
        kind: "fixed",
        level_map: mapEfforts([wire(aliasTier)]),
        ...(aliasTier === "ultra" ? { aliases: { ultra: "max" } } : {}),
      };
    const native = [
      "low",
      "medium",
      "high",
      ...(cap !== "high" ? ["xhigh"] : []),
      ...(cap === "max" ? ["max"] : []),
    ];
    if (!/^gpt-(?:6-astra|6\.1-sol)$/.test(base)) native.unshift("none");
    return {
      kind: "native",
      level_map: mapEfforts(native),
      ...(hasUltraAlias ? { aliases: { ultra: "max" } } : {}),
    };
  }

  if (provider === "kiro" || provider === "kr") {
    const base = model
      .replace(/-(low|medium|high|xhigh|max|thinking)$/, "")
      .replace(/^(claude-(?:opus|sonnet|haiku)-\d+)-(\d{1,2})$/, "$1.$2");
    const profile = getKiroThinkingProfile(base);
    if (profile) return { kind: "native", level_map: mapEfforts(profile.efforts) };
    if (/^gpt-5\.6-(?:sol|terra|luna)$/.test(base))
      return { kind: "native", level_map: mapEfforts(["low", "medium", "high", "xhigh", "max"]) };
    return { kind: "unknown" };
  }

  // These adapters translate effort into numeric budgets. Identical budgets are
  // one effective choice; a canonical xhigh/max label cannot create a new tier.
  if (
    /^(?:google|gemini|vertex|vertex-partner|antigravity|agy)$/.test(provider) &&
    /(?:gemini|claude)/.test(model)
  ) {
    const cap = input.thinkingBudgetCap ?? 32768;
    if (cap <= 0) return { kind: "unknown" };
    const budgets: Record<string, number> = {
      low: Math.min(1024, cap),
      medium: Math.min(input.defaultThinkingBudget || 8192, cap),
      high: Math.min(32768, cap),
    };
    const seen = new Set<number>();
    const levels = Object.keys(budgets).filter((level) => {
      if (seen.has(budgets[level])) return false;
      seen.add(budgets[level]);
      return true;
    });
    if (/gemini-2\.5-.*flash/.test(model)) levels.unshift("none");
    const top = levels.filter((level) => level !== "none").at(-1) ?? "high";
    return {
      kind: "budget",
      level_map: mapEfforts(levels),
      budgets,
      aliases: { xhigh: top, max: top },
    };
  }

  // Provider-declared vocabularies work for future providers without client
  // changes. A fallback canonical vocabulary is not authoritative evidence.
  if (Array.isArray(input.declaredEfforts) && input.declaredEfforts.length > 0) {
    const efforts = input.declaredEfforts
      .filter((value) => typeof value === "string")
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value !== "ultra");
    if (
      efforts.some(
        (value) =>
          value === "none" ||
          HOST_THINKING_LEVELS.includes(value as (typeof HOST_THINKING_LEVELS)[number])
      )
    ) {
      return { kind: "native", level_map: mapEfforts(efforts) };
    }
  }
  return { kind: "unknown" };
}
