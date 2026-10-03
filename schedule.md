# Grade Oficial de Automação, Sentinelas e Governança (DeskRPG + Hermes)

Documentação oficial da grade definitiva de automações, sentinelas e rotinas inteligentes configuradas nos 7 mundos do DeskRPG integrados ao Hermes Gateway.

---

## 1. Grade Unificada de Sentinelas e Rotinas (Operação 24/7)

| Nível       | Canal            | Sala                | Agente(s)                   | Nome do Agendamento                                   |     Job ID     |      Frequência      | Ação Operacional & Gate Inteligente                                                                                                |
| :---------- | :--------------- | :------------------ | :-------------------------- | :---------------------------------------------------- | :------------: | :------------------: | :--------------------------------------------------------------------------------------------------------------------------------- |
| **Crítico** | `Infrastructure` | `NOC`               | `site-reliability-engineer` | **SENTINEL SRE — Production Uptime**                  | `6cb7bd1bf2e0` |    **A cada 1h**     | Bate `curl` nos endpoints e checa logs de VPS. Se 200 OK, encerra sem custo. Se der 500/timeout, acorda e abre **[INCIDENT-P0]**.  |
| **Crítico** | `Operations`     | `War Room`          | `qa-engineer`               | **SENTINEL QA — Test Suites Sentinel**                | `9d61b2fbf2b1` |    **A cada 2h**     | Roda testes de `hot-telegram` e `mystelia`. Se verde, encerra. Se quebrar, isola o traceback e abre **[QA-WATCHDOG]**.             |
| **Ataque**  | `Operations`     | `Ops Control`       | `implementation-planner`    | **ROADMAP GROOMING — Continuous Backlog Progression** | `e5901f673e3b` |    **A cada 8h**     | Analisa o que virou `done` nos 4 projetos e fatia tecnicamente a próxima fase do roadmap, garantindo profundidade real de backlog. |
| **Tático**  | `Product`        | `Product Office`    | `product-manager`           | **DAILY SPEC — Requirement Alignment**                | `af157f773705` |  **Diário (09:00)**  | Refina critérios de aceite e especificações SDD para o próximo ciclo de engenharia.                                                |
| **Tático**  | `Creative/GTM`   | `Campaigns`         | `seo-specialist`            | **DAILY SEO — Funnel & Conversion Health**            | `f535da5fe0dd` |  **Diário (12:00)**  | Checa páginas 404, sitemaps e eventos de pixel/conversão nos checkouts ativos.                                                     |
| **Tático**  | `Operations`     | `War Room`          | `verifier`                  | **DAILY OPS — Release Readiness Audit**               | `f7a9810e3a80` |  **Diário (18:00)**  | Consolida os PRs que passaram nos testes do dia e monta o changelog/pacote de release.                                             |
| **Tático**  | `Knowledge`      | `Library`           | `curator`                   | **NIGHTLY KNOWLEDGE — Lessons Learned Sync**          | `2e859f49f8e4` |  **Diário (22:00)**  | Lê cards finalizados no dia, extrai lições aprendidas (AAR) e atualiza a memória e regras da HIVE.                                 |
| **Semanal** | `Infrastructure` | `Incident Response` | `security-engineer`         | **WEEKLY SEC — Vulnerability & Dependency Scan**      | `9ebb94084781` | **Segundas (06:00)** | Varre dependências (CVEs), permissões de arquivo e chaves nos repositórios dos 4 projetos.                                         |
| **Semanal** | `Engineering`    | `Dev Lab`           | `technical-architect`       | **WEEKLY ARCH — Tech Debt & Architecture Audit**      | `0fe280daa8b8` | **Segundas (07:00)** | Audita complexidade de código, gargalos de performance e cobertura de testes. Gera cards de refatoração preventiva.                |
| **Semanal** | `C-Suite`        | `Boardroom`         | `cfo`                       | **WEEKLY EXECUTIVE — Financial & Throughput SITREP**  | `d0cd212be359` |  **Sextas (17:00)**  | Consolida taxa de conversão, custos de infraestrutura e velocidade de entrega dos 4 projetos para o Soberano.                      |

---

## 2. Como Funciona a Economia de Tokens e Autonomia Real

1. **Gates de Baixo Custo (Zero Desperdício):**
   - Os sentinelas de 1h e 2h (`SRE` e `QA`) executam scripts determinísticos (`curl`, `pytest`). Se tudo estiver 200 OK e 100% verde, o processo morre em 2 segundos consumindo praticamente zero tokens de raciocínio.
   - A LLM só é despertada quando há **falha comprovada**, abrindo o card diretamente com a evidência técnica.

2. **Avanço Real de Roadmap (8h):**
   - Em vez de um contador arbitrário de cartões, o `implementation-planner` audita as entregas concluídas (`done`) nos 4 projetos (`hot-telegram`, `mystelia`, `bloopu`, `social`) e projeta as próximas tarefas atômicas da esteira.

3. **Ciclo Noturno de Inteligência (22:00):**
   - O `curator` institucionaliza o aprendizado diário, garantindo que soluções adotadas virem regras duráveis no vault de conhecimento da HIVE.

---

## 3. Resumo de Registro Físico

- **DeskRPG DB (`deskrpg.db`)**: 10 jobs registrados na tabela `cron_job_origins`.
- **Hermes Daemon**: Jobs ativos nos profiles correspondentes sob `~/.hermes/profiles/<perfil>/cron/jobs.json`.
- **Sincronização de Código**: Documento commitado e enviado para `origin/custom` no GitHub.
