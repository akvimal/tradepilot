export interface Tenant {
  id: string;
  name: string;
  slug: string;
}

export interface BrokerAccount {
  id: string;
  tenantId: string;
  broker: 'dhan' | 'zerodha' | 'angelone' | 'delta';
  label: string;
  mode: 'paper' | 'live';
  status: 'connected' | 'disconnected' | 'error';
}

export type BrokerHealthStatus = 'untested' | 'connected' | 'invalid' | 'error';
export type BrokerOrderRefreshStatus = 'idle' | 'loading' | 'connected' | 'partial' | 'unsupported' | 'error';
export type BrokerAuthMode = 'access_token' | 'oauth_app' | 'api_key_secret';
export type BrokerOrderValidity = 'DAY' | 'IOC';
export type BrokerProductType = 'INTRADAY' | 'MARGIN' | 'CNC' | 'MTF' | 'CO' | 'BO';
export type BrokerOrderStatus =
  | 'pending'
  | 'open'
  | 'partially_traded'
  | 'traded'
  | 'cancelled'
  | 'rejected'
  | 'expired'
  | 'unknown';
export type BrokerOrderSide = 'buy' | 'sell';

export interface BrokerCredentialsBase {
  accessToken?: string;
  accessTokenExpiry?: string;
  apiKey?: string;
  apiSecret?: string;
  clientId?: string;
  clientCode?: string;
  refreshToken?: string;
  feedToken?: string;
  redirectUrl?: string;
  postbackUrl?: string;
  totpSecret?: string;
  pin?: string;
}

export interface DhanBrokerCredentials extends BrokerCredentialsBase {
  clientId?: string;
  accessToken?: string;
  apiKey?: string;
  apiSecret?: string;
  redirectUrl?: string;
  postbackUrl?: string;
  pin?: string;
  totpSecret?: string;
}

export interface ZerodhaBrokerCredentials extends BrokerCredentialsBase {
  apiKey?: string;
  apiSecret?: string;
  redirectUrl?: string;
  accessToken?: string;
}

export interface AngelOneBrokerCredentials extends BrokerCredentialsBase {
  apiKey?: string;
  clientCode?: string;
  accessToken?: string;
  refreshToken?: string;
  feedToken?: string;
  totpSecret?: string;
}

export interface DeltaBrokerCredentials extends BrokerCredentialsBase {
  apiKey?: string;
  apiSecret?: string;
}

export type BrokerCredentials =
  | DhanBrokerCredentials
  | ZerodhaBrokerCredentials
  | AngelOneBrokerCredentials
  | DeltaBrokerCredentials;

export interface BrokerConnectionSettings {
  apiBaseUrl?: string;
  redirectUrl?: string;
  postbackUrl?: string;
  liveFeedEnabled: boolean;
  optionChainEnabled: boolean;
  scripMasterEnabled: boolean;
  staticIpWhitelisted: boolean;
  whitelistedIp?: string;
}

export interface BrokerExecutionDefaults {
  productType: BrokerProductType;
  validity: BrokerOrderValidity;
  exchangeSegment?: string;
}

export interface BrokerOrderRecord {
  broker: BrokerAccount['broker'];
  brokerAccountId: string;
  orderId: string;
  exchangeOrderId?: string;
  status: BrokerOrderStatus;
  side: BrokerOrderSide;
  symbol: string;
  securityId?: string;
  exchangeSegment?: string;
  orderType: string;
  productType?: string;
  validity?: string;
  quantity: number;
  tradedQuantity?: number;
  price?: number;
  averageTradedPrice?: number;
  triggerPrice?: number;
  createdAt?: string;
  updatedAt?: string;
  message?: string;
  raw?: Record<string, unknown>;
}

export interface BrokerOrderSyncState {
  accountId: string;
  broker: BrokerAccount['broker'];
  status: BrokerOrderRefreshStatus;
  message: string;
  lastSyncedAt?: string;
  orderCount: number;
}

export interface BrokerOrderRefreshResponse {
  accountId: string;
  broker: BrokerAccount['broker'];
  status: BrokerOrderRefreshStatus;
  message: string;
  lastSyncedAt: string;
  orderCount: number;
  orders: BrokerOrderRecord[];
}

