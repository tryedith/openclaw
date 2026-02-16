# Multi-Instance OpenClaw: Architecture & Cost Analysis

## Context

Currently, each user deploys exactly 1 bot as a **dedicated EC2 instance** (t3.small) running the full OpenClaw monolith. The goal is to let any user deploy and manage **multiple named bot instances**. Before implementing, we need to decide the right infrastructure approach since the current EC2-per-bot model has significant cost implications at scale.

---

## OpenClaw Runtime Component Analysis

OpenClaw is a **monolith** where everything runs in a single Node.js process. All state lives on the local filesystem (`~/.openclaw/`). Here's what each component actually needs:

### Component Breakdown

| Component | Always-On? | Memory (idle) | Memory (active) | CPU (idle) | CPU (active) | State |
|-----------|-----------|---------------|-----------------|------------|-------------|-------|
| **Gateway server** (`src/gateway/`) | Yes | ~50 MB | ~100 MB | Near 0 | Low | In-memory sessions, WebSocket connections |
| **Channel connectors** (`src/channels/`) | Yes | 20-100 MB per channel | Same | Near 0 | Low | Persistent connections (WS/polling) |
| **Agent runtime** (`src/agents/`) | No, on-demand | 0 | 200-500 MB | 0 | High (API calls) | Stateless (reads sessions from disk) |
| **Browser automation** (`src/browser/`) | No, on-demand | 0 | 300-500 MB (Chromium) | 0 | High | Ephemeral browser context |
| **Cron scheduler** (`src/cron/`) | Yes | ~10 MB | ~10 MB | Near 0 | Near 0 | Schedule config from config file |
| **Memory/Vector DB** (`src/memory/`) | No, on-demand | 0 | 50-100 MB | 0 | Medium | SQLite + sqlite-vec on local disk |
| **Config** (`src/config/`) | Loaded once | ~5 MB | ~5 MB | 0 | 0 | `~/.openclaw/openclaw.json` (local file) |
| **Sessions** | On-demand | ~10 MB | ~50 MB | 0 | Low | JSONL files under `~/.openclaw/sessions/` |

### Key State Dependencies (all local filesystem)

- **Config**: `~/.openclaw/openclaw.json`
- **Sessions**: `~/.openclaw/sessions/*.jsonl` and `~/.openclaw/agents/<id>/sessions/*.jsonl`
- **Credentials**: `~/.openclaw/credentials/`
- **Memory/vectors**: SQLite with sqlite-vec extension (local DB file)
- **WhatsApp auth**: Baileys session files (local)

### Idle vs Active Profile

A typical bot instance spends **>95% of its time idle** — just maintaining channel connections (Telegram polling, Discord WebSocket, WhatsApp Baileys WS). The heavy resources (agent execution, browser, AI API calls) are needed only during active conversations.

- **Idle footprint per bot**: ~80-200 MB RAM, near-zero CPU
- **Active footprint per bot**: ~400-1200 MB RAM, moderate CPU (mostly waiting on AI API responses)

---

## Architecture Comparison at 10,000 Users

### Assumptions

- 10,000 users, average 2 bot instances each = **20,000 bot instances**
- ~8% of instances active at any given time = **1,600 concurrent active**
- Each active conversation lasts ~30 seconds average
- ~20 messages/day per active instance

---

### Architecture A: Current Monolith-per-Bot (1 EC2 per instance)

Every bot gets a full t3.small running the entire OpenClaw stack.

```
┌─────────────────────────────────────────────┐
│  EC2 t3.small (per bot)                     │
│  ┌─────────┐ ┌──────────┐ ┌──────────────┐ │
│  │ Gateway  │ │ Channels │ │ Agent Runtime│ │
│  │ Server   │ │ (Telegram│ │ (AI calls)   │ │
│  │          │ │  Discord │ │              │ │
│  ├──────────┤ │  WhatsApp│ ├──────────────┤ │
│  │ Cron     │ │  etc.)   │ │ Browser      │ │
│  │ Scheduler│ │          │ │ (Playwright) │ │
│  ├──────────┤ ├──────────┤ ├──────────────┤ │
│  │ Config   │ │ Sessions │ │ Memory/Vec   │ │
│  │ (file)   │ │ (JSONL)  │ │ (SQLite)     │ │
│  └──────────┘ └──────────┘ └──────────────┘ │
│  ~/.openclaw/ (local filesystem)            │
└─────────────────────────────────────────────┘
× 20,000 instances
```

