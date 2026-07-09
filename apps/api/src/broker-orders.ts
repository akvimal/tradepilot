import type {
  BrokerOrderRecord,
  BrokerOrderRefreshResponse,
  QuickOrderPlacementRequest,
  QuickOrderPlacementResponse,
  QuickOrderPreparedOrder,
  TradingAccountSettings,
} from '@tradepilot/types';

const defaultDhanApiBaseUrl = 'https://api.dhan.co';

function normalizeText(value: unknown) {
  return String(value ?? '').trim();
}

function normalizeNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeOrderStatus(value: unknown): BrokerOrderRecord['status'] {
  const normalized = normalizeText(value).toLowerCase().replace(/[\s-]+/g, '_');

  if (!normalized) {
    return 'unknown';
  }

  if (normalized.includes('part') && normalized.includes('trade')) {
    return 'partially_traded';
  }

  if (normalized.includes('trade') || normalized.includes('complete')) {
    return 'traded';
  }

  if (normalized.includes('reject')) {
    return 'rejected';
  }

  if (normalized.includes('cancel')) {
    return 'cancelled';
  }

  if (normalized.includes('expire')) {
    return 'expired';
  }

  if (normalized.includes('open')) {
    return 'open';
  }

  if (normalized.includes('pend') || normalized.includes('transit') || normalized.includes('placed')) {
    return 'pending';
  }

  return 'unknown';
}

function normalizeOrderSide(value: unknown): BrokerOrderRecord['side'] {
  return normalizeText(value).toLowerCase().includes('sell') ? 'sell' : 'buy';
}

function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, label: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(url, {
    ...init,
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout)).catch((error) => {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`${label} request timed out after ${timeoutMs}ms`);
    }

    throw error;
  });
}

function getDhanOrderType(order: QuickOrderPreparedOrder) {
  if (order.orderType === 'market') {
    return 'MARKET';
  }

  if (order.orderType === 'limit') {
    return 'LIMIT';
  }

  if (order.orderType === 'stop_market') {
    return 'STOP_LOSS_MARKET';
  }

  return 'STOP_LOSS';
}

function resolveDhanOrderExchangeSegment(underlyingSymbol: string, exchangeSegment: string) {
  const normalizedUnderlying = normalizeText(underlyingSymbol).toUpperCase();
  const normalizedSegment = normalizeText(exchangeSegment).toUpperCase();

  if (normalizedUnderlying === 'GOLD' || normalizedUnderlying === 'CRUDEOIL') {
    return 'MCX_COMM';
  }

  if (normalizedUnderlying === 'SENSEX') {
    return 'BSE_FNO';
  }

  if (normalizedUnderlying === 'NIFTY' || normalizedUnderlying === 'BANKNIFTY' || normalizedUnderlying === 'MIDCPNIFTY') {
    return 'NSE_FNO';
  }

  if (normalizedSegment.includes('MCX')) {
    return 'MCX_COMM';
  }

  if (normalizedSegment.includes('BSE')) {
    return 'BSE_FNO';
  }

  return 'NSE_FNO';
}

async function dhanGetJson<T>(path: string, account: TradingAccountSettings): Promise<T> {
  const url = new URL(path, defaultDhanApiBaseUrl.endsWith('/') ? defaultDhanApiBaseUrl : `${defaultDhanApiBaseUrl}/`).toString();
  const accessToken = account.credentials.accessToken?.trim();
  const clientId = account.credentials.clientId?.trim();

  if (!accessToken) {
    throw new Error('Dhan access token is missing.');
  }

  const response = await fetchWithTimeout(
    url,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'access-token': accessToken,
        ...(clientId ? { 'client-id': clientId } : {}),
      },
    },
    15000,
    `Dhan ${path}`,
  );

  const bodyText = await response.text();

  if (!response.ok) {
    throw new Error(`Dhan request failed for ${path}: ${response.status}${bodyText ? ` ${bodyText}` : ''}`);
  }

  return bodyText ? (JSON.parse(bodyText) as T) : ({} as T);
}

