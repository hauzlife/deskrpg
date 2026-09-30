# Tabela Consolidada de Agendamentos e Automações (DeskRPG + Hermes)

Documentação oficial da grade de agendamentos autônomos e rotinas contínuas configuradas nos 7 mundos do DeskRPG integrados ao Hermes Gateway.

---

## 1. Sentinelas Autônomos (Motor 1 — Disparo Automático 24/7)

Estes são os **watchers contínuos** que criam cards sozinhos nos boards quando detectam erros ou falta de trabalho:

| Canal | Sala | Agente (Perfil) | Job / Sentinela | Frequência | Objetivo Operacional | Status |
| :--- | :--- | :--- | :--- | :---: | :--- | :---: |
| **Infrastructure** | `NOC` | `site-reliability-engineer` | **SENTINEL SRE — Production Health & Incidents** | **A cada 1h** | Monitora endpoints, filas e erros 500. Abre card **[INCIDENT-P0]** se algo cair. | **Ativo** |
| **Operations** | `War Room` | `qa-engineer` | **SENTINEL QA — Test Suites Monitor** | **A cada 2h** | Roda suítes de testes (`hot-telegram`, `mystelia`). Abre card **[QA-WATCHDOG]** se houver falha. | **Ativo** |
| **Operations** | `Ops Control` | `implementation-planner` | **SENTINEL OPS — Backlog Replenishment** | **A cada 6h** | Inspeciona boards de projetos e domínios. Repõe tarefas atômicas se o backlog estiver baixo. | **Ativo** |
| **Creative/GTM** | `Campaigns` | `seo-specialist` | **SENTINEL GTM — Funnel & SEO Audit** | **A cada 12h** | Varre sitemaps, links 404 e tags de conversão nos sites. Gera cards de ajuste de SEO/Funil. | **Ativo** |

---

## 2. Rotinas Diárias dos Especialistas (Cadência de Negócio e Specs)

Estes são os rituais agendados onde os agentes analisam o andamento dos projetos e alimentam relatórios/análises:

| Canal | Agente (Perfil) | Rotina / Job | Horário / Frequência | Ação Executada | Status |
| :--- | :--- | :--- | :---: | :--- | :---: |
| **Product** / **Ops** | `product-manager` | **Office — Product Manager 09:00** | Seg a Sex às **09:00** | Priorização e alinhamento do roadmap dos 4 projetos. | **Ativo** |
| **Product** / **Knowledge** | `researcher` | **Office — Researcher 09:30** | Seg a Sex às **09:30** | Pesquisa de mercado, tendências e validação de hipóteses. | **Ativo** |
| **Product** | `spec-driven-development` | **SDD — Verificação de Requisitos** | Diariamente às **10:00** | Garante que as entregas técnicas batem com as especificações. | **Ativo** |
| **Engineering** / **Product** | `reviewer` | **Reviewer — Qualidade e Bloqueios** | Diariamente às **16:00** | Varre PRs abertos e audita itens travados em code review. | **Ativo** |
| **Infrastructure** / **Eng** | `technical-architect` | **Health check diário de arquitetura** | Seg a Sex às **16:30** | Revisa conformidade de código e integridade dos serviços. | **Ativo** |

---

## 3. Resumo por Mundo (Onde cada coisa dispara)

- **`Infrastructure`**: Sentinela de 1h de uptime/infra + health check técnico às 16:30.
- **`Operations`**: Sentinela de 2h de QA + Sentinela de 6h de reposição de backlog.
- **`Creative/GTM`**: Sentinela de 12h de auditoria de funil e SEO.
- **`Engineering`**: Recebe os cards abertos pelo QA/SRE e executa nos boards `hot-telegram`, `mystelia`, `bloopu`, `social` e `eng-ops`.
- **`Product`**: Cadência matinal (09:00 às 10:00) de PM, Researcher e SDD gerando refinamento contínuo.
- **`Knowledge` & `C-Suite`**: Acompanham as telemetrias e relatórios sintetizados pelas sentinelas.
