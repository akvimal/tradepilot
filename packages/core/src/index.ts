import type {
  BrokerInstrumentMasterRecord,
  BrokerAccountSettings,
  BrokerAccountSettingsInput,
  DataProviderSettingsInput,
  TradingAccountSettingsInput,
  ExecutionRouteSettingsInput,
  BrokerOptionChainSnapshot,
  BrokerOptionQuote,
  BrokerSummary,
  DailySessionPlan,
  ManualWorkspaceSnapshot,
  PlannedTradeSetup,
  PostMarketReview,
  QuickOrderLookupResponse,
  QuickOrderPreviewRequest,
  QuickOrderPreviewResponse,
  QuickOrderPreparedOrder,
  QuickOrderResolvedContract,
  QuickOrderRiskSummary,
  TradeExecution,
  TradePlan,
  TradingPlaybook,
} from '@tradepilot/types';

export type ExecutionMode = 'paper' | 'live';

export type BrokerKey = 'dhan' | 'zerodha' | 'angelone' | 'delta';

export interface NormalizedOrderRequest {
  tenantId: string;
  broker: BrokerKey;
  brokerAccountId: string;
  mode: ExecutionMode;
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  orderType: 'market' | 'limit' | 'stop' | 'stop_market';
  price?: number;
  stopPrice?: number;
  product?: string;
  tags?: string[];
}

export interface NormalizedOrderResult {
  orderId: string;
  brokerOrderId?: string;
  status: 'accepted' | 'rejected' | 'pending';
  reason?: string;
}

export interface BrokerExecutionAdapter {
  broker: BrokerKey;
  placeOrder(order: NormalizedOrderRequest): Promise<NormalizedOrderResult>;
  cancelOrder(orderId: string): Promise<void>;
  getCapital(brokerAccountId: string): Promise<unknown>;
  getPositions(brokerAccountId: string): Promise<unknown[]>;
  getTradeHistory(brokerAccountId: string, from?: string, to?: string): Promise<unknown[]>;
}

export interface QuickOrderBrokerProvider {
  broker: BrokerKey;
  listUnderlyings(): Promise<QuickOrderLookupResponse>;
  loadInstrumentMaster(underlyingSymbol: string): Promise<BrokerInstrumentMasterRecord[]>;
  getOptionChain(
    underlyingSymbol: string,
    expiryPreference: QuickOrderPreviewRequest['expiryPreference'],
  ): Promise<BrokerOptionChainSnapshot>;
}

export interface BrokerSettingsValidationResult {
  valid: boolean;
  errors: string[];
}

export const supportedBrokers: BrokerSummary[] = [
  {
    key: 'dhan',
    label: 'Dhan',
    capabilities: ['equities', 'fno', 'paper-routing'],
  },
  {
    key: 'zerodha',
    label: 'Zerodha',
    capabilities: ['equities', 'fno', 'holdings-sync'],
  },
  {
    key: 'angelone',
    label: 'Angel One',
    capabilities: ['equities', 'fno'],
  },
  {
    key: 'delta',
    label: 'Delta Exchange',
    capabilities: ['crypto', 'derivatives'],
  },
];

export const manualTradingPlaybooks: TradingPlaybook[] = [
  {
    id: 'nse-us-intraday-smc',
    label: 'NSE / US Intraday SMC',
    marketType: 'nse',
    primaryInstruments: ['NIFTY', 'BANKNIFTY', 'SENSEX', 'NDX'],
    correlationExamples: ['NIFTY <-> BANKNIFTY', 'BTCUSD <-> NDX'],
    contextTimeframes: ['1D', '15m'],
    confirmationTimeframes: ['3m', '1m'],
    executionTimeframe: '15s',
    minimumRiskReward: 5,
    checklistFocus: ['global trend', 'crude oil', 'news risk', 'correlation alignment'],
  },
  {
    id: 'crypto-forex-smc',
    label: 'Crypto / Forex SMC',
    marketType: 'crypto',
    primaryInstruments: ['BTCUSD', 'ETHUSD', 'EURUSD', 'XAUUSD'],
    correlationExamples: ['BTCUSD <-> NDX', 'ETHUSD <-> BTCUSD'],
    contextTimeframes: ['1D', '4H'],
    confirmationTimeframes: ['15m', '3m'],
    minimumRiskReward: 5,
    checklistFocus: ['session timing', 'macro risk', 'correlation context'],
  },
];

export function calculateRiskReward(plan: Pick<TradePlan, 'entryPrice' | 'stopLossPrice' | 'targetPrice'>): number | null {
  if (!plan.targetPrice) {
    return null;
  }

  return calculateRiskRewardFromPrices(plan.entryPrice, plan.stopLossPrice, plan.targetPrice);
}

export function calculateRiskRewardFromPrices(entryPrice: number, stopLossPrice: number, targetPrice: number): number | null {
  const risk = Math.abs(entryPrice - stopLossPrice);
  const reward = Math.abs(targetPrice - entryPrice);

  if (risk === 0) {
    return null;
  }

  return Number((reward / risk).toFixed(2));
}

