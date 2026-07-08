import Fastify from 'fastify';

import { appConfig } from '@tradepilot/config';
import { buildManualWorkspaceSnapshot, manualTradingPlaybooks, supportedBrokers } from '@tradepilot/core';
import type { AppHealth } from '@tradepilot/types';

const server = Fastify({
  logger: true,
});

server.get('/health', async (): Promise<AppHealth> => ({
  service: 'api',
  status: 'ok',
  timestamp: new Date().toISOString(),
}));

server.get('/bootstrap', async () => ({
  app: appConfig,
  phase: 'manual-first journal MVP',
  playbooks: manualTradingPlaybooks,
  brokers: supportedBrokers,
}));

server.get('/workspace-snapshot', async () => ({
  app: appConfig,
  snapshot: buildManualWorkspaceSnapshot(),
}));

const start = async () => {
  try {
    await server.listen({
      host: appConfig.api.host,
      port: Number(process.env.PORT ?? appConfig.api.port),
    });
  } catch (error) {
    server.log.error(error);
    process.exit(1);
  }
};

void start();
