# Grade Completa de Automação Individual das 39 Almas (Cadência por NPC)

Documento oficial que detalha a justificativa de existência e as rotinas autônomas agendadas de cada um dos 39 agentes do ecossistema HIVE no DeskRPG + Hermes.

---

## Princípio Fundamental: Nenhuma Alma Ociosa

Para a organização funcionar como uma entidade viva 24/7 sem dependência de intervenção humana, cada especialista possui entre **1 e 3 rotinas periódicas obrigatórias** que o conectam aos repositórios, bancos e boards.

---

## 1. Governança & Orquestração Universal (4 Perfis)

| Agente | Domínio | Nome do Cron / Rotina | Frequência | Ação Autônoma | Entregável Concreto |
| :--- | :--- | :--- | :---: | :--- | :--- |
| **`orchestrator`** | Universal | **Ops Workstream & Dependency Alignment** | **Diário (08:30)** | Alinha a cadeia de dependências entre Engenharia, Ops e Produto para o dia. | Destravamento de tasks e ajuste de prioridades. |
| **`orchestrator`** | Universal | **Blocker Escalation & Circuit Breaker** | **A cada 4h** | Detecta tasks em deadlock, com falhas consecutivas ou paradas há >4h. | Re-roteamento de assignee ou escalonamento. |
| **`orchestrator`** | Universal | **Daily Release Packaging** | **Diário (18:00)** | Consolida os PRs aprovados do dia para homologação executiva. | Changelog diário e pacote de release pronto. |
| **`kanban-strategist`** | Universal | **WIP Limit & Flow Hygiene Audit** | **Diário (11:00)** | Audita limites de WIP, gargalos de garrafa e colunas inchadas nos 11 boards. | Cards de balanceamento de fluxo no `ops-ops`. |
| **`kanban-strategist`** | Universal | **Weekly Throughput & Lead Time Analytics** | **Sextas (16:00)** | Calcula tempo de ciclo, velocidade de vazão e lead time dos 4 projetos. | Relatório de métricas de fluxo no `ops-ops`. |
| **`reviewer`** | Universal | **Open PRs Triage & Review Gate** | **A cada 4h** | Varre PRs pendentes de code review nos 4 repositórios e analisa diffs. | Review comments, aprovação ou request changes. |
| **`reviewer`** | Universal | **Code Smells & Static Quality Pulse** | **Diário (15:30)** | Roda linter e análise estática nas branches de feature ativas. | Cards de correção de estilo/linting. |
| **`verifier`** | Universal | **Acceptance Criteria Verification** | **Diário (17:30)** | Executa testes de aceitação formal contra os critérios do card. | Sign-off de QA e autorização de promoção para done. |
| **`verifier`** | Universal | **Post-Deploy E2E Sanity Probe** | **A cada 6h** | Smoke test dos fluxos críticos de compra e conversão em produção. | Alerta imediato ou card de regressão P0. |

---

## 2. Liderança C-Suite (9 Perfis)

