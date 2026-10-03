# Modelo Operacional Autônomo (HIVE — DeskRPG + Hermes)

Documento oficial de arquitetura, fluxos de trabalho e motores autônomos da HIVE operando 24/7 através do DeskRPG e do runtime Hermes.

---

## 1. Topologia de Boards Sincronizada (Projetos + Domínios)

Todos os **7 mundos funcionais** do DeskRPG (`C-Suite`, `Engineering`, `Product`, `Operations`, `Creative/GTM`, `Infrastructure`, `Knowledge`) estão conectados ao Gateway local com **acesso unificado e seletor ativo**:

### A. Boards de Projeto (Entregas e Código de Produto)

| Board Slug                     | Workspace / Repositório                                 | Escopo de Produto                                                        |
| :----------------------------- | :------------------------------------------------------ | :----------------------------------------------------------------------- |
| **`hot-telegram`** (242 tasks) | `/Users/anonymous/Projects/hauzhouse/hot/hot-telegram`  | Motor de monetização, tráfego, billing e bots de Telegram (consolidado). |
| **`mystelia`** (91 tasks)      | `/Users/anonymous/Projects/hauzhouse/esoteric/mystelia` | Aplicação web/API Django, motor astrológico, checkout e landing pages.   |
| **`bloopu`** (63 tasks)        | `/Users/anonymous/Projects/hauzhouse/crypto`            | Aplicação e serviços crypto (`bloopu-frontend` e `bloopu-backend`).      |
| **`social`** (60 tasks)        | `/Users/anonymous/Projects/hauzhouse/social`            | Operação orgânica em redes sociais, automação de mídia e distribuição.   |

### B. Boards de Domínio (Vida Contínua dos Squads)

Cada canal tem seu board próprio para gestão de débito técnico, refinamento e processos que não poluem o backlog de código:

- `csuite-ops` (C-Suite) | `eng-ops` (Engineering) | `product-ops` (Product)
- `ops-ops` (Operations) | `gtm-ops` (Creative/GTM) | `infra-ops` (Infrastructure) | `knowledge-ops` (Knowledge)

---

## 2. As 39 Almas e Alocação Cross-Channel

O roster das 39 almas foi alocado nas 7 sedes temáticas com renderização 3D nativa (`executive`, `tech`, `agency`, `trading`, `publishing`) e assentos físicos mapeados (`placeUnplacedNpcs`).

### Almas Conectoras (Cross-Functional Triad):

- **`Chief-of-Staff`** → Atua em **C-Suite** _(estratégia/diretoria)_ **E** em **Operations** _(cadência/execução)_.
- **`Product-Manager`** → Atua em **Product** _(especificações)_, em **Operations** _(priorização)_ **E** em **Engineering** _(desbloqueio técnico)_.
- **`Technical-Architect`** → Atua em **Infrastructure** _(design de sistemas)_ **E** em **Engineering** _(code review e integridade)_.

---

## 3. Os 4 Motores de Execução Autônoma (Operação 24/7)

Para a empresa rodar continuamente sem intervenção manual, a esteira opera sob **4 motores sincronizados**:

```
                       ┌────────────────────────────────────────────────────────┐
                       │          1. WATCHERS & SENTINELAS ATIVOS               │
                       │ (QA roda testes, SRE monitora logs, SEO audita funil)  │
                       └──────────────────────────┬─────────────────────────────┘
                                                  ▼  [100% IMPLEMENTADO E ATIVO]
┌───────────────────────────────────────────────────────────────────────────────────────────────┐
│                           2. GERAÇÃO AUTÔNOMA DE BACKLOG                                      │
│  Falha detectada / Meta aberta ──► Implementation-Planner + PM criam cards via kanban_create  │
└─────────────────────────────────────────┬─────────────────────────────────────────────────────┘
                                          ▼  [100% IMPLEMENTADO E ATIVO]
┌───────────────────────────────────────────────────────────────────────────────────────────────┐
│                           3. O DISPATCHER LOOP (Trabalho em Background)                       │
│  Card em "ready" ──► Dispatcher spawna o agente (dev/qa) em worktree isolada sem intervenção  │
└─────────────────────────────────────────┬─────────────────────────────────────────────────────┘
                                          ▼  [100% IMPLEMENTADO E ATIVO]
┌───────────────────────────────────────────────────────────────────────────────────────────────┐
│                           4. CADEIA DE DEPENDÊNCIA (Handoff Automático)                       │
│  Dev conclui card ──► Promove automaticamente o card de QA ──► Verifier dá o sign-off         │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
                                             [100% IMPLEMENTADO E ATIVO]
```

---

## 4. Grade Oficial dos Sentinelas Ativos (Motor 1)

Os 4 sentinelas estão cadastrados no DeskRPG (`cron_job_origins`) e rodam nos perfis oficiais dos agentes:

| Canal              | Sala          | Agente (Perfil)             | Sentinela / Job ID |   Frequência   | Ação Autônoma                                                                                                                  |
| :----------------- | :------------ | :-------------------------- | :----------------: | :------------: | :----------------------------------------------------------------------------------------------------------------------------- |
| **Infrastructure** | `NOC`         | `site-reliability-engineer` |   `0b680dab507a`   | **A cada 1h**  | Monitora saúde de VPS, endpoints, filas de webhooks e erros 500. Abre **[INCIDENT-P0]** no board se detectar anomalia.         |
| **Operations**     | `War Room`    | `qa-engineer`               |   `569c5f72f23e`   | **A cada 2h**  | Executa suítes de testes (`hot-telegram`, `mystelia`). Agrupa causas raízes e cria cards **[QA-WATCHDOG]** com stacktrace.     |
| **Operations**     | `Ops Control` | `implementation-planner`    |   `264409207812`   | **A cada 6h**  | Inspeciona boards de projeto e domínio. Se houver menos de 3 cards em todo/ready, decompõe tarefas atômicas e repõe o backlog. |
| **Creative/GTM**   | `Campaigns`   | `seo-specialist`            |   `f3ce2e8cbdfb`   | **A cada 12h** | Varre sitemaps, páginas 404 e tags de conversão nos sites. Abre cards de ajuste de SEO/Funil.                                  |

---

## 5. Como os Agentes Trabalham Sozinhos

1. **Autodescoberta e Alerta:** O sentinela identifica uma falha (ex: teste quebrando ou API lenta) e cria o card com critérios de aceite no board canônico via `kanban_create`.
2. **Despacho em Worktree:** O Dispatcher do Hermes (PID 80606) detecta o card em `ready`, aloca uma git worktree isolada e inicia a execução do especialista (`dev_backend`, `qa_senior`, etc.).
3. **Validação e PR:** O agente altera o código, roda os testes até atingir 100% verde (exit code 0), abre o PR na branch correta e promove a tarefa para revisão.
4. **Handoff em Dominó:** Ao marcar a tarefa como concluída, o kernel do Hermes desbloqueia a tarefa subsequente de QA/Verificação automaticamente.

---

## 6. O Papel do Soberano (Você)

Você **não** gerencia tickets, não arrasta cards e não digita tarefas operacionais. Seu papel se resume a:

1. **Acompanhar a Telemetria:** Olhar as salas e a movimentação visual no DeskRPG.
2. **Definir a Meta (North Star):** Quando quiser uma iniciativa nova, dizer o objetivo no **C-Suite** ou no **Operations → Ops Control**.
3. **Revisar Gates de Produção:** Autorizar o merge final para as branches de produção quando o QA e o Verifier derem o sinal verde.
