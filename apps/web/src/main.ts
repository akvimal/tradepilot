import './styles.css';

import { appConfig } from '../../../packages/config/src';
import type {
  BrokerAuthMode,
  DataProviderSettings,
  ExecutionRouteSettings,
  BrokerOrderRecord,
  BrokerOrderRefreshResponse,
  BrokerOrderSyncState,
  BrokerOrderValidity,
  BrokerProductType,
  QuickOrderPreviewRequest,
  QuickOrderPreviewResponse,
  QuickOrderPlacementResponse,
  TradingAccountSettings,
  TradeDirection,
} from '../../../packages/types/src';

const STORAGE_KEY = 'tradepilot.daily-planner.v2';
const appElement = document.querySelector<HTMLDivElement>('#app');

if (!appElement) {
  throw new Error('App root was not found');
}

const app = appElement;

type AppPage = 'execution' | 'trades' | 'calendar' | 'settings';
type SetupBias = 'bullish' | 'bearish';
type OptionType = 'CE' | 'PE';
type OrderType = 'market' | 'limit';
type StopMode = 'underlying' | 'manual';
type StrikePreference = 'itm' | 'atm' | 'otm';
type UnderlyingCatalogFilter = 'IDX' | 'COMM';

interface InstrumentConfig {
  id: string;
  name: string;
  lotSize: number;
  strikeStep: number;
  enabled: boolean;
}

interface PlannerSettings {
  capital: number;
  riskPercent: number;
  openingBalance: number;
  instruments: InstrumentConfig[];
}

interface TradeRecord {
  id: string;
  tradeDate: string;
  tradeTime: string;
  instrumentId: string;
  description: string;
  direction: TradeDirection;
  entry: number;
  stopLoss: number;
  exit: number | null;
  remarks: string;
  underlyingSymbol?: string;
  optionStrike?: number;
  optionExpiry?: string;
  optionType?: OptionType;
  broker?: string;
  brokerAccountLabel?: string;
  brokerOrderId?: string;
}

interface ExecutionSetup {
  instrumentId: string;
  bias: SetupBias;
  strikePreference: StrikePreference;
  spotPrice: number;
  useUnderlyingLevels: boolean;
  entryPrice: number;
  stopLossPrice: number;
  targetPrice: number;
  expiryLabel: string;
  stopMode: StopMode;
  manualOptionStop: number;
  entryOrderType: OrderType;
  entryLimitPrice: number;
  entryLimitManual: boolean;
  exitOrderType: OrderType;
  exitLimitPrice: number;
  exitLimitManual: boolean;
  stopLimitPrice: number;
  stopLimitManual: boolean;
  useTargetOrder: boolean;
  targetRr: number;
  notes: string;
}

interface ExecutionState {
  setup: ExecutionSetup;
  preview: QuickOrderPreviewResponse | null;
  loading: boolean;
  error: string;
  resolvedRouteId: string;
  resolvedDataProviderId: string;
  resolvedTradingAccountId: string;
  lastPreviewAt?: string;
}

interface ExecutionCardState extends ExecutionState {}

interface PlannerStore {
  activePage: AppPage;
  selectedDate: string;
  settings: PlannerSettings;
  dataProviders: DataProviderSettings[];
  tradingAccounts: TradingAccountSettings[];
  executionRoutes: ExecutionRouteSettings[];
  trades: TradeRecord[];
  brokerOrders: Record<string, BrokerOrderRecord[]>;
  brokerOrderSyncs: Record<string, BrokerOrderSyncState>;
  execution: ExecutionState;
  executionCards: Record<string, ExecutionCardState>;
}

interface TradeMetrics {
  lotSize: number;
  lots: number;
  value: number;
  risk: number;
  pnl: number | null;
  rr: number | null;
}

interface OptionCandidate {
  id: string;
  profile: StrikePreference;
  optionType: OptionType;
  strike: number;
  symbol: string;
  premiumEntry: number;
  premiumStop: number;
  premiumTarget: number;
  bid: number;
  ask: number;
  spread: number;
  delta: number;
  lots: number;
  totalQuantity: number;
  totalRisk: number;
  capitalRequired: number;
  expectedPnl: number;
  expectedRr: number | null;
  liquidityScore: number;
}

interface ExecutionRouteResolution {
  route: ExecutionRouteSettings;
  dataProvider: DataProviderSettings | null;
  tradingAccount: TradingAccountSettings | null;
  instrumentSegment: string;
  instrumentType: ExecutionRouteSettings['instrumentType'];
  underlyingSymbol: string;
}

const strikePreferenceLabels: Record<StrikePreference, string> = {
  itm: 'ITM',
  atm: 'ATM',
  otm: 'OTM',
};

