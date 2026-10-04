"use client";

import { useCallback, useEffect, useState } from "react";
import type { Socket } from "socket.io-client";

import { getSocketServerUrl } from "@/lib/socket-url";
import type { ToolApprovalSocket } from "./use-tool-approvals";

export type HermesApprovalSocketState = {
  socket: ToolApprovalSocket | null;
  connected: boolean;
  reconnect: () => void;
};

/**
 * Opens the authenticated realtime channel used by Hermes approval requests.
 *
 * The approval registry is intentionally process-local and sends still-pending requests when a
 * user socket connects. This hook therefore owns only transport lifecycle; approval state remains
 * in `ToolApprovalsProvider`, the same source used by the in-game approval cards.
 *
 * Complexity: O(1) local state and O(1) socket listeners. Cleanup always disconnects the socket so
 * navigating away cannot leave a second authenticated approval consumer behind.
 */
export function useHermesApprovalSocket(): HermesApprovalSocketState {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let socketInstance: Socket | null = null;

    import("socket.io-client").then(({ io }) => {
      if (cancelled) return;
      socketInstance = io(getSocketServerUrl(), {
        path: "/socket.io",
        transports: ["websocket"],
        upgrade: false,
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 500,
        reconnectionDelayMax: 3000,
        timeout: 10000,
      });

      const handleConnect = () => setConnected(true);
      const handleDisconnect = () => setConnected(false);
      socketInstance.on("connect", handleConnect);
      socketInstance.on("disconnect", handleDisconnect);
      setSocket(socketInstance);
      setConnected(socketInstance.connected);
    });

    return () => {
      cancelled = true;
      if (!socketInstance) return;
      socketInstance.removeAllListeners("connect");
      socketInstance.removeAllListeners("disconnect");
      socketInstance.disconnect();
      setSocket(null);
      setConnected(false);
    };
  }, []);

  const reconnect = useCallback(() => {
    socket?.disconnect();
    socket?.connect();
  }, [socket]);

  return { socket, connected, reconnect };
}
