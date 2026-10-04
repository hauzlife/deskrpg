# Arquitetura e Doutrina de Governança de Incidentes (Sentry Soberano)

**Status**: ATIVO / INVIOLÁVEL  
**Data**: 2026-10-04  
**SSOT**: `~/.agents/deskrpg/docs/INCIDENT_GOVERNANCE.md` e `~/.agents/hermes/PM_ORCHESTRATION.md`  

---

## 1. Visão Geral

Este documento codifica o protocolo soberano de ingestão de telemetria, agrupamento de erros (*Sentry Issue Fingerprinting*), acumulação cumulativa (*Rollup*) e esteira de governança de tarefas entre Triage, Product Manager, Compose e Execução Técnica.

O objetivo é eliminar 100% do spam no Kanban, consolidar incidentes por família de alerta, impedir que cards entrem em execução sem especificação de critérios de aceite e garantir independência operacional de ferramentas pagas em trial (como o Sentry).

---

## 2. A Ordem Exata da Esteira de Incidentes

```
┌────────────────────────────────────────────────────────┐
│  Vector / Prometheus / Alertmanager / Grafana / SRE   │
└───────────────────────────┬────────────────────────────┘
                            │ POST /api/webhooks/alertmanager
                            ▼
┌────────────────────────────────────────────────────────┐
│ 1. INGESTÃO & SENTRY ROLLUP (alertmanager-webhook.ts)  │
│    - Calcula Sentry Issue Fingerprint (alert+tier+board)│
│    - Existe card ativo no board?                       │
│      ├── SIM ➔ ACUMULA ocorrência no card existente    │
│      │         (incrementa contagem, atualiza lastSeen, │
│      │          anexa alvos e emite comentário rollup)  │
│      └── NÃO ➔ CRIA UM ÚNICO card na coluna 'triage'   │
└───────────────────────────┬────────────────────────────┘
                            ▼
┌────────────────────────────────────────────────────────┐
│ 2. TRIAGEM OBRIGATÓRIA (Status: triage)               │
│    - Assignee inicial: @product-manager                │
│    - Despachante Hermes NÃO toca em cards de triage    │
│    - Notificação enviada à sala tática do PM           │
└───────────────────────────┬────────────────────────────┘
                            ▼
┌────────────────────────────────────────────────────────┐
│ 3. ESPECIFICAÇÃO PELO PM (Specify)                     │
│    - Avaliação de impacto no negócio / receita         │
│    - Redação dos Critérios de Aceite BDD               │
│      (Given - When - Then)                             │
│    - Definição de Pronto (DoD) e Fora de Escopo        │
└───────────────────────────┬────────────────────────────┘
                            ▼
┌────────────────────────────────────────────────────────┐
│ 4. PLANEJAMENTO & FATIAMENTO (Compose)                 │
│    - Hotfix simples?                                   │
│      ├── SIM ➔ Move para 'ready' com dev atribuído     │
│      └── NÃO ➔ Aciona @implementation-planner para     │
│                fatiar em sub-tarefas dependentes       │
└───────────────────────────┬────────────────────────────┘
                            ▼
┌────────────────────────────────────────────────────────┐
│ 5. PRONTO PARA EXECUÇÃO (Status: ready)                │
│    - Assignee: @backend-engineer / @platform-engineer │
│    - Despachante Hermes inicia worker (running)        │
└───────────────────────────┬────────────────────────────┘
                            ▼
┌────────────────────────────────────────────────────────┐
│ 6. EXECUÇÃO TÉCNICA (Status: running)                 │
│    - TDD Red-Green: teste falhando antes do código     │
│    - Correção física na causa raiz                     │
└───────────────────────────┬────────────────────────────┘
                            ▼
┌────────────────────────────────────────────────────────┐
│ 7. REVISÃO & VERIFICAÇÃO (Status: review)              │
│    - @qa_senior / @reviewer valida critérios de aceite │
│    - Suíte de testes 100% verde com exit code 0        │
└───────────────────────────┬────────────────────────────┘
                            ▼
┌────────────────────────────────────────────────────────┐
│ 8. CONCLUSÃO (Status: done)                            │
│    - Fechamento manual ou automático pelo webhook      │
│      quando a telemetria normaliza                     │
└────────────────────────────────────────────────────────┘
```

---

## 3. Comportamento Estilo Sentry (Rollup & Agrupamento)

1. **Fingerprint da Issue**:
   - `buildSentryIssueFingerprint(alert, boardSlug)` extrai:
     `boardSlug + "\u001f" + normalize(alertname) + "\u001f" + normalize(tier)`
   - Variações voláteis como IP de instância, nome de worker transitório ou timestamp NÃO criam cards novos.
2. **Acumulação Ativa**:
   - Se uma Issue estiver ativa (em `triage`, `todo`, `ready`, `running`, `blocked` ou `review`), todo novo evento:
     - Incrementa `<!-- occurrences: N -->`.
     - Atualiza o cabeçalho visível: `**Ocorrências Acumuladas:** N`.
     - Atualiza o timestamp `**Última Ocorrência (Last Seen):**`.
     - Adiciona novos alvos/workers afetados à lista `**Alvos Afetados:**`.
     - Publica comentário do `sentry-local-sentinel`:
       `🔥 [SENTRY ROLLUP — OCORRÊNCIA #N] ...`
3. **Resolução Automática**:
   - Quando o Alertmanager emite `status: "resolved"`, o webhook localiza o card ativo por `sentry-issue`, `dedupKey` ou `alertname`, transiciona para `done` e emite nota de resolução.