let editingTradeId: string | null = null;
let lastRenderedPage: AppPage | null = null;
let underlyingCatalog: Array<{
  symbol: string;
  displayName: string;
  exchangeSegment: string;
  lotSize: number;
  strikeStep: number;
  category: UnderlyingCatalogFilter;
}> = [];
let underlyingCatalogFilter: UnderlyingCatalogFilter = 'IDX';

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function roundToTick(value: number, tick = 0.05) {
  return Number((Math.round(value / tick) * tick).toFixed(2));
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getTodayDate() {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function getCurrentTime() {
  const now = new Date();
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function getApiBaseUrl() {
  const isLocalViteDevServer =
    window.location.hostname === 'localhost' &&
    window.location.port !== '' &&
    window.location.port !== String(appConfig.api.port);

  if (isLocalViteDevServer) {
    return `http://localhost:${appConfig.api.port}`;
  }

  return `${window.location.origin}/api`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatNumber(value: number) {
  return value.toLocaleString('en-IN', {
    maximumFractionDigits: 2,
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
  });
}

function formatCurrency(value: number | null) {
  if (value === null) {
    return '-';
  }

  return `Rs ${formatNumber(value)}`;
}

function formatRatio(value: number | null) {
  if (value === null) {
    return '-';
  }

  return `${formatNumber(value)}R`;
}

function formatDayMonth(value: string) {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString('en-US', {
    day: '2-digit',
    month: 'short',
  });
}

function formatTimeValue(value?: string) {
  if (!value) {
    return '-';
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime()) && value.includes('T')) {
    return parsed.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  return value;
}

function normalizeSymbolValue(value: string | undefined) {
  return (value ?? '').trim().toUpperCase();
}

function normalizeInstrumentSymbol(value: string | undefined) {
  const normalized = normalizeSymbolValue(value);

  if (normalized === 'GOLDM') {
    return 'GOLD';
  }

  if (normalized === 'CRUDEOILM') {
    return 'CRUDEOIL';
  }

  return normalized;
}

function instrumentSymbolAliases(value: string | undefined) {
  const normalized = normalizeInstrumentSymbol(value);

  if (normalized === 'GOLD') {
    return ['GOLD', 'GOLDM'];
  }

  if (normalized === 'CRUDEOIL') {
    return ['CRUDEOIL', 'CRUDEOILM'];
  }

  return [normalized];
}

function getCanonicalInstrumentDefaults(symbol: string) {
  const normalized = normalizeInstrumentSymbol(symbol);

  if (normalized === 'SENSEX') {
    return { lotSize: 20, strikeStep: 100 };
  }

  if (normalized === 'GOLD') {
    return { lotSize: 10, strikeStep: 50 };
  }

  if (normalized === 'CRUDEOIL') {
    return { lotSize: 100, strikeStep: 10 };
  }

  return null;
}

function matchesUnderlyingForOrder(orderSymbol: string, underlyingSymbol: string) {
  const normalizedOrder = normalizeSymbolValue(orderSymbol);
  const normalizedUnderlying = normalizeSymbolValue(underlyingSymbol);

  if (!normalizedOrder || !normalizedUnderlying) {
    return false;
  }

  if (normalizedOrder === normalizedUnderlying) {
    return true;
  }

  if (normalizedOrder.startsWith(normalizedUnderlying) || normalizedUnderlying.startsWith(normalizedOrder)) {
    return true;
  }

  if (normalizedUnderlying === 'GOLD' && normalizedOrder.includes('GOLD')) {
    return true;
  }

  if (normalizedUnderlying === 'CRUDEOIL' && normalizedOrder.includes('CRUDE')) {
    return true;
  }

  return false;
}

function getDefaultStrikeStep(name: string) {
  const normalized = name.toUpperCase();

  if (normalized.includes('BANKNIFTY') || normalized.includes('SENSEX')) {
    return 100;
  }

  if (normalized.includes('NIFTY')) {
    return 50;
  }

  if (normalized.includes('GOLD')) {
    return 50;
  }

  if (normalized.includes('CRUDE')) {
    return 20;
  }

  return 50;
}

function getUnderlyingCatalogCategory(exchangeSegment: string) {
  return (exchangeSegment.toUpperCase().includes('MCX') ? 'COMM' : 'IDX') as UnderlyingCatalogFilter;
}

function getFilteredUnderlyingCatalog() {
  return underlyingCatalog.filter((item) => item.category === underlyingCatalogFilter);
}

function defaultInstruments(): InstrumentConfig[] {
  return [
    {
      id: createId('instrument'),
      name: 'NIFTY',
      lotSize: 65,
      strikeStep: 50,
      enabled: true,
    },
    {
      id: createId('instrument'),
      name: 'SENSEX',
      lotSize: getCanonicalInstrumentDefaults('SENSEX')?.lotSize ?? 20,
      strikeStep: 100,
      enabled: true,
    },
    {
      id: createId('instrument'),
      name: 'BANKNIFTY',
      lotSize: 30,
      strikeStep: 100,
      enabled: true,
    },
    {
      id: createId('instrument'),
      name: 'MIDCPNIFTY',
      lotSize: 120,
      strikeStep: 25,
      enabled: true,
    },
    {
      id: createId('instrument'),
      name: 'GOLD',
      lotSize: getCanonicalInstrumentDefaults('GOLD')?.lotSize ?? 10,
      strikeStep: 50,
      enabled: true,
    },
    {
      id: createId('instrument'),
      name: 'CRUDEOIL',
      lotSize: getCanonicalInstrumentDefaults('CRUDEOIL')?.lotSize ?? 100,
      strikeStep: 10,
      enabled: true,
    },
  ];
}

function defaultExecutionSetup(instrumentId: string): ExecutionSetup {
  return {
    instrumentId,
    bias: 'bullish',
    strikePreference: 'atm',
    spotPrice: 0,
    useUnderlyingLevels: false,
    entryPrice: 0,
    stopLossPrice: 0,
    targetPrice: 0,
    expiryLabel: '',
    stopMode: 'underlying',
    manualOptionStop: 0,
    entryOrderType: 'limit',
    entryLimitPrice: 0,
    entryLimitManual: false,
    exitOrderType: 'limit',
    exitLimitPrice: 0,
    exitLimitManual: false,
    stopLimitPrice: 0,
    stopLimitManual: false,
    useTargetOrder: false,
    targetRr: 5,
    notes: '',
  };
}

function buildDefaultExecutionCard(instrumentId: string): ExecutionCardState {
  return {
    setup: defaultExecutionSetup(instrumentId),
    preview: null,
    loading: false,
    error: '',
    resolvedRouteId: '',
    resolvedDataProviderId: '',
    resolvedTradingAccountId: '',
  };
}

function getExecutionCardState(instrumentId: string): ExecutionCardState {
  if (!store.executionCards[instrumentId]) {
    store.executionCards = {
      ...store.executionCards,
      [instrumentId]: buildDefaultExecutionCard(instrumentId),
    };
  }

  return store.executionCards[instrumentId];
}

function updateExecutionCardSetup(instrumentId: string, patch: Partial<ExecutionSetup>) {
  const card = getExecutionCardState(instrumentId);
  card.setup = {
    ...card.setup,
    ...patch,
    instrumentId,
  };
  store.executionCards = {
    ...store.executionCards,
    [instrumentId]: card,
  };
  store.execution.setup = card.setup;
}

function getBrokerAuthFieldConfig(account: { broker?: 'dhan' | 'zerodha' | 'angelone' | 'delta'; provider?: 'dhan' | 'zerodha' | 'angelone' | 'delta'; authMode: BrokerAuthMode }) {
  const authFields: Array<{ key: string; label: string }> = [];
  const broker = account.broker ?? account.provider;

  if (broker === 'dhan') {
    authFields.push({ key: 'clientId', label: 'Dhan Client ID' });

    if (account.authMode === 'access_token') {
      authFields.push({ key: 'accessToken', label: 'Access Token' });
      authFields.push({ key: 'pin', label: 'PIN' });
      authFields.push({ key: 'totpSecret', label: 'TOTP Secret' });
    }

    if (account.authMode === 'oauth_app') {
      authFields.push({ key: 'apiKey', label: 'API Key' });
      authFields.push({ key: 'apiSecret', label: 'API Secret' });
      authFields.push({ key: 'redirectUrl', label: 'Redirect URL' });
    }
  }

  if (broker === 'zerodha') {
    authFields.push({ key: 'apiKey', label: 'API Key' });
    authFields.push({ key: 'apiSecret', label: 'API Secret' });
    authFields.push({ key: 'redirectUrl', label: 'Redirect URL' });

    if (account.authMode === 'access_token') {
      authFields.push({ key: 'accessToken', label: 'Access Token' });
    }
  }

  if (broker === 'angelone') {
    authFields.push({ key: 'apiKey', label: 'API Key' });
    authFields.push({ key: 'clientCode', label: 'Client Code' });

    if (account.authMode === 'access_token') {
      authFields.push({ key: 'accessToken', label: 'Access Token' });
      authFields.push({ key: 'refreshToken', label: 'Refresh Token' });
      authFields.push({ key: 'feedToken', label: 'Feed Token' });
      authFields.push({ key: 'totpSecret', label: 'TOTP Secret' });
    }
  }

  if (broker === 'delta') {
    authFields.push({ key: 'apiKey', label: 'API Key' });
    authFields.push({ key: 'apiSecret', label: 'API Secret' });
  }

  return authFields;
}

function getCredentialValue(credentials: Record<string, string | undefined>, key: string) {
  return String(credentials[key] ?? '');
}

function createDefaultDataProvider(provider: DataProviderSettings['provider'] = 'dhan'): DataProviderSettings {
  const authMode: BrokerAuthMode = provider === 'dhan' ? 'access_token' : provider === 'delta' ? 'api_key_secret' : 'oauth_app';

  return {
    id: createId('data'),
    provider,
    label: provider === 'dhan' ? 'Primary Dhan Feed' : `${provider.toUpperCase()} Data`,
    enabled: true,
    authMode,
    credentials:
      provider === 'dhan'
        ? { clientId: '', accessToken: '', apiKey: '', apiSecret: '', redirectUrl: '', postbackUrl: '' }
        : provider === 'zerodha'
          ? { apiKey: '', apiSecret: '', redirectUrl: '', accessToken: '' }
          : provider === 'angelone'
            ? { apiKey: '', clientCode: '', accessToken: '', refreshToken: '', feedToken: '', totpSecret: '' }
            : { apiKey: '', apiSecret: '' },
    connection: {
      apiBaseUrl: '',
      redirectUrl: '',
      postbackUrl: '',
      liveFeedEnabled: provider === 'dhan',
      optionChainEnabled: provider === 'dhan' || provider === 'delta',
      scripMasterEnabled: provider === 'dhan',
      staticIpWhitelisted: false,
      whitelistedIp: '',
    },
    exchanges: provider === 'dhan' ? ['NSE_FNO', 'MCX'] : ['NSE_FNO'],
    notes: '',
    healthStatus: 'untested',
  };
}

function createDefaultTradingAccount(broker: TradingAccountSettings['broker'] = 'dhan'): TradingAccountSettings {
  const authMode: BrokerAuthMode = broker === 'dhan' ? 'access_token' : broker === 'delta' ? 'api_key_secret' : 'oauth_app';
  const productType: BrokerProductType = 'INTRADAY';
  const validity: BrokerOrderValidity = 'DAY';

  return {
    id: createId('trading'),
    broker,
    label: broker === 'dhan' ? 'Primary Dhan Trading' : `${broker.toUpperCase()} Trading`,
    ownerLabel: 'Primary',
    mode: 'paper',
    enabled: true,
    authMode,
    credentials:
      broker === 'dhan'
        ? { clientId: '', accessToken: '', apiKey: '', apiSecret: '' }
        : broker === 'zerodha'
          ? { apiKey: '', apiSecret: '', redirectUrl: '', accessToken: '' }
          : broker === 'angelone'
            ? { apiKey: '', clientCode: '', accessToken: '', refreshToken: '', feedToken: '', totpSecret: '' }
            : { apiKey: '', apiSecret: '' },
    defaults: { productType, validity, exchangeSegment: '' },
    supportedExchanges: broker === 'dhan' ? ['NSE_FNO'] : ['NSE_FNO'],
    staticIpWhitelisted: false,
    whitelistedIp: '',
    notes: '',
    healthStatus: 'untested',
  };
}

function createDefaultExecutionRoute(
  tradingAccountId = '',
  dataProviderId = '',
): ExecutionRouteSettings {
  return {
    id: createId('route'),
    label: 'NSE F&O default route',
    enabled: true,
    instrumentSegments: ['NSE_FNO'],
    underlyingSymbol: '',
    instrumentType: 'index_option',
    tradingAccountId,
    dataProviderId,
    priority: 1,
  };
}

function defaultStore(): PlannerStore {
  const instruments = defaultInstruments();

  return {
    activePage: 'execution',
    selectedDate: getTodayDate(),
    settings: {
      capital: 100000,
      riskPercent: 1,
      openingBalance: 100000,
      instruments,
    },
    dataProviders: [createDefaultDataProvider('dhan')],
    tradingAccounts: [createDefaultTradingAccount('dhan')],
    executionRoutes: [],
    trades: [],
    brokerOrders: {},
    brokerOrderSyncs: {},
    execution: {
      setup: defaultExecutionSetup(instruments[0].id),
      preview: null,
      loading: false,
      error: '',
      resolvedRouteId: '',
      resolvedDataProviderId: '',
      resolvedTradingAccountId: '',
    },
    executionCards: {},
  };
}

function normalizeRouteSegments(value: unknown): string[] {
  const allowedSegments = new Set(['NSE_FNO', 'BSE_FNO', 'MCX']);

  if (Array.isArray(value)) {
    return [...new Set(value.map((segment) => String(segment).trim().toUpperCase()).filter((segment) => allowedSegments.has(segment)))];
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toUpperCase();
    return allowedSegments.has(normalized) ? [normalized] : [];
  }

  return [];
}

function isInstrumentConfig(value: unknown): value is InstrumentConfig {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const item = value as Partial<InstrumentConfig>;
  return (
    typeof item.id === 'string' &&
    typeof item.name === 'string' &&
    typeof item.lotSize === 'number' &&
    typeof item.strikeStep === 'number'
  );
}

function hydrateStore(): PlannerStore {
  const fallback = defaultStore();
  const raw = window.localStorage.getItem(STORAGE_KEY);

  if (!raw) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PlannerStore>;
    const instruments = Array.isArray(parsed.settings?.instruments)
      ? parsed.settings.instruments.filter(isInstrumentConfig).map((instrument) => {
          const canonicalDefaults = getCanonicalInstrumentDefaults(instrument.name);

          return canonicalDefaults
            ? {
                ...instrument,
                lotSize: canonicalDefaults.lotSize,
                strikeStep: canonicalDefaults.strikeStep,
              }
            : instrument;
        })
      : fallback.settings.instruments;
    const trades = Array.isArray(parsed.trades) ? parsed.trades : [];
    const dataProviders = Array.isArray((parsed as { dataProviders?: unknown[] }).dataProviders)
      ? (parsed as { dataProviders: unknown[] }).dataProviders.filter(
          (item): item is DataProviderSettings => Boolean(item && typeof item === 'object' && typeof (item as DataProviderSettings).id === 'string'),
        )
      : fallback.dataProviders;
    const tradingAccounts = Array.isArray((parsed as { tradingAccounts?: unknown[] }).tradingAccounts)
      ? (parsed as { tradingAccounts: unknown[] }).tradingAccounts.filter(
          (item): item is TradingAccountSettings => Boolean(item && typeof item === 'object' && typeof (item as TradingAccountSettings).id === 'string'),
        )
      : fallback.tradingAccounts;
    const executionRoutes = Array.isArray((parsed as { executionRoutes?: unknown[] }).executionRoutes)
      ? (parsed as { executionRoutes: unknown[] }).executionRoutes
          .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string'))
          .map((item) => {
            const segments = normalizeRouteSegments((item as { instrumentSegments?: unknown; instrumentSegment?: unknown }).instrumentSegments ?? (item as { instrumentSegment?: unknown }).instrumentSegment);

            return {
              id: String(item.id),
              label: String(item.label ?? 'Route'),
              enabled: Boolean(item.enabled ?? true),
              instrumentSegments: segments.length > 0 ? segments : ['NSE_FNO'],
              underlyingSymbol: String(item.underlyingSymbol ?? ''),
              instrumentType:
                item.instrumentType === 'commodity_option' ||
                item.instrumentType === 'future' ||
                item.instrumentType === 'spot'
                  ? item.instrumentType
                  : 'index_option',
              dataProviderId: String(item.dataProviderId ?? ''),
              tradingAccountId: String(item.tradingAccountId ?? ''),
              priority: Number(item.priority ?? 1),
            } satisfies ExecutionRouteSettings;
          })
      : fallback.executionRoutes;
    const instrumentIds = new Set(instruments.map((instrument) => instrument.id));
    const setup = parsed.execution?.setup;
    const setupInstrumentId =
      typeof setup?.instrumentId === 'string' && instrumentIds.has(setup.instrumentId)
        ? setup.instrumentId
        : instruments[0]?.id ?? fallback.execution.setup.instrumentId;

    return {
      activePage:
        parsed.activePage === 'trades' ||
        parsed.activePage === 'calendar' ||
        parsed.activePage === 'settings' ||
        parsed.activePage === 'execution'
          ? parsed.activePage
          : 'execution',
      selectedDate: typeof parsed.selectedDate === 'string' ? parsed.selectedDate : fallback.selectedDate,
      settings: {
        capital: Number(parsed.settings?.capital ?? fallback.settings.capital),
        riskPercent: Number(parsed.settings?.riskPercent ?? fallback.settings.riskPercent),
        openingBalance: Number(parsed.settings?.openingBalance ?? fallback.settings.openingBalance),
        instruments: instruments.length > 0 ? instruments : fallback.settings.instruments,
      },
      dataProviders: dataProviders.length > 0 ? dataProviders : fallback.dataProviders,
      tradingAccounts: tradingAccounts.length > 0 ? tradingAccounts : fallback.tradingAccounts,
      executionRoutes,
      brokerOrders: (parsed as { brokerOrders?: Record<string, BrokerOrderRecord[]> }).brokerOrders ?? fallback.brokerOrders,
      brokerOrderSyncs: (parsed as { brokerOrderSyncs?: Record<string, BrokerOrderSyncState> }).brokerOrderSyncs ?? fallback.brokerOrderSyncs,
      executionCards: (parsed as { executionCards?: Record<string, ExecutionCardState> }).executionCards ?? {},
      trades: trades.map((rawTrade) => {
        const trade = rawTrade as Partial<TradeRecord> & { exit?: number | string | null };
        const rawExit = trade.exit;

        return {
          id: String(trade.id ?? createId('trade')),
          tradeDate: String(trade.tradeDate ?? fallback.selectedDate),
          tradeTime: String(trade.tradeTime ?? '09:15'),
          instrumentId: String(trade.instrumentId ?? fallback.settings.instruments[0].id),
          description: String(trade.description ?? ''),
          direction: trade.direction === 'short' ? 'short' : 'long',
          entry: Number(trade.entry ?? 0),
          stopLoss: Number(trade.stopLoss ?? 0),
          exit: rawExit === null || rawExit === undefined ? null : String(rawExit).trim() === '' ? null : Number(rawExit),
          remarks: String(trade.remarks ?? ''),
          underlyingSymbol: typeof trade.underlyingSymbol === 'string' ? trade.underlyingSymbol : undefined,
          optionStrike: typeof trade.optionStrike === 'number' ? trade.optionStrike : undefined,
          optionExpiry: typeof trade.optionExpiry === 'string' ? trade.optionExpiry : undefined,
          optionType: trade.optionType === 'CE' || trade.optionType === 'PE' ? trade.optionType : undefined,
          broker: typeof trade.broker === 'string' ? trade.broker : undefined,
          brokerAccountLabel: typeof trade.brokerAccountLabel === 'string' ? trade.brokerAccountLabel : undefined,
          brokerOrderId: typeof trade.brokerOrderId === 'string' ? trade.brokerOrderId : undefined,
        };
      }),
      execution: {
        setup: {
          instrumentId: setupInstrumentId,
          bias: setup?.bias === 'bearish' ? 'bearish' : 'bullish',
          strikePreference:
            setup?.strikePreference === 'itm' || setup?.strikePreference === 'otm' ? setup.strikePreference : 'atm',
          spotPrice: Number(setup?.spotPrice ?? fallback.execution.setup.spotPrice),
          useUnderlyingLevels: Boolean(setup?.useUnderlyingLevels ?? fallback.execution.setup.useUnderlyingLevels),
          entryPrice: Number(setup?.entryPrice ?? fallback.execution.setup.entryPrice),
          stopLossPrice: Number(setup?.stopLossPrice ?? fallback.execution.setup.stopLossPrice),
          targetPrice: Number(setup?.targetPrice ?? fallback.execution.setup.targetPrice),
          expiryLabel: String(setup?.expiryLabel ?? fallback.execution.setup.expiryLabel),
          stopMode: setup?.stopMode === 'manual' ? 'manual' : 'underlying',
          manualOptionStop: Number(setup?.manualOptionStop ?? fallback.execution.setup.manualOptionStop),
          entryOrderType: setup?.entryOrderType === 'market' ? 'market' : 'limit',
          entryLimitPrice: Number(setup?.entryLimitPrice ?? fallback.execution.setup.entryLimitPrice),
          entryLimitManual: Boolean(setup?.entryLimitManual ?? fallback.execution.setup.entryLimitManual),
          exitOrderType: setup?.exitOrderType === 'market' ? 'market' : 'limit',
          exitLimitPrice: Number(setup?.exitLimitPrice ?? fallback.execution.setup.exitLimitPrice),
          exitLimitManual: Boolean(setup?.exitLimitManual ?? fallback.execution.setup.exitLimitManual),
          stopLimitPrice: Number(setup?.stopLimitPrice ?? fallback.execution.setup.stopLimitPrice),
          stopLimitManual: Boolean(setup?.stopLimitManual ?? fallback.execution.setup.stopLimitManual),
          useTargetOrder: Boolean(setup?.useTargetOrder ?? fallback.execution.setup.useTargetOrder),
          targetRr: Number(setup?.targetRr ?? fallback.execution.setup.targetRr),
          notes: String(setup?.notes ?? fallback.execution.setup.notes),
        },
        preview: null,
        loading: false,
        error: '',
        resolvedRouteId: '',
        resolvedDataProviderId: '',
        resolvedTradingAccountId: '',
      },
    };
  } catch {
    return fallback;
  }
}

const store = hydrateStore();

function persistStore() {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function getExecutionUnderlyingSymbol(instrument: InstrumentConfig | null) {
  return instrument?.name.trim().toUpperCase() ?? '';
}

function getExecutionInstrumentSegment(underlyingSymbol: string) {
  const family = getCommodityFamily(underlyingSymbol);

  if (family === 'GOLD' || family === 'CRUDEOIL') {
    return 'MCX';
  }

  if (underlyingSymbol === 'SENSEX') {
    return 'BSE_FNO';
  }

  return 'NSE_FNO';
}

function getExecutionInstrumentType(underlyingSymbol: string): ExecutionRouteSettings['instrumentType'] {
  const family = getCommodityFamily(underlyingSymbol);
  return family === 'GOLD' || family === 'CRUDEOIL' ? 'commodity_option' : 'index_option';
}

function getCommodityFamily(symbol: string) {
  const normalized = symbol.trim().toUpperCase();

  if (normalized.startsWith('GOLD')) {
    return 'GOLD';
  }

  if (normalized.startsWith('CRUDE')) {
    return 'CRUDEOIL';
  }

  return normalized;
}

function matchesRouteUnderlying(routeUnderlying: string | undefined, underlyingSymbol: string, instrumentType: ExecutionRouteSettings['instrumentType']) {
  const normalizedRouteUnderlying = routeUnderlying?.trim().toUpperCase();

  if (!normalizedRouteUnderlying) {
    return true;
  }

  if (normalizedRouteUnderlying === underlyingSymbol) {
    return true;
  }

  if ((instrumentType ?? 'index_option') === 'commodity_option') {
    return getCommodityFamily(normalizedRouteUnderlying) === getCommodityFamily(underlyingSymbol);
  }

  return false;
}

function matchesRouteInstrumentType(
  route: ExecutionRouteSettings,
  instrumentType: ExecutionRouteSettings['instrumentType'],
) {
  const routeType = route.instrumentType ?? 'index_option';

  if (routeType === instrumentType) {
    return true;
  }

  if (route.instrumentSegments.length > 1) {
    return (
      (routeType === 'index_option' || routeType === 'commodity_option') &&
      (instrumentType === 'index_option' || instrumentType === 'commodity_option')
    );
  }

  return false;
}

function getQuickOrderProductType(productType: BrokerProductType): QuickOrderPreviewRequest['productType'] {
  if (productType === 'INTRADAY' || productType === 'MARGIN' || productType === 'CNC') {
    return productType;
  }

  return 'INTRADAY';
}

function resolveExecutionRoute(instrument = getExecutionInstrument()): ExecutionRouteResolution | null {
  if (!instrument) {
    return null;
  }

  const underlyingSymbol = getExecutionUnderlyingSymbol(instrument);
  const instrumentSegment = getExecutionInstrumentSegment(underlyingSymbol);
  const instrumentType = getExecutionInstrumentType(underlyingSymbol);
  const candidates = store.executionRoutes
    .filter((route) => route.enabled)
    .filter((route) => route.instrumentSegments.some((segment) => segment.trim().toUpperCase() === instrumentSegment))
    .filter((route) => matchesRouteInstrumentType(route, instrumentType))
    .filter((route) => matchesRouteUnderlying(route.underlyingSymbol, underlyingSymbol, instrumentType))
    .sort((left, right) => {
      const leftExact = left.underlyingSymbol?.trim().toUpperCase() === underlyingSymbol ? 1 : 0;
      const rightExact = right.underlyingSymbol?.trim().toUpperCase() === underlyingSymbol ? 1 : 0;
      const leftFamily = matchesRouteUnderlying(left.underlyingSymbol, underlyingSymbol, instrumentType) ? 1 : 0;
      const rightFamily = matchesRouteUnderlying(right.underlyingSymbol, underlyingSymbol, instrumentType) ? 1 : 0;

      if (leftExact !== rightExact) {
        return rightExact - leftExact;
      }

      if (leftFamily !== rightFamily) {
        return rightFamily - leftFamily;
      }

      return left.priority - right.priority;
    });

  const route = candidates[0];

  if (!route) {
    return null;
  }

  return {
    route,
    dataProvider: store.dataProviders.find((item) => item.id === route.dataProviderId && item.enabled) ?? null,
    tradingAccount: store.tradingAccounts.find((item) => item.id === route.tradingAccountId && item.enabled) ?? null,
    instrumentSegment: route.instrumentSegments.join(', '),
    instrumentType,
    underlyingSymbol,
  };
}

function buildExecutionPreviewRequest(
  resolution: ExecutionRouteResolution,
  setup = store.execution.setup,
): QuickOrderPreviewRequest {
  const entryOrderType = setup.entryOrderType;
  const targetRiskReward = Math.max(1, setup.targetRr || 5);

  return {
    broker: resolution.dataProvider?.provider ?? 'dhan',
    underlyingSymbol: resolution.underlyingSymbol,
    optionSide: setup.bias === 'bearish' ? 'put' : 'call',
    strikePreference: setup.strikePreference,
    expiryPreference: 'nearest',
    capital: store.settings.capital,
    riskPercent: store.settings.riskPercent,
    entryOrderType,
    entryLimitPrice: entryOrderType === 'limit' && setup.entryLimitManual ? setup.entryLimitPrice : undefined,
    exitOrderType: 'limit',
    exitLimitPrice: setup.useTargetOrder && setup.exitLimitManual ? setup.exitLimitPrice : undefined,
    stopOrderType: 'stop_loss',
    stopLimitPrice: setup.stopLimitManual ? setup.stopLimitPrice || undefined : undefined,
    targetLimitPrice: setup.useTargetOrder && setup.exitLimitManual ? setup.exitLimitPrice || undefined : undefined,
    targetRiskReward: setup.useTargetOrder && !setup.exitLimitManual ? targetRiskReward : undefined,
    productType: getQuickOrderProductType(resolution.tradingAccount?.defaults.productType ?? 'INTRADAY'),
  };
}

function syncExecutionTicketDraftFromForm(ticketForm: HTMLFormElement) {
  const entryOrderType = ticketForm.querySelector<HTMLInputElement>('input[name="entryLimitEnabled"]')?.checked === false ? 'market' : 'limit';
  const useTargetOrder = ticketForm.querySelector<HTMLInputElement>('input[name="useTargetOrder"]')?.checked === true;
  const entryLimitInputValue = Number(ticketForm.querySelector<HTMLInputElement>('input[name="entryLimitPrice"]')?.value ?? store.execution.setup.entryLimitPrice);
  const exitLimitInputValue = Number(ticketForm.querySelector<HTMLInputElement>('input[name="exitLimitPrice"]')?.value ?? store.execution.setup.exitLimitPrice);
  const stopLimitInputValue = Number(ticketForm.querySelector<HTMLInputElement>('input[name="stopLimitPrice"]')?.value ?? store.execution.setup.stopLimitPrice);
  const targetRrInputValue = Number(ticketForm.querySelector<HTMLInputElement>('input[name="targetRr"]')?.value ?? store.execution.setup.targetRr);

  store.execution.setup = {
    ...store.execution.setup,
    entryOrderType,
    entryLimitPrice: Number.isFinite(entryLimitInputValue) ? entryLimitInputValue : store.execution.setup.entryLimitPrice,
    entryLimitManual: store.execution.setup.entryLimitManual || (entryOrderType === 'limit' && Number.isFinite(entryLimitInputValue)),
    exitLimitPrice: Number.isFinite(exitLimitInputValue) ? exitLimitInputValue : store.execution.setup.exitLimitPrice,
    exitLimitManual: store.execution.setup.exitLimitManual || (useTargetOrder && Number.isFinite(exitLimitInputValue)),
    stopLimitPrice: Number.isFinite(stopLimitInputValue) ? stopLimitInputValue : store.execution.setup.stopLimitPrice,
    stopLimitManual: store.execution.setup.stopLimitManual,
    useTargetOrder,
    targetRr: Number.isFinite(targetRrInputValue) && targetRrInputValue > 0 ? targetRrInputValue : store.execution.setup.targetRr,
  };
}

function syncExecutionCardDraftFromForm(cardForm: HTMLFormElement) {
  const instrumentId = cardForm.dataset.instrumentId;
  const cardPanel = cardForm.closest<HTMLElement>('[data-instrument-card]');

  if (!instrumentId) {
    return;
  }

  const entryEnabled = cardForm.querySelector<HTMLInputElement>('input[name="entryLimitEnabled"]')?.checked ?? true;
  const useTargetOrder = cardForm.querySelector<HTMLInputElement>('input[name="useTargetOrder"]')?.checked ?? false;
  const biasValue = cardPanel?.querySelector<HTMLSelectElement>('select[name="bias"]')?.value === 'bearish' ? 'bearish' : 'bullish';
  const strikePreferenceValue =
    cardPanel?.querySelector<HTMLSelectElement>('select[name="strikePreference"]')?.value === 'itm'
      ? 'itm'
      : cardPanel?.querySelector<HTMLSelectElement>('select[name="strikePreference"]')?.value === 'otm'
        ? 'otm'
        : 'atm';
  const targetRrInputValue = Number(cardForm.querySelector<HTMLInputElement>('input[name="targetRr"]')?.value ?? getExecutionCardState(instrumentId).setup.targetRr);
  const entryLimitInputValue = Number(cardForm.querySelector<HTMLInputElement>('input[name="entryLimitPrice"]')?.value ?? getExecutionCardState(instrumentId).setup.entryLimitPrice);
  const exitLimitInputValue = Number(cardForm.querySelector<HTMLInputElement>('input[name="exitLimitPrice"]')?.value ?? getExecutionCardState(instrumentId).setup.exitLimitPrice);
  const stopLimitInputValue = Number(cardForm.querySelector<HTMLInputElement>('input[name="stopLimitPrice"]')?.value ?? getExecutionCardState(instrumentId).setup.stopLimitPrice);

  updateExecutionCardSetup(instrumentId, {
    bias: biasValue,
    strikePreference: strikePreferenceValue,
    entryOrderType: entryEnabled ? 'limit' : 'market',
    entryLimitPrice: Number.isFinite(entryLimitInputValue) ? entryLimitInputValue : getExecutionCardState(instrumentId).setup.entryLimitPrice,
    entryLimitManual: getExecutionCardState(instrumentId).setup.entryLimitManual || (entryEnabled && Number.isFinite(entryLimitInputValue)),
    exitLimitPrice: Number.isFinite(exitLimitInputValue) ? exitLimitInputValue : getExecutionCardState(instrumentId).setup.exitLimitPrice,
    exitLimitManual: getExecutionCardState(instrumentId).setup.exitLimitManual || (useTargetOrder && Number.isFinite(exitLimitInputValue)),
    stopLimitPrice: Number.isFinite(stopLimitInputValue) ? stopLimitInputValue : getExecutionCardState(instrumentId).setup.stopLimitPrice,
    stopLimitManual: getExecutionCardState(instrumentId).setup.stopLimitManual,
    useTargetOrder,
    targetRr: Number.isFinite(targetRrInputValue) && targetRrInputValue > 0 ? targetRrInputValue : getExecutionCardState(instrumentId).setup.targetRr,
  });
}

async function refreshExecutionPreview(instrumentId: string = store.execution.setup.instrumentId) {
  const instrument = getInstrumentById(instrumentId) ?? getExecutionInstrument();
  const resolution = resolveExecutionRoute(instrument);
  const card = getExecutionCardState(instrument.id);
  card.loading = true;
  card.error = '';
  store.execution.setup = card.setup;
  store.execution.loading = true;
  store.execution.error = '';
  if (!instrument) {
    card.preview = null;
    card.error = 'No underlying instrument is available.';
    card.loading = false;
    store.execution.loading = false;
    persistStore();
    render();
    return;
  }

  if (!resolution) {
    card.preview = null;
    card.error = `No enabled execution route matches ${instrument.name}.`;
    card.loading = false;
    store.execution.loading = false;
    persistStore();
    render();
    return;
  }

  if (!resolution.dataProvider) {
    card.preview = null;
    card.error = `Route "${resolution.route.label}" has no enabled data provider.`;
    card.loading = false;
    store.execution.loading = false;
    persistStore();
    render();
    return;
  }

  if (!resolution.tradingAccount) {
    card.preview = null;
    card.error = `Route "${resolution.route.label}" has no enabled trading account.`;
    card.loading = false;
    store.execution.loading = false;
    persistStore();
    render();
    return;
  }

  card.resolvedRouteId = resolution.route.id;
  card.resolvedDataProviderId = resolution.dataProvider.id;
  card.resolvedTradingAccountId = resolution.tradingAccount.id;
  render();

  try {
    const currentSetup = card.setup;
    const response = await fetch(`${getApiBaseUrl()}/execution/preview`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        request: buildExecutionPreviewRequest(resolution, currentSetup),
        dataProvider: resolution.dataProvider,
        tradingAccount: resolution.tradingAccount,
      }),
    });
    const payload = (await response.json()) as {
      preview?: QuickOrderPreviewResponse;
      message?: string;
    };

    if (!response.ok || !payload.preview) {
      throw new Error(payload.message ?? 'Unable to load execution preview.');
    }

    card.preview = payload.preview;
    card.setup.spotPrice = payload.preview.contract.underlyingLastPrice;
    card.setup.expiryLabel = formatDayMonth(payload.preview.contract.expiry);
    card.setup.entryLimitPrice =
      currentSetup.entryOrderType === 'market'
        ? payload.preview.contract.topAskPrice ?? payload.preview.contract.optionLastPrice
        : currentSetup.entryLimitManual && currentSetup.entryLimitPrice > 0
          ? currentSetup.entryLimitPrice
          : payload.preview.contract.optionLastPrice ?? payload.preview.contract.topAskPrice ?? payload.preview.contract.optionLastPrice;
    if (currentSetup.useTargetOrder) {
      card.setup.exitLimitPrice =
        currentSetup.exitLimitManual && currentSetup.exitLimitPrice > 0
          ? currentSetup.exitLimitPrice
          : Number(
              (
                (currentSetup.entryOrderType === 'market'
                  ? payload.preview.contract.topAskPrice ?? payload.preview.contract.optionLastPrice
                  : currentSetup.entryLimitPrice > 0
                    ? currentSetup.entryLimitPrice
                    : payload.preview.contract.optionLastPrice ?? payload.preview.contract.topAskPrice ?? payload.preview.contract.optionLastPrice) +
                payload.preview.risk.premiumRiskPerUnit * Math.max(1, currentSetup.targetRr || 5)
              ).toFixed(2),
            );
    }
    if (!currentSetup.stopLimitManual) {
      card.setup.stopLimitPrice = payload.preview.risk.premiumStopLossPrice;
    }
    card.error = '';
    card.lastPreviewAt = new Date().toISOString();
    store.execution = {
      ...store.execution,
      setup: card.setup,
      preview: card.preview,
      loading: false,
      error: '',
      resolvedRouteId: card.resolvedRouteId,
      resolvedDataProviderId: card.resolvedDataProviderId,
      resolvedTradingAccountId: card.resolvedTradingAccountId,
      lastPreviewAt: card.lastPreviewAt,
    };
  } catch (error) {
    card.preview = null;
    card.error = error instanceof Error ? error.message : 'Unable to load execution preview.';
    store.execution = {
      ...store.execution,
      setup: card.setup,
      preview: null,
      loading: false,
      error: card.error,
      resolvedRouteId: card.resolvedRouteId,
      resolvedDataProviderId: card.resolvedDataProviderId,
      resolvedTradingAccountId: card.resolvedTradingAccountId,
    };
  } finally {
    card.loading = false;
    store.execution.loading = false;
    persistStore();
    render();
  }
}

async function refreshAllExecutionCards() {
  const instruments = getActiveInstruments();
  for (const instrument of instruments) {
    await refreshExecutionPreview(instrument.id);
    await sleep(1200);
  }
}

async function testTradingAccountToken(account: TradingAccountSettings) {
  const requestPayload = {
    broker: account.broker,
    label: account.label,
    ownerLabel: account.ownerLabel,
    mode: account.mode,
    enabled: account.enabled,
    authMode: account.authMode,
    credentials: account.credentials,
    defaults: account.defaults,
    supportedExchanges: account.supportedExchanges,
    staticIpWhitelisted: account.staticIpWhitelisted,
    whitelistedIp: account.whitelistedIp,
    notes: account.notes,
  };

  const response = await fetch(`${getApiBaseUrl()}/trading-accounts/test-token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestPayload),
  });
  const responsePayload = (await response.json()) as {
    item?: Pick<TradingAccountSettings, 'healthStatus' | 'lastValidatedAt'>;
    message?: string;
  };

  if (responsePayload.item) {
    store.tradingAccounts = store.tradingAccounts.map((storedAccount) =>
      storedAccount.id === account.id
        ? {
            ...storedAccount,
            healthStatus: responsePayload.item?.healthStatus ?? storedAccount.healthStatus,
            lastValidatedAt: responsePayload.item?.lastValidatedAt ?? storedAccount.lastValidatedAt,
          }
        : storedAccount,
    );
    persistStore();
  }

  if (!response.ok) {
    throw new Error(responsePayload.message ?? 'Token validation failed.');
  }

  return responsePayload.message ?? 'Token is valid.';
}

async function testDataProviderToken(account: DataProviderSettings) {
  const requestPayload = {
    provider: account.provider,
    label: account.label,
    enabled: account.enabled,
    authMode: account.authMode,
    credentials: account.credentials,
    connection: account.connection,
    exchanges: account.exchanges,
    notes: account.notes,
  };

  const response = await fetch(`${getApiBaseUrl()}/data-providers/test-token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestPayload),
  });
  const responsePayload = (await response.json()) as {
    item?: Pick<DataProviderSettings, 'healthStatus' | 'lastValidatedAt'>;
    message?: string;
  };

  if (responsePayload.item) {
    store.dataProviders = store.dataProviders.map((storedAccount) =>
      storedAccount.id === account.id
        ? {
            ...storedAccount,
            healthStatus: responsePayload.item?.healthStatus ?? storedAccount.healthStatus,
            lastValidatedAt: responsePayload.item?.lastValidatedAt ?? storedAccount.lastValidatedAt,
          }
        : storedAccount,
    );
    persistStore();
  }

  if (!response.ok) {
    throw new Error(responsePayload.message ?? 'Token validation failed.');
  }

  return responsePayload.message ?? 'Token is valid.';
}