| Resource | Calculation | Monthly Cost |
|----------|-----------|-------------|
| EC2 t3.small spot x 20,000 | $0.006/hr x 730 x 20,000 | **$87,600** |
| ALB | Base + LCU | $400 |
| NAT Gateway (2x AZ) | $64 + data | $600 |
| Secrets Manager | 20,000 x $0.40 | $8,000 |
| Pool spares (40) | 40 x $4.38 | $175 |
| CloudWatch | ~600 GB logs | $300 |
| **Total** | | **$97,075/mo** |
| **Per user** | | **$9.71/mo** |
| **Per instance** | | **$4.85/mo** |

**Problem**: Every idle bot wastes ~90% of its allocated resources. You're paying for 20,000 x 2 GB RAM = 40 TB of RAM, but actually using <4 TB.

---

### Architecture B: Decomposed Shared-Nothing (Scale Each Layer Independently)

Break OpenClaw into independently scalable layers. Each layer follows shared-nothing principles (no shared state between nodes in the same layer) but scales on its own.

```
┌─────────────────────────────────────────────────────────────┐
│                    LAYER 1: Channel Gateway                  │
│         (Always-on, multi-tenant, lightweight)               │
│                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │ Channel Pod  │  │ Channel Pod  │  │ Channel Pod  │  ...  │
│  │ ~2000 bots   │  │ ~2000 bots   │  │ ~2000 bots   │       │
│  │ Telegram     │  │ Discord      │  │ WhatsApp     │       │
│  │ connections  │  │ connections  │  │ connections  │        │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘       │
│         └─────────────────┼─────────────────┘                │
│                           │ Message Queue (SQS)              │
└───────────────────────────┼──────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                LAYER 2: Application Workers                  │
│        (On-demand, stateless, scale-to-zero)                 │
│                                                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                     │
│  │ Agent    │ │ Agent    │ │ Browser  │                      │
│  │ Worker   │ │ Worker   │ │ Worker   │  ... (auto-scale)   │
│  │ (256MB)  │ │ (256MB)  │ │ (1GB)    │                      │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘                     │
│       └─────────────┼───────────┘                            │
│                     │ Reads/writes state                      │
└─────────────────────┼────────────────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                  LAYER 3: Data Layer                         │
│           (Persistent, independently scalable)               │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │ PostgreSQL   │  │ S3 / EFS     │  │ Redis        │       │
│  │ (Supabase)   │  │ (Sessions,   │  │ (Hot cache,  │       │
│  │ Config,      │  │  Media,      │  │  Pub/Sub,    │       │
│  │ Metadata,    │  │  Vectors)    │  │  Locks)      │       │
│  │ Usage        │  │              │  │              │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
└─────────────────────────────────────────────────────────────┘
```

#### Layer 1: Channel Gateway (Always-On)

Maintains persistent connections to messaging APIs. Receives incoming messages, publishes them to a queue. Receives responses from queue, delivers to channels. Multi-tenant: one process handles thousands of bot connections.

- Each bot's channel connection: ~20-50 MB (Telegram/Discord are very light, WhatsApp heavier)
- 20,000 bots x 40 MB avg = ~800 GB RAM needed
- But many bots won't have all channels active. Realistic: ~500 GB

| Resource | Spec | Count | Monthly |
|----------|------|-------|---------|
| r6i.4xlarge spot (16 vCPU, 128 GB) | $0.16/hr | 5 | **$584** |
| Redundancy (+2 for HA) | | 2 | $234 |
| **Subtotal** | | 7 | **$818** |

#### Layer 2: Application Workers (On-Demand)

Stateless workers that process messages. Pull context from the data layer, call AI APIs, write results back. Scale based on active conversations.

**Agent Workers** (process chat messages):
- 1,600 concurrent active bots x ~60% actually mid-conversation = ~960 workers
- Each: 0.5 vCPU, 512 MB (mostly waiting on AI API response)
- But conversations are bursty — average concurrent is lower

