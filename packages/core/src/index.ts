import type {
  BrokerSummary,
  DailySessionPlan,
  ManualWorkspaceSnapshot,
  PlannedTradeSetup,
  PostMarketReview,
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