| Agente | Domínio | Nome do Cron / Rotina | Frequência | Ação Autônoma | Entregável Concreto |
| :--- | :--- | :--- | :---: | :--- | :--- |
| **`ceo`** | C-Suite | **Strategic Alignment & North Star Check** | **Segundas (08:00)** | Compara velocidade de entrega com metas estratégicas de receita da HIVE. | Diretriz estratégica semanal no `csuite-ops`. |
| **`cto`** | C-Suite / Eng | **Tech Radar & Stack Drift Audit** | **Quinzenal (Seg 08:30)** | Avalia dívida técnica da stack, versões de dependências e segurança. | Tech Radar atualizado no `csuite-ops` / `eng-ops`. |
| **`cto`** | C-Suite / Infra | **High-Severity Architecture Emergency Probe** | **Diário (08:15)** | Checa decisões e incidentes arquiteturais que afetam múltiplos projetos. | Parecer técnico de estabilidade sistêmica. |
| **`cfo`** | C-Suite / Ops | **Weekly Financial & Token Burn SITREP** | **Sextas (17:00)** | Consolida custos de IA/infra vs receita líquida gerada pelos 4 projetos. | SITREP financeiro consolidado na CFO Suite. |
| **`cfo`** | C-Suite / Ops | **Payment Drop & Conversion Guard** | **A cada 12h** | Compara checkouts iniciados vs pagos no Stripe/PIX. | Alerta de anomalia de receita no canal. |
| **`coo`** | C-Suite / Ops | **Daily Operations Cadence** | **Diário (08:45)** | Checa gargalos operacionais e equilibra capacidade dos squads. | Rebalanceamento de carga no `ops-ops`. |
| **`coo`** | C-Suite / Ops | **SLA & Delivery Commitment Audit** | **Quartas (17:00)** | Mede aderência a prazos e ritmo de fechamento de ciclo. | Relatório de eficiência operacional. |
| **`cmo`** | C-Suite / GTM | **Growth Funnel & CAC/LTV Performance Review** | **Terças e Quintas (10:00)** | Analisa conversão do tráfego orgânico/pago e eficiência dos canais. | Plano de ajuste de canais no `gtm-ops`. |
| **`cmo`** | C-Suite / GTM | **Campaign Launch Gate** | **Segundas (10:30)** | Aprova novas campanhas, copys e posicionamento de marca do GTM. | Parecer de liberação de campanhas. |
| **`cpo`** | C-Suite / Prod | **Product Roadmap Velocity Tracking** | **Quartas (09:30)** | Acompanha avanço percentual dos marcos de produto nos 4 projetos. | Status de maturidade de features no `product-ops`. |
| **`cpo`** | C-Suite / Prod | **User Friction & Churn Signal Analysis** | **Sextas (14:00)** | Analisa pontos de atrito no onboarding e motivos de abandono de uso. | Cards de melhoria de UX/Produto. |
| **`clo`** | C-Suite | **Monthly Compliance & Privacy Audit** | **1º dia do mês (09:00)** | Audita termos de serviço, LGPD/GDPR e conformidade regulatória. | Parecer de risco jurídico no `csuite-ops`. |
| **`chro`** | C-Suite | **Weekly Agent Role & Capability Audit** | **Sextas (15:00)** | Verifica se os 39 perfis têm memórias, ferramentas e skills atualizados. | Atualizações de skills e prompts no vault. |
| **`chief-of-staff`** | C-Suite / Ops | **Daily Morning Executive Standup** | **Diário (08:30)** | Consolida os principais blockers e vitórias para o Soberano. | Briefing executivo diário no `Ops Control`. |
| **`chief-of-staff`** | C-Suite / Ops | **Cross-World Escalation Sync** | **A cada 6h** | Garante que demandas entre C-Suite e Operações não fiquem órfãs. | Desbloqueio e acionamento de responsáveis. |

---

## 3. Produto, Pesquisa e Especificação (5 Perfis)