async function dhanPlaceJson<T>(path: string, account: TradingAccountSettings, body: Record<string, unknown>): Promise<T> {
  const url = new URL(path, defaultDhanApiBaseUrl.endsWith('/') ? defaultDhanApiBaseUrl : `${defaultDhanApiBaseUrl}/`).toString();
  const accessToken = account.credentials.accessToken?.trim();
  const clientId = account.credentials.clientId?.trim();

  if (!accessToken) {
    throw new Error('Dhan access token is missing.');
  }

  const response = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'access-token': accessToken,
        ...(clientId ? { 'client-id': clientId } : {}),
      },
      body: JSON.stringify(body),
    },
    15000,
    `Dhan ${path}`,
  );

  const bodyText = await response.text();

  if (!response.ok) {
    throw new Error(`Dhan request failed for ${path}: ${response.status}${bodyText ? ` ${bodyText}` : ''}`);
  }

  return bodyText ? (JSON.parse(bodyText) as T) : ({} as T);
}

function mapDhanOrder(rawOrder: Record<string, unknown>, account: TradingAccountSettings): BrokerOrderRecord {
  const orderId = normalizeText(
    rawOrder.orderId ??
      rawOrder.order_id ??
      rawOrder.exchangeOrderId ??
      rawOrder.exchange_order_id ??
      rawOrder.id,
  );

  return {
    broker: account.broker,
    brokerAccountId: account.id,
    orderId: orderId || `dhan-${Date.now()}`,
    exchangeOrderId: normalizeText(rawOrder.exchangeOrderId ?? rawOrder.exchange_order_id) || undefined,
    status: normalizeOrderStatus(rawOrder.orderStatus ?? rawOrder.order_status ?? rawOrder.status),
    side: normalizeOrderSide(rawOrder.transactionType ?? rawOrder.side ?? rawOrder.transaction_type),
    symbol:
      normalizeText(
        rawOrder.tradingSymbol ??
          rawOrder.trading_symbol ??
          rawOrder.symbol ??
          rawOrder.securityName ??
          rawOrder.security_name ??
          rawOrder.securityId ??
          rawOrder.security_id,
      ) || 'Unknown',
    securityId: normalizeText(rawOrder.securityId ?? rawOrder.security_id) || undefined,
    exchangeSegment: normalizeText(rawOrder.exchangeSegment ?? rawOrder.exchange_segment) || undefined,
    orderType: normalizeText(rawOrder.orderType ?? rawOrder.order_type ?? rawOrder.type) || 'market',
    productType: normalizeText(rawOrder.productType ?? rawOrder.product_type) || undefined,
    validity: normalizeText(rawOrder.validity ?? rawOrder.orderValidity ?? rawOrder.order_validity) || undefined,
    quantity: normalizeNumber(rawOrder.quantity ?? rawOrder.qty) ?? 0,
    tradedQuantity: normalizeNumber(rawOrder.tradedQuantity ?? rawOrder.traded_quantity),
    price: normalizeNumber(rawOrder.price ?? rawOrder.orderPrice ?? rawOrder.order_price),
    averageTradedPrice: normalizeNumber(rawOrder.averageTradedPrice ?? rawOrder.avgTradedPrice ?? rawOrder.average_traded_price),
    triggerPrice: normalizeNumber(rawOrder.triggerPrice ?? rawOrder.trigger_price),
    createdAt: normalizeText(rawOrder.createdAt ?? rawOrder.created_at) || undefined,
    updatedAt: normalizeText(rawOrder.updatedAt ?? rawOrder.updated_at) || undefined,
    message: normalizeText(rawOrder.message ?? rawOrder.rejectionReason ?? rawOrder.reason) || undefined,
    raw: rawOrder,
  };
}

async function refreshDhanOrders(account: TradingAccountSettings): Promise<BrokerOrderRefreshResponse> {
  const payload = await dhanGetJson<{ data?: unknown[] } | unknown[]>('/v2/orders', account);
  const rawOrders = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { data?: unknown[] }).data)
      ? ((payload as { data?: unknown[] }).data ?? [])
      : [];
  const orders = rawOrders
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .map((item) => mapDhanOrder(item, account));

  return {
    accountId: account.id,
    broker: account.broker,
    status: orders.length > 0 ? 'connected' : 'partial',
    message: orders.length > 0 ? `Loaded ${orders.length} broker orders.` : 'No broker orders found for the selected account.',
    lastSyncedAt: new Date().toISOString(),
    orderCount: orders.length,
    orders,
  };
}

