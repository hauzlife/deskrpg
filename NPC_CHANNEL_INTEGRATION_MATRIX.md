# Matriz de Integração e Topologia dos Perfis (39 Almas nos 7 Canais)

Documento oficial de distribuição, interconexão e presença dos perfis (NPCs) da HIVE através dos 7 mundos temáticos do DeskRPG.

---

## 1. Classificação Estrutural das 39 Almas

Para garantir que o fluxo de trabalho não tenha silos rígidos nem ruído generalizado, as 39 almas estão divididas em **três categorias de mobilidade**:

1. **Tríade Universal (3 perfis — 7 mundos):** Presentes em todos os canais para garantir coordenação, revisão de qualidade e auditoria de entrega contínua.
2. **Coringas Setoriais (8 perfis — 2 a 3 mundos):** Almas conectoras que transitam entre áreas correlatas (ex: Engenharia ↔ Produto ↔ Operações).
3. **Especialistas Verticais (28 perfis — 1 mundo exclusivo):** Foco técnico estrito dentro do seu departamento de domínio, sem dispersão de contexto.

---

## 2. Matriz Consolidada de Presença por Canal

| Papel (NPC) | Categoria | C-Suite | Engineering | Product | Operations | Creative/GTM | Infrastructure | Knowledge | Salas Ativas Principais |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **`orchestrator`** | **Tríade Universal** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Todas as salas + Ops Control |
| **`reviewer`** | **Tríade Universal** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Dev Lab, War Room, Boardroom |
| **`verifier`** | **Tríade Universal** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | War Room, Dev Lab, Incident Resp |
| **`implementation-planner`** | **Coringa Setorial** | — | ✓ | ✓ | ✓ | — | — | — | Dev Lab, Product Office, Ops Control |
| **`product-manager`** | **Coringa Setorial** | — | ✓ | ✓ | ✓ | — | — | — | Product Office, Ops Control, Dev Lab |
| **`technical-architect`** | **Coringa Setorial** | — | ✓ | ✓ | — | — | ✓ | — | Dev Lab, Product Office, NOC |
| **`technical-writer`** | **Coringa Setorial** | — | ✓ | ✓ | — | ✓ | — | — | Meeting Room, Product Office, Campaigns |
| **`qa-engineer`** | **Coringa Setorial** | — | ✓ | — | ✓ | — | — | — | Dev Lab, War Room |
| **`security-engineer`** | **Coringa Setorial** | — | ✓ | — | — | — | ✓ | — | Dev Lab, Incident Response, NOC |
| **`site-reliability-engineer`** | **Coringa Setorial** | — | — | — | ✓ | — | ✓ | — | War Room, NOC, Incident Response |
| **`chief-of-staff`** | **Coringa Setorial** | ✓ | — | — | ✓ | — | — | — | CFO Suite, Boardroom, Ops Control |

---

## 3. Especialistas Verticais (28 Almas Fixadas em 1 Único Canal)

Estes especialistas trabalham com exclusividade nos boards e salas de seu departamento de origem:

### A. C-Suite (7 Especialistas Exclusivos)
- `ceo` *(Direção executiva)* | `cto` *(Estratégia de tecnologia)* | `cfo` *(Alocação de capital e runway)*
- `coo` *(Eficiência operacional)* | `cmo` *(Estratégia de crescimento)* | `clo` *(Risco jurídico e compliance)*
- `chro` *(Cultura e pessoas)* | `cpo` *(Visão de produto)*

### B. Engineering (7 Especialistas Exclusivos)
- `backend-engineer` *(APIs e regras de negócio)* | `frontend-engineer` *(Interfaces e componentes)*
- `platform-engineer` *(Pipelines e tooling)* | `debugger` *(Diagnóstico cirúrgico de erros)*
- `data-architect` *(Modelagem de dados e schema)* | `data-engineer` *(ETL e ingestão de dados)*
- `data-scientist` *(Modelos e inferência)* | `ml-engineer` *(MLOps e tensores)*
- `oss-contributor` *(Higiene open-source)*

### C. Product (4 Especialistas Exclusivos)
- `ux-designer` *(Fluxos visuais e protótipos)* | `researcher` *(Pesquisa de usuários e mercado)*
- `editor` *(Coerência editorial de produto)* | `spec-driven-development` *(Critérios formais SDD)*

### D. Operations (1 Especialista Exclusivo)
- `kanban-strategist` *(Governança de WIP, limites de fluxo e cadência)*

### E. Creative/GTM (4 Especialistas Exclusivos)
- `brand-designer` *(Identidade visual e criativos)* | `copy-editor` *(Copywriting de conversão e microcopy)*
- `seo-specialist` *(Indexação, tráfego orgânico e sitemaps)* | `writer` *(Artigos e conteúdo de marca)*

### F. Knowledge (2 Especialistas Exclusivos)
- `curator` *(SSOT, base de conhecimento e indexação do vault)*
- `wonderer` *(Pesquisa exploratória e conexões interdisciplinares)*

---

## 4. Como os Perfis Interagem nos Canais e Salas

1. **Nas Salas `Office` (Whole Office):**
   - Todos os NPCs alocados no canal escutam os comunicados gerais sob política `'mention'`.
   - Evita ruído e respostas desnecessárias; respondem apenas quando chamados via `@perfil`.

2. **Nas Salas Temáticas (`Dev Lab`, `War Room`, `Ops Control`, `Boardroom`, etc.):**
   - Política `'members'`: Os membros da sala dialogam ativamente e colaboram na resolução das tarefas.
   - Quando um card técnico é criado em **Ops Control**, os coringas (`implementation-planner`, `product-manager`) alinham a entrega e o `orchestrator` despacha diretamente para os especialistas no **Dev Lab** de Engineering.

3. **Garantia de Não-Isolamento:**
   - Como a **Tríade Universal** e os **Coringas Setoriais** estão presentes nas fronteiras dos canais, nenhuma demanda fica perdida ou isolada em um mundo sem acompanhamento.

---

## 5. Resumo da Execução Técnica

- **26 novas instâncias de NPCs** criadas e amarradas aos perfis do Hermes.
- **57 vínculos de salas (`chat_room_members`)** configurados para acesso granular aos chats temáticos.
- **Auto-seating 3D (`placeUnplacedNpcs`)**: 100% dos NPCs posicionados em mesas/estações (zero coordenadas nulas).
- **Consistência de dados**: Verificado em banco e sincronizado no repositório oficial (`hauzlife/deskrpg`).