| Agente | Domínio | Nome do Cron / Rotina | Frequência | Ação Autônoma | Entregável Concreto |
| :--- | :--- | :--- | :---: | :--- | :--- |
| **`product-manager`** | Prod / Ops / Eng | **Daily Spec & Acceptance Criteria Grooming** | **Diário (09:00)** | Refina critérios de aceite e contratos de dados para engenharia. | Cards detalhados com checklist no backlog. |
| **`product-manager`** | Prod / Ops / Eng | **Continuous Roadmap Progression** | **A cada 8h** | Avalia o que virou done e fatia a próxima milestone de backlog. | Novos cards atômicos de produto no Kanban. |
| **`product-manager`** | Prod / Ops / Eng | **Feature Rollout & Flag Verification** | **Diário (16:30)** | Acompanha estabilidade e adoção de novas features recém-publicadas. | Notas de entrega e ajustes no `product-ops`. |
| **`implementation-planner`** | Ops / Prod / Eng | **Roadmap Grooming & Task Slicing** | **A cada 8h** | Fatia epics em tarefas de <4h com arquivos afetados e testes. | Decomposição técnica com dependências amarradas. |
| **`implementation-planner`** | Ops / Prod / Eng | **Technical Dependency Topology Check** | **Diário (11:30)** | Mapeia árvores de parent/child para evitar deadlocks de tasks. | Correção de links de precedência de cards. |
| **`spec-driven-development`** | Product / Eng | **SDD Verification Loop** | **Diário (10:00)** | Compara o código implementado contra a especificação formal. | Relatório de conformidade de spec antes de QA. |
| **`spec-driven-development`** | Product / Eng | **Contract Schema & AST Shape Check** | **Diário (14:30)** | Valida schemas de DTOs e endpoints de API contra contratos. | Cards de correção de schema drift. |
| **`researcher`** | Prod / GTM / Know | **Market Signals & Competitor Reconnaissance** | **Terças e Quintas (09:30)** | Varre movimentos de mercado, concorrentes e novas oportunidades. | Relatório de inteligência competitiva no `gtm-ops`. |
| **`researcher`** | Prod / GTM / Know | **Deep Domain Literature Synthesis** | **Quartas (11:00)** | Pesquisa avanços técnicos em IA, crypto e engenharia de software. | Síntese de pesquisa no canal `Knowledge`. |
| **`ux-designer`** | Product | **UI/UX Consistency & Design System Audit** | **Segundas (14:00)** | Audita telas, componentes e responsividade dos frontends. | Cards de refinamento visual e acessibilidade. |
| **`ux-designer`** | Product | **User Journey Drop-Off Review** | **Quintas (15:00)** | Analisa passos de onboarding e etapas de checkout dos produtos. | Protótipos e wireframes de simplificação. |

---

## 4. Engenharia de Software & Dados (11 Perfis)

| Agente | Domínio | Nome do Cron / Rotina | Frequência | Ação Autônoma | Entregável Concreto |
| :--- | :--- | :--- | :---: | :--- | :--- |
| **`technical-architect`** | Eng / Infra / Prod | **Weekly Tech Debt & Architecture Audit** | **Segundas (07:00)** | Audita acoplamento, complexidade e arquitetura dos 4 repositórios. | Cards de refatoração preventiva no `eng-ops`. |
| **`technical-architect`** | Eng / Infra / Prod | **System Boundary & Contract Verification** | **Quintas (16:30)** | Valida integrações entre front/back e serviços compartilhados. | Correção de contratos de API. |
| **`backend-engineer`** | Engineering | **API Query Cost & Latency Probe** | **Diário (11:00)** | Monitora queries N+1, tempo de resposta e latência de banco. | Otimização de queries e índices. |
| **`backend-engineer`** | Engineering | **Idempotency & Webhook Retry Resiliency** | **Terças e Sextas (14:30)** | Audita rotas de pagamento e processamento assíncrono. | Patches de segurança contra cobrança dupla. |
| **`frontend-engineer`** | Engineering | **Bundle Size & Asset Performance Audit** | **Segundas e Quintas (11:30)** | Mede tamanho de chunks JS/CSS, Core Web Vitals e render. | Otimização de build e dynamic imports. |
| **`frontend-engineer`** | Engineering | **UI State Machine & Error Sweep** | **Diário (16:00)** | Checa logs por erros de hidratação e exceptions de cliente. | Fixes de componentes e estados de tela. |
| **`debugger`** | Eng / Ops / Infra | **Root Cause Exception Sweep** | **A cada 4h** | Rastreia logs de crash nos projetos, gerando hipóteses de causa raiz. | Diagnósticos de 3 linhas (RCA) no `War Room`. |
| **`debugger`** | Eng / Ops / Infra | **Flaky Test & Concurrency Race Detection** | **Quartas (16:00)** | Detecta testes intermitentes ou condições de corrida em threads. | Correção de fixtures e teardowns instáveis. |
| **`data-architect`** | Engineering | **Database Schema Migration & Index Sanity** | **Terças (09:00)** | Audita planos de execução EXPLAIN, índices faltantes e locks. | Migrations seguras sem locks longos. |
| **`data-architect`** | Engineering | **Vector Store & Embedding Integrity Check** | **Sextas (10:00)** | Verifica saúde de bancos vetoriais e integridade de chunks. | Script de reindexação e limpeza de embeddings. |
| **`data-engineer`** | Engineering | **Pipeline ETL & Freshness Sentinel** | **A cada 6h** | Monitora atrasos em syncs de dados, filas e jobs batch. | Alertas de atraso e recuperação de pipelines. |
| **`data-engineer`** | Engineering | **Data Quality & Null Assertion Probe** | **Diário (07:30)** | Roda testes de qualidade de dados nas tabelas consolidadas. | Cards de correção de dados inconsistentes. |
| **`data-scientist`** | Engineering | **Model Accuracy & Prediction Drift Audit** | **Segundas (10:00)** | Mede precisão de inferências e desvio de distribuição de dados. | Calibração de pesos e relatórios de métricas. |
| **`ml-engineer`** | Engineering | **Inference Latency & Hardware Utilization** | **A cada 12h** | Audita tempo de inferência, custo de VRAM e consumo de GPU/Metal. | Otimizações de quantização e execução local. |
| **`platform-engineer`** | Engineering | **CI/CD Build Time & Cache Optimization** | **Quartas (08:00)** | Audita tempo de execução de runners, caches e imagens Docker. | Redução de minutos de build no CI. |
| **`platform-engineer`** | Engineering | **Local Worktree & Workspace Cleanup** | **Sábados (04:00)** | Purga worktrees órfãs, containers mortos e cache temporário. | Liberação de espaço em disco e higiene de git. |
| **`oss-contributor`** | Engineering | **Upstream Dependencies & License Compliance** | **Quinzenal (Qua 10:00)** | Checa licenças (MIT, GPL, etc.) e atualizações de upstream. | PRs de atualização e conformidade de licença. |
| **`editor`** | Product | **Technical Product Messaging Polish** | **Diário (17:00)** | Revisa clareza de textos, PR notes e documentações de entrega. | Textos polidos em microcopy e changelogs. |

