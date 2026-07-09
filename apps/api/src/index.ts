import Fastify from 'fastify';

import { appConfig } from '@tradepilot/config';
import {
  buildDefaultDataProviderSettings,
  buildDefaultExecutionRouteSettings,
  buildDefaultTradingAccountSettings,
  buildManualWorkspaceSnapshot,
  manualTradingPlaybooks,
  supportedBrokers,
  validateDataProviderSettings,
  validateExecutionRouteSettings,
  validateTradingAccountSettings,
} from '@tradepilot/core';
import type {
  AppHealth,
  DataProviderSettings,
  DataProviderSettingsInput,
  ExecutionRouteSettings,
  ExecutionRouteSettingsInput,
  QuickOrderPlacementRequest,
  QuickOrderPreviewRequest,
  QuickOrderPreviewResponse,
  TradingAccountSettings,
  TradingAccountSettingsInput,
} from '@tradepilot/types';

import { createQuickOrderProvider, listCachedDhanUnderlyings, warmQuickOrderCaches } from './quick-order-providers.js';
import { placeBrokerOrder, refreshBrokerOrders } from './broker-orders.js';

const server = Fastify({
  logger: true,
});

server.addHook('onRequest', async (request, reply) => {
  reply.header('Access-Control-Allow-Origin', '*');
  reply.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  reply.header('Access-Control-Allow-Headers', 'Content-Type, access-token, client-id');

  if (request.method === 'OPTIONS') {
    return reply.status(204).send();
  }
});

const dataProviderStore = new Map<string, DataProviderSettings>();
const tradingAccountStore = new Map<string, TradingAccountSettings>();
const executionRouteStore = new Map<string, ExecutionRouteSettings>();

function getQuickOrderProductType(productType: TradingAccountSettings['defaults']['productType']): QuickOrderPreviewRequest['productType'] {
  if (productType === 'INTRADAY' || productType === 'MARGIN' || productType === 'CNC') {
    return productType;
  }

  return 'INTRADAY';
}

function createEntityId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function maskCredentials<T extends { credentials: object }>(settings: T): T {
  const credentialRecord = settings.credentials as Record<string, string | undefined>;
  const maskedEntries = Object.entries(credentialRecord).map(([key, value]) => {
    if (!value) {
      return [key, value];
    }

    if (key.toLowerCase().includes('url') || key === 'clientId' || key === 'clientCode') {
      return [key, value];
    }

    return [key, '••••••••'];
  });

  return {
    ...settings,
    credentials: Object.fromEntries(maskedEntries),
  } as T;
}