| Resource | Spec | Average Concurrent | Monthly |
|----------|------|-------------------|---------|
| ECS Fargate Spot (0.25 vCPU, 0.5 GB) | $0.0037/hr | 200 | **$540** |
| Peak scaling (up to 1,000) | bursty | included | ~$0 extra |

**Browser Workers** (run Playwright, rare):
- ~2% of messages trigger browser tasks
- Average concurrent: ~20

| Resource | Spec | Average Concurrent | Monthly |
|----------|------|-------------------|---------|
| ECS Fargate Spot (1 vCPU, 2 GB) | $0.015/hr | 20 | **$219** |

**Cron Workers** (scheduled tasks):
- Triggered by a shared scheduler
- Same as agent workers, just time-triggered

| Resource | Spec | Average Concurrent | Monthly |
|----------|------|-------------------|---------|
| ECS Fargate Spot (0.25 vCPU, 0.5 GB) | $0.0037/hr | 30 | **$81** |

#### Layer 3: Data Layer (Persistent)

All per-bot state moved from local filesystem to shared services.

| Service | What It Stores | Sizing | Monthly |
|---------|---------------|--------|---------|
| **Supabase Pro** (PostgreSQL) | Config, metadata, usage, channel state | Included in plan | **$25** |
| **RDS PostgreSQL** (if self-hosted) | Alternative to Supabase | db.r6g.large | $200 |
| **S3** | Session files, media, exports | ~2 TB | **$46** |
| **ElastiCache Redis** (r6g.large) | Hot cache, pub/sub (channel-to-worker), locks | 1 cluster | **$195** |
| **pgvector** (in Supabase/RDS) | Vector memory (replaces local sqlite-vec) | Included | $0 |
| **EFS** (fallback for file-heavy ops) | Temp workspace for browser/agent | 500 GB | $150 |

#### Infrastructure & Glue

| Service | Purpose | Monthly |
|---------|---------|---------|
| ALB | Routing to channel gateway + API | $100 |
| NAT Gateway (2x AZ) | Outbound for workers | $200 |
| SQS | Message queue (channel to worker to channel) | $5 |
| CloudWatch | Logs + metrics | $200 |
| ECR | Container registry | $5 |
| ECS Cluster (EC2-backed for Layer 1) | Channel gateway hosts | Included above |

#### Architecture B Total

| Layer | Monthly Cost |
|-------|-------------|
| Layer 1: Channel Gateway | $818 |
| Layer 2: Agent Workers | $540 |
| Layer 2: Browser Workers | $219 |
| Layer 2: Cron Workers | $81 |
| Layer 3: Data Layer | $416 |
| Infrastructure | $510 |
| **Total** | **$2,584/mo** |
| **Per user** | **$0.26/mo** |
| **Per instance** | **$0.13/mo** |

---

### Architecture C: Hybrid (ECS Container Packing, No Decomposition)

Keep OpenClaw as a monolith but run many containers on shared EC2 hosts instead of 1 EC2 per bot. Simpler than full decomposition — no changes to OpenClaw core.

```
┌──────────────────────────────────────────┐
│  EC2 r6i.4xlarge (shared host)           │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│  │ Bot 1    │ │ Bot 2    │ │ Bot 3    │ │
│  │ (full    │ │ (full    │ │ (full    │ │
│  │ OpenClaw)│ │ OpenClaw)│ │ OpenClaw)│ │
│  │ 200MB    │ │ 200MB    │ │ 200MB    │ │
│  └──────────┘ └──────────┘ └──────────┘ │
│   ... up to ~100 idle containers         │
└──────────────────────────────────────────┘
x ~200 hosts
```

| Resource | Calculation | Monthly |
|----------|-----------|---------|
| r6i.4xlarge spot (128 GB) | 200 hosts x $0.16/hr x 730 | **$23,360** |
| Over-provision for active bursts (+30%) | 60 extra hosts | $7,008 |
| ALB, NAT, Secrets Mgr, CW | Same as current | $1,500 |
| **Total** | | **$31,868/mo** |
| **Per user** | | **$3.19/mo** |
| **Per instance** | | **$1.59/mo** |

