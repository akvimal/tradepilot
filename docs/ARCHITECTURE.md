# TradePilot Architecture

## Goals

- Support multi-user, multi-tenant SaaS from day one.
- Support switchable paper and live execution.
- Support multiple brokers without polluting product logic with broker-specific conditionals.
- Leave explicit extension points for AI-assisted review, journaling, and analytics.

## Top-level modules

### Web app
- Trade planner
- Risk dashboard
- Capital and margin views
- Broker account management
- Journal and analytics UI

### API app
- Authentication and tenant management
- Broker account lifecycle
- Execution routing
- Risk validation
- Trade plan CRUD
- Normalized order, fill, and position APIs

### Worker app
- Broker sync jobs
- Webhook / postback processing
- Analytics snapshots
- AI enrichment jobs later

## Execution flow

1. User creates a trade plan.
2. API validates capital, risk, and execution mode.
3. Execution router dispatches to either paper or live broker provider.
4. Provider returns normalized order and fill events.
5. Worker reconciles positions and analytics snapshots.
6. Web app consumes normalized state.

## AI extension boundary

AI should plug into advisory workflows only:
- pre-trade review
- journal summarization
- performance diagnostics
- natural-language analytics

AI must not be coupled directly to live order execution.