async function testTradingAccountToken(account: TradingAccountSettings) {
  if (account.broker !== 'dhan') {
    return {
      ok: Boolean(account.credentials.accessToken || account.credentials.apiKey),
      message: 'Live token validation is only implemented for Dhan right now.',
    };
  }

  const accessToken = account.credentials.accessToken?.trim();
  const clientId = account.credentials.clientId?.trim();

  if (!accessToken) {
    return {
      ok: false,
      message: 'Dhan access token is missing.',
    };
  }

  const response = await fetch('https://api.dhan.co/v2/profile', {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'access-token': accessToken,
      ...(clientId ? { 'client-id': clientId } : {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    return {
      ok: false,
      message: `Dhan profile check failed with ${response.status}${body ? `: ${body}` : ''}`,
    };
  }

  return {
    ok: true,
    message: 'Dhan access token is valid.',
  };
}

async function testDataProviderToken(provider: DataProviderSettings) {
  if (provider.provider !== 'dhan') {
    return {
      ok: Boolean(provider.credentials.accessToken || provider.credentials.apiKey),
      message: 'Live token validation is only implemented for Dhan right now.',
    };
  }

  const accessToken = provider.credentials.accessToken?.trim();
  const clientId = provider.credentials.clientId?.trim();

  if (!accessToken) {
    return {
      ok: false,
      message: 'Dhan access token is missing.',
    };
  }

  const response = await fetch('https://api.dhan.co/v2/profile', {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'access-token': accessToken,
      ...(clientId ? { 'client-id': clientId } : {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    return {
      ok: false,
      message: `Dhan profile check failed with ${response.status}${body ? `: ${body}` : ''}`,
    };
  }

  return {
    ok: true,
    message: 'Dhan data token is valid.',
  };
}

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

server.get('/settings/defaults/data-provider', async (request) => {
  const broker = ((request.query as { broker?: DataProviderSettingsInput['provider'] }).broker ?? 'dhan');
  return buildDefaultDataProviderSettings(broker);
});

server.get('/settings/defaults/trading-account', async (request) => {
  const broker = ((request.query as { broker?: TradingAccountSettingsInput['broker'] }).broker ?? 'dhan');
  return buildDefaultTradingAccountSettings(broker);
});

server.get('/settings/defaults/execution-route', async () => buildDefaultExecutionRouteSettings());

server.get('/data-providers', async () => ({
  items: [...dataProviderStore.values()].map(maskCredentials),
}));

server.post('/data-providers', async (request, reply) => {
  const payload = request.body as DataProviderSettingsInput;
  const validation = validateDataProviderSettings(payload);

  if (!validation.valid) {
    return reply.status(400).send({
      message: 'Data provider settings are invalid.',
      errors: validation.errors,
    });
  }

  const next: DataProviderSettings = {
    id: createEntityId('data'),
    ...payload,
    healthStatus: 'untested',
  };

  dataProviderStore.set(next.id, next);
  return {
    item: maskCredentials(next),
  };
});

server.put('/data-providers/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  const current = dataProviderStore.get(id);

  if (!current) {
    return reply.status(404).send({ message: 'Data provider not found.' });
  }

  const payload = request.body as DataProviderSettingsInput;
  const validation = validateDataProviderSettings(payload);

  if (!validation.valid) {
    return reply.status(400).send({
      message: 'Data provider settings are invalid.',
      errors: validation.errors,
    });
  }

  const next: DataProviderSettings = {
    ...current,
    ...payload,
    id,
  };

  dataProviderStore.set(id, next);
  return {
    item: maskCredentials(next),
  };
});

server.delete('/data-providers/:id', async (request, reply) => {
  const { id } = request.params as { id: string };

  if (!dataProviderStore.has(id)) {
    return reply.status(404).send({ message: 'Data provider not found.' });
  }

  dataProviderStore.delete(id);
  return {
    id,
    deleted: true,
  };
});

server.post('/data-providers/:id/test', async (request, reply) => {
  const { id } = request.params as { id: string };
  const current = dataProviderStore.get(id);

  if (!current) {
    return reply.status(404).send({ message: 'Data provider not found.' });
  }

  const validation = validateDataProviderSettings({
    provider: current.provider,
    label: current.label,
    enabled: current.enabled,
    authMode: current.authMode,
    credentials: current.credentials,
    connection: current.connection,
    exchanges: current.exchanges,
    notes: current.notes,
  });

  const next: DataProviderSettings = {
    ...current,
    healthStatus: validation.valid ? 'connected' : 'invalid',
    lastValidatedAt: new Date().toISOString(),
  };

  dataProviderStore.set(id, next);

  if (!validation.valid) {
    return reply.status(400).send({
      item: maskCredentials(next),
      errors: validation.errors,
    });
  }

  return {
    item: maskCredentials(next),
    message: 'Data provider settings look structurally valid.',
  };
});

server.post('/data-providers/test-token', async (request, reply) => {
  const payload = request.body as DataProviderSettingsInput;
  const validation = validateDataProviderSettings(payload);

  if (!validation.valid) {
    return reply.status(400).send({
      message: validation.errors.join(' '),
    });
  }

  const transientProvider: DataProviderSettings = {
    id: 'transient',
    ...payload,
    healthStatus: 'untested',
  };

  try {
    const tokenTest = await testDataProviderToken(transientProvider);

    if (!tokenTest.ok) {
      return reply.status(400).send({
        item: {
          ...maskCredentials(transientProvider),
          healthStatus: 'invalid',
          lastValidatedAt: new Date().toISOString(),
        },
        message: tokenTest.message,
      });
    }

    return {
      item: {
        ...maskCredentials(transientProvider),
        healthStatus: 'connected',
        lastValidatedAt: new Date().toISOString(),
      },
      message: tokenTest.message,
    };
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      item: {
        ...maskCredentials(transientProvider),
        healthStatus: 'error',
        lastValidatedAt: new Date().toISOString(),
      },
      message: error instanceof Error ? error.message : 'Token validation failed.',
    });
  }
});

server.post('/broker-orders/refresh', async (request, reply) => {
  const payload = request.body as { tradingAccount?: TradingAccountSettings };

  if (!payload?.tradingAccount) {
    return reply.status(400).send({
      message: 'Trading account is required to refresh broker orders.',
    });
  }

  try {
    return await refreshBrokerOrders(payload.tradingAccount);
  } catch (error) {
    request.log.error(error);
    return reply.status(400).send({
      message: error instanceof Error ? error.message : 'Unable to refresh broker orders.',
    });
  }
});

server.post('/execution/place-order', async (request, reply) => {
  const payload = request.body as Partial<QuickOrderPlacementRequest>;

  if (!payload?.preview || !payload?.tradingAccount) {
    return reply.status(400).send({
      message: 'Preview and trading account are required to place an order.',
    });
  }

  try {
    return await placeBrokerOrder({
      preview: payload.preview as QuickOrderPreviewResponse,
      tradingAccount: payload.tradingAccount as TradingAccountSettings,
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(400).send({
      message: error instanceof Error ? error.message : 'Unable to place order.',
    });
  }
});

server.get('/trading-accounts', async () => ({
  items: [...tradingAccountStore.values()].map(maskCredentials),
}));

server.post('/trading-accounts', async (request, reply) => {
  const payload = request.body as TradingAccountSettingsInput;
  const validation = validateTradingAccountSettings(payload);

  if (!validation.valid) {
    return reply.status(400).send({ message: 'Trading account settings are invalid.', errors: validation.errors });
  }

  const next: TradingAccountSettings = {
    id: createEntityId('trading'),
    ...payload,
    healthStatus: 'untested',
  };

  tradingAccountStore.set(next.id, next);
  return { item: maskCredentials(next) };
});

server.put('/trading-accounts/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  const current = tradingAccountStore.get(id);
  if (!current) {
    return reply.status(404).send({ message: 'Trading account not found.' });
  }
  const payload = request.body as TradingAccountSettingsInput;
  const validation = validateTradingAccountSettings(payload);
  if (!validation.valid) {
    return reply.status(400).send({ message: 'Trading account settings are invalid.', errors: validation.errors });
  }
  const next: TradingAccountSettings = { ...current, ...payload, id };
  tradingAccountStore.set(id, next);
  return { item: maskCredentials(next) };
});

server.delete('/trading-accounts/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  if (!tradingAccountStore.has(id)) {
    return reply.status(404).send({ message: 'Trading account not found.' });
  }
  tradingAccountStore.delete(id);
  return { id, deleted: true };
});

server.post('/trading-accounts/:id/test', async (request, reply) => {
  const { id } = request.params as { id: string };
  const current = tradingAccountStore.get(id);
  if (!current) {
    return reply.status(404).send({ message: 'Trading account not found.' });
  }
  const validation = validateTradingAccountSettings({
    broker: current.broker,
    label: current.label,
    ownerLabel: current.ownerLabel,
    mode: current.mode,
    enabled: current.enabled,
    authMode: current.authMode,
    credentials: current.credentials,
    defaults: current.defaults,
    supportedExchanges: current.supportedExchanges,
    staticIpWhitelisted: current.staticIpWhitelisted,
    whitelistedIp: current.whitelistedIp,
    notes: current.notes,
  });
  const next: TradingAccountSettings = { ...current, healthStatus: validation.valid ? 'connected' : 'invalid', lastValidatedAt: new Date().toISOString() };
  tradingAccountStore.set(id, next);
  if (!validation.valid) {
    return reply.status(400).send({ item: maskCredentials(next), errors: validation.errors });
  }
  return { item: maskCredentials(next), message: 'Trading account settings look structurally valid.' };
});

server.post('/trading-accounts/:id/test-token', async (request, reply) => {
  const { id } = request.params as { id: string };
  const current = tradingAccountStore.get(id);

  if (!current) {
    return reply.status(404).send({ message: 'Trading account not found.' });
  }

  try {
    const tokenTest = await testTradingAccountToken(current);
    const next: TradingAccountSettings = {
      ...current,
      healthStatus: tokenTest.ok ? 'connected' : 'invalid',
      lastValidatedAt: new Date().toISOString(),
    };

    tradingAccountStore.set(id, next);

    if (!tokenTest.ok) {
      return reply.status(400).send({
        item: maskCredentials(next),
        message: tokenTest.message,
      });
    }

    return {
      item: maskCredentials(next),
      message: tokenTest.message,
    };
  } catch (error) {
    request.log.error(error);
    const next: TradingAccountSettings = {
      ...current,
      healthStatus: 'error',
      lastValidatedAt: new Date().toISOString(),
    };
    tradingAccountStore.set(id, next);
    return reply.status(500).send({
      item: maskCredentials(next),
      message: error instanceof Error ? error.message : 'Token validation failed.',
    });
  }
});

server.post('/trading-accounts/test-token', async (request, reply) => {
  const payload = request.body as TradingAccountSettingsInput;
  const validation = validateTradingAccountSettings(payload);

  if (!validation.valid) {
    return reply.status(400).send({
      message: validation.errors.join(' '),
    });
  }

  const transientAccount: TradingAccountSettings = {
    id: 'transient',
    ...payload,
    healthStatus: 'untested',
  };

  try {
    const tokenTest = await testTradingAccountToken(transientAccount);

    if (!tokenTest.ok) {
      return reply.status(400).send({
        item: {
          ...maskCredentials(transientAccount),
          healthStatus: 'invalid',
          lastValidatedAt: new Date().toISOString(),
        },
        message: tokenTest.message,
      });
    }

    return {
      item: {
        ...maskCredentials(transientAccount),
        healthStatus: 'connected',
        lastValidatedAt: new Date().toISOString(),
      },
      message: tokenTest.message,
    };
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      item: {
        ...maskCredentials(transientAccount),
        healthStatus: 'error',
        lastValidatedAt: new Date().toISOString(),
      },
      message: error instanceof Error ? error.message : 'Token validation failed.',
    });
  }
});

