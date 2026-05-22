// ============================================================================
// RAG MEMORY INJECTOR
// Reads local memory.jsonl and injects relevant architectural decisions
// into the system prompt, giving all models a shared project memory.
// ============================================================================

interface MemoryRecord {
  category: string;
  decision: string;
  context: string;
}

/**
 * Builds a memory injection string from the memory.jsonl file.
 * - Always injects the first `alwaysInjectCount` entries.
 * - Also injects any entries whose category/context matches the user prompt.
 * - Returns an empty string if the file doesn't exist or has no entries.
 */
export async function buildMemoryInjection(
  memoryPath: string,
  userPrompt: string,
  alwaysInjectCount: number = 3
): Promise<string> {
  const file = Bun.file(memoryPath);
  if (!(await file.exists())) return "";

  const text = await file.text();
  const lines = text.trim().split("\n").filter(Boolean);
  if (lines.length === 0) return "";

  const promptLower = userPrompt.toLowerCase();
  let injectedCount = 0;
  const entries: string[] = [];

  for (const line of lines) {
    try {
      const record = JSON.parse(line) as MemoryRecord;
      const categoryLower = record.category.toLowerCase();
      const contextLower = record.context.toLowerCase();

      const isRelevant =
        promptLower.includes(categoryLower) ||
        promptLower.includes(contextLower);

      if (isRelevant || injectedCount < alwaysInjectCount) {
        entries.push(
          `- [${record.category.toUpperCase()}] ${record.decision} (${record.context})`
        );
        injectedCount++;
      }
    } catch {
      // Fallback for plain-text lines (non-JSON)
      if (injectedCount < alwaysInjectCount + 1) {
        entries.push(`- ${line}`);
        injectedCount++;
      }
    }
  }

  if (entries.length === 0) return "";

  return (
    "\n\n[PROJECT MEMORY]\nAlways honor these active architectural decisions:\n" +
    entries.join("\n")
  );
}
