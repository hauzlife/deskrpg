const crypto = require("crypto");
const fs = require("fs");
const Database = require("/Users/anonymous/Projects/deskrpg/node_modules/better-sqlite3");

const db = new Database("/Users/anonymous/.deskrpg/data/deskrpg.db");
const secret = fs
  .readFileSync("/Users/anonymous/.deskrpg/.env.local", "utf8")
  .split("\n")
  .find((l) => l.startsWith("JWT_SECRET="))
  .split("=")
  .slice(1)
  .join("=")
  .replace(/^"|"$/g, "");

function b64url(b) {
  return Buffer.from(b)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function sign(payload) {
  const h = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64url(JSON.stringify(payload));
  const sig = crypto
    .createHmac("sha256", secret)
    .update(h + "." + p)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  return h + "." + p + "." + sig;
}

const now = Math.floor(Date.now() / 1000);
const token = sign({
  userId: "18d2b828-f0ea-414b-9222-2ed5001fb774",
  nickname: "Majestade",
  iat: now,
  exp: now + 86400 * 7,
});
const headers = { "Content-Type": "application/json", Cookie: `token=${token}` };

// Build map: (profile_name, channel_name) -> { npc_id, channel_id }
const rows = db
  .prepare(
    `
  SELECT n.id as npc_id, c.id as channel_id, c.name as channel_name, p.profile_name
  FROM npcs n
  JOIN channels c ON n.channel_id = c.id
  JOIN hermes_profiles p ON n.hermes_profile_id = p.id
`,
  )
  .all();

const npcMap = new Map();
for (const r of rows) {
  npcMap.set(`${r.profile_name}:${r.channel_name}`, r);
}

// Clean previous jobs from origins and profiles
const existing = db.prepare("SELECT channel_id, profile_name, job_id FROM cron_job_origins").all();
for (const row of existing) {
  const profileDir = `/Users/anonymous/.hermes/profiles/${row.profile_name}/cron`;
  const jobsFile = `${profileDir}/jobs.json`;
  if (fs.existsSync(jobsFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(jobsFile, "utf8"));
      if (Array.isArray(data.jobs)) {
        data.jobs = data.jobs.filter((j) => j.id !== row.job_id);
        fs.writeFileSync(jobsFile, JSON.stringify(data, null, 2));
      }
    } catch (e) {}
  }
}
db.prepare("DELETE FROM cron_job_origins").run();
console.log("Cleaned previous registered jobs from database.");