server.get('/execution-routes', async () => ({
  items: [...executionRouteStore.values()],
}));

server.post('/execution-routes', async (request, reply) => {
  const payload = request.body as ExecutionRouteSettingsInput;
  const validation = validateExecutionRouteSettings(payload);
  if (!validation.valid) {
    return reply.status(400).send({ message: 'Execution route settings are invalid.', errors: validation.errors });
  }
  const next: ExecutionRouteSettings = { id: createEntityId('route'), ...payload };
  executionRouteStore.set(next.id, next);
  return { item: next };
});

server.put('/execution-routes/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  const current = executionRouteStore.get(id);
  if (!current) {
    return reply.status(404).send({ message: 'Execution route not found.' });
  }
  const payload = request.body as ExecutionRouteSettingsInput;
  const validation = validateExecutionRouteSettings(payload);
  if (!validation.valid) {
    return reply.status(400).send({ message: 'Execution route settings are invalid.', errors: validation.errors });
  }
  const next: ExecutionRouteSettings = { ...current, ...payload, id };
  executionRouteStore.set(id, next);
  return { item: next };
});

server.delete('/execution-routes/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  if (!executionRouteStore.has(id)) {
    return reply.status(404).send({ message: 'Execution route not found.' });
  }
  executionRouteStore.delete(id);
  return { id, deleted: true };
});

