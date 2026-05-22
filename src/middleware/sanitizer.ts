// ============================================================================
// VISION SANITIZER
// Intercepts modern Chromium clipboard artifacts (WebP) and malformed Base64
// strings, repairing them before they reach the strict C++ llama engine.
// ============================================================================

import type { ChatMessage, ContentPart } from "../types";

// Minimal valid 1x1 transparent PNG — replaces WebP history images
const BLANK_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

export interface SanitizeResult {
  hasImages: boolean;
  combinedTextContent: string;
}

/**
 * Walks all messages, sanitizes vision payloads, and collects text content.
 * Mutates message parts in-place (avoids a full deep clone).
 */
export function sanitizeMessages(messages: ChatMessage[]): SanitizeResult {
  let hasImages = false;
  let combinedTextContent = "";

  for (const msg of messages) {
    // Plain string content — just collect text
    if (typeof msg.content === "string") {
      combinedTextContent += " " + msg.content;
      continue;
    }

    // Multi-part content — inspect each part
    if (Array.isArray(msg.content)) {
      for (const part of msg.content as ContentPart[]) {
        if (part.type === "text" && part.text) {
          combinedTextContent += " " + part.text;
          continue;
        }

        if (part.type === "image_url" && part.image_url?.url) {
          hasImages = true;
          const url = part.image_url.url;

          // ── Case 1: WebP from Chromium clipboard → neutralize ──────────
          if (url.startsWith("data:image/webp")) {
            console.log("[SHIELD] Neutralized WebP clipboard image → 1×1 PNG");
            part.image_url.url = BLANK_PNG;
            continue;
          }

          // ── Case 2: Malformed Base64 (line breaks, URL-safe chars, padding) ──
          if (url.startsWith("data:image/")) {
            const splitIdx = url.indexOf(";base64,");
            if (splitIdx !== -1) {
              const prefix = url.slice(0, splitIdx + 8); // includes ";base64,"
              let b64 = url.slice(splitIdx + 8);

              b64 = b64
                .replace(/[\r\n\s]|\\n|\\r/g, "") // strip whitespace / escaped newlines
                .replace(/-/g, "+") // URL-safe → standard Base64
                .replace(/_/g, "/");

              // Fix missing padding
              while (b64.length % 4 !== 0) b64 += "=";

              part.image_url.url = prefix + b64;
              console.log("[SHIELD] Repaired malformed Base64 image");
            }
          }
        }
      }
    }
  }

  return { hasImages, combinedTextContent };
}