---

## 5. Operações, QA, Infra & Segurança (4 Perfis)

| Agente | Domínio | Nome do Cron / Rotina | Frequência | Ação Autônoma | Entregável Concreto |
| :--- | :--- | :--- | :---: | :--- | :--- |
| **`qa-engineer`** | Ops / Eng | **Test Suites Regression Sentinel** | **A cada 2h** | Roda testes de `hot-telegram` e `mystelia`. Abre bugs se quebrar. | Cards `[QA-WATCHDOG]` no board correto. |
| **`qa-engineer`** | Ops / Eng | **E2E Critical Path Regression** | **Diário (06:00)** | Roda bateria Playwright/E2E em staging nos fluxos principais. | Relatório de sanidade de release matinal. |
| **`verifier`** | Universal / Ops | **Daily Release Readiness Audit** | **Diário (18:00)** | Consolida os PRs que passaram nos testes e monta a release. | Pacote de release diário pronto para o Soberano. |
| **`site-reliability-engineer`** | Infra / Ops | **Production Uptime & Endpoint Probe** | **A cada 1h** | Health check rápido de endpoints e filas. Abre P0 se cair. | Cards `[INCIDENT-P0]` com traceback. |
| **`site-reliability-engineer`** | Infra / Ops | **VPS Resource & Zombie Process Probe** | **A cada 6h** | Checa espaço em disco, RAM livre e processos travados. | Purgas de processos zumbis e alertas de disco. |
| **`security-engineer`** | Infra / Eng | **Weekly Vulnerability & Dependency Scan** | **Segundas (06:00)** | Auditoria de dependências, CVEs e vulnerabilidades de código. | Relatório de vulnerabilidades e cards de fix. |
| **`security-engineer`** | Infra / Eng | **Secrets & Permission Hardening Check** | **Quintas (06:00)** | Varre git history e filesystem por segredos e permissões indevidas. | Rotação de chaves e correção de chmod. |

