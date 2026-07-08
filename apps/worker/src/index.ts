import { appConfig } from '@tradepilot/config';
import { supportedBrokers } from '@tradepilot/core';
import type { AppHealth } from '@tradepilot/types';

const buildHeartbeat = (): AppHealth => ({
  service: 'worker',
  status: 'ok',
  timestamp: new Date().toISOString(),
});

const logCycle = () => {
  const heartbeat = buildHeartbeat();
  console.log(
    `[worker] ${heartbeat.timestamp} brokers=${supportedBrokers.length} intervalMs=${appConfig.worker.pollIntervalMs}`,
  );
};

console.log('[worker] TradePilot worker started');
logCycle();
setInterval(logCycle, appConfig.worker.pollIntervalMs);