async function placeExecutionBrokerOrder(instrumentId: string) {
  const card = getExecutionCardState(instrumentId);
  const preview = card.preview;
  const tradingAccount = card.resolvedTradingAccountId
    ? store.tradingAccounts.find((account) => account.id === card.resolvedTradingAccountId && account.enabled) ?? null
    : null;

  if (!preview) {
    throw new Error('Live preview is required before placing an order.');
  }

  if (!tradingAccount) {
    throw new Error('An enabled trading account is required to place an order.');
  }

  const response = await fetch(`${getApiBaseUrl()}/execution/place-order`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      preview,
      tradingAccount,
    }),
  });

  const responsePayload = (await response.json()) as Partial<QuickOrderPlacementResponse>;

  if (!response.ok) {
    throw new Error(responsePayload.message ?? 'Order placement failed.');
  }

  if (responsePayload.order) {
    store.brokerOrders = {
      ...store.brokerOrders,
      [tradingAccount.id]: [
        responsePayload.order,
        ...(store.brokerOrders[tradingAccount.id] ?? []).filter((order) => order.orderId !== responsePayload.order?.orderId),
      ],
    };
  }

  persistStore();
  await refreshAllBrokerOrders();
  store.activePage = 'trades';
  render();

  return responsePayload.message ?? 'Order placed.';
}

async function syncInstrumentLotSizesFromMaster() {
  try {
    const response = await fetch(`${getApiBaseUrl()}/quick-order/underlyings?broker=dhan`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      return;
    }

    const payload = (await response.json()) as {
      underlyings?: Array<{ symbol?: string; lotSize?: number }>;
    };

    const lotSizeBySymbol = new Map(
      (payload.underlyings ?? [])
        .filter((item) => typeof item.symbol === 'string' && typeof item.lotSize === 'number' && Number.isFinite(item.lotSize))
        .flatMap((item) => instrumentSymbolAliases(item.symbol).map((alias) => [alias, Number(item.lotSize)] as const)),
    );

    let changed = false;

    store.settings.instruments = store.settings.instruments.map((instrument) => {
      const lotSize = instrumentSymbolAliases(instrument.name)
        .map((alias) => lotSizeBySymbol.get(alias))
        .find((value): value is number => typeof value === 'number' && value > 0);

      if (!lotSize || lotSize <= 0 || instrument.lotSize === lotSize) {
        return instrument;
      }

      changed = true;
      return {
        ...instrument,
        lotSize,
      };
    });

    if (changed) {
      persistStore();
      render();
    }
  } catch {
    return;
  }
}

async function syncUnderlyingCatalogFromMaster() {
  try {
    const response = await fetch(`${getApiBaseUrl()}/quick-order/underlyings?broker=dhan`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      return;
    }

    const payload = (await response.json()) as {
      underlyings?: Array<{ symbol?: string; displayName?: string; exchangeSegment?: string; lotSize?: number }>;
    };

    underlyingCatalog = (payload.underlyings ?? [])
      .filter((item) => typeof item.symbol === 'string' && typeof item.lotSize === 'number' && Number.isFinite(item.lotSize))
      .map((item) => {
        const symbol = normalizeInstrumentSymbol(String(item.symbol).trim().toUpperCase());
        const exchangeSegment = String(item.exchangeSegment ?? '').trim().toUpperCase();
        return {
          symbol,
          displayName: String(item.displayName ?? symbol).trim() || symbol,
          exchangeSegment,
          lotSize: Number(item.lotSize),
          strikeStep: getDefaultStrikeStep(symbol),
          category: getUnderlyingCatalogCategory(exchangeSegment),
        };
      })
      .sort((left, right) => left.symbol.localeCompare(right.symbol));

    const lotSizeBySymbol = new Map(underlyingCatalog.map((item) => [normalizeInstrumentSymbol(item.symbol), item.lotSize] as const));
    const strikeStepBySymbol = new Map(underlyingCatalog.map((item) => [normalizeInstrumentSymbol(item.symbol), item.strikeStep] as const));
    let changed = false;

    store.settings.instruments = store.settings.instruments.map((instrument) => {
      const symbol = normalizeInstrumentSymbol(instrument.name);
      const lotSize = lotSizeBySymbol.get(symbol);
      const strikeStep = strikeStepBySymbol.get(symbol);

      if ((lotSize === undefined || lotSize <= 0 || instrument.lotSize === lotSize) && (strikeStep === undefined || strikeStep <= 0 || instrument.strikeStep === strikeStep)) {
        return instrument;
      }

      changed = true;
      return {
        ...instrument,
        lotSize: lotSize && lotSize > 0 ? lotSize : instrument.lotSize,
        strikeStep: strikeStep && strikeStep > 0 ? strikeStep : instrument.strikeStep,
      };
    });

    if (underlyingCatalog.length >= 0) {
      persistStore();
      render();
    }
  } catch {
    return;
  }
}

async function refreshBrokerOrdersForAccount(account: TradingAccountSettings) {
  try {
    const response = await fetch(`${getApiBaseUrl()}/broker-orders/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tradingAccount: account,
      }),
    });
    const responsePayload = (await response.json()) as Partial<BrokerOrderRefreshResponse> & { message?: string };

    if (!response.ok) {
      throw new Error(responsePayload.message ?? 'Unable to refresh broker orders.');
    }

    const orders = Array.isArray(responsePayload.orders) ? responsePayload.orders : [];
    store.brokerOrders = {
      ...store.brokerOrders,
      [account.id]: orders,
    };
    store.brokerOrderSyncs = {
      ...store.brokerOrderSyncs,
      [account.id]: {
        accountId: account.id,
        broker: account.broker,
        status: responsePayload.status ?? 'connected',
        message: responsePayload.message ?? `Loaded ${orders.length} broker orders.`,
        lastSyncedAt: responsePayload.lastSyncedAt ?? new Date().toISOString(),
        orderCount: responsePayload.orderCount ?? orders.length,
      },
    };
    persistStore();
    return responsePayload.message ?? `Loaded ${orders.length} broker orders.`;
  } catch (error) {
    store.brokerOrderSyncs = {
      ...store.brokerOrderSyncs,
      [account.id]: {
        accountId: account.id,
        broker: account.broker,
        status: 'error',
        message: error instanceof Error ? error.message : 'Unable to refresh broker orders.',
        lastSyncedAt: new Date().toISOString(),
        orderCount: store.brokerOrders[account.id]?.length ?? 0,
      },
    };
    persistStore();
    throw error;
  }
}

async function refreshAllBrokerOrders() {
  const accounts = store.tradingAccounts.filter((account) => account.enabled);

  if (accounts.length === 0) {
    return;
  }

  store.brokerOrderSyncs = accounts.reduce<Record<string, BrokerOrderSyncState>>((accumulator, account) => {
    accumulator[account.id] = {
      accountId: account.id,
      broker: account.broker,
      status: 'loading',
      message: 'Refreshing broker orders...',
      orderCount: store.brokerOrderSyncs[account.id]?.orderCount ?? 0,
      lastSyncedAt: store.brokerOrderSyncs[account.id]?.lastSyncedAt,
    };
    return accumulator;
  }, { ...store.brokerOrderSyncs });
  persistStore();
  render();

  await Promise.allSettled(accounts.map((account) => refreshBrokerOrdersForAccount(account)));
  render();
}

function buildTradingAccountFromForm(form: HTMLFormElement, account: TradingAccountSettings): TradingAccountSettings {
  const formData = new FormData(form);

  return {
    ...account,
    broker: String(formData.get(`tradingBroker:${account.id}`) ?? account.broker) as TradingAccountSettings['broker'],
    label: String(formData.get(`tradingLabel:${account.id}`) ?? account.label).trim() || account.label,
    ownerLabel: String(formData.get(`tradingOwner:${account.id}`) ?? account.ownerLabel).trim() || account.ownerLabel,
    mode: formData.get(`tradingMode:${account.id}`) === 'live' ? 'live' : 'paper',
    enabled: formData.get(`tradingEnabled:${account.id}`) === 'on',
    authMode: String(formData.get(`tradingAuthMode:${account.id}`) ?? account.authMode) as BrokerAuthMode,
    credentials: {
      ...account.credentials,
      clientId: String(formData.get(`tradingclientId:${account.id}`) ?? account.credentials.clientId ?? ''),
      clientCode: String(formData.get(`tradingclientCode:${account.id}`) ?? account.credentials.clientCode ?? ''),
      accessToken: String(formData.get(`tradingaccessToken:${account.id}`) ?? account.credentials.accessToken ?? ''),
      apiKey: String(formData.get(`tradingapiKey:${account.id}`) ?? account.credentials.apiKey ?? ''),
      apiSecret: String(formData.get(`tradingapiSecret:${account.id}`) ?? account.credentials.apiSecret ?? ''),
      redirectUrl: String(formData.get(`tradingredirectUrl:${account.id}`) ?? account.credentials.redirectUrl ?? ''),
      totpSecret: String(formData.get(`tradingtotpSecret:${account.id}`) ?? account.credentials.totpSecret ?? ''),
      pin: String(formData.get(`tradingpin:${account.id}`) ?? account.credentials.pin ?? ''),
      refreshToken: String(formData.get(`tradingrefreshToken:${account.id}`) ?? account.credentials.refreshToken ?? ''),
      feedToken: String(formData.get(`tradingfeedToken:${account.id}`) ?? account.credentials.feedToken ?? ''),
    },
    defaults: {
      productType: String(formData.get(`tradingProductType:${account.id}`) ?? account.defaults.productType) as BrokerProductType,
      validity: String(formData.get(`tradingValidity:${account.id}`) ?? account.defaults.validity) as BrokerOrderValidity,
      exchangeSegment: String(formData.get(`tradingExchangeSegment:${account.id}`) ?? account.defaults.exchangeSegment ?? ''),
    },
    supportedExchanges: String(formData.get(`tradingExchanges:${account.id}`) ?? account.supportedExchanges.join(','))
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    staticIpWhitelisted: formData.get(`tradingStaticIp:${account.id}`) === 'on',
    whitelistedIp: String(formData.get(`tradingWhitelistedIp:${account.id}`) ?? account.whitelistedIp ?? ''),
    notes: String(formData.get(`tradingNotes:${account.id}`) ?? account.notes ?? ''),
  };
}

function buildDataProviderFromForm(form: HTMLFormElement, account: DataProviderSettings): DataProviderSettings {
  const formData = new FormData(form);

  return {
    ...account,
    provider: String(formData.get(`dataProviderProvider:${account.id}`) ?? account.provider) as DataProviderSettings['provider'],
    label: String(formData.get(`dataProviderLabel:${account.id}`) ?? account.label).trim() || account.label,
    enabled: formData.get(`dataProviderEnabled:${account.id}`) === 'on',
    authMode: String(formData.get(`dataProviderAuthMode:${account.id}`) ?? account.authMode) as BrokerAuthMode,
    credentials: {
      ...account.credentials,
      clientId: String(formData.get(`dataProviderclientId:${account.id}`) ?? account.credentials.clientId ?? ''),
      clientCode: String(formData.get(`dataProviderclientCode:${account.id}`) ?? account.credentials.clientCode ?? ''),
      accessToken: String(formData.get(`dataProvideraccessToken:${account.id}`) ?? account.credentials.accessToken ?? ''),
      apiKey: String(formData.get(`dataProviderapiKey:${account.id}`) ?? account.credentials.apiKey ?? ''),
      apiSecret: String(formData.get(`dataProviderapiSecret:${account.id}`) ?? account.credentials.apiSecret ?? ''),
      redirectUrl: String(formData.get(`dataProviderredirectUrl:${account.id}`) ?? account.credentials.redirectUrl ?? ''),
      postbackUrl: String(formData.get(`dataProviderpostbackUrl:${account.id}`) ?? account.credentials.postbackUrl ?? ''),
      totpSecret: String(formData.get(`dataProvidertotpSecret:${account.id}`) ?? account.credentials.totpSecret ?? ''),
      pin: String(formData.get(`dataProviderpin:${account.id}`) ?? account.credentials.pin ?? ''),
      refreshToken: String(formData.get(`dataProviderrefreshToken:${account.id}`) ?? account.credentials.refreshToken ?? ''),
      feedToken: String(formData.get(`dataProviderfeedToken:${account.id}`) ?? account.credentials.feedToken ?? ''),
    },
    connection: {
      ...account.connection,
      redirectUrl: String(formData.get(`dataProviderRedirectUrl:${account.id}`) ?? account.connection.redirectUrl ?? ''),
      postbackUrl: String(formData.get(`dataProviderPostbackUrl:${account.id}`) ?? account.connection.postbackUrl ?? ''),
      liveFeedEnabled: formData.get(`dataProviderLiveFeedEnabled:${account.id}`) === 'on',
      optionChainEnabled: formData.get(`dataProviderOptionChainEnabled:${account.id}`) === 'on',
      scripMasterEnabled: formData.get(`dataProviderScripMasterEnabled:${account.id}`) === 'on',
      staticIpWhitelisted: false,
      whitelistedIp: '',
    },
    exchanges: String(formData.get(`dataProviderExchanges:${account.id}`) ?? account.exchanges.join(','))
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    notes: String(formData.get(`dataProviderNotes:${account.id}`) ?? account.notes ?? ''),
  };
}

function validateDataProviderDraft(account: DataProviderSettings): string[] {
  const errors: string[] = [];

  if (!account.label.trim()) {
    errors.push('Data provider label is required.');
  }
  if (account.exchanges.length === 0) {
    errors.push('At least one exchange is required for a data provider.');
  }
  if (account.provider === 'dhan') {
    if (!account.credentials.clientId?.trim()) {
      errors.push('Dhan Client ID is required.');
    }
    if (account.authMode === 'access_token' && !account.credentials.accessToken?.trim()) {
      errors.push('Dhan access token is required for access token mode.');
    }
    if (account.authMode === 'oauth_app') {
      if (!account.credentials.apiKey?.trim()) {
        errors.push('Dhan API key is required for OAuth app mode.');
      }
      if (!account.credentials.apiSecret?.trim()) {
        errors.push('Dhan API secret is required for OAuth app mode.');
      }
      if (!(account.connection.redirectUrl ?? account.credentials.redirectUrl)?.trim()) {
        errors.push('Dhan redirect URL is required for OAuth app mode.');
      }
    }
  }

  return errors;
}

function validateTradingAccountDraft(account: TradingAccountSettings): string[] {
  const errors: string[] = [];

  if (!account.label.trim()) {
    errors.push('Trading account label is required.');
  }
  if (!account.ownerLabel.trim()) {
    errors.push('Trading account owner is required.');
  }
  if (account.supportedExchanges.length === 0) {
    errors.push('At least one supported exchange is required.');
  }
  if (account.broker === 'dhan') {
    if (!account.credentials.clientId?.trim()) {
      errors.push('Dhan Client ID is required.');
    }
    if (account.authMode === 'access_token' && !account.credentials.accessToken?.trim()) {
      errors.push('Dhan access token is required for access token mode.');
    }
    if (account.authMode === 'oauth_app') {
      if (!account.credentials.apiKey?.trim()) {
        errors.push('Dhan API key is required for OAuth app mode.');
      }
      if (!account.credentials.apiSecret?.trim()) {
        errors.push('Dhan API secret is required for OAuth app mode.');
      }
    }
  }
  if (account.staticIpWhitelisted && !account.whitelistedIp?.trim()) {
    errors.push('Whitelisted IP is required when static IP is enabled.');
  }

  return errors;
}

function applySettingsValidation() {
  const settingsForm = document.querySelector<HTMLFormElement>('#settings-form');

  if (!settingsForm) {
    return;
  }

  const setInputRequirement = (name: string, required: boolean, message: string) => {
    const input = settingsForm.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[name="${name}"]`);
    if (!input) {
      return;
    }
    input.required = required;
    input.setCustomValidity(required && !String((input as HTMLInputElement).value ?? '').trim() ? message : '');
  };

  store.dataProviders.forEach((account) => {
    const draft = buildDataProviderFromForm(settingsForm, account);
    const isDhan = draft.provider === 'dhan';
    setInputRequirement(`dataProviderLabel:${account.id}`, true, 'Data provider label is required.');
    setInputRequirement(`dataProviderExchanges:${account.id}`, true, 'At least one exchange is required.');
    setInputRequirement(`dataProviderclientId:${account.id}`, isDhan, 'Dhan Client ID is required.');
    setInputRequirement(
      `dataProvideraccessToken:${account.id}`,
      isDhan && draft.authMode === 'access_token',
      'Dhan access token is required for access token mode.',
    );
    setInputRequirement(`dataProviderapiKey:${account.id}`, isDhan && draft.authMode === 'oauth_app', 'Dhan API key is required.');
    setInputRequirement(`dataProviderapiSecret:${account.id}`, isDhan && draft.authMode === 'oauth_app', 'Dhan API secret is required.');
    setInputRequirement(
      `dataProviderRedirectUrl:${account.id}`,
      isDhan && draft.authMode === 'oauth_app',
      'Dhan redirect URL is required for OAuth app mode.',
    );
  });

  store.tradingAccounts.forEach((account) => {
    const draft = buildTradingAccountFromForm(settingsForm, account);
    const isDhan = draft.broker === 'dhan';
    setInputRequirement(`tradingLabel:${account.id}`, true, 'Trading account label is required.');
    setInputRequirement(`tradingOwner:${account.id}`, true, 'Trading account owner is required.');
    setInputRequirement(`tradingExchanges:${account.id}`, true, 'At least one supported exchange is required.');
    setInputRequirement(`tradingclientId:${account.id}`, isDhan, 'Dhan Client ID is required.');
    setInputRequirement(
      `tradingaccessToken:${account.id}`,
      isDhan && draft.authMode === 'access_token',
      'Dhan access token is required for access token mode.',
    );
    setInputRequirement(`tradingapiKey:${account.id}`, isDhan && draft.authMode === 'oauth_app', 'Dhan API key is required.');
    setInputRequirement(`tradingapiSecret:${account.id}`, isDhan && draft.authMode === 'oauth_app', 'Dhan API secret is required.');
    setInputRequirement(
      `tradingWhitelistedIp:${account.id}`,
      draft.staticIpWhitelisted,
      'Whitelisted IP is required when static IP is enabled.',
    );
  });
}

function getRiskPerTrade() {
  return Number((((store.settings.capital * store.settings.riskPercent) / 100) * 0.9).toFixed(2));
}

function getExecutionCardRiskPreview(card: ExecutionCardState) {
  return card.preview ? getCapitalCappedRisk(card.preview) : null;
}

function getInstrumentById(instrumentId: string) {
  return store.settings.instruments.find((instrument) => instrument.id === instrumentId) ?? null;
}

function getActiveInstruments() {
  const enabled = store.settings.instruments.filter((instrument) => instrument.enabled);
  return enabled.length > 0 ? enabled : store.settings.instruments;
}

function calculateTradeMetrics(trade: Pick<TradeRecord, 'instrumentId' | 'entry' | 'stopLoss' | 'exit' | 'direction'>): TradeMetrics {
  const instrument = getInstrumentById(trade.instrumentId);
  const lotSize = instrument?.lotSize ?? 0;
  const riskPerTrade = getRiskPerTrade();
  const unitRisk = Math.abs(trade.entry - trade.stopLoss);
  const rawLots = unitRisk > 0 && lotSize > 0 ? Math.floor(riskPerTrade / (unitRisk * lotSize)) : 0;
  const lots = Math.max(rawLots, 0);
  const value = Number((trade.entry * lotSize * lots).toFixed(2));
  const risk = Number((unitRisk * lotSize * lots).toFixed(2));

  if (trade.exit === null) {
    return {
      lotSize,
      lots,
      value,
      risk,
      pnl: null,
      rr: null,
    };
  }

  const priceDelta = trade.direction === 'long' ? trade.exit - trade.entry : trade.entry - trade.exit;
  const pnl = Number((priceDelta * lotSize * lots).toFixed(2));
  const rr = risk > 0 ? Number((pnl / risk).toFixed(2)) : null;

  return {
    lotSize,
    lots,
    value,
    risk,
    pnl,
    rr,
  };
}

function getTradesForSelectedDate() {
  return store.trades
    .filter((trade) => trade.tradeDate === store.selectedDate)
    .sort((left, right) => `${right.tradeDate} ${right.tradeTime}`.localeCompare(`${left.tradeDate} ${left.tradeTime}`));
}

function calculateSummary(trades: TradeRecord[]) {
  const realizedTrades = trades.filter((trade) => trade.exit !== null);
  const pnlValues = realizedTrades
    .map((trade) => calculateTradeMetrics(trade).pnl)
    .filter((value): value is number => value !== null);
  const riskValues = trades.map((trade) => calculateTradeMetrics(trade).risk);

  return {
    trades: trades.length,
    totalPnl: pnlValues.reduce((sum, value) => sum + value, 0),
    totalRisk: riskValues.reduce((sum, value) => sum + value, 0),
    openTrades: trades.filter((trade) => trade.exit === null).length,
  };
}