export function calculateRealizedRiskReward(
  entryPrice: number,
  stopLossPrice: number,
  exitPrice: number,
  direction: 'long' | 'short',
): number | null {
  const risk = Math.abs(entryPrice - stopLossPrice);

  if (risk === 0) {
    return null;
  }

  const reward = direction === 'long' ? exitPrice - entryPrice : entryPrice - exitPrice;
  return Number((reward / risk).toFixed(2));
}

export function calculateChecklistCompletionRate(checklist: DailySessionPlan['checklist']): number {
  const total = checklist.length;
  const completed = checklist.filter((item) => item.completed).length;

  if (total === 0) {
    return 0;
  }

  return Number(((completed / total) * 100).toFixed(0));
}

export function calculateFollowRate(executions: TradeExecution[]): number {
  if (executions.length === 0) {
    return 0;
  }

  const followed = executions.filter((execution) => execution.followedPlan).length;
  return Number(((followed / executions.length) * 100).toFixed(0));
}

export function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return Number((total / values.length).toFixed(2));
}

export function calculateQuickOrderRiskBudget(capital: number, riskPercent: number): number {
  const rawRiskBudget = (capital * riskPercent) / 100;
  const bufferedRiskBudget = rawRiskBudget * 0.9;
  return Number(Math.max(0, bufferedRiskBudget).toFixed(2));
}

export function getNearestStrike(strikes: number[], underlyingLastPrice: number): number | null {
  if (strikes.length === 0) {
    return null;
  }

  return [...strikes].sort((left, right) => Math.abs(left - underlyingLastPrice) - Math.abs(right - underlyingLastPrice))[0] ?? null;
}

export function resolveStrikeByPreference(
  availableStrikes: number[],
  underlyingLastPrice: number,
  optionType: 'CE' | 'PE',
  strikePreference: QuickOrderPreviewRequest['strikePreference'],
): number | null {
  const sorted = [...new Set(availableStrikes)].sort((left, right) => left - right);
  const atm = getNearestStrike(sorted, underlyingLastPrice);

  if (atm === null) {
    return null;
  }

  if (strikePreference === 'atm') {
    return atm;
  }

  const atmIndex = sorted.findIndex((strike) => strike === atm);

  if (atmIndex < 0) {
    return atm;
  }

  const offset =
    optionType === 'CE'
      ? strikePreference === 'itm'
        ? -1
        : 1
      : strikePreference === 'itm'
        ? 1
        : -1;

  return sorted[Math.max(0, Math.min(sorted.length - 1, atmIndex + offset))] ?? atm;
}

export function selectQuickOrderContract(
  request: QuickOrderPreviewRequest,
  master: BrokerInstrumentMasterRecord[],
  chain: BrokerOptionChainSnapshot,
): QuickOrderResolvedContract {
  const optionType = request.optionSide === 'call' ? 'CE' : 'PE';
  const chainQuotes = chain.quotes.filter((quote) => quote.optionType === optionType);
  const targetStrike = resolveStrikeByPreference(
    chainQuotes.map((quote) => quote.strikePrice),
    chain.underlyingLastPrice,
    optionType,
    request.strikePreference,
  );

  if (targetStrike === null) {
    throw new Error(`No ${optionType} strikes available for ${request.underlyingSymbol}`);
  }

  const quote =
    chainQuotes.find((item) => item.strikePrice === targetStrike) ??
    chainQuotes.sort((left, right) => Math.abs(left.strikePrice - targetStrike) - Math.abs(right.strikePrice - targetStrike))[0];

  if (!quote) {
    throw new Error(`No ${optionType} quote available for ${request.underlyingSymbol}`);
  }

  const masterRecord =
    master.find(
      (item) =>
        item.securityId === quote.securityId ||
        (item.expiry === quote.expiry && item.strikePrice === quote.strikePrice && item.optionType === quote.optionType),
    ) ?? null;

  return {
    broker: request.broker,
    securityId: masterRecord?.securityId ?? quote.securityId,
    exchangeSegment: masterRecord?.exchangeSegment ?? quote.exchangeSegment,
    tradingSymbol: masterRecord?.tradingSymbol ?? quote.tradingSymbol,
    underlyingSymbol: request.underlyingSymbol,
    optionType,
    expiry: masterRecord?.expiry ?? quote.expiry,
    strikePrice: masterRecord?.strikePrice ?? quote.strikePrice,
    lotSize: masterRecord?.lotSize ?? 1,
    tickSize: masterRecord?.tickSize,
    underlyingLastPrice: chain.underlyingLastPrice,
    optionLastPrice: quote.lastPrice,
    topBidPrice: quote.topBidPrice,
    topAskPrice: quote.topAskPrice,
    spread:
      quote.topBidPrice !== undefined && quote.topAskPrice !== undefined
        ? Number((quote.topAskPrice - quote.topBidPrice).toFixed(2))
        : undefined,
    volume: quote.volume,
    openInterest: quote.openInterest,
    delta: quote.delta,
  };
}

