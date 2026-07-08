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