---

## Cost Comparison Summary

| Architecture | Monthly (20K instances) | Per User | Per Instance | Savings vs Current | Engineering Effort |
|-------------|----------------------|----------|-------------|-------------------|-------------------|
| **A: EC2-per-bot (current)** | $97,075 | $9.71 | $4.85 | Baseline | None |
| **B: Decomposed shared-nothing** | $2,584 | $0.26 | $0.13 | **97.3%** | Very High (3-6 months) |
| **C: Hybrid (ECS packing)** | $31,868 | $3.19 | $1.59 | **67.2%** | Medium (2-4 weeks) |

### Why Architecture B Is So Much Cheaper

1. **Idle bots cost almost nothing** — channel connections are just lightweight WebSocket/polling, packed densely on shared hosts
2. **Workers scale to zero** — you only pay for compute during actual conversations, not 24/7
3. **Data layer is shared** — one PostgreSQL instance serves all 20K bots vs 20K SQLite files
4. **No wasted resources** — current approach gives each idle bot 2 vCPU + 2 GB RAM when it needs <50 MB

### What Architecture B Requires (the hard part)

1. **Refactor OpenClaw state management** — move from local filesystem (`~/.openclaw/`) to external services (PostgreSQL, S3, Redis)
2. **Build a multi-tenant channel gateway** — current channel code assumes single-tenant; need to multiplex thousands of bot connections per process
3. **Make agent runtime stateless** — currently reads/writes local files; need to read from DB, process, write to DB
4. **Build message routing** — SQS/Redis pub-sub between channel gateway and workers
5. **Session externalization** — move JSONL session files to PostgreSQL or S3

---

## Scaling Curves

### At Different User Counts

| Users | Instances (2x avg) | Arch A (EC2/bot) | Arch B (Decomposed) | Arch C (Hybrid) |
|-------|-------------------|-------------------|---------------------|-----------------|
| 100 | 200 | $1,170/mo | $950/mo | $1,200/mo |
| 1,000 | 2,000 | $10,200/mo | $1,100/mo | $4,500/mo |
| 5,000 | 10,000 | $49,500/mo | $1,800/mo | $16,500/mo |
| 10,000 | 20,000 | $97,075/mo | $2,584/mo | $31,868/mo |
| 50,000 | 100,000 | $485,000/mo | $10,000/mo | $155,000/mo |

Note: Architecture B has high **fixed costs** (~$950/mo baseline for data layer + infrastructure) but very low **marginal cost** per instance. It becomes cheaper than A at ~200 instances and cheaper than C at ~500 instances.

---

## Recommended Phased Approach

### Phase 1: Multi-Instance Feature (1-2 weeks)
Ship the multi-instance UI and API on the current EC2 architecture. Unblocks the user-facing feature immediately. Cost: $4.85/instance.

### Phase 2: Hybrid Container Packing (2-4 weeks)
Move to ECS containers on shared EC2 hosts. 67% cost reduction. No OpenClaw core changes needed — just orchestration.

### Phase 3: Full Decomposition (3-6 months, when needed)
Break OpenClaw into channel gateway + stateless workers + external data layer. 97% cost reduction. Requires significant refactoring of OpenClaw core state management.

---

## Appendix: Pricing Sources

All prices are AWS us-west-2 as of early 2026:

- EC2 t3.small on-demand: $0.0208/hr
- EC2 t3.small spot: ~$0.006/hr
- EC2 r6i.4xlarge spot: ~$0.16/hr
- Fargate standard (0.25 vCPU, 0.5 GB): $0.0123/hr
- Fargate Spot (0.25 vCPU, 0.5 GB): $0.0037/hr
- ALB: $0.0225/hr + $0.008/LCU-hr
- NAT Gateway: $0.045/hr + $0.045/GB
- Secrets Manager: $0.40/secret/month
- S3: $0.023/GB/month
- ElastiCache r6g.large: ~$0.267/hr
- EFS: $0.30/GB/month
- SQS: $0.40/million requests
- CloudWatch Logs: $0.50/GB ingested