export interface BrokerAccountSettings {
  id: string;
  broker: BrokerAccount['broker'];
  label: string;
  mode: BrokerAccount['mode'];
  enabled: boolean;
  authMode: BrokerAuthMode;
  credentials: BrokerCredentials;
  connection: BrokerConnectionSettings;
  defaults: BrokerExecutionDefaults;
  notes?: string;
  healthStatus: BrokerHealthStatus;
  lastValidatedAt?: string;
}

export interface BrokerAccountSettingsInput {
  broker: BrokerAccount['broker'];
  label: string;
  mode: BrokerAccount['mode'];
  enabled: boolean;
  authMode: BrokerAuthMode;
  credentials: BrokerCredentials;
  connection: BrokerConnectionSettings;
  defaults: BrokerExecutionDefaults;
  notes?: string;
}

export interface DataProviderSettings {
  id: string;
  provider: BrokerAccount['broker'];
  label: string;
  enabled: boolean;
  authMode: BrokerAuthMode;
  credentials: BrokerCredentials;
  connection: BrokerConnectionSettings;
  exchanges: string[];
  healthStatus: BrokerHealthStatus;
  lastValidatedAt?: string;
  notes?: string;
}

export interface DataProviderSettingsInput {
  provider: BrokerAccount['broker'];
  label: string;
  enabled: boolean;
  authMode: BrokerAuthMode;
  credentials: BrokerCredentials;
  connection: BrokerConnectionSettings;
  exchanges: string[];
  notes?: string;
}

export interface TradingAccountSettings {
  id: string;
  broker: BrokerAccount['broker'];
  label: string;
  ownerLabel: string;
  mode: BrokerAccount['mode'];
  enabled: boolean;
  authMode: BrokerAuthMode;
  credentials: BrokerCredentials;
  defaults: BrokerExecutionDefaults;
  supportedExchanges: string[];
  staticIpWhitelisted: boolean;
  whitelistedIp?: string;
  healthStatus: BrokerHealthStatus;
  lastValidatedAt?: string;
  notes?: string;
}

export interface TradingAccountSettingsInput {
  broker: BrokerAccount['broker'];
  label: string;
  ownerLabel: string;
  mode: BrokerAccount['mode'];
  enabled: boolean;
  authMode: BrokerAuthMode;
  credentials: BrokerCredentials;
  defaults: BrokerExecutionDefaults;
  supportedExchanges: string[];
  staticIpWhitelisted: boolean;
  whitelistedIp?: string;
  notes?: string;
}

export interface ExecutionRouteSettings {
  id: string;
  label: string;
  enabled: boolean;
  instrumentSegments: string[];
  underlyingSymbol?: string;
  instrumentType?: 'index_option' | 'commodity_option' | 'future' | 'spot';
  dataProviderId?: string;
  tradingAccountId: string;
  priority: number;
}

export interface ExecutionRouteSettingsInput {
  label: string;
  enabled: boolean;
  instrumentSegments: string[];
  underlyingSymbol?: string;
  instrumentType?: 'index_option' | 'commodity_option' | 'future' | 'spot';
  dataProviderId?: string;
  tradingAccountId: string;
  priority: number;
}

export type MarketType = 'nse' | 'us' | 'crypto' | 'forex';
export type InstrumentType = 'index_option' | 'stock' | 'future' | 'spot' | 'perpetual' | 'fx_pair';
export type TradeDirection = 'long' | 'short';
export type SetupGrade = 'A' | 'B' | 'C' | 'invalid';
export type CorrelationStatus = 'confirming' | 'neutral' | 'diverging';
export type SessionExpectation = 'trend_day' | 'range_day' | 'event_driven' | 'uncertain';
export type NewsRisk = 'low' | 'medium' | 'high';
export type SentimentBias = 'bullish' | 'bearish' | 'neutral' | 'mixed';

export interface PriceLevel {
  label: string;
  value: number | string;
  timeframe: string;
  note?: string;
}

export interface ChecklistItem {
  label: string;
  completed: boolean;
  note?: string;
}

export interface TimeframeContext {
  timeframe: string;
  bias: SentimentBias;
  structure: string;
  levels: PriceLevel[];
  notes?: string;
}

