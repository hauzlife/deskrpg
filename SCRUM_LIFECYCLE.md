# Arquitetura e Especificação do Scrum Lifecycle (HIVE — DeskRPG + Hermes)

Documento oficial de especificação e governança da esteira **Scrum Lifecycle** da HIVE.  
Estabelece o modelo **Scrumban**, combinando o motor de fluxo contínuo do Kanban (com os 5 Portões de Fusão do GitHub) com a cadência temporal, foco e prestação de contas do Scrum em sprints semanais de 5 dias úteis (Segunda a Sexta).

---

## 1. O Problema Fundamental do Kanban Puro

Um sistema puramente em Kanban puxa tarefas do topo do backlog sem prazo limite. Em uma organização com 40 agentes autônomos, o Kanban puro produz três falhas estratégicas:

1. **Ausência de Sprint Goal:** Os agentes entregam cartões aleatórios sem saber qual objetivo de negócio deve estar funcionando na sexta-feira.
2. **Escopo Infinito:** Sem timebox, novos cartões são adicionados no meio do caminho, diluindo o foco dos squads e gerando entregas incompletas.
3. **Falta de Demonstração e Retrospectiva:** O código é mergeado, mas o usuário/Soberano não recebe uma demonstração clara do incremento pronto e as lições aprendidas não são consolidadas no vault.

---

## 2. A Solução Scrumban: Todas as Cerimônias como Reuniões Nativas do DeskRPG

O **Scrum Lifecycle** atua como a moldura estratégica que governa o motor do Kanban. **Toda e qualquer cerimônia é instanciada através da feature oficial de reuniões (`meeting_minutes`) do DeskRPG**:

- **Elementos Visuais e Espaciais:** Os avatares 3D dos especialistas se deslocam pelo escritório virtual e sentam fisicamente ao redor da mesa de reunião (`Boardroom`, `Dev Lab`, `Product Office`).
- **Transcrição e Diálogo Completo:** Cada turno de fala é gravado na íntegra com os argumentos, discordâncias construtivas e convergências dos especialistas.
- **Relatório e Ata Visual:** Registro formal com tópicos-chave, decisões e a ata visual exportável em Markdown.
- **Auto-Registro de Tarefas (`registerBatch`):** Os itens de ação acordados na reunião viram cards no Kanban automaticamente.

```
Segunda-feira (09:00) ──────► Terça a Sexta (08:30) ──────► Quarta-feira (14:00) ──────► Sexta-feira (16:30) ──────► Sexta-feira (17:30)
 ┌─────────────────┐           ┌──────────────────┐           ┌─────────────────┐           ┌─────────────────┐           ┌─────────────────┐
 │ SPRINT PLANNING │           │  ASYNC STANDUP   │           │ MID-SPRINT CHECK│           │  SPRINT REVIEW  │           │  RETROSPECTIVE  │
 │ • Reunião 3D    │           │ • Mesa redonda   │           │ • Burndown rate │           │ • Demo com Artur│           │ • Reunião na Bib│
 │ • Sprint Goal   │           │ • 3 Linhas/agente│           │ • Corte escopo  │           │ • Incremento OK │           │ • AAR no Vault  │
 │ • Auto-Cards    │           │ • HK-08 Blocker  │           │ • Ata gravada   │           │ • 5 Gates OK    │           │ • Ata gravada   │
 └─────────────────┘           └──────────────────┘           └─────────────────┘           └─────────────────┘           └─────────────────┘
```

---

## 3. As 5 Cerimônias do Scrum Lifecycle Autônomo

### Cerimônia 1: `SprintPlanningHook` (Segunda-feira — 09:00)

- **Local:** `Boardroom` e `Product Office`.
- **Participantes:** `@product-manager` (Líder), `@implementation-planner`, `@technical-architect`, `@cpo`.
- **Ações Automatizadas:**
  1. O `@product-manager` define o **Sprint Goal** específico de cada um dos 4 projetos (`hot-telegram`, `mystelia`, `bloopu`, `social`).
  2. O `@implementation-planner` extrai os épicos do backlog e fatia as tarefas em cards de `<4h` com arquivos afetados e testes mapeados.
  3. O conjunto de tarefas prioritárias recebe a tag `sprint-WW-YYYY` e o **Sprint Backlog é selado**.
  4. **Regra de Travamento de Escopo:** Novos cards só entram no sprint backlog se forem incidentes P0 de produção aprovados pelo SRE/PM.

### Cerimônia 2: `DailyStandupHook` (Terça a Sexta — 08:30)

