"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Terminal,
  X,
  Maximize2,
  Minimize2,
  Copy,
  Check,
  Trash2,
  Send,
} from "lucide-react";
import type { Socket } from "socket.io-client";
import { EventBus } from "@/game/EventBus";
import type { NpcChatMessage } from "@/components/NpcDialog";

export interface LogEntry {
  id: string;
  timestamp: string;
  type: "system" | "tool" | "thinking" | "stdout" | "input" | "error";
  text: string;
  toolName?: string;
}

export interface AgentTerminalModalProps {
  npcId: string;
  npcName: string;
  socket: Socket | null;
  characterId?: string;
  onClose: () => void;
  availableAgents?: Array<{ id: string; name: string }>;
  onSelectAgent?: (agent: { id: string; name: string }) => void;
}

function formatTime(d = new Date()): string {
  return d.toTimeString().split(" ")[0];
}

export default function AgentTerminalModal({
  npcId,
  npcName,
  socket,
  characterId,
  onClose,
  availableAgents = [],
  onSelectAgent,
}: AgentTerminalModalProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [commandInput, setCommandInput] = useState("");
  const [isMaximized, setIsMaximized] = useState(false);
  const [copied, setCopied] = useState(false);
  const [currentActivity, setCurrentActivity] = useState<string | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);

  const terminalBodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const autoScrollRef = useRef(true);

  // Initialize terminal banner
  useEffect(() => {
    setLogs([
      {
        id: "banner-1",
        timestamp: formatTime(),
        type: "system",
        text: `═════════════════════════════════════════════════════════════════════`,
      },
      {
        id: "banner-2",
        timestamp: formatTime(),
        type: "system",
        text: ` DESKRPG WORKSTATION CONSOLE v1.2.0 [AGENT TERMINAL]`,
      },
      {
        id: "banner-3",
        timestamp: formatTime(),
        type: "system",
        text: ` ATTACHED AGENT: [${npcName.toUpperCase()}]  |  TARGET_ID: ${npcId}`,
      },
      {
        id: "banner-4",
        timestamp: formatTime(),
        type: "system",
        text: ` PROTOCOL: POSIX / HERMES RUNTIME STREAM  |  STATUS: ONLINE`,
      },
      {
        id: "banner-5",
        timestamp: formatTime(),
        type: "system",
        text: `═════════════════════════════════════════════════════════════════════`,
      },
      {
        id: "banner-6",
        timestamp: formatTime(),
        type: "system",
        text: `[SYSTEM] Session stream initialized. Listening for tool calls & stdout...`,
      },
    ]);
  }, [npcId, npcName]);

  // Request past history on load
  useEffect(() => {
    if (!socket || !socket.connected) return;
    socket.emit("npc:history", { npcId });

    const handleHistory = (data: { npcId: string; messages: NpcChatMessage[] }) => {
      if (data.npcId !== npcId || !Array.isArray(data.messages)) return;
      const historyEntries: LogEntry[] = data.messages.map((m, idx) => ({
        id: `hist-${idx}-${Date.now()}`,
        timestamp: formatTime(),
        type: m.role === "player" ? "input" : "stdout",
        text: m.role === "player" ? `➜ user: ${m.content}` : `[OUTPUT] ${m.content}`,
      }));
      setLogs((prev) => [...prev, ...historyEntries]);
    };

    socket.on("npc:history", handleHistory);
    return () => {
      socket.off("npc:history", handleHistory);
    };
  }, [socket, npcId]);

  // Listen to live activity & response streaming from socket
  useEffect(() => {
    if (!socket) return;

    const handleActivity = (data: { npcId: string; activityKey?: string | null }) => {
      if (data.npcId !== npcId) return;
      const key = data.activityKey ?? null;
      setCurrentActivity(key);
      if (key) {
        setIsExecuting(true);
        setLogs((prev) => [
          ...prev,
          {
            id: `act-${Date.now()}-${Math.random()}`,
            timestamp: formatTime(),
            type: key.includes("thinking") ? "thinking" : "tool",
            text: `⚙ [EXEC] ${key}`,
            toolName: key,
          },
        ]);
      } else {
        setIsExecuting(false);
      }
    };

    const handleResponse = (data: { npcId: string; chunk?: string; done?: boolean }) => {
      if (data.npcId !== npcId) return;
      const chunk = data.chunk;
      if (chunk) {
        setLogs((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.type === "stdout" && !last.text.includes("\n\n")) {
            return [
              ...prev.slice(0, -1),
              { ...last, text: last.text + chunk },
            ];
          }
          return [
            ...prev,
            {
              id: `resp-${Date.now()}-${Math.random()}`,
              timestamp: formatTime(),
              type: "stdout",
              text: chunk,
            },
          ];
        });
      }
      if (data.done) {
        setIsExecuting(false);
        setCurrentActivity(null);
      }
    };

    socket.on("npc:activity", handleActivity);
    socket.on("npc:response", handleResponse);

    return () => {
      socket.off("npc:activity", handleActivity);
      socket.off("npc:response", handleResponse);
    };
  }, [socket, npcId]);

  // Auto-scroll handler
  useEffect(() => {
    if (autoScrollRef.current && terminalBodyRef.current) {
      terminalBodyRef.current.scrollTop = terminalBodyRef.current.scrollHeight;
    }
  }, [logs]);

  // ESC hotkey to close, Ctrl+L to clear
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "l" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setLogs([]);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Focus input on open
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSendCommand = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      const trimmed = commandInput.trim();
      if (!trimmed) return;

      const userTime = formatTime();
      setLogs((prev) => [
        ...prev,
        {
          id: `cmd-${Date.now()}`,
          timestamp: userTime,
          type: "input",
          text: `➜ ${npcName.toLowerCase()}@deskrpg:~$ ${trimmed}`,
        },
      ]);
      setCommandInput("");

      if (socket && socket.connected) {
        const sourceMessageId = crypto.randomUUID();
        socket.emit("npc:chat", {
          npcId,
          message: trimmed,
          sourceMessageId,
          characterId: characterId ?? undefined,
        });
        EventBus.emit("chat:speech", {
          actorId: socket.id ?? "player",
          text: trimmed,
        });
      } else {
        setLogs((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            timestamp: formatTime(),
            type: "error",
            text: `[ERROR] Socket not connected. Cannot dispatch command to agent.`,
          },
        ]);
      }
    },
    [commandInput, socket, npcId, npcName, characterId],
  );

  const handleCopyLogs = useCallback(() => {
    const plainText = logs.map((l) => `[${l.timestamp}] ${l.text}`).join("\n");
    navigator.clipboard.writeText(plainText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [logs]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 md:p-6 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        className={`flex flex-col rounded-lg border border-[#30363d] bg-[#0d1117] text-[#c9d1d9] shadow-2xl transition-all duration-200 overflow-hidden font-mono ${
          isMaximized ? "w-full h-full max-w-none" : "w-full max-w-[850px] h-[580px]"
        }`}
      >
        {/* Terminal Header Bar */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-[#161b22] border-b border-[#30363d] select-none">
          <div className="flex items-center gap-3">
            {/* Traffic Lights */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={onClose}
                className="w-3 h-3 rounded-full bg-[#ff5f56] hover:brightness-110 active:brightness-90 transition-all flex items-center justify-center group"
                title="Close (Esc)"
                aria-label="Close terminal"
              >
                <X size={8} className="opacity-0 group-hover:opacity-100 text-black/70" />
              </button>
              <button
                type="button"
                onClick={() => setLogs([])}
                className="w-3 h-3 rounded-full bg-[#ffbd2e] hover:brightness-110 active:brightness-90 transition-all flex items-center justify-center group"
                title="Clear screen (Ctrl+L)"
                aria-label="Clear screen"
              >
                <Trash2 size={8} className="opacity-0 group-hover:opacity-100 text-black/70" />
              </button>
              <button
                type="button"
                onClick={() => setIsMaximized((m) => !m)}
                className="w-3 h-3 rounded-full bg-[#27c93f] hover:brightness-110 active:brightness-90 transition-all flex items-center justify-center group"
                title="Toggle Maximize"
                aria-label="Toggle Maximize"
              >
                {isMaximized ? (
                  <Minimize2 size={8} className="opacity-0 group-hover:opacity-100 text-black/70" />
                ) : (
                  <Maximize2 size={8} className="opacity-0 group-hover:opacity-100 text-black/70" />
                )}
              </button>
            </div>

            {/* Title & Agent Indicator */}
            <div className="flex items-center gap-2 pl-2 border-l border-[#30363d] text-xs">
              <Terminal size={14} className="text-[#58a6ff]" />
              <span className="font-semibold text-[#f0f6fc]">
                {npcName.toLowerCase()}@workstation:~$
              </span>
              <span className="text-[#8b949e] hidden sm:inline">[tty/1]</span>
            </div>
          </div>

          {/* Right Header Controls */}
          <div className="flex items-center gap-2">
            {/* Live State Badge */}
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] bg-[#21262d] border border-[#30363d]">
              <span
                className={`w-2 h-2 rounded-full ${
                  isExecuting ? "bg-[#f1e05a] animate-pulse" : "bg-[#238636]"
                }`}
              />
              <span className="font-medium text-[#8b949e]">
                {currentActivity
                  ? currentActivity.replace("npc.activity.", "").toUpperCase()
                  : "IDLE"}
              </span>
            </div>

            {/* Multi-Agent Switcher if provided */}
            {availableAgents.length > 1 && onSelectAgent && (
              <select
                value={npcId}
                onChange={(e) => {
                  const target = availableAgents.find((a) => a.id === e.target.value);
                  if (target) onSelectAgent(target);
                }}
                className="bg-[#21262d] border border-[#30363d] text-xs text-[#c9d1d9] rounded px-2 py-1 outline-none focus:border-[#58a6ff]"
              >
                {availableAgents.map((ag) => (
                  <option key={ag.id} value={ag.id}>
                    {ag.name}
                  </option>
                ))}
              </select>
            )}

            {/* Copy Button */}
            <button
              type="button"
              onClick={handleCopyLogs}
              className="p-1 rounded text-[#8b949e] hover:text-[#f0f6fc] hover:bg-[#21262d] transition-colors"
              title="Copy terminal logs"
              aria-label="Copy logs"
            >
              {copied ? <Check size={14} className="text-[#3fb950]" /> : <Copy size={14} />}
            </button>

            {/* Close Button */}
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded text-[#8b949e] hover:text-[#f0f6fc] hover:bg-[#21262d] transition-colors"
              title="Close terminal"
              aria-label="Close"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Terminal Body */}
        <div
          ref={terminalBodyRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            autoScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
          }}
          className="flex-1 p-3 overflow-y-auto space-y-1 text-xs select-text leading-relaxed tracking-wide scrollbar-thin scrollbar-thumb-[#30363d] scrollbar-track-transparent"
        >
          {logs.map((log) => {
            let textColor = "text-[#c9d1d9]";
            if (log.type === "system") textColor = "text-[#58a6ff]";
            else if (log.type === "tool") textColor = "text-[#d29922]";
            else if (log.type === "thinking") textColor = "text-[#bc8cff]";
            else if (log.type === "input") textColor = "text-[#3fb950] font-semibold";
            else if (log.type === "error") textColor = "text-[#f85149]";

            return (
              <div key={log.id} className="flex items-start gap-2 hover:bg-[#161b22]/50 px-1 py-0.5 rounded">
                <span className="text-[#484f58] select-none shrink-0 font-mono">
                  [{log.timestamp}]
                </span>
                <span className={`break-words whitespace-pre-wrap ${textColor}`}>
                  {log.text}
                </span>
              </div>
            );
          })}
        </div>

        {/* Interactive CLI Prompt Bar */}
        <form
          onSubmit={handleSendCommand}
          className="flex items-center gap-2 px-3 py-2 bg-[#161b22] border-t border-[#30363d]"
        >
          <div className="flex items-center gap-1 text-[#3fb950] shrink-0 font-semibold select-none text-xs">
            <span>{npcName.toLowerCase()}</span>
            <span className="text-[#8b949e]">@</span>
            <span>deskrpg</span>
            <span className="text-[#c9d1d9]">:</span>
            <span className="text-[#58a6ff]">~</span>
            <span>$</span>
          </div>
          <input
            ref={inputRef}
            type="text"
            value={commandInput}
            onChange={(e) => setCommandInput(e.target.value)}
            placeholder={`Execute command or talk to ${npcName}...`}
            className="flex-1 bg-transparent text-xs text-[#f0f6fc] outline-none placeholder:text-[#484f58] font-mono"
          />
          <button
            type="submit"
            disabled={!commandInput.trim()}
            className="px-2.5 py-1 rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 disabled:hover:bg-emerald-700 text-white text-xs font-medium flex items-center gap-1 transition-all"
          >
            <Send size={11} />
            <span className="hidden sm:inline">Exec</span>
          </button>
        </form>
      </div>
    </div>
  );
}