export interface TradePlan {
  id: string;
  tenantId: string;
  symbol: string;
  setupType: string;
  entryPrice: number;
  stopLossPrice: number;
  targetPrice?: number;
  riskAmount: number;
  capitalAllocated: number;
  notes?: string;
}

export interface TradingPlaybook {
  id: string;
  label: string;
  marketType: MarketType;
  primaryInstruments: string[];
  correlationExamples: string[];
  contextTimeframes: string[];
  confirmationTimeframes: string[];
  executionTimeframe?: string;
  minimumRiskReward: number;
  checklistFocus: string[];
}

export interface DailySessionPlan {
  id: string;
  tradeDate: string;
  playbookId: string;
  primaryInstrument: string;
  correlationInstrument: string;
  globalSentiment: SentimentBias;
  globalTrendNote: string;
  crudeOilBias: SentimentBias;
  crudeOilNote: string;
  newsRisk: NewsRisk;
  newsHeadline: string;
  sessionExpectation: SessionExpectation;
  liquidityDraw: string;
  primaryContext: TimeframeContext[];
  correlationContext: TimeframeContext[];
  checklist: ChecklistItem[];
  readyForTrading: boolean;
}

export interface PlannedTradeSetup {
  id: string;
  sessionPlanId: string;
  playbookId: string;
  primaryInstrument: string;
  correlationInstrument: string;
  instrumentType: InstrumentType;
  direction: TradeDirection;
  setupType: string;
  setupGrade: SetupGrade;
  correlationStatus: CorrelationStatus;
  confirmationNarrative: string;
  executionNarrative: string;
  entryTimeframe: string;
  entryPrice: number;
  stopLossPrice: number;
  targetPrice: number;
  riskAmount: number;
  projectedRiskReward: number;
  invalidation: string;
  targetNarrative: string;
  notes: string;
}

export interface TradeExecution {
  id: string;
  setupId: string;
  brokerLabel: string;
  accountLabel: string;
  instrumentSymbol: string;
  instrumentType: InstrumentType;
  direction: TradeDirection;
  optionType?: 'CE' | 'PE' | 'call' | 'put';
  strike?: string;
  expiry?: string;
  plannedEntry: number;
  actualEntry: number;
  stopLossPrice: number;
  targetPrice: number;
  exitPrice: number;
  quantity: number;
  fees: number;
  grossPnl: number;
  netPnl: number;
  realizedRiskReward: number;
  followedPlan: boolean;
}

export interface PostMarketReview {
  id: string;
  sessionPlanId: string;
  executionIds: string[];
  disciplineScore: number;
  biasQuality: number;
  executionQuality: number;
  whatWorked: string[];
  whatFailed: string[];
  mindsetNotes: string;
  tomorrowAdjustment: string;
}

export interface PerformanceSnapshot {
  totalNetPnl: number;
  averageRealizedRiskReward: number;
  averageProjectedRiskReward: number;
  setupFollowRate: number;
  disciplineScore: number;
  checklistCompletionRate: number;
}

export interface ManualWorkspaceSnapshot {
  playbooks: TradingPlaybook[];
  sessionPlan: DailySessionPlan;
  setups: PlannedTradeSetup[];
  executions: TradeExecution[];
  review: PostMarketReview;
  performance: PerformanceSnapshot;
}

export interface BrokerSummary {
  key: BrokerAccount['broker'];
  label: string;
  capabilities: string[];
}

export interface AppHealth {
  service: 'api' | 'worker' | 'web';
  status: 'ok' | 'degraded';
  timestamp: string;
}

export type QuickOrderOptionSide = 'call' | 'put';
export type QuickOrderStrikePreference = 'itm' | 'atm' | 'otm';
export type QuickOrderEntryType = 'market' | 'limit';
export type QuickOrderStopType = 'stop_loss' | 'stop_loss_market';
export type QuickOrderExpiryPreference = 'nearest' | 'next';
export type QuickOrderProductType = 'INTRADAY' | 'MARGIN' | 'CNC';
export type QuickOrderPriceSource = 'snapshot' | 'live_feed';

export interface BrokerInstrumentMasterRecord {
  broker: BrokerAccount['broker'];
  securityId: string;
  exchangeSegment: string;
  tradingSymbol: string;
  displayName: string;
  instrumentType: 'spot' | 'future' | 'option';
  underlyingSymbol: string;
  lotSize: number;
  tickSize?: number;
  expiry?: string;
  strikePrice?: number;
  optionType?: 'CE' | 'PE';
}

