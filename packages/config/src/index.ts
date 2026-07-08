export const appConfig = {
  name: 'TradePilot',
  defaultExecutionMode: 'paper',
  api: {
    host: '0.0.0.0',
    port: 3001,
  },
  worker: {
    pollIntervalMs: 15_000,
  },
  ai: {
    enabled: false,
    mode: 'advisory',
  },
} as const;
