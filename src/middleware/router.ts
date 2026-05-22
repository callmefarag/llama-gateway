// ============================================================================
// INTENT ROUTING ENGINE
// Config-driven model routing — no more hardcoded if/else chains.
// Rules are evaluated in order; first match wins.
// ============================================================================

import type { RouterContext, RoutingRule } from "../types";

export interface RouteResult {
  model: string;
  ruleName: string;
}

/**
 * Evaluates routing rules in order and returns the first matching model.
 * Falls back to `defaultModel` if no rule matches.
 */
export function resolveModel(
  rules: RoutingRule[],
  defaultModel: string,
  ctx: RouterContext
): RouteResult {
  for (const rule of rules) {
    switch (rule.condition) {
      case "has_images":
        if (ctx.hasImages) {
          return { model: rule.model, ruleName: rule.name };
        }
        break;

      case "system_contains":
        if (
          rule.keywords?.some((kw) =>
            ctx.systemPrompt.includes(kw.toLowerCase())
          )
        ) {
          return { model: rule.model, ruleName: rule.name };
        }
        break;

      case "user_contains":
        if (
          rule.keywords?.some((kw) =>
            ctx.userPrompt.includes(kw.toLowerCase())
          )
        ) {
          return { model: rule.model, ruleName: rule.name };
        }
        break;

      case "prompt_contains": {
        const combined = ctx.systemPrompt + " " + ctx.userPrompt;
        if (
          rule.keywords?.some((kw) => combined.includes(kw.toLowerCase()))
        ) {
          return { model: rule.model, ruleName: rule.name };
        }
        break;
      }
    }
  }

  return { model: defaultModel, ruleName: "default" };
}
