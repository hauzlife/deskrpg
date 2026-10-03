"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { EventBus } from "@/game/EventBus";

export interface ThemeToggleProps {
  className?: string;
  showLabel?: boolean;
  size?: number;
}

function subscribeTheme(callback: () => void) {
  const handler = () => callback();
  EventBus.on("theme:change", handler);
  if (typeof window !== "undefined") {
    window.addEventListener("storage", handler);
  }
  return () => {
    EventBus.off("theme:change", handler);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", handler);
    }
  };
}

function getThemeSnapshot(): "light" | "dark" {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ||
    localStorage.getItem("deskrpg_theme") === "dark"
    ? "dark"
    : "light";
}

function getServerSnapshot(): "light" | "dark" {
  return "light";
}

export default function ThemeToggle({
  className = "",
  showLabel = false,
  size = 18,
}: ThemeToggleProps) {
  const theme = useSyncExternalStore(subscribeTheme, getThemeSnapshot, getServerSnapshot);

  const toggleTheme = () => {
    const nextTheme = theme === "dark" ? "light" : "dark";

    if (nextTheme === "dark") {
      document.documentElement.classList.add("dark");
      document.documentElement.setAttribute("data-theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      document.documentElement.setAttribute("data-theme", "light");
    }

    try {
      localStorage.setItem("deskrpg_theme", nextTheme);
    } catch {
      // Ignora erro de localStorage em sandboxes privadas
    }

    EventBus.emit("theme:change", nextTheme);
  };

  const isDark = theme === "dark";
  const labelText = isDark ? "Modo Claro" : "Modo Escuro";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={`group relative flex items-center gap-2 rounded-md transition-all duration-200 focus-visible:outline-2 focus-visible:outline-primary ${className}`}
      title={isDark ? "Ativar Modo Claro (Sol ☀️)" : "Ativar Modo Escuro (Lua 🌙)"}
      aria-label={isDark ? "Ativar Modo Claro" : "Ativar Modo Escuro"}
    >
      <span className="relative flex items-center justify-center transition-transform duration-300 group-hover:rotate-45 group-active:scale-90">
        {isDark ? (
          <Moon
            size={size}
            className="text-amber-300 drop-shadow-[0_0_8px_rgba(252,211,77,0.5)] transition-colors duration-200"
            aria-hidden="true"
          />
        ) : (
          <Sun
            size={size}
            className="text-amber-500 transition-colors duration-200 hover:text-amber-600"
            aria-hidden="true"
          />
        )}
      </span>
      {showLabel && (
        <span className="text-caption font-semibold transition-colors duration-200 text-text group-hover:text-primary">
          {labelText}
        </span>
      )}
    </button>
  );
}