---

## 6. Creative, GTM & Comunicação (4 Perfis)

| Agente | Domínio | Nome do Cron / Rotina | Frequência | Ação Autônoma | Entregável Concreto |
| :--- | :--- | :--- | :---: | :--- | :--- |
| **`seo-specialist`** | GTM | **Funnel & Conversion Health** | **Diário (12:00)** | Checa páginas 404, sitemaps e eventos de pixel de conversão. | Cards de correção de funil e metatags. |
| **`seo-specialist`** | GTM | **Keyword Ranking & SERP Visibility Sweep** | **Segundas (09:00)** | Monitora posição em buscadores e indexação de novas páginas. | Relatório de posicionamento orgânico no `gtm-ops`. |
| **`copy-editor`** | GTM | **Copy Conversion & Microcopy Friction Review** | **Quartas (14:00)** | Audita textos de botões, popups e mensagens de erro nos checkouts. | Sugestões de teste A/B de microcopy. |
| **`copy-editor`** | GTM | **Marketing Asset Quality & Brand Voice Gate** | **Seg e Qui (15:00)** | Revisa peças antes do disparo para garantir padrão de voz. | Aprovação ou refino de copy de campanhas. |
| **`brand-designer`** | GTM | **Visual Asset & Brand Identity Health Check** | **Terças (14:00)** | Audita consistência visual de assets, ícones e templates. | Atualização do design kit e templates no GTM. |
| **`technical-writer`** | GTM / Prod / Eng | **API Documentation & SDK Sync** | **Ter e Sex (11:00)** | Verifica se novas rotas de backend estão documentadas no SDK. | Documentação OpenAPI/Markdown atualizada. |
| **`technical-writer`** | GTM / Prod / Eng | **User Guide & Internal Runbook Freshness** | **Quintas (11:00)** | Atualiza runbooks operacionais e manuais de troubleshooting. | Runbooks atualizados no canal `Operations`. |
| **`writer`** | GTM | **Long-form Content & Deep-Dive Drafting** | **Quartas (10:00)** | Rascunha artigos técnicos de autoridade e changelogs públicos. | Artigo técnico pronto para revisão no `Studio`. |

---

## 7. Conhecimento & Sabedoria (2 Perfis)

| Agente | Domínio | Nome do Cron / Rotina | Frequência | Ação Autônoma | Entregável Concreto |
| :--- | :--- | :--- | :---: | :--- | :--- |
| **`curator`** | Knowledge | **Nightly Lessons Learned & AAR Sync** | **Diário (22:00)** | Consolida aprendizados do dia e atualiza o vault da HIVE. | Novas regras e aprendizados no vault. |
| **`curator`** | Knowledge | **Knowledge Base Deduplication & Cleanup** | **Domingos (20:00)** | Organiza links quebrados e consolida notas antigas do vault. | Base de conhecimento saneada e indexada. |
| **`wonderer`** | Knowledge | **Lateral Thinking & Black Swan Horizon Scan** | **Sextas (16:30)** | Conecta pontos não óbvios entre projetos e sugere novas teses. | Memo de inovação lateral no `Deep Thought`. |

---

## 8. Resumo Estatístico de Cobertura

- **Total de Perfis Ativos:** 39 de 39 (100% com ao menos 1 rotina agendada).
- **Perfis com 1 Rotina:** 8 agentes (especialistas de foco profundo: `ceo`, `clo`, `chro`, `data-scientist`, `ml-engineer`, `oss-contributor`, `brand-designer`, `writer`, `wonderer`).
- **Perfis com 2 Rotinas:** 27 agentes (especialistas táticos e de suporte contínuo).
- **Perfis com 3 Rotinas:** 4 agentes (motores de alto impacto: `orchestrator`, `product-manager`).
- **Garantia Operacional:** 100% do ecossistema tem pulso autônomo. Nenhuma alma fica sem propósito ou ociosa no DeskRPG.
