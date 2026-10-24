/**
 * Resolves the Socket.IO endpoint used by the browser.
 *
 * The production deployment may expose the realtime server on the next port, while local
 * development lets Socket.IO use the current origin. Keeping the decision in one module prevents
 * pages that consume the same authenticated event stream from silently connecting to different
 * endpoints.
 */
export function getSocketServerUrl(): string | undefined {
  if (typeof window === "undefined") return undefined;

  const explicitUrl = process.env.NEXT_PUBLIC_SOCKET_URL;
  if (explicitUrl) return explicitUrl;

  const { protocol, hostname, port } = window.location;
  const currentPort = Number.parseInt(port, 10);

  // Standalone server running directly on localhost:3000 without reverse proxy
  if ((hostname === "localhost" || hostname === "127.0.0.1") && currentPort === 3000) {
    return `${protocol}//${hostname}:${currentPort + 1}`;
  }

  return undefined;
}