export function derivePremiumStopLoss(
  request: QuickOrderPreviewRequest,
  contract: QuickOrderResolvedContract,
): number {
  const entryPremium =
    request.entryOrderType === 'limit'
      ? request.entryLimitPrice ?? contract.optionLastPrice
      : contract.topAskPrice ?? contract.optionLastPrice;
  const stopBuffer = Math.max(0.25, contract.tickSize ?? 0.25);
  const roundStop = (candidateStop: number) => Number(Math.max(0.05, Math.round(candidateStop)).toFixed(2));
  const widenStopDistance = (baseStop: number) => {
    const stopDistance = Math.max(stopBuffer, entryPremium - baseStop);
    const widenedStop = entryPremium - stopDistance * 1.05;
    return roundStop(Math.min(entryPremium - stopBuffer, widenedStop));
  };
  const hasUnderlyingLevels =
    typeof request.underlyingEntryPrice === 'number' &&
    typeof request.underlyingStopLossPrice === 'number' &&
    Number.isFinite(request.underlyingEntryPrice) &&
    Number.isFinite(request.underlyingStopLossPrice) &&
    request.underlyingEntryPrice !== request.underlyingStopLossPrice;

  if (!hasUnderlyingLevels) {
    const riskBudget = calculateQuickOrderRiskBudget(request.capital, request.riskPercent);
    const riskPerUnitFromBudget =
      request.capital > 0 && contract.lotSize > 0 ? riskBudget / contract.lotSize : entryPremium * 0.1;
    const heuristicCap = entryPremium * 0.2;
    const premiumRisk = Math.max(
      0.5,
      Math.min(entryPremium - stopBuffer, riskPerUnitFromBudget, heuristicCap),
    );
    return widenStopDistance(Number(Math.max(0.05, entryPremium - premiumRisk).toFixed(2)));
  }

  const underlyingRisk = Math.abs((request.underlyingEntryPrice ?? contract.underlyingLastPrice) - (request.underlyingStopLossPrice ?? contract.underlyingLastPrice));
  const optionDelta = Math.abs(contract.delta ?? 0.5);
  const premiumRisk = underlyingRisk * optionDelta;
  return widenStopDistance(Number(Math.max(0.05, entryPremium - premiumRisk - stopBuffer).toFixed(2)));
}