- **Local:** Salas táticas (`Dev Lab`, `NOC`, `War Room`, `Ops Control`).
- **Participantes:** Todos os engenheiros, QAs e planners ativos.
- **Ações Automatizadas:**
  1. Cada agente gera um relatório estrito de 3 linhas:
     - **Linha 1:** O que concluiu ontem (PRs mergeados nos 5 portões).
     - **Linha 2:** Qual tarefa está executando hoje da coluna `ready`.
     - **Linha 3:** Impedimentos ou blockers ativos.
  2. O `@chief-of-staff` e o `@orchestrator` consolidam a ata e acionam o `HK-08 (BlockerTriageHook)` imediatamente para qualquer impedimento reportado.

### Cerimônia 3: `MidSprintScopeGuardHook` (Quarta-feira — 14:00)

- **Local:** `Ops Control`.
- **Participantes:** `@kanban-strategist`, `@product-manager`.
- **Ações Automatizadas:**
  1. O `@kanban-strategist` calcula a velocidade de vazão (throughput) e a curva de burndown dos cards restantes.
  2. Se a projeção de entrega até sexta-feira for inferior a 85% do Sprint Goal, o status entra em `at_risk`.
  3. O `@product-manager` executa o **Corte Preventivo de Escopo (Scope Slicing)**: tarefas secundárias ou perfumarias são despriorizadas de volta para o backlog futuro, garantindo que o núcleo monetizável da meta seja entregue 100% verde.

### Cerimônia 4: `SprintReviewDemoHook` (Sexta-feira — 16:30)

- **Local:** Chat executivo com o Soberano (Artur Modesto).
- **Participantes:** `@product-manager`, `@verifier`, `@qa-engineer`, `@cpo`.
- **Ações Automatizadas:**
  1. Valida se todos os cards entregues cumpriram a **Definição de Pronto (DoD)** e passaram nos 5 Portões de Fusão.
  2. Consolida o **SITREP de Entrega da Sprint**:
     - Lista de PRs mergeados com links de diff e commits.
     - Demonstração funcional das features ativas em produção.
     - Métricas de impacto (vendas geradas, latência reduzida, novos usuários).
  3. Apresenta o pacote pronto para homologação do Soberano.

### Cerimônia 5: `SprintRetrospectiveHook` (Sexta-feira — 17:30)

- **Local:** `Knowledge / Library`.
- **Participantes:** `@curator`, `@site-reliability-engineer`, `@debugger`.
- **Ações Automatizadas:**
  1. Analisa a telemetria do ciclo: quantos cards entraram em `blocked`, quantas falhas de CI ocorreram, tempo médio de cycle time.
  2. Gera o relatório de Lições Aprendidas (AAR — After Action Review).
  3. O `@curator` atualiza as regras do sistema no vault (`skills/` e memórias duráveis), garantindo aprendizado acumulado entre sprints.

---

## 4. Definição de Pronto (Definition of Done — DoD)

Nenhum card é considerado concluído na Sprint sem atender a 100% dos critérios abaixo:

1. **Código com Testes Automatizados:** Suíte unitária/integração com 100% de aprovação (exit code 0).
2. **Merge nos 5 Portões de Fusão:**
   - [x] Gate 1: Sem conflitos de merge com a `main`.
   - [x] Gate 2: GitHub Actions CI verde.
   - [x] Gate 3: Parecer técnico aprovado por `@reviewer`.
   - [x] Gate 4: Homologação de cenários aprovada por `@qa-engineer`.
   - [x] Gate 5: Validação de aceite de negócio aprovada por `@product-manager`.
3. **Deploy em Staging/Produção:** Implantação confirmada pelo SRE com monitoramento ativo.
4. **Artefato de Proveniência:** Registro do PR, commit SHA e pirâmide de artefato vinculados ao card.

---

## 5. Matriz de Integração com o DeskRPG e Hermes

| Cerimônia            | Gatilho                   | Responsável Primário | Entregável Concreto                                 |
| :------------------- | :------------------------ | :------------------- | :-------------------------------------------------- |
| **Sprint Planning**  | Cron Seg 09:00 / Hook     | `@product-manager`   | Sprint Goals selados e cards etiquetados no Kanban. |
| **Async Standup**    | Cron Ter-Sex 08:30 / Hook | `@chief-of-staff`    | Resumo de impedimentos e destravamento via HK-08.   |
| **Mid-Sprint Check** | Cron Qua 14:00 / Hook     | `@kanban-strategist` | Gráfico de burndown e parecer de corte de escopo.   |
| **Sprint Review**    | Cron Sex 16:30 / Hook     | `@product-manager`   | Relatório executivo do incremento para o Soberano.  |
| **Sprint Retro**     | Cron Sex 17:30 / Hook     | `@curator`           | AAR estruturado e atualização de regras no vault.   |
