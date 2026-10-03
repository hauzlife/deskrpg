"use client";

import { useEffect, useState, useCallback } from "react";

export interface WorkspaceChannel {
  id: string;
  name: string;
  [key: string]: unknown;
}

const STORAGE_KEY = "deskrpg:workspace:selected-channel";

export function useWorkspaceChannels() {
  const [channels, setChannels] = useState<WorkspaceChannel[]>([]);
  const [selectedChannelId, setSelectedChannelIdState] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    try {
      return window.localStorage.getItem(STORAGE_KEY) || "";
    } catch {
      return "";
    }
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const setSelectedChannelId = useCallback((id: string) => {
    setSelectedChannelIdState(id);
    try {
      if (id) {
        window.localStorage.setItem(STORAGE_KEY, id);
      } else {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // Ignore localStorage errors (private browsing, etc.)
    }
  }, []);

  useEffect(() => {
    let alive = true;
    fetch("/api/channels")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (!alive) return;
        const list = Array.isArray(data.channels) ? data.channels : [];
        setChannels(list);
        if (list.length > 0) {
          setSelectedChannelIdState((prev) => {
            const hasMatch = prev && (prev === "all" || list.some((c: { id: string }) => c.id === prev));
            const chosen = hasMatch ? prev : list[0].id;
            try {
              window.localStorage.setItem(STORAGE_KEY, chosen);
            } catch {
              // ignore
            }
            return chosen;
          });
        }
      })
      .catch((err) => {
        if (alive) {
          setError(err instanceof Error ? err.message : String(err));
          setChannels([]);
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, []);

  return {
    channels,
    selectedChannelId,
    setSelectedChannelId,
    loading,
    error,
  };
}