server.get('/quick-order/underlyings', async (request, reply) => {
  const broker = (request.query as { broker?: QuickOrderPreviewRequest['broker'] }).broker ?? 'dhan';

  try {
    if (broker === 'dhan') {
      return await listCachedDhanUnderlyings();
    }

    return await createQuickOrderProvider(broker).listUnderlyings();
  } catch (error) {
    request.log.error(error);
    return reply.status(400).send({
      message: error instanceof Error ? error.message : 'Unable to list underlyings',
    });
  }
});

server.post('/quick-order/preview', async (request, reply) => {
  const payload = request.body as QuickOrderPreviewRequest;

  try {
    return await createQuickOrderProvider(payload.broker).preview(payload);
  } catch (error) {
    request.log.error(error);
    return reply.status(400).send({
      message: error instanceof Error ? error.message : 'Unable to prepare quick order preview',
    });
  }
});

server.post('/execution/preview', async (request, reply) => {
  const payload = request.body as {
    request: QuickOrderPreviewRequest;
    dataProvider: DataProviderSettings;
    tradingAccount?: TradingAccountSettings;
  };

  if (!payload?.request || !payload?.dataProvider) {
    return reply.status(400).send({
      message: 'Execution preview requires both request and data provider.',
    });
  }

  try {
    const preview = await createQuickOrderProvider(payload.dataProvider.provider, {
      credentials: payload.dataProvider.credentials,
      connection: {
        apiBaseUrl: payload.dataProvider.connection.apiBaseUrl,
      },
    }).preview({
      ...payload.request,
      broker: payload.dataProvider.provider,
      productType: payload.tradingAccount?.defaults.productType
        ? getQuickOrderProductType(payload.tradingAccount.defaults.productType)
        : payload.request.productType,
    });

    return { preview };
  } catch (error) {
    request.log.error(error);
    return reply.status(400).send({
      message: error instanceof Error ? error.message : 'Unable to prepare execution preview',
    });
  }
});

server.get('/quick-order/live-feed-config', async (request, reply) => {
  const broker = (request.query as { broker?: QuickOrderPreviewRequest['broker'] }).broker ?? 'dhan';

  if (broker !== 'dhan') {
    return reply.status(400).send({
      message: `Live feed config is not available for broker ${broker}.`,
    });
  }

  return {
    broker,
    transport: 'websocket',
    endpoint: 'wss://api-feed.dhan.co?version=2&token={token}&clientId={clientId}&authType=2',
    instrumentLimitPerConnection: 5000,
    instrumentsPerSubscribeMessage: 100,
    supportedModes: ['ticker', 'quote', 'full'],
  };
});

const start = async () => {
  try {
    await warmQuickOrderCaches();
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
