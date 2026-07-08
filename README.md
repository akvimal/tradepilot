# TradePilot

TradePilot is a manual-first intraday planning and review platform for discretionary traders who want to record pre-market analysis, validate setups, capture trades with R-multiples, and review discipline after the close.

## Current phase

Phase 1 deliberately avoids broker integration. The product is focused on:

- pre-market bias building
- playbook-based setup planning
- manual execution capture with risk-reward tracking
- post-market review and discipline scoring

## Workspace layout

- `apps/web`: Vite frontend showing the phase-one planner and review workflow
- `apps/api`: Fastify API exposing bootstrap metadata and a manual workspace snapshot
- `apps/worker`: background worker placeholder for later automation
- `packages/core`: shared playbooks, sample snapshot builder, and risk/review helpers
- `packages/types`: shared domain types for session plans, setups, executions, and reviews
- `packages/config`: shared runtime configuration

## Requirements

- Node.js 20 or newer
- npm 8 or newer

## Install

```bash
npm install
```

## Run

Web app:

```bash
npm run dev:web
```

API:

```bash
npm run dev:api
```

Worker:

```bash
npm run dev:worker
```

## Verify

```bash
npm run typecheck
npm run build
```

## API endpoints

- `GET /health`
- `GET /bootstrap`
- `GET /workspace-snapshot`

## Phase-one scope

1. Record global trend, crude oil, news risk, HTF bias, and correlation before the session.
2. Plan setups using the selected playbook and minimum R:R constraints.
3. Capture manual executions across accounts without broker sync.
4. Review discipline, execution quality, and lessons after the market.

## Next likely steps

1. Replace the sample snapshot with persisted storage.
2. Add create/edit flows for session plans, setups, and executions.
3. Add analytics by playbook, instrument, and discipline error.
4. Introduce chart and screenshot attachments.
5. Add market data assistance only after the manual workflow is stable.