export interface BrokerOptionQuote {
  securityId: string;
  exchangeSegment: string;
  tradingSymbol: string;
  optionType: 'CE' | 'PE';
  strikePrice: number;
  expiry: string;
  lastPrice: number;
  topBidPrice?: number;
  topAskPrice?: number;
  volume?: number;
  openInterest?: number;
  delta?: number;
}

export interface BrokerOptionChainSnapshot {
  broker: BrokerAccount['broker'];
  underlyingSymbol: string;
  exchangeSegment: string;
  expiry: string;
  underlyingLastPrice: number;
  priceSource: QuickOrderPriceSource;
  quotes: BrokerOptionQuote[];
}

export interface QuickOrderPreviewRequest {
  broker: BrokerAccount['broker'];
  underlyingSymbol: string;
  optionSide: QuickOrderOptionSide;
  strikePreference: QuickOrderStrikePreference;
  expiryPreference: QuickOrderExpiryPreference;
  capital: number;
  riskPercent: number;
  underlyingEntryPrice?: number;
  underlyingStopLossPrice?: number;
  underlyingTargetPrice?: number;
  entryOrderType: QuickOrderEntryType;
  entryLimitPrice?: number;
  exitOrderType: QuickOrderEntryType;
  exitLimitPrice?: number;
  stopOrderType: QuickOrderStopType;
  stopLimitPrice?: number;
  targetLimitPrice?: number;
  targetRiskReward?: number;
  productType: QuickOrderProductType;
}

export interface QuickOrderResolvedContract {
  broker: BrokerAccount['broker'];
  securityId: string;
  exchangeSegment: string;
  tradingSymbol: string;
  underlyingSymbol: string;
  optionType: 'CE' | 'PE';
  expiry: string;
  strikePrice: number;
  lotSize: number;
  tickSize?: number;
  underlyingLastPrice: number;
  optionLastPrice: number;
  topBidPrice?: number;
  topAskPrice?: number;
  spread?: number;
  volume?: number;
  openInterest?: number;
  delta?: number;
}

export interface QuickOrderRiskSummary {
  riskBudget: number;
  premiumRiskPerUnit: number;
  premiumStopLossPrice: number;
  premiumStopLossLimitPrice: number;
  premiumTargetPrice: number;
  premiumFiveRTargetPrice: number;
  lots: number;
  quantity: number;
  canTrade: boolean;
  riskBlockReason?: string;
  capitalRequired: number;
  capitalBlockReason?: string;
  totalRisk: number;
  expectedReward: number;
  expectedRiskReward: number | null;
}

export interface QuickOrderPreparedOrder {
  step: 'entry' | 'stop_loss' | 'take_profit';
  side: 'buy' | 'sell';
  orderType: 'market' | 'limit' | 'stop' | 'stop_market';
  quantity: number;
  price?: number;
  triggerPrice?: number;
  productType: QuickOrderProductType;
}

export interface QuickOrderFeedSubscription {
  mode: 'ticker' | 'quote' | 'full';
  instruments: Array<{
    exchangeSegment: string;
    securityId: string;
  }>;
}

export interface QuickOrderPreviewResponse {
  request: QuickOrderPreviewRequest;
  contract: QuickOrderResolvedContract;
  risk: QuickOrderRiskSummary;
  orders: QuickOrderPreparedOrder[];
  feedSubscription: QuickOrderFeedSubscription;
}

export interface QuickOrderLookupResponse {
  broker: BrokerAccount['broker'];
  underlyings: Array<{
    symbol: string;
    displayName: string;
    exchangeSegment: string;
    lotSize: number;
    supportedStrikePreferences: QuickOrderStrikePreference[];
  }>;
}

export interface QuickOrderPlacementRequest {
  preview: QuickOrderPreviewResponse;
  tradingAccount: TradingAccountSettings;
}

export interface QuickOrderPlacementResponse {
  accountId: string;
  broker: BrokerAccount['broker'];
  status: 'placed' | 'rejected' | 'unsupported';
  message: string;
  placedAt: string;
  order?: BrokerOrderRecord;
}