function monthLabel(date: Date) {
  return date.toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
  });
}

function getMonthDate(value: string) {
  const [year, month] = value.split('-').map(Number);
  return new Date(year, month - 1, 1);
}

function getTradeNetPnl(trade: TradeRecord) {
  return calculateTradeMetrics(trade).pnl ?? 0;
}

function getTradeUnderlyingSymbol(trade: TradeRecord) {
  return (trade.underlyingSymbol ?? trade.description.split(' ')[0] ?? '').trim().toUpperCase();
}

function getTradeOptionStrike(trade: TradeRecord) {
  if (typeof trade.optionStrike === 'number' && Number.isFinite(trade.optionStrike)) {
    return trade.optionStrike;
  }

  const match = trade.description.match(/\b(\d+(?:\.\d+)?)\b/);
  return match ? Number(match[1]) : null;
}

function getTradeExpiryLabel(trade: TradeRecord) {
  return trade.optionExpiry ? formatDayMonth(trade.optionExpiry) : trade.description.split(' ').slice(-2).join(' ');
}

function getActiveBrokerOrderForUnderlying(underlyingSymbol: string) {
  const normalized = underlyingSymbol.trim().toUpperCase();

  if (!normalized) {
    return null;
  }

  const activeStatuses = new Set<BrokerOrderRecord['status']>(['pending', 'open', 'partially_traded', 'traded', 'unknown']);

  return store.tradingAccounts
    .filter((account) => account.enabled)
    .flatMap((account) => (store.brokerOrders[account.id] ?? []).map((order) => ({ order, account })))
    .filter(({ order }) => activeStatuses.has(order.status))
    .find(({ order }) => {
      const orderSymbol = normalizeSymbolValue(order.symbol);
      return matchesUnderlyingForOrder(orderSymbol, normalized);
    }) ?? null;
}

function getOpenTradeForUnderlying(underlyingSymbol: string) {
  const liveOrder = getActiveBrokerOrderForUnderlying(underlyingSymbol);

  if (liveOrder) {
    return {
      trade: null,
      source: 'broker' as const,
      order: liveOrder.order,
      account: liveOrder.account,
    };
  }

  const normalized = underlyingSymbol.trim().toUpperCase();

  return (
    store.trades.find((trade) => {
      if (trade.exit !== null) {
        return false;
      }

      return getTradeUnderlyingSymbol(trade) === normalized;
    }) ?? null
  );
}

function getOpenTradeBlockMessage(preview: QuickOrderPreviewResponse | null): { blocked: boolean; message: string } | null {
  if (!preview) {
    return null;
  }

  const openTrade = getOpenTradeForUnderlying(preview.contract.underlyingSymbol);

  if (!openTrade) {
    return null;
  }

  const openStrike = 'trade' in openTrade && openTrade.trade ? getTradeOptionStrike(openTrade.trade) : null;
  const currentStrike = preview.contract.strikePrice;

  if ('source' in openTrade && openTrade.source === 'broker') {
    return {
      blocked: true,
      message: `Broker live trade exists for ${preview.contract.underlyingSymbol}. Open the Live view instead of a new strike.`,
    };
  }

  if (openStrike !== null && openStrike !== currentStrike) {
    return {
      blocked: true,
      message: `Open position exists for ${preview.contract.underlyingSymbol} at strike ${formatNumber(openStrike)}. Do not open a new strike until the current position is closed.`,
    };
  }

  return {
    blocked: true,
    message: `Open position already exists for ${preview.contract.underlyingSymbol} at the same strike.`,
  };
}

function getBrokerOrderStatusLabel(status: BrokerOrderSyncState['status']) {
  switch (status) {
    case 'loading':
      return 'Refreshing';
    case 'connected':
      return 'Live';
    case 'partial':
      return 'Partial';
    case 'unsupported':
      return 'Not supported';
    case 'error':
      return 'Error';
    default:
      return 'Idle';
  }
}

function getTradesForMonth(monthDate: Date) {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();

  return store.trades.filter((trade) => {
    const tradeDate = new Date(`${trade.tradeDate}T00:00:00`);
    return tradeDate.getFullYear() === year && tradeDate.getMonth() === month;
  });
}

function calculateStreaks(trades: TradeRecord[]) {
  const daily = new Map<string, number>();

  trades.forEach((trade) => {
    daily.set(trade.tradeDate, (daily.get(trade.tradeDate) ?? 0) + getTradeNetPnl(trade));
  });

  const ordered = [...daily.entries()].sort(([left], [right]) => left.localeCompare(right));
  let bestWinning = 0;
  let currentWinning = 0;

  ordered.forEach(([, pnl]) => {
    if (pnl > 0) {
      currentWinning += 1;
      bestWinning = Math.max(bestWinning, currentWinning);
      return;
    }

    currentWinning = 0;
  });

  let trailingWinning = 0;

  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    if (ordered[index][1] > 0) {
      trailingWinning += 1;
      continue;
    }

    break;
  }

  return {
    bestWinning,
    currentWinning: trailingWinning,
  };
}

function getExecutionInstrument() {
  return getInstrumentById(store.execution.setup.instrumentId) ?? getActiveInstruments()[0] ?? store.settings.instruments[0];
}

function roundToStrike(value: number, step: number) {
  return Math.round(value / step) * step;
}

function getUnderlyingRiskReward() {
  const setup = store.execution.setup;

  return {
    risk: Math.abs(setup.entryPrice - setup.stopLossPrice),
    reward: Math.abs(setup.targetPrice - setup.entryPrice),
  };
}

function getExecutionRiskRatio() {
  const { risk, reward } = getUnderlyingRiskReward();

  if (risk === 0) {
    return null;
  }

  return Number((reward / risk).toFixed(2));
}

function getCandidateOffsets(
  bias: SetupBias,
): Array<{ profile: StrikePreference; strikeShift: number; delta: number; timeFactor: number }> {
  return bias === 'bullish'
    ? [
        { profile: 'itm', strikeShift: -1, delta: 0.62, timeFactor: 0.84 },
        { profile: 'atm', strikeShift: 0, delta: 0.5, timeFactor: 1 },
        { profile: 'otm', strikeShift: 1, delta: 0.36, timeFactor: 1.12 },
      ]
    : [
        { profile: 'itm', strikeShift: 1, delta: 0.62, timeFactor: 0.84 },
        { profile: 'atm', strikeShift: 0, delta: 0.5, timeFactor: 1 },
        { profile: 'otm', strikeShift: -1, delta: 0.36, timeFactor: 1.12 },
      ];
}

function generateOptionCandidates(): OptionCandidate[] {
  const instrument = getExecutionInstrument();
  const setup = store.execution.setup;

  if (!instrument) {
    return [];
  }

  const riskBudget = getRiskPerTrade();
  const strikeStep = instrument.strikeStep > 0 ? instrument.strikeStep : getDefaultStrikeStep(instrument.name);
  const baseStrike = roundToStrike(setup.spotPrice, strikeStep);
  const optionType: OptionType = setup.bias === 'bullish' ? 'CE' : 'PE';
  const brokerFeesPerLot = instrument.name.includes('CRUDE') || instrument.name.includes('GOLD') ? 18 : 24;
  const { risk: underlyingRisk, reward: underlyingReward } = getUnderlyingRiskReward();

  return getCandidateOffsets(setup.bias).map((variant) => {
    const strike = baseStrike + variant.strikeShift * strikeStep;
    const intrinsic =
      optionType === 'CE'
        ? Math.max(setup.entryPrice - strike, 0)
        : Math.max(strike - setup.entryPrice, 0);
    const baseTimeValue = Math.max(strikeStep * 0.18, setup.spotPrice * 0.0012);
    const premiumEntry = roundToTick(Math.max(6, intrinsic + baseTimeValue * variant.timeFactor));
    const stopFromUnderlying = roundToTick(Math.max(0.5, premiumEntry - underlyingRisk * variant.delta * 0.92));
    const premiumStop =
      setup.stopMode === 'manual'
        ? roundToTick(Math.max(0.5, Math.min(setup.manualOptionStop, premiumEntry - 0.05)))
        : stopFromUnderlying;
    const premiumTarget = roundToTick(Math.max(premiumEntry + 0.1, premiumEntry + underlyingReward * variant.delta * 0.96));
    const spreadRate = variant.profile === 'otm' ? 0.022 : variant.profile === 'atm' ? 0.015 : 0.012;
    const spread = roundToTick(Math.max(0.1, premiumEntry * spreadRate));
    const bid = roundToTick(Math.max(0.05, premiumEntry - spread / 2));
    const ask = roundToTick(premiumEntry + spread / 2);
    const perLotRisk = Math.max(0, (premiumEntry - premiumStop) * instrument.lotSize + brokerFeesPerLot);
    const lots = perLotRisk > 0 ? Math.floor(riskBudget / perLotRisk) : 0;
    const totalQuantity = lots * instrument.lotSize;
    const totalRisk = Number((perLotRisk * lots).toFixed(2));
    const capitalRequired = Number((premiumEntry * totalQuantity).toFixed(2));
    const expectedPnl = Number(((premiumTarget - premiumEntry) * totalQuantity).toFixed(2));
    const expectedRr = totalRisk > 0 ? Number((expectedPnl / totalRisk).toFixed(2)) : null;
    const liquidityScore = Math.max(
      52,
      Math.min(
        92,
        Math.round(
            90 -
            spread * 4 -
            (variant.profile === 'otm' ? 10 : 0) -
            (variant.profile === 'itm' ? 4 : 0),
        ),
      ),
    );

    return {
      id: `${instrument.id}-${optionType}-${strike}-${variant.profile}`,
      profile: variant.profile,
      optionType,
      strike,
      symbol: `${instrument.name} ${strike} ${optionType}`,
      premiumEntry,
      premiumStop,
      premiumTarget,
      bid,
      ask,
      spread,
      delta: variant.delta,
      lots,
      totalQuantity,
      totalRisk,
      capitalRequired,
      expectedPnl,
      expectedRr,
      liquidityScore,
    };
  });
}

function getSelectedCandidate(candidates: OptionCandidate[]) {
  return candidates.find((candidate) => candidate.profile === store.execution.setup.strikePreference) ?? candidates[0] ?? null;
}

function getExecutionTicketPrice(candidate: OptionCandidate | null, side: 'entry' | 'exit') {
  if (!candidate) {
    return null;
  }

  const setup = store.execution.setup;

  if (side === 'entry') {
    return setup.entryOrderType === 'market' ? candidate.ask : setup.entryLimitPrice || candidate.premiumEntry;
  }

  return setup.exitOrderType === 'market' ? candidate.bid : setup.exitLimitPrice || candidate.premiumTarget;
}

function getPreviewEntryPrice(preview: QuickOrderPreviewResponse) {
  return preview.request.entryOrderType === 'market'
    ? preview.contract.topAskPrice ?? preview.contract.optionLastPrice
    : preview.request.entryLimitPrice ?? preview.contract.topAskPrice ?? preview.contract.optionLastPrice;
}

function getPreviewExitPrice(preview: QuickOrderPreviewResponse) {
  return preview.request.exitOrderType === 'market'
    ? preview.contract.topBidPrice ?? preview.contract.optionLastPrice
    : preview.request.exitLimitPrice ?? preview.risk.premiumFiveRTargetPrice ?? preview.contract.topBidPrice ?? preview.contract.optionLastPrice;
}

function getCapitalCappedRisk(preview: QuickOrderPreviewResponse, lotSizeOverride?: number) {
  const entryPrice = getPreviewEntryPrice(preview);
  const lotSize = lotSizeOverride && lotSizeOverride > 0 ? lotSizeOverride : preview.contract.lotSize;
  const capitalPerLot = Math.max(0, entryPrice) * lotSize;
  const capitalLots = capitalPerLot > 0 ? Math.floor(store.settings.capital / capitalPerLot) : 0;
  const effectiveLots = Math.max(0, Math.min(preview.risk.lots, capitalLots));
  const effectiveQuantity = effectiveLots * lotSize;
  const capitalRequired = Number((entryPrice * effectiveQuantity).toFixed(2));

  return {
    entryPrice,
    capitalLots,
    effectiveLots,
    effectiveQuantity,
    capitalRequired,
    capitalCapped: effectiveLots !== preview.risk.lots,
  };
}

function resetExecutionPricingDraft() {
  store.execution.setup = {
    ...store.execution.setup,
    entryOrderType: 'limit',
    entryLimitPrice: 0,
    entryLimitManual: false,
    exitOrderType: 'limit',
    exitLimitPrice: 0,
    exitLimitManual: false,
    stopLimitPrice: 0,
    stopLimitManual: false,
    useTargetOrder: false,
    targetRr: 5,
  };
}

function resetExecutionCardPricingDraft(instrumentId: string) {
  updateExecutionCardSetup(instrumentId, {
    entryOrderType: 'limit',
    entryLimitPrice: 0,
    entryLimitManual: false,
    exitOrderType: 'limit',
    exitLimitPrice: 0,
    exitLimitManual: false,
    stopLimitPrice: 0,
    stopLimitManual: false,
    useTargetOrder: false,
    targetRr: 5,
  });
}

function syncExecutionTicketDefaults(form: HTMLFormElement) {
  const preview = store.execution.preview;

  if (!preview) {
    return;
  }

  const entryOrderType = form.querySelector<HTMLInputElement>('input[name="entryLimitEnabled"]')?.checked === false ? 'market' : 'limit';
  const useTargetOrder = form.querySelector<HTMLInputElement>('input[name="useTargetOrder"]')?.checked === true;
  const targetRrInput = form.querySelector<HTMLInputElement>('input[name="targetRr"]');
  const entryPriceInput = form.querySelector<HTMLInputElement>('input[name="entryLimitPrice"]');
  const exitPriceInput = form.querySelector<HTMLInputElement>('input[name="exitLimitPrice"]');
  const stopLimitInput = form.querySelector<HTMLInputElement>('input[name="stopLimitPrice"]');
  const entrySeed = preview.contract.optionLastPrice ?? preview.contract.topAskPrice ?? 0;
  const stopLimitSeed = preview.risk.premiumStopLossPrice ?? preview.risk.premiumStopLossLimitPrice ?? 0;
  const targetRr = Number(targetRrInput?.value ?? store.execution.setup.targetRr ?? 5);
  const entryValue =
    entryOrderType === 'market'
      ? preview.contract.topAskPrice ?? preview.contract.optionLastPrice ?? entrySeed
      : store.execution.setup.entryLimitManual && store.execution.setup.entryLimitPrice > 0
        ? store.execution.setup.entryLimitPrice
        : preview.contract.optionLastPrice ?? entrySeed;

  if (entryPriceInput) {
    entryPriceInput.disabled = entryOrderType === 'market';
    entryPriceInput.value = String(entryValue);
    store.execution.setup.entryOrderType = entryOrderType;
    store.execution.setup.entryLimitPrice = Number(entryValue);
    if (entryOrderType === 'market' || !store.execution.setup.entryLimitManual) {
      store.execution.setup.entryLimitManual = false;
    }
  }

  if (exitPriceInput) {
    exitPriceInput.disabled = !useTargetOrder;
    const riskPerUnit = preview.risk.premiumRiskPerUnit > 0 ? preview.risk.premiumRiskPerUnit : Math.max(0.05, entryValue - stopLimitSeed);
    const exitValue =
      useTargetOrder && store.execution.setup.exitLimitManual && store.execution.setup.exitLimitPrice > 0
        ? store.execution.setup.exitLimitPrice
        : Number((entryValue + riskPerUnit * Math.max(1, targetRr || 5)).toFixed(2));
    exitPriceInput.value = String(exitValue);
    store.execution.setup.exitLimitPrice = Number(exitValue);
    if (useTargetOrder) {
      store.execution.setup.exitLimitPrice = Number(exitValue);
      if (!store.execution.setup.exitLimitManual) {
        store.execution.setup.exitLimitManual = false;
      }
    } else {
      store.execution.setup.exitLimitManual = false;
    }
  }

  if (stopLimitInput) {
    const stopValue = store.execution.setup.stopLimitManual ? store.execution.setup.stopLimitPrice : stopLimitSeed;
    stopLimitInput.value = String(stopValue);
    if (!store.execution.setup.stopLimitManual) {
      store.execution.setup.stopLimitPrice = Number(stopValue);
    }
  }

  store.execution.setup.useTargetOrder = useTargetOrder;
  store.execution.setup.targetRr = Number.isFinite(targetRr) && targetRr > 0 ? targetRr : store.execution.setup.targetRr;
}

function renderNav() {
  return `
    <header class="topbar">
      <div>
        <span class="eyebrow">Execution workspace</span>
        <h1>${appConfig.name}</h1>
      </div>
      <nav class="menu">
        <button type="button" class="menu-button ${store.activePage === 'execution' ? 'active' : ''}" data-role="switch-page" data-page="execution">Execution</button>
        <button type="button" class="menu-button ${store.activePage === 'trades' ? 'active' : ''}" data-role="switch-page" data-page="trades">Trades</button>
        <button type="button" class="menu-button ${store.activePage === 'calendar' ? 'active' : ''}" data-role="switch-page" data-page="calendar">Calendar</button>
        <button type="button" class="menu-button ${store.activePage === 'settings' ? 'active' : ''}" data-role="switch-page" data-page="settings">Settings</button>
      </nav>
    </header>
  `;
}

function renderExecutionPage() {
  const enabledInstruments = getActiveInstruments();
  const liveCards = enabledInstruments.map((instrument) => renderExecutionCard(instrument)).join('');

  return `
    <section class="stat-card execution-summary-card">
      <div class="execution-summary-row">
        <div>
          <span class="label">Capital</span>
          <strong>${formatCurrency(store.settings.capital)}</strong>
        </div>
        <div>
          <span class="label">Risk / Trade</span>
          <strong>${formatCurrency(getRiskPerTrade())}</strong>
        </div>
        <div>
          <span class="label">Enabled Cards</span>
          <strong>${enabledInstruments.length}</strong>
        </div>
        <div>
          <span class="label">Live Orders</span>
          <strong>${Object.values(store.brokerOrderSyncs).filter((sync) => sync.status === 'connected').length}</strong>
        </div>
      </div>
    </section>
    <div class="execution-card-stack">
      ${liveCards}
    </div>
  `;
}

