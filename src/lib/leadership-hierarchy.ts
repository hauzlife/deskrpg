/**
 * Mapeamento Canônico de Liderança Hierárquica para o DeskRPG.
 *
 * Baseado na matriz canônica de governança do Hermes Squad (00-ROSTER.md).
 * Define para qual líder de área um especialista deve se reportar ao concluir
 * tarefas ou solicitar code review no Kanban, evitando interrupções desnecessárias
 * ao Comandante humano.
 */

export const LEADERSHIP_MATRIX: Record<string, { lead: string; fallback: string }> = {
  // Engenharia, Código e Arquitetura
  "backend-engineer": { lead: "technical-architect", fallback: "cto" },
  "frontend-engineer": { lead: "technical-architect", fallback: "cto" },
  "data-engineer": { lead: "technical-architect", fallback: "cto" },
  "data-architect": { lead: "technical-architect", fallback: "cto" },
  "technical-architect": { lead: "cto", fallback: "orchestrator" },
  "spec-driven-development": { lead: "technical-architect", fallback: "reviewer" },

  // Qualidade, Testes e Revisão
  "qa-engineer": { lead: "reviewer", fallback: "product-manager" },
  "debugger": { lead: "reviewer", fallback: "technical-architect" },
  "reviewer": { lead: "product-manager", fallback: "orchestrator" },

  // Produto, Planejamento e Kanban
  "implementation-planner": { lead: "product-manager", fallback: "cpo" },
  "kanban-strategist": { lead: "product-manager", fallback: "cpo" },
  "product-manager": { lead: "cpo", fallback: "orchestrator" },

  // Design, Marca e UX
  "ux-designer": { lead: "brand-designer", fallback: "cpo" },
  "brand-designer": { lead: "ux-designer", fallback: "cmo" },

  // Redação, Conteúdo e Tom de Voz
  "writer": { lead: "editor", fallback: "cmo" },
  "technical-writer": { lead: "editor", fallback: "technical-architect" },
  "copy-editor": { lead: "editor", fallback: "cmo" },
  "editor": { lead: "cmo", fallback: "orchestrator" },

  // Infraestrutura, SRE e Operações
  "site-reliability-engineer": { lead: "platform-engineer", fallback: "technical-architect" },
  "platform-engineer": { lead: "site-reliability-engineer", fallback: "cto" },
  "security-engineer": { lead: "platform-engineer", fallback: "cto" },
};

export type NpcRosterItem = {
  id: string;
  name: string;
  role?: string | null;
  profileName?: string | null;
  active: boolean;
  positionX?: number | null;
  positionY?: number | null;
};

/**
 * Normaliza um identificador de perfil ou role para lookup na matriz de liderança.
 */
function normalizeProfileKey(raw?: string | null): string {
  if (!raw) return "";
  return raw
    .toLowerCase()
    .trim()
    .replace(/[_\s]+/g, "-");
}

/**
 * Resolve o Lead de área para um determinado NPC com base no roster ativo no mapa.
 *
 * @param reportingNpc O NPC que concluiu a tarefa ou precisa de reporte.
 * @param roster Lista de todos os NPCs atualmente ativos no canal.
 * @returns O NPC do Líder correspondente com posição válida no mapa, ou null se nenhum líder estiver ativo.
 */
export function resolveSquadLead(
  reportingNpc: NpcRosterItem,
  roster: readonly NpcRosterItem[],
): NpcRosterItem | null {
  const profileKey = normalizeProfileKey(reportingNpc.profileName || reportingNpc.role);
  const rule = LEADERSHIP_MATRIX[profileKey];

  const hasValidPosition = (n: NpcRosterItem): boolean =>
    n.positionX !== null && n.positionX !== undefined &&
    n.positionY !== null && n.positionY !== undefined;

  if (rule) {
    // 1. Procura o líder primário ativo no mapa
    const primary = roster.find(
      (n) =>
        n.active &&
        n.id !== reportingNpc.id &&
        normalizeProfileKey(n.profileName || n.role || n.name) === rule.lead &&
        hasValidPosition(n),
    );
    if (primary) return primary;

    // 2. Procura o líder de fallback
    const fallback = roster.find(
      (n) =>
        n.active &&
        n.id !== reportingNpc.id &&
        normalizeProfileKey(n.profileName || n.role || n.name) === rule.fallback &&
        hasValidPosition(n),
    );
    if (fallback) return fallback;
  }

  // 3. Fallback geral de arbitragem executiva: orchestrator, product-manager ou chief-of-staff
  const generalLeads = ["orchestrator", "product-manager", "chief-of-staff", "cto", "cpo"];
  return (
    roster.find(
      (n) =>
        n.active &&
        n.id !== reportingNpc.id &&
        generalLeads.includes(normalizeProfileKey(n.profileName || n.role || n.name)) &&
        hasValidPosition(n),
    ) ?? null
  );
}

/**
 * Determina se o relatório é um incidente executivo ou blocker que requer
 * a presença física e atenção imediata do Comandante Humano.
 */
export function isCommanderEscalation(cardTitle?: string | null, summary?: string | null): boolean {
  const text = `${cardTitle || ""} ${summary || ""}`.toUpperCase();
  return (
    text.includes("P0") ||
    text.includes("CRITICAL") ||
    text.includes("FATAL") ||
    text.includes("BLOCKED:HUMAN") ||
    text.includes("ESCALATE:HUMAN") ||
    text.includes("APROVACAO:HUMANO")
  );
}