export function buildQuickOrderRiskSummary(
  request: QuickOrderPreviewRequest,
  contract: QuickOrderResolvedContract,
): QuickOrderRiskSummary {
  const riskBudget = calculateQuickOrderRiskBudget(request.capital, request.riskPercent);
  const targetRiskReward = Math.max(1, request.targetRiskReward ?? 5);
  const entryPremiumForRisk =
    request.entryOrderType === 'limit'
      ? request.entryLimitPrice ?? contract.optionLastPrice
      : contract.topAskPrice ?? contract.optionLastPrice;
  const rawPremiumStopLossPrice = derivePremiumStopLoss(request, contract);
  const riskStopBuffer = Math.max(0.25, contract.tickSize ?? 0.25);
  const budgetFloorStopPrice = Number(
    Math.max(0.05, entryPremiumForRisk - riskBudget / Math.max(1, contract.lotSize) - riskStopBuffer).toFixed(2),
  );
  const premiumStopLossPrice = Number(Math.max(rawPremiumStopLossPrice, budgetFloorStopPrice).toFixed(2));
  const premiumStopLossLimitPrice = Number(Math.max(0.05, request.stopLimitPrice ?? premiumStopLossPrice).toFixed(2));
  const invalidStopSide = premiumStopLossLimitPrice >= entryPremiumForRisk;
  if (invalidStopSide) {
    return {
      riskBudget,
      premiumRiskPerUnit: 0,
      premiumStopLossPrice,
      premiumStopLossLimitPrice,
      premiumTargetPrice: Number(
        (
          request.targetLimitPrice ??
          (contract.optionLastPrice + 0)
        ).toFixed(2),
      ),
      premiumFiveRTargetPrice: Number(Math.max(0.05, request.targetLimitPrice ?? contract.optionLastPrice).toFixed(2)),
      lots: 0,
      quantity: 0,
      canTrade: false,
      riskBlockReason: `Stop loss ${premiumStopLossLimitPrice.toFixed(2)} must be below entry ${entryPremiumForRisk.toFixed(2)}.`,
      capitalRequired: 0,
      capitalBlockReason: undefined,
      totalRisk: 0,
      expectedReward: 0,
      expectedRiskReward: null,
    };
  }
  const riskStopPrice = Number(Math.max(0.05, Math.min(entryPremiumForRisk - riskStopBuffer, premiumStopLossLimitPrice)).toFixed(2));
  const premiumRiskPerUnit = Number(Math.max(0.05, entryPremiumForRisk - riskStopPrice).toFixed(2));
  const riskPerLot = Number((premiumRiskPerUnit * contract.lotSize).toFixed(2));
  const riskBudgetPaise = Math.floor(riskBudget * 100);
  const riskPerLotPaise = Math.ceil(riskPerLot * 100);
  const riskLotsRaw = riskPerLotPaise > 0 ? Math.floor(riskBudgetPaise / riskPerLotPaise) : 0;
  const entryPremiumForCapital =
    request.entryOrderType === 'limit'
      ? request.entryLimitPrice ?? contract.optionLastPrice
      : contract.topAskPrice ?? contract.optionLastPrice;
  const capitalPerLot = Math.max(0, entryPremiumForCapital) * contract.lotSize;
  const capitalPerLotPaise = Math.ceil(capitalPerLot * 100);
  const capitalLots = capitalPerLotPaise > 0 ? Math.floor((request.capital * 100) / capitalPerLotPaise) : 0;
  const riskLots =
    riskLotsRaw === 0 && riskBudgetPaise >= riskPerLotPaise && capitalLots >= 1
      ? 1
      : riskLotsRaw;
  const lots = Math.max(0, Math.min(riskLots, capitalLots));
  const quantity = lots * contract.lotSize;
  const totalRisk = Number((premiumRiskPerUnit * quantity).toFixed(2));
  const hasUnderlyingTarget =
    typeof request.underlyingEntryPrice === 'number' &&
    typeof request.underlyingTargetPrice === 'number' &&
    Number.isFinite(request.underlyingEntryPrice) &&
    Number.isFinite(request.underlyingTargetPrice) &&
    request.underlyingEntryPrice !== request.underlyingTargetPrice;
  const targetPremiumMove = hasUnderlyingTarget
    ? Math.abs((request.underlyingTargetPrice ?? contract.underlyingLastPrice) - (request.underlyingEntryPrice ?? contract.underlyingLastPrice)) * Math.abs(contract.delta ?? 0.5)
    : premiumRiskPerUnit * 5;
  const expectedReward = Number((targetPremiumMove * quantity).toFixed(2));
  const expectedRiskReward = totalRisk > 0 ? Number((expectedReward / totalRisk).toFixed(2)) : null;
  const premiumTargetPrice = Number(
    (
      request.targetLimitPrice ??
      (contract.optionLastPrice + (expectedReward / Math.max(1, quantity)))
    ).toFixed(2),
  );
  const premiumFiveRTargetPrice = Number(Math.max(0.05, request.targetLimitPrice ?? contract.optionLastPrice + premiumRiskPerUnit * targetRiskReward).toFixed(2));
  const capitalRequired = Number((entryPremiumForCapital * quantity).toFixed(2));
  const canTrade = lots > 0 && capitalRequired <= request.capital;
  const riskBlockReason =
    canTrade || riskBudget <= 0
      ? undefined
      : `Risk budget ${riskBudget.toFixed(2)} is not enough for one lot. Need at least ${riskPerLot.toFixed(2)}.`;
  const capitalBlockReason =
    canTrade || request.capital <= 0
      ? undefined
      : capitalRequired > request.capital
        ? `Order value ${capitalRequired.toFixed(2)} exceeds capital ${request.capital.toFixed(2)}.`
        : undefined;

  return {
    riskBudget,
    premiumRiskPerUnit,
    premiumStopLossPrice,
    premiumStopLossLimitPrice,
    premiumTargetPrice,
    premiumFiveRTargetPrice,
    lots,
    quantity,
    canTrade,
    riskBlockReason,
    capitalRequired,
    capitalBlockReason,
    totalRisk,
    expectedReward,
    expectedRiskReward,
  };
}

export function buildQuickOrderPreview(
  request: QuickOrderPreviewRequest,
  master: BrokerInstrumentMasterRecord[],
  chain: BrokerOptionChainSnapshot,
): QuickOrderPreviewResponse {
  const contract = selectQuickOrderContract(request, master, chain);
  const risk = buildQuickOrderRiskSummary(request, contract);
  const entryPrice =
    request.entryOrderType === 'limit'
      ? request.entryLimitPrice ?? contract.topAskPrice ?? contract.optionLastPrice
      : undefined;
  const exitPrice =
    request.exitOrderType === 'limit'
      ? request.exitLimitPrice ?? risk.premiumFiveRTargetPrice ?? contract.topBidPrice ?? contract.optionLastPrice
      : undefined;

  const orders: QuickOrderPreparedOrder[] = [
    {
      step: 'entry',
      side: 'buy',
      orderType: request.entryOrderType,
      quantity: risk.quantity,
      price: entryPrice,
      productType: request.productType,
    },
    {
      step: 'stop_loss',
      side: 'sell',
      orderType: request.stopOrderType === 'stop_loss_market' ? 'stop_market' : 'stop',
      quantity: risk.quantity,
      price: request.stopOrderType === 'stop_loss' ? risk.premiumStopLossLimitPrice : undefined,
      triggerPrice: risk.premiumStopLossPrice,
      productType: request.productType,
    },
    ...(request.targetLimitPrice !== undefined
      ? [
          {
            step: 'take_profit' as const,
            side: 'sell' as const,
            orderType: 'limit' as const,
            quantity: risk.quantity,
            price: exitPrice ?? risk.premiumFiveRTargetPrice,
            productType: request.productType,
          },
        ]
      : []),
  ];

  return {
    request,
    contract,
    risk,
    orders,
    feedSubscription: {
      mode: 'quote',
      instruments: [
        {
          exchangeSegment: chain.exchangeSegment,
          securityId:
            master.find((item) => item.underlyingSymbol === request.underlyingSymbol && item.instrumentType === 'spot')?.securityId ??
            contract.securityId,
        },
        {
          exchangeSegment: contract.exchangeSegment,
          securityId: contract.securityId,
        },
      ],
    },
  };
}