function renderExecutionCard(instrument: InstrumentConfig) {
  const card = getExecutionCardState(instrument.id);
  const setup = card.setup;
  const resolution = resolveExecutionRoute(instrument);
  const preview = card.preview;
  const liveSpot = preview?.contract.underlyingLastPrice ?? setup.spotPrice ?? null;
  const lastPreviewLabel = card.lastPreviewAt
    ? new Date(card.lastPreviewAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null;
  const routeLabel = resolution ? `${resolution.dataProvider?.label ?? 'No data'} → ${resolution.tradingAccount?.label ?? 'No trading account'}` : 'No route selected';
  const openTradeState = preview ? getOpenTradeBlockMessage(preview) : null;
  const hasLiveTrade = Boolean(openTradeState?.blocked);
  const canSubmit = Boolean(preview && !hasLiveTrade && preview.risk.canTrade && (getCapitalCappedRisk(preview)?.effectiveQuantity ?? 0) >= 1);
  const entryPrice = preview ? getPreviewEntryPrice(preview) : setup.entryLimitPrice;
  const riskPerUnit = preview?.risk.premiumRiskPerUnit ?? Math.max(0.05, entryPrice - setup.stopLimitPrice);
  const autoTarget = Number((entryPrice + riskPerUnit * Math.max(1, setup.targetRr || 5)).toFixed(2));
  const targetValue = setup.useTargetOrder
    ? setup.exitLimitManual && setup.exitLimitPrice > 0
      ? setup.exitLimitPrice
      : autoTarget
    : autoTarget;
  const targetRR = riskPerUnit > 0 ? Number(((targetValue - entryPrice) / riskPerUnit).toFixed(2)) : null;
  const currentLotSize = preview ? (getInstrumentById(instrument.id)?.lotSize ?? instrument.lotSize ?? preview.contract.lotSize) : instrument.lotSize;
  const cappedRisk = preview ? getCapitalCappedRisk(preview, currentLotSize) : null;
  const loading = card.loading;
  const error = card.error;
  const expiryLabel = setup.expiryLabel || (preview ? formatDayMonth(preview.contract.expiry) : 'Pending');
  const currentPreview = preview as QuickOrderPreviewResponse | null;

  return `
    <section class="panel compact-exec-card" data-instrument-card="${escapeHtml(instrument.id)}">
      <div class="section-head compact-head">
        <div>
          <span class="eyebrow muted">${escapeHtml(instrument.name)}</span>
          <h2>${escapeHtml(preview?.contract.tradingSymbol ?? 'Awaiting preview')}</h2>
        </div>
        <div class="section-head-actions">
          <span class="chip">${escapeHtml(expiryLabel)}</span>
          <span class="chip">${escapeHtml(routeLabel)}</span>
          <label class="header-select compact-field compact-field-side">
            <select name="bias">
              <option value="bullish" ${setup.bias === 'bullish' ? 'selected' : ''}>CE</option>
              <option value="bearish" ${setup.bias === 'bearish' ? 'selected' : ''}>PE</option>
            </select>
          </label>
          <label class="header-select compact-field compact-field-moneyness">
            <select name="strikePreference">
              <option value="atm" ${setup.strikePreference === 'atm' ? 'selected' : ''}>ATM</option>
              <option value="itm" ${setup.strikePreference === 'itm' ? 'selected' : ''}>ITM</option>
              <option value="otm" ${setup.strikePreference === 'otm' ? 'selected' : ''}>OTM</option>
            </select>
          </label>
          <button type="button" class="secondary-button slim" data-role="refresh-card-preview" data-instrument-id="${escapeHtml(instrument.id)}" ${loading ? 'disabled' : ''}>Refresh</button>
        </div>
      </div>
      <div class="compact-summary-row">
        <div><span>Spot</span><strong>${liveSpot === null ? '-' : formatNumber(liveSpot)}</strong></div>
        <div><span>Entry</span><strong>${formatNumber(entryPrice)}</strong></div>
        <div><span>SL</span><strong>${formatNumber(currentPreview?.risk.premiumStopLossPrice ?? setup.stopLimitPrice)} / ${formatNumber(setup.stopLimitManual ? setup.stopLimitPrice : currentPreview?.risk.premiumStopLossPrice ?? setup.stopLimitPrice)}</strong></div>
        <div><span>Lots</span><strong>${formatNumber(cappedRisk?.effectiveLots ?? currentPreview?.risk.lots ?? 0)}</strong></div>
        <div><span>Qty</span><strong>${formatNumber(cappedRisk?.effectiveQuantity ?? currentPreview?.risk.quantity ?? 0)}</strong></div>
        <div><span>Risk</span><strong>${formatCurrency(currentPreview?.risk.totalRisk ?? 0)}</strong></div>
        <div><span>Total</span><strong>${formatCurrency(cappedRisk?.capitalRequired ?? currentPreview?.risk.capitalRequired ?? 0)}</strong></div>
      </div>
      ${
        loading
          ? `<p class="muted-copy compact-note">Loading live option preview...</p>`
          : error
            ? `<p class="muted-copy compact-note negative">${escapeHtml(error)}</p>`
            : preview
              ? `
                <form class="compact-ticket" data-execution-card-form data-instrument-id="${escapeHtml(instrument.id)}">
                  ${
                    hasLiveTrade
                      ? `<p class="compact-warning">${escapeHtml(openTradeState?.message ?? 'Live trade exists for this underlying.')}</p>`
                      : ''
                  }
                  ${
                    !preview.risk.canTrade
                      ? `<p class="compact-warning compact-warning-block negative">${escapeHtml(preview.risk.riskBlockReason ?? 'Current option price cannot buy even one lot within the configured risk budget.')}</p>`
                      : ''
                  }
                  ${
                    cappedRisk?.capitalCapped
                      ? `<p class="compact-warning">Lot count capped to ${formatNumber(cappedRisk.effectiveLots)} because capital is lower than the risk-based size.</p>`
                      : ''
                  }
                  <div class="compact-control-row compact-control-row-main">
                    <label class="toggle-row compact inline-toggle compact-inline">
                      <input name="entryLimitEnabled" type="checkbox" ${setup.entryOrderType === 'limit' ? 'checked' : ''} />
                      <span>Limit</span>
                    </label>
                    <label class="compact-field compact-field-entry">
                      <span>Entry</span>
                      <input
                        name="entryLimitPrice"
                        type="number"
                        step="0.05"
                        value="${setup.entryOrderType === 'market' ? (preview.contract.topAskPrice || preview.contract.optionLastPrice) : (setup.entryLimitPrice || preview.contract.optionLastPrice)}"
                        ${setup.entryOrderType === 'market' ? 'disabled' : ''}
                      />
                    </label>
                    <label class="compact-field compact-field-sl">
                      <span>SL</span>
                      <input name="stopLimitPrice" type="number" step="0.05" value="${setup.stopLimitManual ? setup.stopLimitPrice : preview.risk.premiumStopLossPrice}" />
                    </label>
                    <label class="toggle-row compact inline-toggle compact-inline">
                      <input name="useTargetOrder" type="checkbox" ${setup.useTargetOrder ? 'checked' : ''} />
                      <span>TGT</span>
                    </label>
                    <label class="compact-field compact-field-target ${setup.useTargetOrder ? '' : 'hidden'}">
                      <input
                        name="exitLimitPrice"
                        type="number"
                        step="0.05"
                        value="${setup.exitLimitManual && setup.exitLimitPrice > 0 ? setup.exitLimitPrice : targetValue}"
                      />
                    </label>
                    <div class="compact-inline compact-value-text ${setup.useTargetOrder ? '' : 'hidden'}">${formatRatio(targetRR ?? currentPreview?.risk.expectedRiskReward ?? null)}</div>
                    <div class="actions compact-actions">
                    ${
                      hasLiveTrade
                        ? `<button type="button" class="secondary-button" data-role="switch-page" data-page="trades">Live</button>`
                        : `<button type="submit" ${canSubmit ? '' : 'disabled'}>Submit</button>`
                    }
                  </div>
                  </div>
                </form>
              `
              : `<p class="muted-copy compact-note">Save a valid route and refresh the execution preview to fetch the live contract suggestion.</p>`
      }
    </section>
  `;
}

function renderExecutionSetupForm(instrument: InstrumentConfig | null) {
  const setup = store.execution.setup;
  const activeInstruments = getActiveInstruments();
  const liveSpot = store.execution.preview?.contract.underlyingLastPrice ?? null;
  const lastPreviewLabel = store.execution.lastPreviewAt
    ? new Date(store.execution.lastPreviewAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null;
  const setupStatus = store.execution.loading
    ? 'Refreshing live preview...'
    : store.execution.error
      ? store.execution.error
      : lastPreviewLabel
        ? `Preview refreshed at ${lastPreviewLabel}`
        : 'Preview not loaded yet.';

  return `
    <section class="panel">
      <div class="section-head">
        <div>
          <span class="eyebrow muted">Layer 1</span>
          <h2>Underlying Setup</h2>
        </div>
        <span class="chip">${escapeHtml(lastPreviewLabel ? `Live spot synced ${lastPreviewLabel}` : 'Spot auto-sync enabled')}</span>
      </div>
      <form id="execution-form" class="form-grid execution-form concise-exec">
        <label class="full">
          <span>Underlying</span>
          <select name="instrumentId">
            ${activeInstruments
              .map(
                (item) => `<option value="${item.id}" ${item.id === setup.instrumentId ? 'selected' : ''}>${escapeHtml(item.name)}</option>`,
              )
              .join('')}
          </select>
        </label>
        <label>
          <span>Bias</span>
          <select name="bias">
            <option value="bullish" ${setup.bias === 'bullish' ? 'selected' : ''}>Bullish / CE</option>
            <option value="bearish" ${setup.bias === 'bearish' ? 'selected' : ''}>Bearish / PE</option>
          </select>
        </label>
        <label>
          <span>Strike</span>
          <select name="strikePreference">
            <option value="atm" ${setup.strikePreference === 'atm' ? 'selected' : ''}>ATM</option>
            <option value="itm" ${setup.strikePreference === 'itm' ? 'selected' : ''}>ITM</option>
            <option value="otm" ${setup.strikePreference === 'otm' ? 'selected' : ''}>OTM</option>
          </select>
        </label>
        <div class="full compact-readonly">
          <div>
            <span>Live Spot</span>
            <strong>${liveSpot === null ? '-' : formatNumber(liveSpot)}</strong>
          </div>
          <div>
            <span>Expiry</span>
            <strong>${escapeHtml(setup.expiryLabel || 'Pending')}</strong>
          </div>
          <div>
            <span>Sync</span>
            <strong>${escapeHtml(lastPreviewLabel ?? 'Pending')}</strong>
          </div>
        </div>
        <label class="toggle-row full">
          <input name="useUnderlyingLevels" type="checkbox" ${setup.useUnderlyingLevels ? 'checked' : ''} />
          <span>Use underlying levels</span>
        </label>
        <div class="full ${setup.useUnderlyingLevels ? '' : 'hidden'}" data-role="underlying-levels">
          <div class="form-grid concise-grid">
            <label>
              <span>Entry</span>
              <input name="entryPrice" type="number" step="0.05" value="${setup.entryPrice}" />
            </label>
            <label>
              <span>Stop</span>
              <input name="stopLossPrice" type="number" step="0.05" value="${setup.stopLossPrice}" />
            </label>
            <label>
              <span>Target</span>
              <input name="targetPrice" type="number" step="0.05" value="${setup.targetPrice}" />
            </label>
            <label>
              <span>Stop Mode</span>
              <select name="stopMode">
                <option value="underlying" ${setup.stopMode === 'underlying' ? 'selected' : ''}>Derived</option>
                <option value="manual" ${setup.stopMode === 'manual' ? 'selected' : ''}>Manual SL</option>
              </select>
            </label>
            <label>
              <span>Manual SL</span>
              <input name="manualOptionStop" type="number" step="0.05" value="${setup.manualOptionStop}" />
            </label>
          </div>
        </div>
        <label class="full">
          <span>Notes</span>
          <textarea name="notes" rows="3">${escapeHtml(setup.notes)}</textarea>
        </label>
        <p class="muted-copy full">${escapeHtml(setupStatus)}</p>
        <div class="actions full">
          <button type="submit" ${store.execution.loading ? 'disabled' : ''}>Update And Refresh</button>
        </div>
      </form>
    </section>
  `;
}

function renderExecutionBoard(resolution: ExecutionRouteResolution | null, preview: QuickOrderPreviewResponse | null) {
  return `
    <section class="execution-board">
      ${renderExecutionRoutePanel(resolution)}
      ${renderExecutionTicket(resolution, preview)}
    </section>
  `;
}

function renderExecutionRoutePanel(resolution: ExecutionRouteResolution | null) {
  if (!resolution) {
    return `
      <section class="panel">
        <div class="section-head">
          <div>
            <span class="eyebrow muted">Routing</span>
            <h2>Execution Route</h2>
          </div>
        </div>
        <p class="muted-copy">Create an enabled execution route in Settings so this underlying knows which data provider and trading account to use.</p>
      </section>
    `;
  }

  return `
    <section class="panel">
      <div class="section-head">
        <div>
          <span class="eyebrow muted">Layer 2</span>
          <h2>Route Resolution</h2>
        </div>
        <span class="chip">${escapeHtml(resolution.route.label)}</span>
      </div>
      <div class="quick-strip">
        <div><span>Segment</span><strong>${escapeHtml(resolution.instrumentSegment)}</strong></div>
        <div><span>Type</span><strong>${escapeHtml(resolution.instrumentType ?? '-')}</strong></div>
        <div><span>Data</span><strong>${escapeHtml(resolution.dataProvider?.label ?? 'Missing')}</strong></div>
        <div><span>Trading</span><strong>${escapeHtml(resolution.tradingAccount?.label ?? 'Missing')}</strong></div>
      </div>
    </section>
  `;
}

function renderExecutionTicket(resolution: ExecutionRouteResolution | null, preview: QuickOrderPreviewResponse | null) {
  const setup = store.execution.setup;
  const optionSide = setup.bias === 'bullish' ? 'buy CE' : 'buy PE';
  const entryOrder = preview?.orders.find((item) => item.step === 'entry') ?? null;
  const stopOrder = preview?.orders.find((item) => item.step === 'stop_loss') ?? null;
  const targetOrder = preview?.orders.find((item) => item.step === 'take_profit') ?? null;
  const targetPrice = setup.useTargetOrder ? setup.exitLimitPrice || preview?.risk.premiumFiveRTargetPrice || 0 : null;
  const currentLotSize = getExecutionInstrument()?.lotSize ?? preview?.contract.lotSize ?? 0;
  const cappedRisk = preview ? getCapitalCappedRisk(preview, currentLotSize) : null;
  const livePositionConflict = getOpenTradeBlockMessage(preview);
  const tradeBlocked = Boolean(livePositionConflict?.blocked);
  const riskBlocked = Boolean(preview && !preview.risk.canTrade && preview.risk.riskBlockReason);
  const capitalBlocked = Boolean(preview && cappedRisk && cappedRisk.effectiveQuantity < 1);
  const canPlaceOrder = Boolean(preview && !tradeBlocked && !riskBlocked && !capitalBlocked);

  return `
    <section class="panel">
      <div class="section-head">
        <div>
          <span class="eyebrow muted">Layer 3</span>
          <h2>Execution Ticket</h2>
        </div>
        <span class="chip">${escapeHtml(optionSide)}</span>
      </div>
      ${
        store.execution.loading
          ? `
            <p class="muted-copy">Loading live option preview...</p>
          `
          : store.execution.error
            ? `
              <p class="muted-copy">${escapeHtml(store.execution.error)}</p>
            `
            : preview
          ? `
            <form id="ticket-form" class="form-grid execution-form">
              ${
                livePositionConflict
                  ? `<p class="full muted-copy ${tradeBlocked ? 'negative' : ''}">${escapeHtml(livePositionConflict.message)}</p>`
                  : ''
              }
              ${
                riskBlocked
                  ? `<p class="full muted-copy negative">${escapeHtml(preview?.risk.riskBlockReason ?? 'Current option price cannot buy even one lot within the configured risk budget.')}</p>`
                  : ''
              }
              ${
                capitalBlocked
                  ? `<p class="full muted-copy negative">${escapeHtml(preview?.risk.capitalBlockReason ?? 'Selected lot value exceeds available capital.')}</p>`
                  : cappedRisk?.capitalCapped
                    ? `<p class="full muted-copy">Lot count capped to ${formatNumber(cappedRisk.effectiveLots)} because capital is lower than the risk-based size.</p>`
                  : ''
              }
              <div class="full compact-readonly">
                <div>
                  <span>Contract</span>
                  <strong>${escapeHtml(preview.contract.tradingSymbol)}</strong>
                </div>
                <div>
                  <span>Entry</span>
                  <strong>${formatNumber(getPreviewEntryPrice(preview))}</strong>
                </div>
                <div>
                  <span>SL</span>
                  <strong>${formatNumber(preview.risk.premiumStopLossPrice)} / ${formatNumber(store.execution.setup.stopLimitManual ? store.execution.setup.stopLimitPrice : preview.risk.premiumStopLossPrice)}</strong>
                </div>
                <div>
                  <span>Risk</span>
                  <strong>${formatCurrency(preview.risk.totalRisk)}</strong>
                </div>
                <div>
                  <span>Capital Use</span>
                  <strong>${formatCurrency(cappedRisk?.capitalRequired ?? preview.risk.capitalRequired)} / ${formatCurrency(store.settings.capital)}</strong>
                </div>
              </div>
              <div class="full compact-readonly">
                <div>
                  <span>Strike</span>
                  <strong>${formatNumber(preview.contract.strikePrice)}</strong>
                </div>
                <div>
                  <span>Expiry</span>
                  <strong>${escapeHtml(formatDayMonth(preview.contract.expiry))}</strong>
                </div>
                <div>
                  <span>Lots</span>
                  <strong>${formatNumber(cappedRisk?.effectiveLots ?? preview.risk.lots)} × ${formatNumber(cappedRisk?.effectiveQuantity ?? preview.risk.quantity)}</strong>
                </div>
                <div>
                  <span>RR</span>
                  <strong>${formatRatio(preview.risk.expectedRiskReward)}</strong>
                </div>
              </div>
              <div class="full ticket-control-grid">
                <label>
                  <span>Entry</span>
                  <select name="entryOrderType">
                    <option value="limit" ${setup.entryOrderType === 'limit' ? 'selected' : ''}>Limit</option>
                    <option value="market" ${setup.entryOrderType === 'market' ? 'selected' : ''}>Market</option>
                  </select>
                </label>
                <label>
                  <span>Entry Price</span>
                  <input
                    name="entryLimitPrice"
                    type="number"
                    step="0.05"
                    value="${setup.entryOrderType === 'market' ? (preview.contract.topAskPrice || preview.contract.optionLastPrice) : (setup.entryLimitPrice || preview.contract.optionLastPrice)}"
                    ${setup.entryOrderType === 'market' ? 'disabled' : ''}
                  />
                </label>
                <label>
                  <span>SL Limit</span>
                  <input
                    name="stopLimitPrice"
                    type="number"
                    step="0.05"
                    value="${setup.stopLimitManual ? setup.stopLimitPrice : preview.risk.premiumStopLossPrice}"
                  />
                </label>
                <label>
                  <span>Target</span>
                  <select name="useTargetOrder">
                    <option value="no" ${setup.useTargetOrder ? '' : 'selected'}>Off</option>
                    <option value="yes" ${setup.useTargetOrder ? 'selected' : ''}>On</option>
                  </select>
                </label>
                <label>
                  <span>Exit</span>
                  <select name="exitOrderType">
                    <option value="limit" ${setup.exitOrderType === 'limit' ? 'selected' : ''}>Limit</option>
                    <option value="market" ${setup.exitOrderType === 'market' ? 'selected' : ''}>Market</option>
                  </select>
                </label>
                <label>
                  <span>5R Target</span>
                  <input
                    name="exitLimitPrice"
                    type="number"
                    step="0.05"
                    value="${setup.exitOrderType === 'market' ? (preview.contract.topBidPrice || preview.contract.optionLastPrice) : ((targetPrice ?? preview.risk.premiumFiveRTargetPrice) || preview.contract.topBidPrice || preview.contract.optionLastPrice)}"
                    ${setup.exitOrderType === 'market' || !setup.useTargetOrder ? 'disabled' : ''}
                  />
                </label>
              </div>
              <div class="full compact-readonly compact-readonly-tight">
                <div>
                  <span>Order Qty</span>
                  <strong>${formatNumber(cappedRisk?.effectiveQuantity ?? preview.risk.quantity)}</strong>
                </div>
                <div>
                  <span>Risk</span>
                  <strong>${formatCurrency(preview.risk.totalRisk)}</strong>
                </div>
                <div>
                  <span>Target / RR</span>
                  <strong>${formatNumber(setup.useTargetOrder ? getPreviewExitPrice(preview) : preview.risk.premiumFiveRTargetPrice)} · ${formatRatio(preview.risk.expectedRiskReward)}</strong>
                </div>
              </div>
              <div class="actions full">
                <button type="submit">Update Ticket</button>
                <button type="button" class="secondary-button" data-role="refresh-execution-preview">Refresh Live Preview</button>
                <button type="button" data-role="record-ticket-trade" ${canPlaceOrder ? '' : 'disabled'}>Place Quick Order</button>
              </div>
            </form>
          `
          : `
            <p class="muted-copy">Save a valid route and refresh the execution preview to fetch the live contract suggestion.</p>
          `
      }
    </section>
  `;
}

function renderTradeForm() {
  const activeInstruments = getActiveInstruments();
  const editingTrade = editingTradeId ? store.trades.find((trade) => trade.id === editingTradeId) ?? null : null;
  const fallbackInstrument = activeInstruments[0] ?? store.settings.instruments[0];

  return `
    <section class="panel">
      <div class="section-head">
        <div>
          <span class="eyebrow muted">Planner input</span>
          <h2>${editingTrade ? 'Edit Trade' : 'Add Trade'}</h2>
        </div>
        <span class="chip">${formatCurrency(getRiskPerTrade())} risk per trade</span>
      </div>
      <form id="trade-form" class="form-grid">
        <input type="hidden" name="tradeId" value="${editingTrade?.id ?? ''}" />
        <label>
          <span>Date</span>
          <input name="tradeDate" type="date" value="${escapeHtml(editingTrade?.tradeDate ?? store.selectedDate)}" required />
        </label>
        <label>
          <span>Time</span>
          <input name="tradeTime" type="time" value="${escapeHtml(editingTrade?.tradeTime ?? getCurrentTime())}" required />
        </label>
        <label>
          <span>Instrument</span>
          <select name="instrumentId">
            ${activeInstruments
              .map((instrument) => {
                const selectedId = editingTrade?.instrumentId ?? fallbackInstrument?.id ?? '';
                return `<option value="${instrument.id}" ${instrument.id === selectedId ? 'selected' : ''}>${escapeHtml(instrument.name)}</option>`;
              })
              .join('')}
          </select>
        </label>
        <label>
          <span>Direction</span>
          <select name="direction">
            <option value="long" ${(editingTrade?.direction ?? 'long') === 'long' ? 'selected' : ''}>Long</option>
            <option value="short" ${(editingTrade?.direction ?? 'long') === 'short' ? 'selected' : ''}>Short</option>
          </select>
        </label>
        <label class="full">
          <span>Description</span>
          <input name="description" value="${escapeHtml(editingTrade?.description ?? '')}" />
        </label>
        <label>
          <span>Entry</span>
          <input name="entry" type="number" step="0.05" value="${editingTrade?.entry ?? ''}" required />
        </label>
        <label>
          <span>Stop</span>
          <input name="stopLoss" type="number" step="0.05" value="${editingTrade?.stopLoss ?? ''}" required />
        </label>
        <label>
          <span>Exit</span>
          <input name="exit" type="number" step="0.05" value="${editingTrade?.exit ?? ''}" />
        </label>
        <label class="full">
          <span>Remarks</span>
          <textarea name="remarks" rows="3">${escapeHtml(editingTrade?.remarks ?? '')}</textarea>
        </label>
        <div class="actions full">
          ${editingTrade ? '<button type="button" class="secondary-button" data-role="cancel-edit">Cancel</button>' : ''}
          <button type="submit">${editingTrade ? 'Save Trade' : 'Add Trade'}</button>
        </div>
      </form>
    </section>
  `;
}

function renderBrokerOrdersPanel() {
  const enabledAccounts = store.tradingAccounts.filter((account) => account.enabled);
  const syncedOrders = enabledAccounts
    .flatMap((account) => (store.brokerOrders[account.id] ?? []).map((order) => ({ order, account })))
    .sort((left, right) => {
      const leftTime = new Date(left.order.updatedAt ?? left.order.createdAt ?? 0).getTime();
      const rightTime = new Date(right.order.updatedAt ?? right.order.createdAt ?? 0).getTime();
      return rightTime - leftTime;
    });

  return `
    <section class="panel broker-orders-panel">
      <div class="section-head">
        <div>
          <span class="eyebrow muted">Broker sync</span>
          <h2>Live Orders</h2>
        </div>
        <div class="section-head-actions">
          <span class="chip">${enabledAccounts.length} accounts</span>
          <button type="button" class="secondary-button slim" data-role="refresh-broker-orders">Refresh live orders</button>
        </div>
      </div>
      ${
        enabledAccounts.length === 0
          ? `<p class="muted-copy">Add at least one enabled trading account in Settings to sync live orders.</p>`
          : `
            <div class="broker-order-status-grid">
              ${enabledAccounts
                .map((account) => {
                  const sync = store.brokerOrderSyncs[account.id] ?? {
                    accountId: account.id,
                    broker: account.broker,
                    status: 'idle' as const,
                    message: 'Not refreshed yet.',
                    orderCount: 0,
                  };

                  return `
                    <article class="broker-order-status-card">
                      <div class="broker-order-status-head">
                        <div>
                          <strong>${escapeHtml(account.label)}</strong>
                          <small>${escapeHtml(account.broker)} · ${escapeHtml(account.ownerLabel)}</small>
                        </div>
                        <span class="chip">${escapeHtml(getBrokerOrderStatusLabel(sync.status))}</span>
                      </div>
                      <p>${escapeHtml(sync.message)}</p>
                      <div class="broker-order-status-meta">
                        <span>${sync.orderCount} orders</span>
                        <span>${escapeHtml(sync.lastSyncedAt ? formatTimeValue(sync.lastSyncedAt) : 'Not synced')}</span>
                      </div>
                    </article>
                  `;
                })
                .join('')}
            </div>
          `
      }
      ${
        syncedOrders.length === 0
          ? `<p class="muted-copy">No broker orders cached yet. Refresh to pull the latest order book from connected brokers.</p>`
          : `
            <div class="table-wrap broker-order-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Order</th>
                    <th>Symbol</th>
                    <th>Side</th>
                    <th>Status</th>
                    <th>Qty</th>
                    <th>Traded</th>
                    <th>Price</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  ${syncedOrders
                    .map(({ order, account }) => `
                      <tr>
                        <td>
                          <strong>${escapeHtml(account.label)}</strong>
                          <small>${escapeHtml(account.broker)}</small>
                        </td>
                        <td>
                          <strong>${escapeHtml(order.orderId)}</strong>
                          <small>${escapeHtml(order.exchangeOrderId ?? order.brokerAccountId)}</small>
                        </td>
                        <td>
                          <strong>${escapeHtml(order.symbol)}</strong>
                          <small>${escapeHtml([order.securityId, order.exchangeSegment].filter(Boolean).join(' · ') || '-')}</small>
                        </td>
                        <td>${escapeHtml(order.side)}</td>
                        <td><span class="broker-order-pill ${escapeHtml(order.status)}">${escapeHtml(order.status)}</span></td>
                        <td>${formatNumber(order.quantity)}</td>
                        <td>${formatNumber(order.tradedQuantity ?? 0)}</td>
                        <td>${formatNumber(order.price ?? 0)}</td>
                        <td>${escapeHtml(formatTimeValue(order.updatedAt ?? order.createdAt))}</td>
                      </tr>
                    `)
                    .join('')}
                </tbody>
              </table>
            </div>
          `
      }
    </section>
  `;
}

function renderTradeTable() {
  const trades = getTradesForSelectedDate();

  if (trades.length === 0) {
    return `
      <section class="panel">
        <div class="section-head">
          <div>
            <span class="eyebrow muted">Today board</span>
            <h2>Trades</h2>
          </div>
        </div>
        <p class="muted-copy">No trades saved for ${escapeHtml(store.selectedDate)}.</p>
      </section>
    `;
  }

  return `
    <section class="panel">
      <div class="section-head">
        <div>
          <span class="eyebrow muted">Today board</span>
          <h2>Trades</h2>
        </div>
        <span class="chip">${trades.length} rows</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Time</th>
              <th>Instrument</th>
              <th>Description</th>
              <th>Direction</th>
              <th>Entry</th>
              <th>SL</th>
              <th>Lots</th>
              <th>Risk</th>
              <th>Exit</th>
              <th>P/L</th>
              <th>RR</th>
              <th>Remarks</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${trades
              .map((trade) => {
                const instrument = getInstrumentById(trade.instrumentId);
                const metrics = calculateTradeMetrics(trade);

                return `
                  <tr>
                    <td>${escapeHtml(trade.tradeDate)}</td>
                    <td>${escapeHtml(trade.tradeTime)}</td>
                    <td>
                      <strong>${escapeHtml(instrument?.name ?? 'Unknown')}</strong>
                      <small>${escapeHtml(trade.optionExpiry ? formatDayMonth(trade.optionExpiry) : '-')}</small>
                    </td>
                    <td>${escapeHtml(trade.description)}</td>
                    <td>${escapeHtml(trade.direction)}</td>
                    <td>${formatNumber(trade.entry)}</td>
                    <td>${formatNumber(trade.stopLoss)}</td>
                    <td>${formatNumber(metrics.lots)}</td>
                    <td>${formatCurrency(metrics.risk)}</td>
                    <td>${trade.exit === null ? '-' : formatNumber(trade.exit)}</td>
                    <td class="${(metrics.pnl ?? 0) >= 0 ? 'positive' : 'negative'}">${formatCurrency(metrics.pnl)}</td>
                    <td>${formatRatio(metrics.rr)}</td>
                    <td>${escapeHtml(trade.remarks)}</td>
                    <td class="row-actions">
                      <button type="button" class="link-button" data-role="edit-trade" data-id="${trade.id}">Edit</button>
                      <button type="button" class="link-button danger" data-role="delete-trade" data-id="${trade.id}">Delete</button>
                    </td>
                  </tr>
                `;
              })
              .join('')}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderTradesPage() {
  const daySummary = calculateSummary(getTradesForSelectedDate());
  const allSummary = calculateSummary(store.trades);
  const currentBalance = Number((store.settings.openingBalance + allSummary.totalPnl).toFixed(2));

  return `
    ${renderBrokerOrdersPanel()}

    <section class="stats-grid">
      <article class="stat-card">
        <span class="label">Capital</span>
        <strong>${formatCurrency(store.settings.capital)}</strong>
      </article>
      <article class="stat-card">
        <span class="label">Risk / Trade</span>
        <strong>${formatCurrency(getRiskPerTrade())}</strong>
      </article>
      <article class="stat-card">
        <span class="label">Selected Day P/L</span>
        <strong class="${daySummary.totalPnl >= 0 ? 'positive' : 'negative'}">${formatCurrency(daySummary.totalPnl)}</strong>
      </article>
      <article class="stat-card">
        <span class="label">Current Balance</span>
        <strong>${formatCurrency(currentBalance)}</strong>
      </article>
    </section>

    <section class="panel toolbar">
      <label>
        <span>Working date</span>
        <input id="selected-date" type="date" value="${escapeHtml(store.selectedDate)}" />
      </label>
      <div class="toolbar-metrics">
        <div><span>Trades</span><strong>${daySummary.trades}</strong></div>
        <div><span>Open</span><strong>${daySummary.openTrades}</strong></div>
        <div><span>Day Risk</span><strong>${formatCurrency(daySummary.totalRisk)}</strong></div>
      </div>
    </section>

    <section class="content-grid trades-layout">
      ${renderTradeForm()}
      ${renderTradeTable()}
    </section>
  `;
}

function renderCalendarPage() {
  const monthDate = getMonthDate(store.selectedDate);
  const monthlyTrades = getTradesForMonth(monthDate);
  const monthSummary = calculateSummary(monthlyTrades);
  const dailyMap = new Map<string, number>();

  monthlyTrades.forEach((trade) => {
    dailyMap.set(trade.tradeDate, (dailyMap.get(trade.tradeDate) ?? 0) + getTradeNetPnl(trade));
  });

  const tradedDays = [...dailyMap.keys()].length;
  const profitableDays = [...dailyMap.values()].filter((pnl) => pnl > 0).length;
  const streaks = calculateStreaks(monthlyTrades);
  const allSummary = calculateSummary(store.trades);
  const monthlyBest = dailyMap.size > 0 ? Math.max(...dailyMap.values()) : 0;
  const allDailyMap = new Map<string, number>();

  store.trades.forEach((trade) => {
    allDailyMap.set(trade.tradeDate, (allDailyMap.get(trade.tradeDate) ?? 0) + getTradeNetPnl(trade));
  });

  const bestAllTime = allDailyMap.size > 0 ? Math.max(...allDailyMap.values()) : 0;
  const firstDay = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const daysInMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
  const offset = (firstDay.getDay() + 6) % 7;
  const cells: string[] = [];

  for (let index = 0; index < offset; index += 1) {
    cells.push('<div class="calendar-cell empty"></div>');
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const tradeDate = `${monthDate.getFullYear()}-${pad(monthDate.getMonth() + 1)}-${pad(day)}`;
    const pnl = dailyMap.get(tradeDate);
    const hasTrades = pnl !== undefined;
    const isSelected = tradeDate === store.selectedDate;
    const tone = !hasTrades ? 'neutral' : pnl > 0 ? 'positive' : pnl < 0 ? 'negative' : 'flat';

    cells.push(`
      <button type="button" class="calendar-cell ${tone} ${isSelected ? 'selected' : ''}" data-role="pick-calendar-date" data-date="${tradeDate}">
        <strong>${day}</strong>
        <span>${hasTrades ? formatCurrency(pnl ?? 0) : '-'}</span>
      </button>
    `);
  }

  return `
    <section class="panel">
      <div class="section-head">
        <div>
          <span class="eyebrow muted">Monthly snapshot</span>
          <h2>${monthLabel(monthDate)}</h2>
        </div>
        <div class="month-switcher">
          <button type="button" class="secondary-button slim" data-role="change-month" data-direction="prev">Previous</button>
          <button type="button" class="secondary-button slim" data-role="change-month" data-direction="next">Next</button>
        </div>
      </div>
      <section class="stats-grid calendar-stats">
        <article class="stat-card">
          <span class="label">Net Realised P&amp;L</span>
          <strong class="${monthSummary.totalPnl >= 0 ? 'positive' : 'negative'}">${formatCurrency(monthSummary.totalPnl)}</strong>
        </article>
        <article class="stat-card">
          <span class="label">Most Profitable This Month</span>
          <strong class="${monthlyBest >= 0 ? 'positive' : 'negative'}">${formatCurrency(monthlyBest)}</strong>
        </article>
        <article class="stat-card">
          <span class="label">Most Profitable All Time</span>
          <strong class="${bestAllTime >= 0 ? 'positive' : 'negative'}">${formatCurrency(bestAllTime)}</strong>
        </article>
        <article class="stat-card">
          <span class="label">Trading Days</span>
          <strong>${tradedDays}</strong>
        </article>
        <article class="stat-card">
          <span class="label">In-Profit Days</span>
          <strong>${profitableDays}</strong>
        </article>
        <article class="stat-card">
          <span class="label">Winning Streak</span>
          <strong>${streaks.bestWinning}</strong>
        </article>
        <article class="stat-card">
          <span class="label">Current Streak</span>
          <strong>${streaks.currentWinning}</strong>
        </article>
        <article class="stat-card">
          <span class="label">Total Trades</span>
          <strong>${monthlyTrades.length}</strong>
        </article>
      </section>
    </section>

    <section class="panel">
      <div class="section-head">
        <div>
          <span class="eyebrow muted">Monthly trades P&amp;L</span>
          <h2>Calendar</h2>
        </div>
        <span class="chip">${monthLabel(monthDate)}</span>
      </div>
      <div class="calendar-headings">
        <span>Mon</span>
        <span>Tue</span>
        <span>Wed</span>
        <span>Thu</span>
        <span>Fri</span>
        <span>Sat</span>
        <span>Sun</span>
      </div>
      <div class="calendar-grid">${cells.join('')}</div>
      <p class="calendar-footnote">
        ${monthLabel(monthDate)}: profitable days ${profitableDays}/${tradedDays || 0} traded days
      </p>
    </section>

    <section class="stats-grid">
      <article class="stat-card">
        <span class="label">Overall P&amp;L</span>
        <strong class="${allSummary.totalPnl >= 0 ? 'positive' : 'negative'}">${formatCurrency(allSummary.totalPnl)}</strong>
      </article>
      <article class="stat-card">
        <span class="label">Net P&amp;L</span>
        <strong class="${monthSummary.totalPnl >= 0 ? 'positive' : 'negative'}">${formatCurrency(monthSummary.totalPnl)}</strong>
      </article>
      <article class="stat-card">
        <span class="label">Total Trades</span>
        <strong>${monthlyTrades.length}</strong>
      </article>
      <article class="stat-card">
        <span class="label">Selected Date</span>
        <strong>${escapeHtml(store.selectedDate)}</strong>
      </article>
    </section>
  `;
}

function renderDataProviderSettings() {
  return `
    <div class="full section-split">
      <div>
        <span class="eyebrow muted">Data providers</span>
        <h3>Shared market data connections</h3>
      </div>
      <button type="button" class="secondary-button slim" data-role="add-data-provider">Add data provider</button>
    </div>
    <div class="full broker-account-list">
      ${store.dataProviders
        .map((account) => {
          const authFields = getBrokerAuthFieldConfig(account);

          return `
            <section class="broker-card">
              <div class="section-head">
                <div>
                  <span class="eyebrow muted">${escapeHtml(account.provider)}</span>
                  <h3>${escapeHtml(account.label)}</h3>
                </div>
                <span class="chip">${escapeHtml(account.healthStatus)}</span>
              </div>
              <div class="form-grid broker-grid broker-grid-top">
                <label>
                  <span>Provider</span>
                  <select name="dataProviderProvider:${account.id}">
                    ${['dhan', 'zerodha', 'angelone', 'delta']
                      .map((broker) => `<option value="${broker}" ${account.provider === broker ? 'selected' : ''}>${broker}</option>`)
                      .join('')}
                  </select>
                </label>
                <label>
                  <span>Label</span>
                  <input name="dataProviderLabel:${account.id}" value="${escapeHtml(account.label)}" />
                </label>
                <label>
                  <span>Auth Mode</span>
                  <select name="dataProviderAuthMode:${account.id}">
                    <option value="access_token" ${account.authMode === 'access_token' ? 'selected' : ''}>access token</option>
                    <option value="oauth_app" ${account.authMode === 'oauth_app' ? 'selected' : ''}>oauth app</option>
                    <option value="api_key_secret" ${account.authMode === 'api_key_secret' ? 'selected' : ''}>api key secret</option>
                  </select>
                </label>
                <label class="toggle-row">
                  <input name="dataProviderEnabled:${account.id}" type="checkbox" ${account.enabled ? 'checked' : ''} />
                  <span>Enabled</span>
                </label>
              </div>

              <div class="broker-section">
                <div class="section-head">
                  <div>
                    <span class="eyebrow muted">Auth</span>
                    <h4>Credentials for ${escapeHtml(account.authMode)}</h4>
                  </div>
                  <button type="button" class="secondary-button slim" data-role="test-data-provider" data-id="${account.id}">Test Token</button>
                </div>
                <div class="form-grid broker-grid">
                  ${authFields
                    .map(
                      (field) => `
                        <label>
                          <span>${escapeHtml(field.label)}</span>
                          <input name="dataProvider${field.key}:${account.id}" value="${escapeHtml(getCredentialValue(account.credentials as Record<string, string | undefined>, field.key))}" />
                        </label>
                      `,
                    )
                    .join('')}
                </div>
              </div>

              <div class="broker-section">
                <div>
                  <span class="eyebrow muted">Connection</span>
                  <h4>Feed capabilities</h4>
                </div>
                <div class="form-grid broker-grid">
                  <label class="full">
                    <span>Exchanges</span>
                    <input name="dataProviderExchanges:${account.id}" value="${escapeHtml(account.exchanges.join(', '))}" />
                  </label>
                  <label class="toggle-row">
                    <input name="dataProviderLiveFeedEnabled:${account.id}" type="checkbox" ${account.connection.liveFeedEnabled ? 'checked' : ''} />
                    <span>Live Feed</span>
                  </label>
                  <label class="toggle-row">
                    <input name="dataProviderOptionChainEnabled:${account.id}" type="checkbox" ${account.connection.optionChainEnabled ? 'checked' : ''} />
                    <span>Option Chain</span>
                  </label>
                  <label class="toggle-row">
                    <input name="dataProviderScripMasterEnabled:${account.id}" type="checkbox" ${account.connection.scripMasterEnabled ? 'checked' : ''} />
                    <span>Scrip Master</span>
                  </label>
                  <label class="full">
                    <span>Notes</span>
                    <textarea name="dataProviderNotes:${account.id}" rows="2">${escapeHtml(account.notes ?? '')}</textarea>
                  </label>
                </div>
              </div>

              <div class="actions">
                <button type="button" class="link-button danger" data-role="delete-data-provider" data-id="${account.id}">Delete</button>
              </div>
            </section>
          `;
        })
        .join('')}
    </div>
  `;
}

function renderTradingAccountSettings() {
  return `
    <div class="full section-split">
      <div>
        <span class="eyebrow muted">Trading accounts</span>
        <h3>Multiple broker accounts per individual</h3>
      </div>
      <button type="button" class="secondary-button slim" data-role="add-trading-account">Add trading account</button>
    </div>
    <div class="full broker-account-list">
      ${store.tradingAccounts.map((account) => {
        const authFields = getBrokerAuthFieldConfig(account);
        return `
          <section class="broker-card">
            <div class="section-head">
              <div>
                <span class="eyebrow muted">${escapeHtml(account.broker)}</span>
                <h3>${escapeHtml(account.label)}</h3>
              </div>
              <span class="chip">${escapeHtml(account.healthStatus)}</span>
            </div>
            <div class="form-grid broker-grid broker-grid-top">
              <label>
                <span>Broker</span>
                <select name="tradingBroker:${account.id}">
                  ${['dhan', 'zerodha', 'angelone', 'delta'].map((broker) => `<option value="${broker}" ${account.broker === broker ? 'selected' : ''}>${broker}</option>`).join('')}
                </select>
              </label>
              <label>
                <span>Label</span>
                <input name="tradingLabel:${account.id}" value="${escapeHtml(account.label)}" />
              </label>
              <label>
                <span>Owner</span>
                <input name="tradingOwner:${account.id}" value="${escapeHtml(account.ownerLabel)}" />
              </label>
              <label>
                <span>Mode</span>
                <select name="tradingMode:${account.id}">
                  <option value="paper" ${account.mode === 'paper' ? 'selected' : ''}>paper</option>
                  <option value="live" ${account.mode === 'live' ? 'selected' : ''}>live</option>
                </select>
              </label>
              <label>
                <span>Auth Mode</span>
                <select name="tradingAuthMode:${account.id}">
                  <option value="access_token" ${account.authMode === 'access_token' ? 'selected' : ''}>access token</option>
                  <option value="oauth_app" ${account.authMode === 'oauth_app' ? 'selected' : ''}>oauth app</option>
                  <option value="api_key_secret" ${account.authMode === 'api_key_secret' ? 'selected' : ''}>api key secret</option>
                </select>
              </label>
              <label class="toggle-row">
                <input name="tradingEnabled:${account.id}" type="checkbox" ${account.enabled ? 'checked' : ''} />
                <span>Enabled</span>
              </label>
            </div>
            <div class="broker-section">
              <div class="section-head">
                <div><span class="eyebrow muted">Auth</span><h4>Trading credentials</h4></div>
                <button type="button" class="secondary-button slim" data-role="test-trading-account" data-id="${account.id}">Test Token</button>
              </div>
              <div class="form-grid broker-grid">
                ${authFields.map((field) => `<label><span>${escapeHtml(field.label)}</span><input name="trading${field.key}:${account.id}" value="${escapeHtml(getCredentialValue(account.credentials as Record<string, string | undefined>, field.key))}" /></label>`).join('')}
              </div>
            </div>
            <div class="broker-section">
              <div><span class="eyebrow muted">Execution</span><h4>Order defaults</h4></div>
              <div class="form-grid broker-grid">
                <label><span>Supported Exchanges</span><input name="tradingExchanges:${account.id}" value="${escapeHtml(account.supportedExchanges.join(', '))}" /></label>
                <label><span>Product Type</span><select name="tradingProductType:${account.id}">${['INTRADAY', 'MARGIN', 'CNC', 'MTF', 'CO', 'BO'].map((value) => `<option value="${value}" ${account.defaults.productType === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
                <label><span>Validity</span><select name="tradingValidity:${account.id}">${['DAY', 'IOC'].map((value) => `<option value="${value}" ${account.defaults.validity === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
                <label><span>Exchange Segment</span><input name="tradingExchangeSegment:${account.id}" value="${escapeHtml(account.defaults.exchangeSegment ?? '')}" /></label>
                <label><span>Whitelisted IP</span><input name="tradingWhitelistedIp:${account.id}" value="${escapeHtml(account.whitelistedIp ?? '')}" /></label>
                <label class="toggle-row"><input name="tradingStaticIp:${account.id}" type="checkbox" ${account.staticIpWhitelisted ? 'checked' : ''} /><span>Static IP Whitelisted</span></label>
                <label class="full"><span>Notes</span><textarea name="tradingNotes:${account.id}" rows="2">${escapeHtml(account.notes ?? '')}</textarea></label>
              </div>
            </div>
            <div class="actions">
              <button type="button" class="link-button danger" data-role="delete-trading-account" data-id="${account.id}">Delete</button>
            </div>
          </section>
        `;
      }).join('')}
    </div>
  `;
}

function renderExecutionRouteSettings() {
  const segmentOptions = ['NSE_FNO', 'BSE_FNO', 'MCX'];
  const underlyingOptions = [
    { value: '', label: 'Any underlying' },
    ...store.settings.instruments.map((instrument) => ({
      value: instrument.name.trim().toUpperCase(),
      label: instrument.name.trim().toUpperCase(),
    })),
  ].filter((option, index, list) => list.findIndex((item) => item.value === option.value) === index);

  return `
    <div class="full section-split">
      <div>
        <span class="eyebrow muted">Execution routes</span>
        <h3>Route segments to the right account</h3>
      </div>
      <button type="button" class="secondary-button slim" data-role="add-execution-route">Add route</button>
    </div>
    <div class="full broker-account-list">
      ${store.executionRoutes.map((route) => `
        <section class="broker-card">
          <div class="section-head">
            <div><span class="eyebrow muted">${escapeHtml(route.instrumentSegments.join(', '))}</span><h3>${escapeHtml(route.label)}</h3></div>
            <span class="chip">${route.enabled ? 'enabled' : 'disabled'}</span>
          </div>
          <div class="form-grid broker-grid">
            <label><span>Label</span><input name="routeLabel:${route.id}" value="${escapeHtml(route.label)}" /></label>
            <div>
              <span>Segment</span>
              <div class="choice-row">
                ${segmentOptions.map((segment) => `
                  <label class="toggle-row compact">
                    <input
                      name="routeSegments:${route.id}"
                      value="${segment}"
                      type="checkbox"
                      ${route.instrumentSegments.includes(segment) ? 'checked' : ''}
                    />
                    <span>${escapeHtml(segment)}</span>
                  </label>
                `).join('')}
              </div>
            </div>
            <label><span>Underlying</span><select name="routeUnderlying:${route.id}">${underlyingOptions.map((option) => `<option value="${escapeHtml(option.value)}" ${String(route.underlyingSymbol ?? '') === option.value ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}</select></label>
            <label><span>Type</span><select name="routeType:${route.id}">${['index_option', 'commodity_option', 'future', 'spot'].map((value) => `<option value="${value}" ${route.instrumentType === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
            <label><span>Data Provider</span><select name="routeDataProvider:${route.id}"><option value="">None</option>${store.dataProviders.map((item) => `<option value="${item.id}" ${route.dataProviderId === item.id ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}</select></label>
            <label><span>Trading Account</span><select name="routeTradingAccount:${route.id}">${store.tradingAccounts.map((item) => `<option value="${item.id}" ${route.tradingAccountId === item.id ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}</select></label>
            <label><span>Priority</span><input name="routePriority:${route.id}" type="number" step="1" min="1" value="${route.priority}" /></label>
            <label class="toggle-row"><input name="routeEnabled:${route.id}" type="checkbox" ${route.enabled ? 'checked' : ''} /><span>Enabled</span></label>
          </div>
          <div class="actions">
            <button type="button" class="link-button danger" data-role="delete-execution-route" data-id="${route.id}">Delete</button>
          </div>
        </section>
      `).join('')}
    </div>
  `;
}

function renderSettingsPage() {
  const catalogEntries = getFilteredUnderlyingCatalog();
  const selectedCatalog = catalogEntries[0] ?? null;
  const enabledSymbols = new Set(store.settings.instruments.map((instrument) => instrument.name.trim().toUpperCase()));

  return `
    <section class="panel">
      <div class="section-head">
        <div>
          <span class="eyebrow muted">Capital setup</span>
          <h2>Risk Settings</h2>
        </div>
        <span class="chip">Saved locally in your browser</span>
      </div>
      <form id="settings-form" class="form-grid">
        <label>
          <span>Capital</span>
          <input name="capital" type="number" step="any" value="${store.settings.capital}" required />
        </label>
        <label>
          <span>Risk / Trade %</span>
          <input name="riskPercent" type="number" step="any" value="${store.settings.riskPercent}" required />
        </label>
        <label>
          <span>Risk / Trade Rs.</span>
          <input id="risk-rupees" type="text" value="${formatCurrency(getRiskPerTrade())}" readonly />
        </label>
        <label>
          <span>Opening Balance</span>
          <input name="openingBalance" type="number" step="any" value="${store.settings.openingBalance}" required />
        </label>
        <div class="full section-split">
          <div>
            <span class="eyebrow muted">Instrument master</span>
            <h3>Filtered from scrip master</h3>
          </div>
          <div class="choice-row">
            <button type="button" class="secondary-button slim ${underlyingCatalogFilter === 'IDX' ? 'active' : ''}" data-role="filter-underlying-catalog" data-filter="IDX">IDX</button>
            <button type="button" class="secondary-button slim ${underlyingCatalogFilter === 'COMM' ? 'active' : ''}" data-role="filter-underlying-catalog" data-filter="COMM">COMM</button>
          </div>
        </div>
        <div class="full section-split">
          <div class="catalog-picker">
            <span class="eyebrow muted">Add underlying</span>
            <h3>${escapeHtml(underlyingCatalogFilter)} catalog</h3>
          </div>
          <div class="catalog-picker-controls">
            <select name="catalogUnderlying">
              ${
                catalogEntries.length === 0
                  ? `<option value="">No underlyings loaded</option>`
                  : catalogEntries
                      .map((item) => {
                        const active = enabledSymbols.has(item.symbol);
                        return `<option value="${escapeHtml(item.symbol)}">${escapeHtml(item.symbol)} · ${formatNumber(item.lotSize)} lot${active ? ' · enabled' : ''}</option>`;
                      })
                      .join('')
              }
            </select>
            <button type="button" class="secondary-button slim" data-role="add-underlying" ${selectedCatalog ? '' : 'disabled'}>Add / enable</button>
          </div>
        </div>
        <div class="full table-wrap">
          <table>
            <thead>
              <tr>
                <th>Instrument</th>
                <th>Lot Size</th>
                <th>Strike Step</th>
                <th>Enabled</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${store.settings.instruments
                .map((instrument) => {
                  const isInUse = store.trades.some((trade) => trade.instrumentId === instrument.id);

                  return `
                    <tr>
                      <td><strong>${escapeHtml(instrument.name)}</strong></td>
                      <td><span class="readonly-chip">${formatNumber(instrument.lotSize)}</span></td>
                      <td><span class="readonly-chip">${formatNumber(instrument.strikeStep)}</span></td>
                      <td><input name="enabled:${instrument.id}" type="checkbox" ${instrument.enabled ? 'checked' : ''} /></td>
                      <td>
                        <button type="button" class="link-button danger" data-role="delete-instrument" data-id="${instrument.id}" ${isInUse ? 'disabled' : ''}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  `;
                })
                .join('')}
            </tbody>
          </table>
        </div>
        <div class="actions full">
          <button type="button" class="secondary-button" data-role="reset-planner">Reset planner</button>
          <button type="submit">Save settings</button>
        </div>
        ${renderDataProviderSettings()}
        ${renderTradingAccountSettings()}
        ${renderExecutionRouteSettings()}
        <div class="actions full">
          <button type="submit">Save settings</button>
        </div>
      </form>
    </section>
  `;
}

function syncSettingsMasterData() {
  void syncUnderlyingCatalogFromMaster();
  void syncInstrumentLotSizesFromMaster();
}

function render() {
  const shouldAutoRefreshBrokerOrders = store.activePage === 'trades' && lastRenderedPage !== 'trades' && store.tradingAccounts.some((account) => account.enabled);
  const shouldAutoRefreshExecution = store.activePage === 'execution' && lastRenderedPage !== 'execution';
  const shouldRefreshSettingsMaster = store.activePage === 'settings' && lastRenderedPage !== 'settings';

  app.innerHTML = `
    <main class="page-shell">
      ${renderNav()}
      ${
        store.activePage === 'execution'
          ? renderExecutionPage()
          : store.activePage === 'trades'
            ? renderTradesPage()
            : store.activePage === 'calendar'
              ? renderCalendarPage()
              : renderSettingsPage()
      }
    </main>
  `;

  lastRenderedPage = store.activePage;
  bindEvents();

  if (shouldAutoRefreshBrokerOrders) {
    void refreshAllBrokerOrders();
  }

  if (shouldAutoRefreshExecution) {
    void refreshAllExecutionCards();
  }

  if (shouldRefreshSettingsMaster) {
    syncSettingsMasterData();
  }
}

function recordExecutionTrade() {
  const instrument = getExecutionInstrument();
  const preview = store.execution.preview;
  const livePositionConflict = getOpenTradeBlockMessage(preview);
  const cappedRisk = preview ? getCapitalCappedRisk(preview) : null;

  if (!preview || !instrument || (cappedRisk?.effectiveQuantity ?? preview.risk.quantity) < 1 || livePositionConflict?.blocked) {
    return;
  }

  const entry =
    store.execution.setup.entryOrderType === 'limit'
      ? store.execution.setup.entryLimitPrice || preview.contract.topAskPrice || preview.contract.optionLastPrice
      : preview.contract.topAskPrice || preview.contract.optionLastPrice;

  store.trades.push({
    id: createId('trade'),
    tradeDate: store.selectedDate,
    tradeTime: getCurrentTime(),
    instrumentId: instrument.id,
    description: `${preview.contract.tradingSymbol} ${store.execution.setup.expiryLabel}`,
    direction: 'long',
    entry,
    stopLoss: preview.risk.premiumStopLossPrice,
    exit: null,
    remarks: `Generated from execution workflow. Qty ${cappedRisk?.effectiveQuantity ?? preview.risk.quantity}, expected RR ${formatRatio(preview.risk.expectedRiskReward)}.`,
    underlyingSymbol: preview.contract.underlyingSymbol,
    optionStrike: preview.contract.strikePrice,
    optionExpiry: preview.contract.expiry,
    optionType: preview.contract.optionType,
    broker: preview.request.broker,
    brokerAccountLabel: store.execution.resolvedTradingAccountId
      ? store.tradingAccounts.find((account) => account.id === store.execution.resolvedTradingAccountId)?.label
      : undefined,
  });

  store.activePage = 'trades';
  persistStore();
  render();
}

function bindSettingsPreview() {
  const capitalInput = document.querySelector<HTMLInputElement>('input[name="capital"]');
  const riskPercentInput = document.querySelector<HTMLInputElement>('input[name="riskPercent"]');
  const riskRupeesInput = document.querySelector<HTMLInputElement>('#risk-rupees');

  if (!capitalInput || !riskPercentInput || !riskRupeesInput) {
    return;
  }

  const update = () => {
    const capital = Number(capitalInput.value || 0);
    const riskPercent = Number(riskPercentInput.value || 0);
    riskRupeesInput.value = formatCurrency(Number(((capital * riskPercent) / 100).toFixed(2)));
  };

  capitalInput.addEventListener('input', update);
  riskPercentInput.addEventListener('input', update);
  update();
}

function getRouteSegmentFromForm(formData: FormData, route: ExecutionRouteSettings) {
  const segmentOptions = ['NSE_FNO', 'BSE_FNO', 'MCX'];
  const selected = formData.getAll(`routeSegments:${route.id}`).map((value) => String(value).trim().toUpperCase()).filter((value) => segmentOptions.includes(value));
  return selected.length > 0 ? [...new Set(selected)] : route.instrumentSegments;
}

function applySettingsFormDraft(settingsForm: HTMLFormElement) {
  const formData = new FormData(settingsForm);

  store.settings.capital = Number(formData.get('capital') ?? store.settings.capital);
  store.settings.riskPercent = Number(formData.get('riskPercent') ?? store.settings.riskPercent);
  store.settings.openingBalance = Number(formData.get('openingBalance') ?? store.settings.openingBalance);
  store.settings.instruments = store.settings.instruments.map((instrument) => ({
    ...instrument,
    name: String(formData.get(`name:${instrument.id}`) ?? instrument.name).trim() || instrument.name,
    lotSize: Number(formData.get(`lotSize:${instrument.id}`) ?? instrument.lotSize),
    strikeStep: Number(formData.get(`strikeStep:${instrument.id}`) ?? instrument.strikeStep),
    enabled: formData.get(`enabled:${instrument.id}`) === 'on',
  }));

  store.dataProviders = store.dataProviders.map((account) => ({
    ...account,
    provider: String(formData.get(`dataProviderProvider:${account.id}`) ?? account.provider) as DataProviderSettings['provider'],
    label: String(formData.get(`dataProviderLabel:${account.id}`) ?? account.label).trim() || account.label,
    enabled: formData.get(`dataProviderEnabled:${account.id}`) === 'on',
    authMode: String(formData.get(`dataProviderAuthMode:${account.id}`) ?? account.authMode) as BrokerAuthMode,
    credentials: {
      ...account.credentials,
      clientId: String(formData.get(`dataProviderclientId:${account.id}`) ?? account.credentials.clientId ?? ''),
      clientCode: String(formData.get(`dataProviderclientCode:${account.id}`) ?? account.credentials.clientCode ?? ''),
      accessToken: String(formData.get(`dataProvideraccessToken:${account.id}`) ?? account.credentials.accessToken ?? ''),
      apiKey: String(formData.get(`dataProviderapiKey:${account.id}`) ?? account.credentials.apiKey ?? ''),
      apiSecret: String(formData.get(`dataProviderapiSecret:${account.id}`) ?? account.credentials.apiSecret ?? ''),
      redirectUrl: String(formData.get(`dataProviderredirectUrl:${account.id}`) ?? account.credentials.redirectUrl ?? ''),
      postbackUrl: String(formData.get(`dataProviderpostbackUrl:${account.id}`) ?? account.credentials.postbackUrl ?? ''),
      totpSecret: String(formData.get(`dataProvidertotpSecret:${account.id}`) ?? account.credentials.totpSecret ?? ''),
      pin: String(formData.get(`dataProviderpin:${account.id}`) ?? account.credentials.pin ?? ''),
      refreshToken: String(formData.get(`dataProviderrefreshToken:${account.id}`) ?? account.credentials.refreshToken ?? ''),
      feedToken: String(formData.get(`dataProviderfeedToken:${account.id}`) ?? account.credentials.feedToken ?? ''),
    },
    connection: {
      ...account.connection,
      redirectUrl: String(formData.get(`dataProviderRedirectUrl:${account.id}`) ?? account.connection.redirectUrl ?? ''),
      postbackUrl: String(formData.get(`dataProviderPostbackUrl:${account.id}`) ?? account.connection.postbackUrl ?? ''),
      liveFeedEnabled: formData.get(`dataProviderLiveFeedEnabled:${account.id}`) === 'on',
      optionChainEnabled: formData.get(`dataProviderOptionChainEnabled:${account.id}`) === 'on',
      scripMasterEnabled: formData.get(`dataProviderScripMasterEnabled:${account.id}`) === 'on',
      staticIpWhitelisted: false,
      whitelistedIp: '',
    },
    exchanges: String(formData.get(`dataProviderExchanges:${account.id}`) ?? account.exchanges.join(','))
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    notes: String(formData.get(`dataProviderNotes:${account.id}`) ?? account.notes ?? ''),
  }));

  store.tradingAccounts = store.tradingAccounts.map((account) => ({
    ...account,
    broker: String(formData.get(`tradingBroker:${account.id}`) ?? account.broker) as TradingAccountSettings['broker'],
    label: String(formData.get(`tradingLabel:${account.id}`) ?? account.label).trim() || account.label,
    ownerLabel: String(formData.get(`tradingOwner:${account.id}`) ?? account.ownerLabel).trim() || account.ownerLabel,
    mode: formData.get(`tradingMode:${account.id}`) === 'live' ? 'live' : 'paper',
    enabled: formData.get(`tradingEnabled:${account.id}`) === 'on',
    authMode: String(formData.get(`tradingAuthMode:${account.id}`) ?? account.authMode) as BrokerAuthMode,
    credentials: {
      ...account.credentials,
      clientId: String(formData.get(`tradingclientId:${account.id}`) ?? account.credentials.clientId ?? ''),
      clientCode: String(formData.get(`tradingclientCode:${account.id}`) ?? account.credentials.clientCode ?? ''),
      accessToken: String(formData.get(`tradingaccessToken:${account.id}`) ?? account.credentials.accessToken ?? ''),
      apiKey: String(formData.get(`tradingapiKey:${account.id}`) ?? account.credentials.apiKey ?? ''),
      apiSecret: String(formData.get(`tradingapiSecret:${account.id}`) ?? account.credentials.apiSecret ?? ''),
      redirectUrl: String(formData.get(`tradingredirectUrl:${account.id}`) ?? account.credentials.redirectUrl ?? ''),
      totpSecret: String(formData.get(`tradingtotpSecret:${account.id}`) ?? account.credentials.totpSecret ?? ''),
      pin: String(formData.get(`tradingpin:${account.id}`) ?? account.credentials.pin ?? ''),
      refreshToken: String(formData.get(`tradingrefreshToken:${account.id}`) ?? account.credentials.refreshToken ?? ''),
      feedToken: String(formData.get(`tradingfeedToken:${account.id}`) ?? account.credentials.feedToken ?? ''),
    },
    defaults: {
      productType: String(formData.get(`tradingProductType:${account.id}`) ?? account.defaults.productType) as BrokerProductType,
      validity: String(formData.get(`tradingValidity:${account.id}`) ?? account.defaults.validity) as BrokerOrderValidity,
      exchangeSegment: String(formData.get(`tradingExchangeSegment:${account.id}`) ?? account.defaults.exchangeSegment ?? ''),
    },
    supportedExchanges: String(formData.get(`tradingExchanges:${account.id}`) ?? account.supportedExchanges.join(','))
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    staticIpWhitelisted: formData.get(`tradingStaticIp:${account.id}`) === 'on',
    whitelistedIp: String(formData.get(`tradingWhitelistedIp:${account.id}`) ?? account.whitelistedIp ?? ''),
    notes: String(formData.get(`tradingNotes:${account.id}`) ?? account.notes ?? ''),
  }));

  store.executionRoutes = store.executionRoutes.map((route) => ({
    ...route,
    label: String(formData.get(`routeLabel:${route.id}`) ?? route.label).trim() || route.label,
    instrumentSegments: getRouteSegmentFromForm(formData, route),
    underlyingSymbol: String(formData.get(`routeUnderlying:${route.id}`) ?? route.underlyingSymbol ?? ''),
    dataProviderId: String(formData.get(`routeDataProvider:${route.id}`) ?? route.dataProviderId ?? ''),
    tradingAccountId: String(formData.get(`routeTradingAccount:${route.id}`) ?? route.tradingAccountId),
    priority: Number(formData.get(`routePriority:${route.id}`) ?? route.priority),
    enabled: formData.get(`routeEnabled:${route.id}`) === 'on',
    instrumentType: String(formData.get(`routeType:${route.id}`) ?? route.instrumentType ?? 'index_option') as ExecutionRouteSettings['instrumentType'],
  }));

  const activeInstruments = getActiveInstruments();
  const currentInstrumentId = store.execution.setup.instrumentId;
  const isStillActive = activeInstruments.some((instrument) => instrument.id === currentInstrumentId);

  if (!isStillActive) {
    store.execution.setup.instrumentId = activeInstruments[0]?.id ?? store.settings.instruments[0]?.id ?? currentInstrumentId;
  }
}

function bindEvents() {
  document.querySelectorAll<HTMLButtonElement>('[data-role="switch-page"]').forEach((button) => {
    button.addEventListener('click', () => {
      const page = button.dataset.page;

      if (page === 'execution' || page === 'trades' || page === 'calendar' || page === 'settings') {
        store.activePage = page;
      } else {
        store.activePage = 'execution';
      }

      editingTradeId = null;
      persistStore();
      render();

      if (store.activePage === 'execution') {
        void refreshExecutionPreview();
      }
    });
  });

  const executionForm = document.querySelector<HTMLFormElement>('#execution-form');

  executionForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(executionForm);
    const useUnderlyingLevels = formData.get('useUnderlyingLevels') === 'on';

    store.execution.setup = {
      ...store.execution.setup,
      instrumentId: String(formData.get('instrumentId') ?? store.execution.setup.instrumentId),
      bias: formData.get('bias') === 'bearish' ? 'bearish' : 'bullish',
      strikePreference:
        formData.get('strikePreference') === 'itm'
          ? 'itm'
          : formData.get('strikePreference') === 'otm'
            ? 'otm'
            : 'atm',
      spotPrice: Number(formData.get('spotPrice') ?? store.execution.setup.spotPrice),
      useUnderlyingLevels,
      entryPrice: Number(formData.get('entryPrice') ?? store.execution.setup.entryPrice),
      stopLossPrice: Number(formData.get('stopLossPrice') ?? store.execution.setup.stopLossPrice),
      targetPrice: Number(formData.get('targetPrice') ?? store.execution.setup.targetPrice),
      expiryLabel: String(formData.get('expiryLabel') ?? store.execution.setup.expiryLabel),
      stopMode: formData.get('stopMode') === 'manual' ? 'manual' : 'underlying',
      manualOptionStop: Number(formData.get('manualOptionStop') ?? store.execution.setup.manualOptionStop),
      notes: String(formData.get('notes') ?? store.execution.setup.notes),
    };
    persistStore();
    render();
    await refreshExecutionPreview();
  });

  const ticketForm = document.querySelector<HTMLFormElement>('#ticket-form');

  ticketForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(ticketForm);
    const entryOrderType = ticketForm.querySelector<HTMLInputElement>('input[name="entryLimitEnabled"]')?.checked === false ? 'market' : 'limit';
    const useTargetOrder = ticketForm.querySelector<HTMLInputElement>('input[name="useTargetOrder"]')?.checked === true;
    const preview = store.execution.preview;
    const targetRr = Number(formData.get('targetRr') ?? store.execution.setup.targetRr);

    store.execution.setup = {
      ...store.execution.setup,
      entryOrderType,
      entryLimitPrice:
        entryOrderType === 'market'
          ? preview?.contract.topAskPrice ?? preview?.contract.optionLastPrice ?? store.execution.setup.entryLimitPrice
          : store.execution.setup.entryLimitManual
            ? Number(formData.get('entryLimitPrice') ?? preview?.contract.optionLastPrice ?? store.execution.setup.entryLimitPrice)
            : store.execution.setup.entryLimitPrice,
      useTargetOrder,
      exitLimitPrice:
        !useTargetOrder
          ? store.execution.setup.exitLimitPrice
          : store.execution.setup.exitLimitManual
            ? Number(formData.get('exitLimitPrice') ?? preview?.risk.premiumFiveRTargetPrice ?? store.execution.setup.exitLimitPrice)
            : store.execution.setup.exitLimitPrice,
      stopLimitPrice: Number(formData.get('stopLimitPrice') ?? preview?.risk.premiumStopLossPrice ?? store.execution.setup.stopLimitPrice),
      stopLimitManual:
        store.execution.setup.stopLimitManual ||
        Number(formData.get('stopLimitPrice') ?? preview?.risk.premiumStopLossPrice ?? store.execution.setup.stopLimitPrice) !==
          (preview?.risk.premiumStopLossPrice ?? store.execution.setup.stopLimitPrice),
      targetRr: Number.isFinite(targetRr) && targetRr > 0 ? targetRr : store.execution.setup.targetRr,
    };

    persistStore();
    render();
    await refreshExecutionPreview();
  });

  ticketForm?.querySelector<HTMLInputElement>('input[name="entryLimitEnabled"]')?.addEventListener('change', () => {
    store.execution.setup = {
      ...store.execution.setup,
      entryOrderType: ticketForm.querySelector<HTMLInputElement>('input[name="entryLimitEnabled"]')?.checked === false ? 'market' : 'limit',
      entryLimitManual: false,
    };
    syncExecutionTicketDefaults(ticketForm);
    void refreshExecutionPreview();
  });

  ticketForm?.querySelector<HTMLInputElement>('input[name="useTargetOrder"]')?.addEventListener('change', () => {
    store.execution.setup = {
      ...store.execution.setup,
      useTargetOrder: ticketForm.querySelector<HTMLInputElement>('input[name="useTargetOrder"]')?.checked === true,
      exitLimitManual: false,
    };
    syncExecutionTicketDefaults(ticketForm);
    void refreshExecutionPreview();
  });

  ticketForm?.querySelector<HTMLInputElement>('input[name="targetRr"]')?.addEventListener('change', () => {
    store.execution.setup = {
      ...store.execution.setup,
      targetRr: Number(ticketForm.querySelector<HTMLInputElement>('input[name="targetRr"]')?.value ?? store.execution.setup.targetRr),
      exitLimitManual: false,
    };
    syncExecutionTicketDefaults(ticketForm);
    void refreshExecutionPreview();
  });

  ticketForm?.querySelector<HTMLInputElement>('input[name="entryLimitPrice"]')?.addEventListener('input', () => {
    syncExecutionTicketDraftFromForm(ticketForm);
  });
  ticketForm?.querySelector<HTMLInputElement>('input[name="entryLimitPrice"]')?.addEventListener('change', () => {
    store.execution.setup.entryLimitManual = true;
    syncExecutionTicketDraftFromForm(ticketForm);
    void refreshExecutionPreview();
  });
  ticketForm?.querySelector<HTMLInputElement>('input[name="exitLimitPrice"]')?.addEventListener('input', () => {
    syncExecutionTicketDraftFromForm(ticketForm);
  });
  ticketForm?.querySelector<HTMLInputElement>('input[name="exitLimitPrice"]')?.addEventListener('change', () => {
    store.execution.setup.exitLimitManual = true;
    syncExecutionTicketDraftFromForm(ticketForm);
    void refreshExecutionPreview();
  });
  ticketForm?.querySelector<HTMLInputElement>('input[name="stopLimitPrice"]')?.addEventListener('change', () => {
    const preview = store.execution.preview;
    const currentValue = Number(ticketForm.querySelector<HTMLInputElement>('input[name="stopLimitPrice"]')?.value ?? store.execution.setup.stopLimitPrice);
    store.execution.setup = {
      ...store.execution.setup,
      stopLimitPrice: currentValue,
      stopLimitManual: true,
    };
    persistStore();
    if (preview) {
      void refreshExecutionPreview();
    } else {
      render();
    }
  });
  ticketForm?.querySelector<HTMLInputElement>('input[name="stopLimitPrice"]')?.addEventListener('input', () => {
    syncExecutionTicketDraftFromForm(ticketForm);
  });

  executionForm?.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement | HTMLSelectElement | null;

    if (!target?.name) {
      return;
    }

    if (target.name === 'instrumentId') {
      const instrumentId = (target as HTMLSelectElement).value;
      store.execution.setup = defaultExecutionSetup(instrumentId);
      persistStore();
      render();
      void refreshExecutionPreview();
      return;
    }

    if (target.name === 'bias' || target.name === 'strikePreference') {
      store.execution.setup = {
        ...store.execution.setup,
        bias: executionForm.querySelector<HTMLSelectElement>('select[name="bias"]')?.value === 'bearish' ? 'bearish' : 'bullish',
        strikePreference:
          executionForm.querySelector<HTMLSelectElement>('select[name="strikePreference"]')?.value === 'itm'
            ? 'itm'
            : executionForm.querySelector<HTMLSelectElement>('select[name="strikePreference"]')?.value === 'otm'
              ? 'otm'
              : 'atm',
        stopLimitManual: false,
      };
      resetExecutionPricingDraft();
      persistStore();
      render();
      void refreshExecutionPreview();
      return;
    }

    if (target.name === 'useUnderlyingLevels') {
      store.execution.setup = {
        ...store.execution.setup,
        useUnderlyingLevels: (target as HTMLInputElement).checked,
        stopLimitManual: false,
      };
      persistStore();
      render();
      void refreshExecutionPreview();
      return;
    }

    if (target.name === 'entryPrice' || target.name === 'stopLossPrice' || target.name === 'targetPrice' || target.name === 'manualOptionStop' || target.name === 'stopMode') {
      const formData = new FormData(executionForm);
      store.execution.setup = {
        ...store.execution.setup,
        useUnderlyingLevels: (executionForm.querySelector<HTMLInputElement>('input[name="useUnderlyingLevels"]')?.checked ?? false),
        entryPrice: Number(formData.get('entryPrice') ?? store.execution.setup.entryPrice),
        stopLossPrice: Number(formData.get('stopLossPrice') ?? store.execution.setup.stopLossPrice),
        targetPrice: Number(formData.get('targetPrice') ?? store.execution.setup.targetPrice),
        stopMode: formData.get('stopMode') === 'manual' ? 'manual' : 'underlying',
        manualOptionStop: Number(formData.get('manualOptionStop') ?? store.execution.setup.manualOptionStop),
      };
      persistStore();
      void refreshExecutionPreview();
      return;
    }
  });

  document.querySelectorAll<HTMLFormElement>('form[data-execution-card-form]').forEach((cardForm) => {
    const instrumentId = cardForm.dataset.instrumentId;
    const cardPanel = cardForm.closest<HTMLElement>('[data-instrument-card]');

    if (!instrumentId) {
      return;
    }

    cardForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      syncExecutionCardDraftFromForm(cardForm);
      await placeExecutionBrokerOrder(instrumentId);
    });

    cardForm.querySelector<HTMLInputElement>('input[name="entryLimitEnabled"]')?.addEventListener('change', () => {
      updateExecutionCardSetup(instrumentId, {
        entryOrderType: cardForm.querySelector<HTMLInputElement>('input[name="entryLimitEnabled"]')?.checked === false ? 'market' : 'limit',
        entryLimitManual: false,
      });
      syncExecutionCardDraftFromForm(cardForm);
      void refreshExecutionPreview(instrumentId);
    });

    cardPanel?.querySelector<HTMLSelectElement>('select[name="bias"]')?.addEventListener('change', () => {
      updateExecutionCardSetup(instrumentId, {
        bias: cardPanel.querySelector<HTMLSelectElement>('select[name="bias"]')?.value === 'bearish' ? 'bearish' : 'bullish',
      });
      resetExecutionCardPricingDraft(instrumentId);
      void refreshExecutionPreview(instrumentId);
    });

    cardPanel?.querySelector<HTMLSelectElement>('select[name="strikePreference"]')?.addEventListener('change', () => {
      updateExecutionCardSetup(instrumentId, {
        strikePreference:
          cardPanel.querySelector<HTMLSelectElement>('select[name="strikePreference"]')?.value === 'itm'
            ? 'itm'
            : cardPanel.querySelector<HTMLSelectElement>('select[name="strikePreference"]')?.value === 'otm'
              ? 'otm'
              : 'atm',
      });
      resetExecutionCardPricingDraft(instrumentId);
      void refreshExecutionPreview(instrumentId);
    });

    cardForm.querySelector<HTMLInputElement>('input[name="useTargetOrder"]')?.addEventListener('change', () => {
      updateExecutionCardSetup(instrumentId, {
        useTargetOrder: cardForm.querySelector<HTMLInputElement>('input[name="useTargetOrder"]')?.checked === true,
        exitLimitManual: false,
      });
      syncExecutionCardDraftFromForm(cardForm);
      void refreshExecutionPreview(instrumentId);
    });

    cardForm.querySelector<HTMLInputElement>('input[name="targetRr"]')?.addEventListener('change', () => {
      updateExecutionCardSetup(instrumentId, {
        targetRr: Number(cardForm.querySelector<HTMLInputElement>('input[name="targetRr"]')?.value ?? getExecutionCardState(instrumentId).setup.targetRr),
        exitLimitManual: false,
      });
      syncExecutionCardDraftFromForm(cardForm);
      void refreshExecutionPreview(instrumentId);
    });

    cardForm.querySelector<HTMLInputElement>('input[name="entryLimitPrice"]')?.addEventListener('input', () => {
      syncExecutionCardDraftFromForm(cardForm);
    });
    cardForm.querySelector<HTMLInputElement>('input[name="entryLimitPrice"]')?.addEventListener('change', () => {
      updateExecutionCardSetup(instrumentId, { entryLimitManual: true });
      syncExecutionCardDraftFromForm(cardForm);
      void refreshExecutionPreview(instrumentId);
    });

    cardForm.querySelector<HTMLInputElement>('input[name="exitLimitPrice"]')?.addEventListener('input', () => {
      syncExecutionCardDraftFromForm(cardForm);
    });
    cardForm.querySelector<HTMLInputElement>('input[name="exitLimitPrice"]')?.addEventListener('change', () => {
      updateExecutionCardSetup(instrumentId, { exitLimitManual: true });
      syncExecutionCardDraftFromForm(cardForm);
      void refreshExecutionPreview(instrumentId);
    });

    cardForm.querySelector<HTMLInputElement>('input[name="stopLimitPrice"]')?.addEventListener('input', () => {
      syncExecutionCardDraftFromForm(cardForm);
    });
    cardForm.querySelector<HTMLInputElement>('input[name="stopLimitPrice"]')?.addEventListener('change', () => {
      updateExecutionCardSetup(instrumentId, { stopLimitManual: true });
      syncExecutionCardDraftFromForm(cardForm);
      void refreshExecutionPreview(instrumentId);
    });
  });

  document.querySelectorAll<HTMLButtonElement>('[data-role="refresh-card-preview"]').forEach((button) => {
    button.addEventListener('click', async () => {
      const instrumentId = button.dataset.instrumentId;

      if (instrumentId) {
        await refreshExecutionPreview(instrumentId);
      }
    });
  });

  document.querySelector<HTMLButtonElement>('[data-role="refresh-broker-orders"]')?.addEventListener('click', async () => {
    await refreshAllBrokerOrders();
  });

  const selectedDateInput = document.querySelector<HTMLInputElement>('#selected-date');

  selectedDateInput?.addEventListener('change', () => {
    store.selectedDate = selectedDateInput.value || getTodayDate();
    editingTradeId = null;
    persistStore();
    render();
  });

  const tradeForm = document.querySelector<HTMLFormElement>('#trade-form');

  tradeForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(tradeForm);
    const tradeId = String(formData.get('tradeId') ?? '');
    const existingTrade = tradeId ? store.trades.find((trade) => trade.id === tradeId) ?? null : null;
    const nextTrade: TradeRecord = {
      ...(existingTrade ?? {}),
      id: tradeId || createId('trade'),
      tradeDate: String(formData.get('tradeDate') ?? store.selectedDate),
      tradeTime: String(formData.get('tradeTime') ?? getCurrentTime()),
      instrumentId: String(formData.get('instrumentId') ?? getActiveInstruments()[0]?.id ?? ''),
      description: String(formData.get('description') ?? ''),
      direction: formData.get('direction') === 'short' ? 'short' : 'long',
      entry: Number(formData.get('entry') ?? 0),
      stopLoss: Number(formData.get('stopLoss') ?? 0),
      exit: formData.get('exit') === null || formData.get('exit') === '' ? null : Number(formData.get('exit')),
      remarks: String(formData.get('remarks') ?? ''),
    };

    if (tradeId) {
      const index = store.trades.findIndex((trade) => trade.id === tradeId);

      if (index >= 0) {
        store.trades[index] = nextTrade;
      }
    } else {
      store.trades.push(nextTrade);
    }

    store.selectedDate = nextTrade.tradeDate;
    editingTradeId = null;
    persistStore();
    render();
  });

  document.querySelector<HTMLButtonElement>('[data-role="cancel-edit"]')?.addEventListener('click', () => {
    editingTradeId = null;
    render();
  });

  document.querySelectorAll<HTMLButtonElement>('[data-role="edit-trade"]').forEach((button) => {
    button.addEventListener('click', () => {
      const tradeId = button.dataset.id;
      const trade = store.trades.find((item) => item.id === tradeId);

      if (!trade) {
        return;
      }

      store.selectedDate = trade.tradeDate;
      editingTradeId = trade.id;
      render();
      document.querySelector<HTMLFormElement>('#trade-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  document.querySelectorAll<HTMLButtonElement>('[data-role="delete-trade"]').forEach((button) => {
    button.addEventListener('click', () => {
      const tradeId = button.dataset.id;
      store.trades = store.trades.filter((trade) => trade.id !== tradeId);

      if (editingTradeId === tradeId) {
        editingTradeId = null;
      }

      persistStore();
      render();
    });
  });

  document.querySelectorAll<HTMLButtonElement>('[data-role="pick-calendar-date"]').forEach((button) => {
    button.addEventListener('click', () => {
      const tradeDate = button.dataset.date;

      if (!tradeDate) {
        return;
      }

      store.selectedDate = tradeDate;
      persistStore();
      render();
    });
  });

  document.querySelectorAll<HTMLButtonElement>('[data-role="change-month"]').forEach((button) => {
    button.addEventListener('click', () => {
      const selected = getMonthDate(store.selectedDate);
      const next = new Date(selected.getFullYear(), selected.getMonth() + (button.dataset.direction === 'next' ? 1 : -1), 1);
      store.selectedDate = `${next.getFullYear()}-${pad(next.getMonth() + 1)}-01`;
      persistStore();
      render();
    });
  });

  const settingsForm = document.querySelector<HTMLFormElement>('#settings-form');

  settingsForm?.addEventListener('submit', (event) => {
    event.preventDefault();

    applySettingsValidation();

    if (!settingsForm.reportValidity()) {
      return;
    }

    applySettingsFormDraft(settingsForm);

    const dataProviderErrors = store.dataProviders.flatMap((item) => validateDataProviderDraft(item));
    const tradingAccountErrors = store.tradingAccounts.flatMap((item) => validateTradingAccountDraft(item));

    if (dataProviderErrors.length > 0 || tradingAccountErrors.length > 0) {
      window.alert([...dataProviderErrors, ...tradingAccountErrors][0]);
      return;
    }

    persistStore();
    render();

    if (store.activePage === 'execution') {
      void refreshExecutionPreview();
    }
  });

  document.querySelectorAll<HTMLButtonElement>('[data-role="filter-underlying-catalog"]').forEach((button) => {
    button.addEventListener('click', () => {
      underlyingCatalogFilter = (button.dataset.filter === 'COMM' ? 'COMM' : 'IDX');
      render();
    });
  });

  document.querySelector<HTMLButtonElement>('[data-role="add-underlying"]')?.addEventListener('click', () => {
    const select = document.querySelector<HTMLSelectElement>('select[name="catalogUnderlying"]');
    const symbol = select?.value.trim().toUpperCase();

    if (!symbol) {
      return;
    }

    const catalogEntry = underlyingCatalog.find((item) => instrumentSymbolAliases(item.symbol).includes(normalizedSymbol));
    const normalizedSymbol = normalizeInstrumentSymbol(symbol);
    const existing = store.settings.instruments.find((instrument) => normalizeInstrumentSymbol(instrument.name) === normalizedSymbol);

    if (existing) {
      store.settings.instruments = store.settings.instruments.map((instrument) =>
        normalizeInstrumentSymbol(instrument.name) === normalizedSymbol
          ? {
              ...instrument,
              lotSize: catalogEntry?.lotSize ?? instrument.lotSize,
              strikeStep: catalogEntry?.strikeStep ?? instrument.strikeStep,
              enabled: true,
            }
          : instrument,
      );
      persistStore();
      render();
      return;
    }

    store.settings.instruments.push({
      id: createId('instrument'),
      name: catalogEntry?.symbol ?? symbol,
      lotSize: catalogEntry?.lotSize ?? 1,
      strikeStep: catalogEntry?.strikeStep ?? getDefaultStrikeStep(symbol),
      enabled: true,
    });
    persistStore();
    render();
  });

  document.querySelector<HTMLButtonElement>('[data-role="add-data-provider"]')?.addEventListener('click', () => {
    const settingsForm = document.querySelector<HTMLFormElement>('#settings-form');

    if (settingsForm) {
      applySettingsFormDraft(settingsForm);
    }

    store.dataProviders.push(createDefaultDataProvider('dhan'));
    persistStore();
    render();
  });

  document.querySelector<HTMLButtonElement>('[data-role="add-trading-account"]')?.addEventListener('click', () => {
    const settingsForm = document.querySelector<HTMLFormElement>('#settings-form');

    if (settingsForm) {
      applySettingsFormDraft(settingsForm);
    }

    store.tradingAccounts.push(createDefaultTradingAccount('dhan'));
    persistStore();
    render();
  });

  document.querySelector<HTMLButtonElement>('[data-role="add-execution-route"]')?.addEventListener('click', () => {
    const settingsForm = document.querySelector<HTMLFormElement>('#settings-form');

    if (settingsForm) {
      applySettingsFormDraft(settingsForm);
    }

    store.executionRoutes.push(createDefaultExecutionRoute(store.tradingAccounts[0]?.id ?? '', store.dataProviders[0]?.id ?? ''));
    persistStore();
    render();
  });

  document.querySelectorAll<HTMLButtonElement>('[data-role="delete-data-provider"]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.dataset.id;
      if (!id) {
        return;
      }
      store.dataProviders = store.dataProviders.filter((item) => item.id !== id);
      store.executionRoutes = store.executionRoutes.map((route) => route.dataProviderId === id ? { ...route, dataProviderId: '' } : route);
      persistStore();
      render();
    });
  });

  document.querySelectorAll<HTMLButtonElement>('[data-role="delete-trading-account"]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.dataset.id;
      if (!id) {
        return;
      }
      store.tradingAccounts = store.tradingAccounts.filter((item) => item.id !== id);
      store.executionRoutes = store.executionRoutes.filter((route) => route.tradingAccountId !== id);
      persistStore();
      render();
    });
  });

  document.querySelectorAll<HTMLButtonElement>('[data-role="delete-execution-route"]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.dataset.id;
      if (!id) {
        return;
      }
      store.executionRoutes = store.executionRoutes.filter((item) => item.id !== id);
      persistStore();
      render();
    });
  });

  document.querySelectorAll<HTMLButtonElement>('[data-role="test-data-provider"]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.dataset.id;
      if (!id) {
        return;
      }

      button.disabled = true;

      try {
        const currentAccount = store.dataProviders.find((account) => account.id === id);
        const settingsForm = document.querySelector<HTMLFormElement>('#settings-form');

        if (!currentAccount || !settingsForm) {
          throw new Error('Data provider not found in local state.');
        }

        const currentFormAccount = buildDataProviderFromForm(settingsForm, currentAccount);
        const validationErrors = validateDataProviderDraft(currentFormAccount);

        if (validationErrors.length > 0) {
          applySettingsValidation();
          settingsForm.reportValidity();
          throw new Error(validationErrors[0]);
        }

        const message = await testDataProviderToken(currentFormAccount);
        store.dataProviders = store.dataProviders.map((account) => account.id === id ? currentFormAccount : account);
        persistStore();
        render();
        window.alert(message);
      } catch (error) {
        render();
        window.alert(error instanceof Error ? error.message : 'Token validation failed.');
      } finally {
        button.disabled = false;
      }
    });
  });

  document.querySelectorAll<HTMLButtonElement>('[data-role="test-trading-account"]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.dataset.id;
      if (!id) {
        return;
      }

      button.disabled = true;

      try {
        const currentAccount = store.tradingAccounts.find((account) => account.id === id);
        const settingsForm = document.querySelector<HTMLFormElement>('#settings-form');

        if (!currentAccount || !settingsForm) {
          throw new Error('Trading account not found in local state.');
        }

        const currentFormAccount = buildTradingAccountFromForm(settingsForm, currentAccount);
        const validationErrors = validateTradingAccountDraft(currentFormAccount);

        if (validationErrors.length > 0) {
          applySettingsValidation();
          settingsForm.reportValidity();
          throw new Error(validationErrors[0]);
        }

        const message = await testTradingAccountToken(currentFormAccount);
        store.tradingAccounts = store.tradingAccounts.map((account) => account.id === id ? currentFormAccount : account);
        persistStore();
        render();
        window.alert(message);
      } catch (error) {
        render();
        window.alert(error instanceof Error ? error.message : 'Token validation failed.');
      } finally {
        button.disabled = false;
      }
    });
  });

  document.querySelectorAll<HTMLButtonElement>('[data-role="delete-instrument"]').forEach((button) => {
    button.addEventListener('click', () => {
      const instrumentId = button.dataset.id;

      if (!instrumentId) {
        return;
      }

      store.settings.instruments = store.settings.instruments.filter((instrument) => instrument.id !== instrumentId);

      if (store.execution.setup.instrumentId === instrumentId) {
        store.execution.setup.instrumentId = getActiveInstruments()[0]?.id ?? store.settings.instruments[0]?.id ?? '';
      }

      persistStore();
      render();
    });
  });

  document.querySelector<HTMLButtonElement>('[data-role="reset-planner"]')?.addEventListener('click', () => {
    const fresh = defaultStore();
    store.activePage = 'execution';
    store.selectedDate = fresh.selectedDate;
    store.settings = fresh.settings;
    store.dataProviders = fresh.dataProviders;
    store.tradingAccounts = fresh.tradingAccounts;
    store.executionRoutes = fresh.executionRoutes;
    store.trades = [];
    store.execution = fresh.execution;
    editingTradeId = null;
    persistStore();
    render();
  });

  bindSettingsPreview();
  applySettingsValidation();
  settingsForm?.addEventListener('input', applySettingsValidation);
  settingsForm?.addEventListener('change', applySettingsValidation);
}

render();

syncSettingsMasterData();

if (store.activePage === 'execution') {
  void refreshAllExecutionCards();
}