// Definition of all 70 autonomous routines from SOULS_AUTONOMOUS_CRON_SCHEDULE.md
const SPECS = [
  // 1. Governança Universal
  {
    profile: "orchestrator",
    channel: "Operations",
    name: "Ops Workstream and Dependency Alignment",
    schedule: "30 8 * * 1-5",
    prompt:
      "Você é o orchestrator da HIVE. Alinhar a cadeia de dependências entre Engenharia, Operações e Produto para o dia. Varrer os 4 boards de projeto e destravar dependências entre cards. Autônomo.",
  },
  {
    profile: "orchestrator",
    channel: "Operations",
    name: "Blocker Escalation and Circuit Breaker",
    schedule: "every 4h",
    prompt:
      "Você é o orchestrator da HIVE. Detectar tasks em deadlock, com falhas consecutivas ou paradas há mais de 4h. Se houver blocker crítico, reatribuir ou quebrar a tarefa em subtarefa viável via kanban_create. Autônomo.",
  },
  {
    profile: "orchestrator",
    channel: "Operations",
    name: "Daily Release Packaging",
    schedule: "0 18 * * 1-5",
    prompt:
      "Você é o orchestrator da HIVE no canal Operations. Consolidar os PRs e cards aprovados do dia para homologação executiva, gerando o changelog consolidado. Autônomo.",
  },
  {
    profile: "kanban-strategist",
    channel: "Operations",
    name: "WIP Limit and Flow Hygiene Audit",
    schedule: "0 11 * * 1-5",
    prompt:
      "Você é o kanban-strategist da HIVE. Auditar limites de WIP, gargalos de fluxo e colunas inchadas nos boards ativos. Balancear a esteira gerando cards de higiene de fluxo no ops-ops. Autônomo.",
  },
  {
    profile: "kanban-strategist",
    channel: "Operations",
    name: "Weekly Throughput and Lead Time Analytics",
    schedule: "0 16 * * 5",
    prompt:
      "Você é o kanban-strategist da HIVE. Calcular tempo de ciclo, velocidade de vazão e lead time dos 4 projetos na semana. Registrar o relatório no ops-ops. Autônomo.",
  },
  {
    profile: "reviewer",
    channel: "Engineering",
    name: "Open PRs Triage and Review Gate",
    schedule: "every 4h",
    prompt:
      "Você é o reviewer da HIVE. Varrer PRs abertos pendentes de code review nos 4 repositórios (hot-telegram, mystelia, bloopu, social). Analisar diffs e emitir parecer ou aprovação. Autônomo.",
  },
  {
    profile: "reviewer",
    channel: "Engineering",
    name: "Code Smells and Static Quality Pulse",
    schedule: "30 15 * * 1-5",
    prompt:
      "Você é o reviewer da HIVE. Rodar linter e análise estática nas branches de feature ativas. Gerar cards de refino técnico no eng-ops se houver violações graves. Autônomo.",
  },
  {
    profile: "verifier",
    channel: "Operations",
    name: "Acceptance Criteria Verification",
    schedule: "30 17 * * 1-5",
    prompt:
      "Você é o verifier da HIVE. Executar testes de aceitação formal contra os critérios declarados nos cards prontos para release. Dar sign-off objetivo de qualidade. Autônomo.",
  },
  {
    profile: "verifier",
    channel: "Operations",
    name: "Post-Deploy E2E Sanity Probe",
    schedule: "every 6h",
    prompt:
      "Você é o verifier da HIVE. Executar smoke test dos fluxos críticos de compra, webhook e autenticação em produção. Se falhar, abrir card de regressão P0 imediatamente. Autônomo.",
  },

  // 2. C-Suite
  {
    profile: "ceo",
    channel: "C-Suite",
    name: "Strategic Alignment and North Star Check",
    schedule: "0 8 * * 1",
    prompt:
      "Você é o CEO da HIVE. Comparar a velocidade de entrega das branches com as metas de receita e monetização da organização. Emitir memorando de foco estratégico semanal no csuite-ops. Autônomo.",
  },
  {
    profile: "cto",
    channel: "Engineering",
    name: "Tech Radar and Stack Drift Audit",
    schedule: "30 8 * * 1",
    prompt:
      "Você é o CTO da HIVE. Avaliar dívida técnica da stack, compatibilidade de dependências e evolução de arquitetura nos 4 projetos. Atualizar o Tech Radar no eng-ops. Autônomo.",
  },
  {
    profile: "cto",
    channel: "Infrastructure",
    name: "High-Severity Architecture Emergency Probe",
    schedule: "15 8 * * 1-5",
    prompt:
      "Você é o CTO da HIVE. Inspecionar incidentes e gargalos de infraestrutura que afetem múltiplos sistemas na VPS. Emitir diretriz de resiliência e estabilidade. Autônomo.",
  },
  {
    profile: "cfo",
    channel: "C-Suite",
    name: "Weekly Financial and Token Burn SITREP",
    schedule: "0 17 * * 5",
    prompt:
      "Você é o CFO da HIVE. Consolidar os custos de computação, consumo de tokens e infraestrutura vs volume de vendas nos checkouts de Stripe/PIX. Relatório no csuite-ops. Autônomo.",
  },
  {
    profile: "cfo",
    channel: "Operations",
    name: "Payment Drop and Conversion Guard",
    schedule: "every 12h",
    prompt:
      "Você é o CFO da HIVE em Operations. Auditar a taxa de conversão de checkouts abertos vs pagos nas últimas 12 horas. Se houver queda anormal de pagamentos, alertar o canal com diagnóstico. Autônomo.",
  },
  {
    profile: "coo",
    channel: "Operations",
    name: "Daily Operations Cadence",
    schedule: "45 8 * * 1-5",
    prompt:
      "Você é o COO da HIVE. Varrer a distribuição de carga entre os agentes dos squads operacionais e de engenharia. Rebalancear alocações para evitar ociosidade. Autônomo.",
  },
  {
    profile: "coo",
    channel: "Operations",
    name: "SLA and Delivery Commitment Audit",
    schedule: "0 17 * * 3",
    prompt:
      "Você é o COO da HIVE. Auditar o tempo médio de resolução de blockers e o cumprimento de prazos de entrega dos cards. Relatório de eficiência no ops-ops. Autônomo.",
  },
  {
    profile: "cmo",
    channel: "Creative/GTM",
    name: "Growth Funnel and CAC LTV Performance Review",
    schedule: "0 10 * * 2,4",
    prompt:
      "Você é o CMO da HIVE em Creative/GTM. Analisar a tração de canais orgânicos e funis de conversão nos projetos de mídia e vendas (social, hot-telegram). Recomendar ajustes no gtm-ops. Autônomo.",
  },
  {
    profile: "cmo",
    channel: "Creative/GTM",
    name: "Campaign Launch Gate",
    schedule: "30 10 * * 1",
    prompt:
      "Você é o CMO da HIVE. Avaliar e aprovar os lançamentos de campanhas da semana no canal Creative/GTM, garantindo tom de voz, promessa de conversão e integridade dos links de compra. Autônomo.",
  },
  {
    profile: "cpo",
    channel: "Product",
    name: "Product Roadmap Velocity Tracking",
    schedule: "30 9 * * 3",
    prompt:
      "Você é o CPO da HIVE em Product. Mapear o progresso das entregas dos 4 projetos em relação aos marcos de produto de médio prazo. Emitir relatório no product-ops. Autônomo.",
  },
  {
    profile: "cpo",
    channel: "Product",
    name: "User Friction and Churn Signal Analysis",
    schedule: "0 14 * * 5",
    prompt:
      "Você é o CPO da HIVE. Inspecionar relatórios de telemetria de uso dos clientes, identificando gargalos de usabilidade e causas de abandono. Gerar cards de evolução no backlog. Autônomo.",
  },
  {
    profile: "clo",
    channel: "C-Suite",
    name: "Monthly Compliance and Privacy Audit",
    schedule: "0 9 1 * *",
    prompt:
      "Você é o CLO da HIVE. Auditar conformidade com termos de serviço de gateways de pagamento, privacidade de dados de usuários e integridade jurídica no csuite-ops. Autônomo.",
  },
  {
    profile: "chro",
    channel: "C-Suite",
    name: "Weekly Agent Role and Capability Audit",
    schedule: "0 15 * * 5",
    prompt:
      "Você é o CHRO da HIVE. Verificar se as 39 almas têm ferramentas, memórias e instruções alinhadas com as responsabilidades operacionais. Ajustar skills e documentação. Autônomo.",
  },
  {
    profile: "chief-of-staff",
    channel: "Operations",
    name: "Daily Morning Executive Standup",
    schedule: "30 8 * * 1-5",
    prompt:
      "Você é o Chief-of-Staff da HIVE. Varrer o status de todos os 7 mundos do DeskRPG e compilar o briefing executivo matinal com prioridades e blockers para o Soberano. Autônomo.",
  },
  {
    profile: "chief-of-staff",
    channel: "Operations",
    name: "Cross-World Escalation Sync",
    schedule: "every 6h",
    prompt:
      "Você é o Chief-of-Staff da HIVE. Monitorar demandas interdisciplinares que cruzam C-Suite, Engenharia e Operações. Destravar tarefas órfãs e acionar responsáveis. Autônomo.",
  },

  // 3. Produto, Pesquisa e Specs
  {
    profile: "product-manager",
    channel: "Product",
    name: "Daily Spec and Acceptance Criteria Grooming",
    schedule: "0 9 * * 1-5",
    prompt:
      "Você é o product-manager da HIVE no canal Product. Refinar critérios de aceite, requisitos funcionais e contratos de dados dos cards em planejamento para engenharia. Autônomo.",
  },
  {
    profile: "product-manager",
    channel: "Product",
    name: "Continuous Roadmap Progression",
    schedule: "every 8h",
    prompt:
      "Você é o product-manager da HIVE. Analisar o avanço das branches e cards concluídos nos 4 projetos e descer novas tarefas atômicas no backlog. Autônomo.",
  },
  {
    profile: "product-manager",
    channel: "Product",
    name: "Feature Rollout and Flag Verification",
    schedule: "30 16 * * 1-5",
    prompt:
      "Você é o product-manager da HIVE. Verificar a estabilidade e comportamento de novas features recém-publicadas em produção, registrando notas no product-ops. Autônomo.",
  },
  {
    profile: "implementation-planner",
    channel: "Operations",
    name: "Roadmap Grooming and Task Slicing",
    schedule: "every 8h",
    prompt:
      "Você é o implementation-planner da HIVE em Operations. Inspecionar os 4 boards de projeto. Decompor a próxima fase técnica de cada roadmap em cards atômicos de <4h com arquivos afetados e testes. Autônomo.",
  },
  {
    profile: "implementation-planner",
    channel: "Operations",
    name: "Technical Dependency Topology Check",
    schedule: "30 11 * * 1-5",
    prompt:
      "Você é o implementation-planner da HIVE. Mapear a árvore de precedência parent/child de tarefas para evitar ciclos ou gargalos de execução paralela. Autônomo.",
  },
  {
    profile: "spec-driven-development",
    channel: "Product",
    name: "SDD Verification Loop",
    schedule: "0 10 * * 1-5",
    prompt:
      "Você é o spec-driven-development da HIVE em Product. Comparar as implementações de código recentes contra as especificações formais do SDD, gerando cards de desvio de spec. Autônomo.",
  },
  {
    profile: "spec-driven-development",
    channel: "Engineering",
    name: "Contract Schema and AST Shape Check",
    schedule: "30 14 * * 1-5",
    prompt:
      "Você é o spec-driven-development em Engineering. Validar se os contratos de API e DTOs entre serviços continuam sincronizados e sem breaking changes. Autônomo.",
  },
  {
    profile: "researcher",
    channel: "Creative/GTM",
    name: "Market Signals and Competitor Reconnaissance",
    schedule: "30 9 * * 2,4",
    prompt:
      "Você é o researcher da HIVE em Creative/GTM. Monitorar tendências de mercado, movimentos de concorrentes e oportunidades de monetização rápida. Relatório no gtm-ops. Autônomo.",
  },
  {
    profile: "researcher",
    channel: "Knowledge",
    name: "Deep Domain Literature Synthesis",
    schedule: "0 11 * * 3",
    prompt:
      "Você é o researcher da HIVE em Knowledge. Pesquisar avanços em IA, tensores e arquitetura de agentes, consolidando sínteses analíticas no canal Knowledge. Autônomo.",
  },
  {
    profile: "ux-designer",
    channel: "Product",
    name: "UI UX Consistency and Design System Audit",
    schedule: "0 14 * * 1",
    prompt:
      "Você é o ux-designer da HIVE em Product. Auditar telas, fluxos de navegação e consistência visual dos frontends dos projetos, gerando cards de polimento de UI. Autônomo.",
  },
  {
    profile: "ux-designer",
    channel: "Product",
    name: "User Journey Drop-Off Review",
    schedule: "0 15 * * 4",
    prompt:
      "Você é o ux-designer da HIVE. Inspecionar telas de checkout e landing pages em busca de pontos de fricção ou confusão cognitiva para o usuário. Autônomo.",
  },

  // 4. Engenharia de Software & Dados
  {
    profile: "technical-architect",
    channel: "Engineering",
    name: "Weekly Tech Debt and Architecture Audit",
    schedule: "0 7 * * 1",
    prompt:
      "Você é o technical-architect da HIVE em Engineering. Auditar complexidade ciclomática, acoplamento modular e saúde da base de código nos 4 projetos. Gerar cards no eng-ops. Autônomo.",
  },
  {
    profile: "technical-architect",
    channel: "Engineering",
    name: "System Boundary and Contract Verification",
    schedule: "30 16 * * 4",
    prompt:
      "Você é o technical-architect da HIVE. Validar fronteiras entre frontend, backend e microsserviços para garantir resiliência e ausência de dependências circulares. Autônomo.",
  },
  {
    profile: "backend-engineer",
    channel: "Engineering",
    name: "API Query Cost and Latency Probe",
    schedule: "0 11 * * 1-5",
    prompt:
      "Você é o backend-engineer da HIVE em Engineering. Monitorar tempo de resposta de endpoints de backend e otimizar queries lentas nos bancos de dados. Autônomo.",
  },
  {
    profile: "backend-engineer",
    channel: "Engineering",
    name: "Idempotency and Webhook Retry Resiliency",
    schedule: "30 14 * * 2,5",
    prompt:
      "Você é o backend-engineer da HIVE. Auditar rotas críticas de cobrança, webhooks de Telegram e Stripe para garantir idempotência contra requisições duplicadas. Autônomo.",
  },
  {
    profile: "frontend-engineer",
    channel: "Engineering",
    name: "Bundle Size and Asset Performance Audit",
    schedule: "30 11 * * 1,4",
    prompt:
      "Você é o frontend-engineer da HIVE em Engineering. Auditar tamanho de bundles JS, tempos de carregamento de página e Web Vitals dos apps frontend. Autônomo.",
  },
  {
    profile: "frontend-engineer",
    channel: "Engineering",
    name: "UI State Machine and Error Sweep",
    schedule: "0 16 * * 1-5",
    prompt:
      "Você é o frontend-engineer da HIVE. Checar logs do navegador e componentes em busca de erros de renderização ou inconsistência de estado. Autônomo.",
  },
  {
    profile: "debugger",
    channel: "Engineering",
    name: "Root Cause Exception Sweep",
    schedule: "every 4h",
    prompt:
      "Você é o debugger da HIVE. Rastrear exceções e traces de erro recentes nos projetos, gerando diagnósticos objetivos de causa raiz (RCA) de 3 linhas no War Room. Autônomo.",
  },
  {
    profile: "debugger",
    channel: "Operations",
    name: "Flaky Test and Concurrency Race Detection",
    schedule: "0 16 * * 3",
    prompt:
      "Você é o debugger da HIVE em Operations. Identificar testes intermitentes (flaky) ou condições de corrida nas suítes automatizadas dos projetos. Corrigir fixtures. Autônomo.",
  },
  {
    profile: "data-architect",
    channel: "Engineering",
    name: "Database Schema Migration and Index Sanity",
    schedule: "0 9 * * 2",
    prompt:
      "Você é o data-architect da HIVE em Engineering. Auditar migrations pendentes, uso de índices e locks em tabelas críticas dos bancos SQLite e PostgreSQL. Autônomo.",
  },
  {
    profile: "data-architect",
    channel: "Engineering",
    name: "Vector Store and Embedding Integrity Check",
    schedule: "0 10 * * 5",
    prompt:
      "Você é o data-architect da HIVE. Auditar a integridade das coleções vetoriais e integridade semântica dos embeddings de conhecimento da HIVE. Autônomo.",
  },
  {
    profile: "data-engineer",
    channel: "Engineering",
    name: "Pipeline ETL and Freshness Sentinel",
    schedule: "every 6h",
    prompt:
      "Você é o data-engineer da HIVE em Engineering. Monitorar pipelines de dados e sincronizações em batch para garantir atualização contínua sem quebras de fila. Autônomo.",
  },
  {
    profile: "data-engineer",
    channel: "Engineering",
    name: "Data Quality and Null Assertion Probe",
    schedule: "30 7 * * 1-5",
    prompt:
      "Você é o data-engineer da HIVE. Executar assertions de qualidade de dados nas tabelas consolidadas, detectando valores nulos ou dados corrompidos. Autônomo.",
  },
  {
    profile: "data-scientist",
    channel: "Engineering",
    name: "Model Accuracy and Prediction Drift Audit",
    schedule: "0 10 * * 1",
    prompt:
      "Você é o data-scientist da HIVE em Engineering. Auditar métricas de acurácia e detecção de drift estatístico nos modelos de predição e análise. Autônomo.",
  },
  {
    profile: "ml-engineer",
    channel: "Engineering",
    name: "Inference Latency and Hardware Utilization",
    schedule: "every 12h",
    prompt:
      "Você é o ml-engineer da HIVE em Engineering. Monitorar tempos de inferência local (Metal/MLX), consumo de VRAM e eficiência de quantização dos modelos. Autônomo.",
  },
  {
    profile: "platform-engineer",
    channel: "Engineering",
    name: "CI CD Build Time and Cache Optimization",
    schedule: "0 8 * * 3",
    prompt:
      "Você é o platform-engineer da HIVE em Engineering. Otimizar pipelines de CI/CD, caching de dependências e tempo de execução dos builds dos projetos. Autônomo.",
  },
  {
    profile: "platform-engineer",
    channel: "Engineering",
    name: "Local Worktree and Workspace Cleanup",
    schedule: "0 4 * * 6",
    prompt:
      "Você é o platform-engineer da HIVE. Purgar branches e worktrees órfãs, containers inativos e lixo temporário do disco para preservar performance. Autônomo.",
  },
  {
    profile: "oss-contributor",
    channel: "Engineering",
    name: "Upstream Dependencies and License Compliance",
    schedule: "0 10 * * 3",
    prompt:
      "Você é o oss-contributor da HIVE em Engineering. Checar atualizações de segurança de bibliotecas open-source e garantir conformidade de licenças nos repositórios. Autônomo.",
  },
  {
    profile: "editor",
    channel: "Product",
    name: "Technical Product Messaging Polish",
    schedule: "0 17 * * 1-5",
    prompt:
      "Você é o editor da HIVE em Product. Revisar a redação de notas de release, documentação voltada para o usuário e microcopy de telas entregues no dia. Autônomo.",
  },

  // 5. Operações, QA, Infra & Segurança
  {
    profile: "qa-engineer",
    channel: "Operations",
    name: "Test Suites Regression Sentinel",
    schedule: "every 2h",
    prompt:
      "Você é o qa-engineer da HIVE em Operations. Executar as suítes de testes automatizados dos projetos hot-telegram e mystelia. Se quebrar, abrir card de bug com traceback. Autônomo.",
  },
  {
    profile: "qa-engineer",
    channel: "Operations",
    name: "E2E Critical Path Regression",
    schedule: "0 6 * * 1-5",
    prompt:
      "Você é o qa-engineer da HIVE. Rodar testes de regressão E2E nos caminhos críticos de conversão e pagamento dos projetos antes do início do expediente. Autônomo.",
  },
  {
    profile: "site-reliability-engineer",
    channel: "Infrastructure",
    name: "Production Uptime and Endpoint Probe",
    schedule: "every 1h",
    prompt:
      "Você é o site-reliability-engineer da HIVE em Infrastructure (NOC). Checar status de resposta 200 de todos os endpoints e serviços locais e da VPS. Se cair, abrir incidente P0. Autônomo.",
  },
  {
    profile: "site-reliability-engineer",
    channel: "Infrastructure",
    name: "VPS Resource and Zombie Process Probe",
    schedule: "every 6h",
    prompt:
      "Você é o site-reliability-engineer da HIVE. Inspecionar espaço livre em disco, memória RAM e processos travados na VPS de produção. Purgar zumbis. Autônomo.",
  },
  {
    profile: "security-engineer",
    channel: "Infrastructure",
    name: "Weekly Vulnerability and Dependency Scan",
    schedule: "0 6 * * 1",
    prompt:
      "Você é o security-engineer da HIVE em Infrastructure. Varrer dependências dos 4 projetos em busca de vulnerabilidades conhecidas (CVEs). Relatório no infra-ops. Autônomo.",
  },
  {
    profile: "security-engineer",
    channel: "Infrastructure",
    name: "Secrets and Permission Hardening Check",
    schedule: "0 6 * * 4",
    prompt:
      "Você é o security-engineer da HIVE. Auditar repositórios e servidores em busca de chaves privadas expostas, variáveis de ambiente sem proteção ou permissões 777. Autônomo.",
  },

  // 6. Creative, GTM & Comunicação
  {
    profile: "seo-specialist",
    channel: "Creative/GTM",
    name: "Funnel and Conversion Health",
    schedule: "0 12 * * *",
    prompt:
      "Você é o seo-specialist da HIVE em Creative/GTM. Auditar status de URLs, páginas 404, sitemaps e eventos de pixel/conversão nos checkouts ativos. Autônomo.",
  },
  {
    profile: "seo-specialist",
    channel: "Creative/GTM",
    name: "Keyword Ranking and SERP Visibility Sweep",
    schedule: "0 9 * * 1",
    prompt:
      "Você é o seo-specialist da HIVE. Monitorar posicionamento orgânico e indexação dos sites da HIVE nos motores de busca, gerando recomendações no gtm-ops. Autônomo.",
  },
  {
    profile: "copy-editor",
    channel: "Creative/GTM",
    name: "Copy Conversion and Microcopy Friction Review",
    schedule: "0 14 * * 3",
    prompt:
      "Você é o copy-editor da HIVE em Creative/GTM. Auditar copies de botões, banners de oferta e mensagens de erro nos checkouts para maximizar conversão de compra. Autônomo.",
  },
  {
    profile: "copy-editor",
    channel: "Creative/GTM",
    name: "Marketing Asset Quality and Brand Voice Gate",
    schedule: "0 15 * * 1,4",
    prompt:
      "Você é o copy-editor da HIVE. Validar materiais de divulgação e mensagens antes de disparos públicos, garantindo alinhamento ao tom de voz institucional. Autônomo.",
  },
  {
    profile: "brand-designer",
    channel: "Creative/GTM",
    name: "Visual Asset and Brand Identity Health Check",
    schedule: "0 14 * * 2",
    prompt:
      "Você é o brand-designer da HIVE em Creative/GTM. Auditar a consistência de paletas, tipografia, logotipos e peças visuais nos frontends e landing pages. Autônomo.",
  },
  {
    profile: "technical-writer",
    channel: "Engineering",
    name: "API Documentation and SDK Sync",
    schedule: "0 11 * * 2,5",
    prompt:
      "Você é o technical-writer da HIVE em Engineering. Garantir que todas as rotas e contratos de backend estejam documentados de forma clara e atualizada. Autônomo.",
  },
  {
    profile: "technical-writer",
    channel: "Operations",
    name: "User Guide and Internal Runbook Freshness",
    schedule: "0 11 * * 4",
    prompt:
      "Você é o technical-writer da HIVE em Operations. Manter runbooks de suporte e manuais de operação atualizados para guiar os squads em procedimentos repetíveis. Autônomo.",
  },
  {
    profile: "writer",
    channel: "Creative/GTM",
    name: "Long-form Content and Deep-Dive Drafting",
    schedule: "0 10 * * 3",
    prompt:
      "Você é o writer da HIVE em Creative/GTM. Redigir artigos técnicos de posicionamento estratégico e changelogs públicos de novos releases dos produtos. Autônomo.",
  },

  // 7. Conhecimento & Sabedoria
  {
    profile: "curator",
    channel: "Knowledge",
    name: "Nightly Lessons Learned and AAR Sync",
    schedule: "0 22 * * *",
    prompt:
      "Você é o curator da HIVE em Knowledge. Varrer todos os cards e incidentes concluídos no dia em todos os canais. Extrair lições aprendidas (AAR) e atualizar o vault da HIVE. Autônomo.",
  },
  {
    profile: "curator",
    channel: "Knowledge",
    name: "Knowledge Base Deduplication and Cleanup",
    schedule: "0 20 * * 0",
    prompt:
      "Você é o curator da HIVE. Higienizar a base de documentação e vault, eliminando notas duplicadas, links quebrados e consolidando tópicos complementares. Autônomo.",
  },
  {
    profile: "wonderer",
    channel: "Knowledge",
    name: "Lateral Thinking and Black Swan Horizon Scan",
    schedule: "30 16 * * 5",
    prompt:
      "Você é o wonderer da HIVE em Knowledge. Mapear conexões interdisciplinares, riscos ocultos e novas fronteiras conceituais para os 4 projetos da HIVE. Emitir memorando no Deep Thought. Autônomo.",
  },
];

console.log(`Starting registration of ${SPECS.length} autonomous routines...`);

async function run() {
  let created = 0;
  let failed = 0;

  for (const item of SPECS) {
    const key = `${item.profile}:${item.channel}`;
    const target = npcMap.get(key);
    if (!target) {
      console.warn(`[SKIP] NPC not found for ${key}`);
      failed++;
      continue;
    }

    const url = `http://127.0.0.1:3000/api/channels/${target.channel_id}/cron/jobs`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          npcId: target.npc_id,
          name: item.name,
          schedule: item.schedule,
          prompt: item.prompt,
          deliver: "local",
        }),
      });
      const data = await res.json();
      if (res.status === 201) {
        created++;
        process.stdout.write(".");
      } else {
        console.error(`\n[FAIL] ${item.name}: ${res.status}`, data);
        failed++;
      }
    } catch (err) {
      console.error(`\n[ERROR] ${item.name}:`, err.message);
      failed++;
    }
  }

  console.log(`\n\nRegistration complete! Created: ${created} | Failed: ${failed}`);
}

run().catch(console.error);
