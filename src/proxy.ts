// ============================================================================
// PROXY HELPER
// Transparently forwards requests to llama-swap.
// SSE-aware: preserves content-type: text/event-stream and all headers.
// ============================================================================

/**
 * Forwards a request to the target URL.
 * @param originalReq   The incoming request from the IDE client.
 * @param targetUrl     The llama-swap URL to forward to.
 * @param mutatedBody   If provided, replaces the original request body.
 */
export async function proxyRequest(
  originalReq: Request,
  targetUrl: string,
  mutatedBody?: string
): Promise<Response> {
  const headers = new Headers(originalReq.headers);
  headers.set("host", "127.0.0.1");

  // Let fetch recalculate content-length when body was mutated
  if (mutatedBody !== undefined) {
    headers.delete("content-length");
  }

  try {
    const upstream = await fetch(targetUrl, {
      method: originalReq.method,
      headers,
      body: mutatedBody !== undefined ? mutatedBody : originalReq.body,
    });

    // Forward all upstream headers, including:
    //   content-type: text/event-stream (SSE streaming)
    //   x-* headers from llama-swap
    const resHeaders = new Headers(upstream.headers);
    resHeaders.set("Access-Control-Allow-Origin", "*");

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: resHeaders,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[PROXY] Cannot reach ${targetUrl}: ${message}`);

    return new Response(
      JSON.stringify({
        error: {
          message: "llama-swap proxy unreachable",
          type: "connection_error",
          code: 502,
        },
      }),
      {
        status: 502,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