export function buildStaticOptionMasterFromQuotes(
  broker: BrokerKey,
  underlyingSymbol: string,
  exchangeSegment: string,
  lotSize: number,
  quotes: BrokerOptionQuote[],
): BrokerInstrumentMasterRecord[] {
  return quotes.map((quote) => ({
    broker,
    securityId: quote.securityId,
    exchangeSegment: quote.exchangeSegment || exchangeSegment,
    tradingSymbol: quote.tradingSymbol,
    displayName: quote.tradingSymbol,
    instrumentType: 'option',
    underlyingSymbol,
    lotSize,
    expiry: quote.expiry,
    strikePrice: quote.strikePrice,
    optionType: quote.optionType,
  }));
}

export function buildDefaultBrokerAccountSettings(
  broker: BrokerKey,
  overrides: Partial<BrokerAccountSettingsInput> = {},
): BrokerAccountSettingsInput {
  return {
    broker,
    label: overrides.label ?? `${supportedBrokers.find((item) => item.key === broker)?.label ?? broker} Account`,
    mode: overrides.mode ?? 'paper',
    enabled: overrides.enabled ?? true,
    authMode:
      overrides.authMode ??
      (broker === 'dhan' ? 'access_token' : broker === 'delta' ? 'api_key_secret' : 'oauth_app'),
    credentials: overrides.credentials ?? {},
    connection: {
      apiBaseUrl: overrides.connection?.apiBaseUrl,
      redirectUrl: overrides.connection?.redirectUrl,
      postbackUrl: overrides.connection?.postbackUrl,
      liveFeedEnabled: overrides.connection?.liveFeedEnabled ?? broker === 'dhan',
      optionChainEnabled: overrides.connection?.optionChainEnabled ?? (broker === 'dhan' || broker === 'delta'),
      scripMasterEnabled: overrides.connection?.scripMasterEnabled ?? broker === 'dhan',
      staticIpWhitelisted: overrides.connection?.staticIpWhitelisted ?? false,
      whitelistedIp: overrides.connection?.whitelistedIp,
    },
    defaults: {
      productType: overrides.defaults?.productType ?? 'INTRADAY',
      validity: overrides.defaults?.validity ?? 'DAY',
      exchangeSegment: overrides.defaults?.exchangeSegment,
    },
    notes: overrides.notes,
  };
}

