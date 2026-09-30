# Vector & Alertmanager Pipeline Configuration Specification
## Arquitetura Zero Gambiarra: PM2 Logs ➔ Vector ➔ Prometheus ➔ Alertmanager ➔ DeskRPG Webhook

Este documento especifica a configuração exata para a esteira de telemetria semântica que fecha o ciclo operacional do DeskRPG e da HIVE para todos os projetos da organização.

---

### 1. Vector Configuration (`/etc/vector/vector.yaml`)

```yaml
sources:
  pm2_logs:
    type: file
    include:
      - /root/.pm2/logs/hot-traffic-*.log
      - /root/.pm2/logs/hot-billing-*.log
      - /root/.pm2/logs/mystelia-*.log
      - /root/.pm2/logs/bloopu-*.log
    read_from: end

transforms:
  parse_telemetry:
    type: remap
    inputs:
      - pm2_logs
    source: |
      .message = string!(.message)
      
      # 1. Grupo ou Bot com link inativo / restrito
      if contains(.message, "GROUP_BOT_LINK_INACTIVE_OR_RESTRICTED") {
        .is_alert = true
        .alert_name = "TelegramBotLinkRestricted"
        .severity = "critical"
        .tier = "business-traffic"
        .bot = parse_regex(.message, r'🤖\s*(?P<bot>@\w+)').bot ?? "unknown"
        .group = parse_regex(.message, r'👥\s*(?P<group>[^|]+)').group ?? "unknown"
        .summary = "Vínculo Inativo ou Restrito no Telegram"
        .description = "Bot com link inativo ou banido no grupo de tráfego."
      }
      
      # 2. Todos os disparos falharam
      if contains(.message, "TODOS OS ENVIOS FALHARAM") {
        .is_alert = true
        .alert_name = "TelegramBotDeliveryHalted"
        .severity = "critical"
        .tier = "business-traffic"
        .bot = parse_regex(.message, r'PRA\s*(?P<bot>@\w+)').bot ?? "unknown"
        .summary = "Envio de tráfego paralisado para o bot"
        .description = "Worker Sargatanas reportou falha total de envios. Risco de faturamento."
      }
      
      # 3. Falha de login MTProto Telethon
      if contains(.message, "FASE 2 FAILED: Login falhou") {
        .is_alert = true
        .alert_name = "TelethonSessionLoginFailure"
        .severity = "critical"
        .tier = "infra-mtproto"
        .summary = "Falha de Autenticação MTProto"
        .description = "Sessão Telethon deslogada ou chave revogada."
      }

  filter_alerts:
    type: filter
    inputs:
      - parse_telemetry
    condition: ".is_alert == true"

sinks:
  prometheus_exporter:
    type: prometheus_exporter
    inputs:
      - filter_alerts
    address: 0.0.0.0:9598
```

---

### 2. Prometheus Alerting Rules (`/etc/prometheus/alerts.yml`)

```yaml
groups:
  - name: hive_business_traffic_alerts
    rules:
      - alert: TelegramBotLinkRestricted
        expr: increase(vector_alert_total{alert_name="TelegramBotLinkRestricted"}[5m]) > 0
        for: 30s
        labels:
          severity: critical
          tier: business-traffic
          project: hot-telegram
        annotations:
          summary: "Vínculo Inativo ou Restrito: {{ $labels.bot }}"
          description: "Bot {{ $labels.bot }} no grupo {{ $labels.group }} está inativo ou restrito no Telegram."

      - alert: TelegramBotDeliveryHalted
        expr: increase(vector_alert_total{alert_name="TelegramBotDeliveryHalted"}[5m]) > 0
        for: 30s
        labels:
          severity: critical
          tier: business-traffic
          project: hot-telegram
        annotations:
          summary: "Envio de tráfego paralisado para o bot {{ $labels.bot }}"
          description: "Worker Sargatanas reportou falha total de disparos."
```

---

### 3. Alertmanager Receiver (`/etc/prometheus/alertmanager.yml`)

```yaml
route:
  receiver: "deskrpg-webhook"
  group_by: ["alertname", "bot", "project"]
  group_wait: 10s
  group_interval: 1m
  repeat_interval: 4h

receivers:
  - name: "deskrpg-webhook"
    webhook_configs:
      - url: "http://<DESKRPG_HOST>:3000/api/alerts/webhook"
        send_resolved: true
```

---

### 4. Integração no DeskRPG (Implementado em `src/app/api/alerts/webhook/route.ts`)

Quando o Alertmanager dispara o webhook:
1. O DeskRPG valida e extrai os alertas com status `firing`.
2. Mapeia o rótulo `tier` / `project` para o board canônico correspondente (`hot-telegram`, `mystelia`, `bloopu`, `social`).
3. Executa `insertTaskSafely` aplicando:
   - Deduplicação por título (idempotência perfeita).
   - Verificação de limites de WIP do Kanban.
   - Atribuição ao especialista de infra/backend (`backend-engineer` ou `site-reliability-engineer`).
   - Status inicial em `ready` para o Dispatcher do Hermes executar em worktree isolada.
4. Notifica a sala tática (`NOC` / `War Room`) no canal de Infraestrutura do DeskRPG.
