// ============================================================================
// CONTEXT RUNWAY DEFLATION SHIELD
// When the payload approaches the model's context ceiling, intelligently
// truncates the MIDDLE of chat history while anchoring the system prompt
// and the most recent exchange — preventing the "Compaction Death Loop".
// ============================================================================

import type { ChatMessage } from "../types";

export interface DeflateResult {
  trimmed: boolean;
  originalSize: number;
  finalSize: number;
  pairsRemoved: number;
}

/**
 * Deflates context by evicting the OLDEST user+assistant pairs atomically.
 * Atomic pair eviction is critical — orphaned assistant messages without
 * their user turn confuse models that expect strict turn alternation.
 *
 * Mutates the `messages` array in-place.
 */
export function deflateContext(
  messages: ChatMessage[],
  maxChars: number,
  targetChars: number
): DeflateResult {
  const originalSize = JSON.stringify(messages).length;

  if (originalSize <= maxChars) {
    return { trimmed: false, originalSize, finalSize: originalSize, pairsRemoved: 0 };
  }

  console.log(
    `[SHIELD] Payload ${originalSize.toLocaleString()} chars exceeds limit (${maxChars.toLocaleString()}). Deflating…`
  );

  // Separate system message from conversational history
  const sysMsg = messages.find((m) => m.role === "system");
  let history = messages.filter((m) => m.role !== "system");
  let pairsRemoved = 0;

  while (JSON.stringify(history).length > targetChars && history.length > 2) {
    const first = history[0];
    const second = history[1];

    if (first?.role === "user" && second?.role === "assistant") {
      // ✅ Evict a complete user+assistant pair — maintains turn structure
      history.splice(0, 2);
      pairsRemoved++;
    } else {
      // Orphan fallback: single-message eviction (rare but safe)
      history.shift();
    }
  }

  // Rebuild messages array in-place
  messages.length = 0;
  if (sysMsg) messages.push(sysMsg);
  messages.push(...history);

  const finalSize = JSON.stringify(messages).length;
  console.log(
    `[SHIELD] Stabilized at ${finalSize.toLocaleString()} chars` +
      (pairsRemoved > 0 ? ` (removed ${pairsRemoved} message pair${pairsRemoved > 1 ? "s" : ""})` : "")
  );

  return { trimmed: true, originalSize, finalSize, pairsRemoved };
}