export async function refreshBrokerOrders(account: TradingAccountSettings): Promise<BrokerOrderRefreshResponse> {
  if (!account.enabled) {
    return {
      accountId: account.id,
      broker: account.broker,
      status: 'unsupported',
      message: 'Trading account is disabled.',
      lastSyncedAt: new Date().toISOString(),
      orderCount: 0,
      orders: [],
    };
  }

  if (account.broker !== 'dhan') {
    return {
      accountId: account.id,
      broker: account.broker,
      status: 'unsupported',
      message: `Live order sync is not implemented for broker ${account.broker} yet.`,
      lastSyncedAt: new Date().toISOString(),
      orderCount: 0,
      orders: [],
    };
  }

  return refreshDhanOrders(account);
}

function buildBrokerOrderRecord(rawOrder: Record<string, unknown>, account: TradingAccountSettings): BrokerOrderRecord {
  return mapDhanOrder(rawOrder, account);
}

export async function placeBrokerOrder(request: QuickOrderPlacementRequest): Promise<QuickOrderPlacementResponse> {
  const { preview, tradingAccount } = request;

  if (!tradingAccount.enabled) {
    return {
      accountId: tradingAccount.id,
      broker: tradingAccount.broker,
      status: 'unsupported',
      message: 'Trading account is disabled.',
      placedAt: new Date().toISOString(),
    };
  }

  if (tradingAccount.broker !== preview.request.broker) {
    throw new Error(`Broker mismatch between preview (${preview.request.broker}) and trading account (${tradingAccount.broker}).`);
  }

  if (tradingAccount.broker !== 'dhan') {
    return {
      accountId: tradingAccount.id,
      broker: tradingAccount.broker,
      status: 'unsupported',
      message: `Order placement is not implemented for broker ${tradingAccount.broker} yet.`,
      placedAt: new Date().toISOString(),
    };
  }

  const entryOrder = preview.orders.find((item) => item.step === 'entry');

  if (!entryOrder) {
    throw new Error('Entry order is missing from the execution preview.');
  }

  const transactionType = entryOrder.side === 'buy' ? 'BUY' : 'SELL';
  const orderType = getDhanOrderType(entryOrder);
  const exchangeSegment = resolveDhanOrderExchangeSegment(
    preview.contract.underlyingSymbol,
    preview.contract.exchangeSegment,
  );
  const body: Record<string, unknown> = {
    dhanClientId: tradingAccount.credentials.clientId?.trim(),
    correlationId: `tp-${Date.now()}`,
    transactionType,
    exchangeSegment,
    productType: preview.request.productType,
    orderType,
    validity: tradingAccount.defaults.validity,
    securityId: preview.contract.securityId,
    quantity: entryOrder.quantity,
    disclosedQuantity: 0,
    afterMarketOrder: false,
  };

  if (orderType === 'LIMIT') {
    body.price = entryOrder.price ?? preview.contract.optionLastPrice;
  }

  if (orderType === 'STOP_LOSS' || orderType === 'STOP_LOSS_MARKET') {
    body.triggerPrice = entryOrder.triggerPrice ?? entryOrder.price ?? preview.risk.premiumStopLossPrice;
    if (orderType === 'STOP_LOSS') {
      body.price = entryOrder.price ?? preview.risk.premiumStopLossLimitPrice;
    }
  }

  const response = await dhanPlaceJson<Record<string, unknown>>('/v2/orders', tradingAccount, body);
  const order = buildBrokerOrderRecord(
    {
      ...response,
      orderStatus: response.orderStatus ?? response.status,
      orderId: response.orderId ?? response.order_id ?? response.id,
      exchangeOrderId: response.exchangeOrderId ?? response.exchange_order_id,
      transactionType,
      tradingSymbol: preview.contract.tradingSymbol,
      securityId: preview.contract.securityId,
      exchangeSegment,
      orderType,
      productType: preview.request.productType,
      validity: tradingAccount.defaults.validity,
      quantity: entryOrder.quantity,
      price: entryOrder.price ?? preview.contract.optionLastPrice,
      triggerPrice: entryOrder.triggerPrice,
      message: response.message ?? response.rejectionReason,
    },
    tradingAccount,
  );

  return {
    accountId: tradingAccount.id,
    broker: tradingAccount.broker,
    status: 'placed',
    message: `Placed ${transactionType} ${orderType.toLowerCase()} order for ${preview.contract.tradingSymbol}.`,
    placedAt: new Date().toISOString(),
    order,
  };
}