export function validateBrokerAccountSettings(input: BrokerAccountSettingsInput): BrokerSettingsValidationResult {
  const errors: string[] = [];

  if (!input.label.trim()) {
    errors.push('Account label is required.');
  }

  if (input.broker === 'dhan') {
    if (!input.credentials.clientId?.trim()) {
      errors.push('Dhan Client ID is required.');
    }

    if (input.authMode === 'access_token' && !input.credentials.accessToken?.trim()) {
      errors.push('Dhan access token is required for access token mode.');
    }

    if (input.authMode === 'oauth_app') {
      if (!input.credentials.apiKey?.trim()) {
        errors.push('Dhan API key is required for OAuth app mode.');
      }

      if (!input.credentials.apiSecret?.trim()) {
        errors.push('Dhan API secret is required for OAuth app mode.');
      }

      if (!(input.connection.redirectUrl ?? input.credentials.redirectUrl)?.trim()) {
        errors.push('Dhan redirect URL is required for OAuth app mode.');
      }
    }
  }

  if (input.broker === 'zerodha') {
    if (!input.credentials.apiKey?.trim()) {
      errors.push('Zerodha API key is required.');
    }

    if (!input.credentials.apiSecret?.trim()) {
      errors.push('Zerodha API secret is required.');
    }
  }

  if (input.broker === 'angelone') {
    if (!input.credentials.apiKey?.trim()) {
      errors.push('Angel One API key is required.');
    }

    if (!input.credentials.clientCode?.trim()) {
      errors.push('Angel One client code is required.');
    }
  }

  if (input.broker === 'delta') {
    if (!input.credentials.apiKey?.trim()) {
      errors.push('Delta API key is required.');
    }

    if (!input.credentials.apiSecret?.trim()) {
      errors.push('Delta API secret is required.');
    }
  }

  if (input.connection.staticIpWhitelisted && !input.connection.whitelistedIp?.trim()) {
    errors.push('Whitelisted IP must be provided when static IP is enabled.');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function buildDefaultDataProviderSettings(
  provider: BrokerKey,
  overrides: Partial<DataProviderSettingsInput> = {},
): DataProviderSettingsInput {
  return {
    provider,
    label: overrides.label ?? `${supportedBrokers.find((item) => item.key === provider)?.label ?? provider} Data`,
    enabled: overrides.enabled ?? true,
    authMode:
      overrides.authMode ??
      (provider === 'dhan' ? 'access_token' : provider === 'delta' ? 'api_key_secret' : 'oauth_app'),
    credentials: overrides.credentials ?? {},
    connection: {
      apiBaseUrl: overrides.connection?.apiBaseUrl,
      redirectUrl: overrides.connection?.redirectUrl,
      postbackUrl: overrides.connection?.postbackUrl,
      liveFeedEnabled: overrides.connection?.liveFeedEnabled ?? true,
      optionChainEnabled: overrides.connection?.optionChainEnabled ?? (provider === 'dhan' || provider === 'delta'),
      scripMasterEnabled: overrides.connection?.scripMasterEnabled ?? provider === 'dhan',
      staticIpWhitelisted: overrides.connection?.staticIpWhitelisted ?? false,
      whitelistedIp: overrides.connection?.whitelistedIp,
    },
    exchanges: overrides.exchanges ?? (provider === 'dhan' ? ['NSE_FNO', 'MCX'] : ['NSE_FNO']),
    notes: overrides.notes,
  };
}

export function validateDataProviderSettings(input: DataProviderSettingsInput): BrokerSettingsValidationResult {
  const errors: string[] = [];

  if (!input.label.trim()) {
    errors.push('Data provider label is required.');
  }

  if (input.exchanges.length === 0) {
    errors.push('At least one exchange must be selected for a data provider.');
  }

  if (input.provider === 'dhan') {
    if (!input.credentials.clientId?.trim()) {
      errors.push('Dhan Client ID is required for the data provider.');
    }

    if (input.authMode === 'access_token' && !input.credentials.accessToken?.trim()) {
      errors.push('Dhan access token is required for the data provider.');
    }
  }

  if (input.provider === 'delta' && !input.credentials.apiKey?.trim()) {
    errors.push('Delta API key is required for the data provider.');
  }

  return { valid: errors.length === 0, errors };
}

export function buildDefaultTradingAccountSettings(
  broker: BrokerKey,
  overrides: Partial<TradingAccountSettingsInput> = {},
): TradingAccountSettingsInput {
  return {
    broker,
    label: overrides.label ?? `${supportedBrokers.find((item) => item.key === broker)?.label ?? broker} Trading`,
    ownerLabel: overrides.ownerLabel ?? 'Primary',
    mode: overrides.mode ?? 'paper',
    enabled: overrides.enabled ?? true,
    authMode:
      overrides.authMode ??
      (broker === 'dhan' ? 'access_token' : broker === 'delta' ? 'api_key_secret' : 'oauth_app'),
    credentials: overrides.credentials ?? {},
    defaults: {
      productType: overrides.defaults?.productType ?? 'INTRADAY',
      validity: overrides.defaults?.validity ?? 'DAY',
      exchangeSegment: overrides.defaults?.exchangeSegment,
    },
    supportedExchanges: overrides.supportedExchanges ?? (broker === 'dhan' ? ['NSE_FNO'] : ['NSE_FNO']),
    staticIpWhitelisted: overrides.staticIpWhitelisted ?? false,
    whitelistedIp: overrides.whitelistedIp,
    notes: overrides.notes,
  };
}

export function validateTradingAccountSettings(input: TradingAccountSettingsInput): BrokerSettingsValidationResult {
  const errors: string[] = [];

  if (!input.label.trim()) {
    errors.push('Trading account label is required.');
  }

  if (!input.ownerLabel.trim()) {
    errors.push('Trading account owner label is required.');
  }

  if (input.supportedExchanges.length === 0) {
    errors.push('At least one exchange must be selected for a trading account.');
  }

  if (input.broker === 'dhan') {
    if (!input.credentials.clientId?.trim()) {
      errors.push('Dhan Client ID is required.');
    }

    if (input.authMode === 'access_token' && !input.credentials.accessToken?.trim()) {
      errors.push('Dhan access token is required for access token mode.');
    }

    if (input.authMode === 'oauth_app') {
      if (!input.credentials.apiKey?.trim()) {
        errors.push('Dhan API key is required for OAuth app mode.');
      }

      if (!input.credentials.apiSecret?.trim()) {
        errors.push('Dhan API secret is required for OAuth app mode.');
      }
    }
  }

  if (input.staticIpWhitelisted && !input.whitelistedIp?.trim()) {
    errors.push('Whitelisted IP must be provided when static IP is enabled.');
  }

  return { valid: errors.length === 0, errors };
}

export function buildDefaultExecutionRouteSettings(
  overrides: Partial<ExecutionRouteSettingsInput> = {},
): ExecutionRouteSettingsInput {
  return {
    label: overrides.label ?? 'NSE F&O default route',
    enabled: overrides.enabled ?? true,
    instrumentSegments: overrides.instrumentSegments ?? ['NSE_FNO'],
    underlyingSymbol: overrides.underlyingSymbol,
    instrumentType: overrides.instrumentType ?? 'index_option',
    dataProviderId: overrides.dataProviderId,
    tradingAccountId: overrides.tradingAccountId ?? '',
    priority: overrides.priority ?? 1,
  };
}

export function validateExecutionRouteSettings(input: ExecutionRouteSettingsInput): BrokerSettingsValidationResult {
  const errors: string[] = [];
  const allowedSegments = new Set(['NSE_FNO', 'BSE_FNO', 'MCX']);

  if (!input.label.trim()) {
    errors.push('Execution route label is required.');
  }

  const segments = Array.isArray(input.instrumentSegments)
    ? input.instrumentSegments.map((segment) => segment.trim().toUpperCase()).filter(Boolean)
    : [];

  if (segments.length === 0) {
    errors.push('At least one instrument segment is required.');
  } else if (segments.some((segment) => !allowedSegments.has(segment))) {
    errors.push('Instrument segments must be NSE_FNO, BSE_FNO, or MCX.');
  }

  if (!input.tradingAccountId.trim()) {
    errors.push('Trading account is required for a route.');
  }

  return { valid: errors.length === 0, errors };
}

export function buildManualWorkspaceSnapshot(): ManualWorkspaceSnapshot {
  const sessionPlan: DailySessionPlan = {
    id: 'session-2026-06-30',
    tradeDate: '2026-06-30',
    playbookId: 'nse-us-intraday-smc',
    primaryInstrument: 'NIFTY',
    correlationInstrument: 'BANKNIFTY',
    globalSentiment: 'bullish',
    globalTrendNote: 'US close was constructive, Asia stable, no overnight panic in index futures.',
    crudeOilBias: 'neutral',
    crudeOilNote: 'Crude stable enough to avoid immediate inflation-driven shock bias for the open.',
    newsRisk: 'medium',
    newsHeadline: 'Domestic macro calendar light; remain alert around US session for tech-led risk swings.',
    sessionExpectation: 'trend_day',
    liquidityDraw: 'Previous day high after any opening sweep into 15m demand.',
    primaryContext: [
      {
        timeframe: '1D',
        bias: 'bullish',
        structure: 'Holding above prior daily demand with room toward external buy-side liquidity.',
        levels: [
          { label: 'PDH', value: 24280, timeframe: '1D' },
          { label: 'Daily OB', value: '24110-24140', timeframe: '1D' },
        ],
      },
      {
        timeframe: '15m',
        bias: 'bullish',
        structure: 'Recent swing low held. Expect sell-side sweep first, then reclaim.',
        levels: [
          { label: 'Intraday discount', value: '24155-24165', timeframe: '15m' },
          { label: 'Buy-side target', value: 24320, timeframe: '15m' },
        ],
      },
    ],
    correlationContext: [
      {
        timeframe: '1D',
        bias: 'bullish',
        structure: 'BANKNIFTY daily structure remains supportive and interchangeable with NIFTY bias.',
        levels: [
          { label: 'PDH', value: 53190, timeframe: '1D' },
        ],
      },
      {
        timeframe: '15m',
        bias: 'bullish',
        structure: 'Watching for matching reclaim after liquidity sweep.',
        levels: [
          { label: '15m demand', value: '52840-52880', timeframe: '15m' },
        ],
      },
    ],
    checklist: [
      { label: 'Global trend checked', completed: true, note: 'Risk-on tone intact.' },
      { label: 'Crude oil reviewed', completed: true, note: 'No abnormal gap pressure.' },
      { label: 'Important news mapped', completed: true, note: 'Medium event risk only.' },
      { label: '1D and 15m levels marked', completed: true },
      { label: 'Correlation bias aligned', completed: true, note: 'BANKNIFTY confirming.' },
      { label: 'Daily loss limit defined', completed: false, note: 'Need to set exact rupee cap before open.' },
    ],
    readyForTrading: false,
  };

  const setups: PlannedTradeSetup[] = [
    {
      id: 'setup-nifty-orb-reclaim',
      sessionPlanId: sessionPlan.id,
      playbookId: sessionPlan.playbookId,
      primaryInstrument: 'NIFTY',
      correlationInstrument: 'BANKNIFTY',
      instrumentType: 'index_option',
      direction: 'long',
      setupType: 'sell-side sweep -> MSS -> FVG reclaim',
      setupGrade: 'A',
      correlationStatus: 'confirming',
      confirmationNarrative: '3m shift after sweep low, 1m displacement, 15s refine into FVG.',
      executionNarrative: 'Buy ATM CE only after 15s reclaim prints higher low above 1m displacement origin.',
      entryTimeframe: '15s',
      entryPrice: 24205,
      stopLossPrice: 24192,
      targetPrice: 24274,
      riskAmount: 2500,
      projectedRiskReward: calculateRiskRewardFromPrices(24205, 24192, 24274) ?? 0,
      invalidation: 'Lose 1m bullish order block and slip back below sweep low.',
      targetNarrative: 'PDH and resting buy-side liquidity above the opening range.',
      notes: 'Only valid if BANKNIFTY reclaims with it. No entry if first displacement is weak.',
    },
    {
      id: 'setup-btc-ny-open',
      sessionPlanId: sessionPlan.id,
      playbookId: 'crypto-forex-smc',
      primaryInstrument: 'BTCUSD',
      correlationInstrument: 'NDX',
      instrumentType: 'perpetual',
      direction: 'long',
      setupType: 'US session continuation after 15m demand response',
      setupGrade: 'B',
      correlationStatus: 'neutral',
      confirmationNarrative: 'Need 3m internal structure shift after NY open if NDX stays bid.',
      executionNarrative: 'No 15s refine in this playbook. Enter only from 3m retest.',
      entryTimeframe: '3m',
      entryPrice: 106240,
      stopLossPrice: 105980,
      targetPrice: 107600,
      riskAmount: 3000,
      projectedRiskReward: calculateRiskRewardFromPrices(106240, 105980, 107600) ?? 0,
      invalidation: '3m close back below demand and NDX broad risk-off rejection.',
      targetNarrative: 'Internal range high first, then daily external liquidity.',
      notes: 'Secondary watchlist idea, not primary for the NSE session.',
    },
  ];

  const executions: TradeExecution[] = [
    {
      id: 'exec-nifty-1',
      setupId: setups[0].id,
      brokerLabel: 'Manual Entry',
      accountLabel: 'Primary Intraday',
      instrumentSymbol: 'NIFTY 24300 CE',
      instrumentType: 'index_option',
      direction: 'long',
      optionType: 'CE',
      strike: '24300',
      expiry: '2026-07-02',
      plannedEntry: 24205,
      actualEntry: 24208,
      stopLossPrice: 24192,
      targetPrice: 24274,
      exitPrice: 24266,
      quantity: 75,
      fees: 110,
      grossPnl: 4350,
      netPnl: 4240,
      realizedRiskReward: calculateRealizedRiskReward(24208, 24192, 24266, 'long') ?? 0,
      followedPlan: true,
    },
    {
      id: 'exec-btc-watch',
      setupId: setups[1].id,
      brokerLabel: 'Manual Entry',
      accountLabel: 'Perp Account',
      instrumentSymbol: 'BTCUSD',
      instrumentType: 'perpetual',
      direction: 'long',
      plannedEntry: 106240,
      actualEntry: 106310,
      stopLossPrice: 105980,
      targetPrice: 107600,
      exitPrice: 106120,
      quantity: 1,
      fees: 18,
      grossPnl: -190,
      netPnl: -208,
      realizedRiskReward: calculateRealizedRiskReward(106310, 105980, 106120, 'long') ?? 0,
      followedPlan: false,
    },
  ];

  const review: PostMarketReview = {
    id: 'review-2026-06-30',
    sessionPlanId: sessionPlan.id,
    executionIds: executions.map((execution) => execution.id),
    disciplineScore: 78,
    biasQuality: 82,
    executionQuality: 74,
    whatWorked: [
      'Top-down 1D and 15m bias gave a clean NIFTY long map.',
      'Correlation with BANKNIFTY prevented forcing a weak first move.',
      'Primary trade respected the planned invalidation and target narrative.',
    ],
    whatFailed: [
      'BTC entry was early relative to 3m confirmation and ignored neutral correlation.',
      'Daily loss limit field was not finalized before the session started.',
    ],
    mindsetNotes: 'Patience stayed strong on the primary setup, but attention drifted during the later US watchlist trade.',
    tomorrowAdjustment: 'Lock the daily loss cap in pre-market and reject secondary trades unless correlation flips to confirming.',
  };

  const performance = {
    totalNetPnl: executions.reduce((sum, execution) => sum + execution.netPnl, 0),
    averageRealizedRiskReward: average(executions.map((execution) => execution.realizedRiskReward)),
    averageProjectedRiskReward: average(setups.map((setup) => setup.projectedRiskReward)),
    setupFollowRate: calculateFollowRate(executions),
    disciplineScore: review.disciplineScore,
    checklistCompletionRate: calculateChecklistCompletionRate(sessionPlan.checklist),
  };

  return {
    playbooks: manualTradingPlaybooks,
    sessionPlan,
    setups,
    executions,
    review,
    performance,
  };
}
