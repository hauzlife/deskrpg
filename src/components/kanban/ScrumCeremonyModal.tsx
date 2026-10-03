"use client";

import { useState } from "react";
import {
  X,
  Sparkles,
  ClipboardList,
  Users,
  ShieldAlert,
  Award,
  History,
  CheckCircle2,
} from "lucide-react";
import type { ScrumCeremonyType } from "@/lib/scrum-types";
import { useT } from "@/lib/i18n";

interface ScrumCeremonyModalProps {
  isOpen: boolean;
  onClose: () => void;
  channelId: string;
  boardSlug: string;
  onCeremonyCreated: (meetingId: string) => void;
}

const CEREMONIES: Array<{
  type: ScrumCeremonyType;
  label: string;
  desc: string;
  icon: typeof ClipboardList;
}> = [
  {
    type: "sprint_planning",
    label: "Sprint Planning",
    desc: "Definição do Sprint Goal, extração de épicos e selagem do backlog da semana.",
    icon: ClipboardList,
  },
  {
    type: "daily_standup",
    label: "Daily Standup",
    desc: "Alinhamento diário rápido de 3 linhas por especialista e triagem de blockers.",
    icon: Users,
  },
  {
    type: "mid_sprint_check",
    label: "Mid-Sprint Scope Guard",
    desc: "Cálculo de throughput, burndown rate e corte preventivo de escopo.",
    icon: ShieldAlert,
  },
  {
    type: "sprint_review",
    label: "Sprint Review & Demo",
    desc: "Demonstração executiva do incremento pronto e validação dos 5 gates.",
    icon: Award,
  },
  {
    type: "sprint_retrospective",
    label: "Sprint Retrospective",
    desc: "Análise causal (AAR), consolidação de lições aprendidas e melhoria contínua.",
    icon: History,
  },
];

function getDefaultSprintTag(): string {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const pastDaysOfYear = (now.getTime() - startOfYear.getTime()) / 86400000;
  const weekNum = Math.ceil((pastDaysOfYear + startOfYear.getDay() + 1) / 7);
  return `sprint-w${weekNum}-${now.getFullYear()}`;
}

export default function ScrumCeremonyModal({
  isOpen,
  onClose,
  channelId,
  boardSlug,
  onCeremonyCreated,
}: ScrumCeremonyModalProps) {
  const t = useT();
  const [selectedCeremony, setSelectedCeremony] = useState<ScrumCeremonyType>("daily_standup");
  const [sprintTag, setSprintTag] = useState(getDefaultSprintTag);
  const [sprintGoal, setSprintGoal] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleCreate = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/scrum/ceremony", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ceremonyType: selectedCeremony,
          channelId: channelId || "c_general",
          boardSlug: boardSlug || "hot-telegram",
          sprintTag: sprintTag.trim() || getDefaultSprintTag(),
          sprintGoal: sprintGoal.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.message || data.error || "Falha ao instanciar cerimônia Scrum");
      }

      onCeremonyCreated(data.meetingId);
      onClose();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="bg-bg border border-border rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-surface-raised">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-text">Instanciar Cerimônia Scrum</h3>
              <p className="text-xs text-text-muted">
                Mesa redonda 3D com avatares, transcrição e ata executiva
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="text-text-muted hover:text-text p-1 rounded-md hover:bg-surface"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {error && (
            <div className="p-3 rounded-lg bg-danger/10 border border-danger/30 text-xs text-danger">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-text mb-2">
              Selecione a Cerimônia
            </label>
            <div className="grid grid-cols-1 gap-2">
              {CEREMONIES.map((c) => {
                const Icon = c.icon;
                const isSelected = selectedCeremony === c.type;
                return (
                  <button
                    key={c.type}
                    type="button"
                    onClick={() => setSelectedCeremony(c.type)}
                    className={`flex items-start gap-3 p-3 rounded-lg border text-left transition-all ${
                      isSelected
                        ? "border-primary bg-primary/5 text-text ring-1 ring-primary/40"
                        : "border-border bg-surface hover:bg-surface-raised text-text-muted hover:text-text"
                    }`}
                  >
                    <div
                      className={`p-2 rounded-md ${
                        isSelected ? "bg-primary text-white" : "bg-surface-raised text-text-muted"
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-text">{c.label}</span>
                        {isSelected && <CheckCircle2 className="w-4 h-4 text-primary" />}
                      </div>
                      <p className="text-[11px] text-text-dim mt-0.5 leading-snug">{c.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-2">
            <div>
              <label className="block text-xs font-semibold text-text mb-1">Sprint Tag</label>
              <input
                type="text"
                value={sprintTag}
                onChange={(e) => setSprintTag(e.target.value)}
                placeholder="Ex: sprint-w40-2026"
                className="w-full bg-surface border border-border rounded-md px-3 py-1.5 text-xs text-text focus:outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text mb-1">Board Alvo</label>
              <input
                type="text"
                value={boardSlug || "hot-telegram"}
                disabled
                className="w-full bg-surface-raised border border-border rounded-md px-3 py-1.5 text-xs text-text-dim cursor-not-allowed"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-text mb-1">
              Sprint Goal / Foco da Sessão (Opcional)
            </label>
            <input
              type="text"
              value={sprintGoal}
              onChange={(e) => setSprintGoal(e.target.value)}
              placeholder="Ex: Lançamento do motor de pagamentos e liquidação P2P"
              className="w-full bg-surface border border-border rounded-md px-3 py-1.5 text-xs text-text focus:outline-none focus:border-primary"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-surface-raised">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-3 py-1.5 rounded-md text-xs font-medium text-text-muted hover:text-text border border-border hover:bg-surface"
          >
            {t("common.cancel") || "Cancelar"}
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={loading}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-bold text-white bg-primary hover:bg-primary-hover disabled:opacity-50 transition-colors shadow-xs"
          >
            <Sparkles className="w-3.5 h-3.5" />
            {loading ? "Instanciando Reunião 3D..." : "Instanciar Cerimônia 3D"}
          </button>
        </div>
      </div>
    </div>
  );
}
