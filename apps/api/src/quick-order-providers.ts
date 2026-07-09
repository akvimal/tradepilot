import {
  buildQuickOrderPreview,
  type QuickOrderBrokerProvider,
} from '@tradepilot/core';
import type {
  BrokerInstrumentMasterRecord,
  BrokerOptionChainSnapshot,
  BrokerCredentials,
  BrokerConnectionSettings,
  QuickOrderLookupResponse,
  QuickOrderPreviewRequest,
  QuickOrderStrikePreference,
} from '@tradepilot/types';

type QuickOrderProviderConfig = {
  credentials?: BrokerCredentials;
  connection?: Pick<BrokerConnectionSettings, 'apiBaseUrl'>;
  scripMasterUrl?: string;
};

type ProviderFactory = {
  listUnderlyings(): Promise<QuickOrderLookupResponse>;
  preview(request: QuickOrderPreviewRequest): Promise<ReturnType<typeof buildQuickOrderPreview>>;
};

type DhanExpiryListResponse =
  | { data?: { expiries?: string[]; expiry?: string[]; expiryList?: string[]; underlyings?: string[] } }
  | { data?: string[] }
  | string[];

type DhanOptionChainResponse = {
  data?: {
    last_price?: number;
    oc?: Record<string, {
      ce?: Record<string, unknown>;
      pe?: Record<string, unknown>;
    }>;
  };
};

const defaultStrikePreferences: QuickOrderStrikePreference[] = ['itm', 'atm', 'otm'];
const defaultScripMasterUrl = 'https://images.dhan.co/api-data/api-scrip-master.csv';
const masterCache = new Map<string, { expiresAt: number; value: BrokerInstrumentMasterRecord[] }>();
const expiryListCache = new Map<string, { expiresAt: number; value: string[] }>();
const optionChainCache = new Map<string, { expiresAt: number; value: BrokerOptionChainSnapshot }>();
const optionChainInflight = new Map<string, Promise<BrokerOptionChainSnapshot>>();

function normalizeSymbol(value: string | undefined) {
  return (value ?? '').trim().toUpperCase();
}

function normalizeOptionalText(value: string | undefined) {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseDhanMasterCsv(csv: string): BrokerInstrumentMasterRecord[] {
  const parseCsv = (source: string): string[][] =>
    source
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        const cells: string[] = [];
        let current = '';
        let inQuotes = false;

        for (let index = 0; index < line.length; index += 1) {
          const char = line[index];

          if (char === '"') {
            inQuotes = !inQuotes;
            continue;
          }

          if (char === ',' && !inQuotes) {
            cells.push(current);
            current = '';
            continue;
          }

          current += char;
        }

        cells.push(current);
        return cells.map((cell) => cell.trim());
      });

  const [headerRow, ...rows] = parseCsv(csv);
  const indexByHeader = new Map(headerRow.map((header, index) => [header.toLowerCase(), index]));
  const read = (row: string[], names: string[]) => {
    for (const name of names) {
      const index = indexByHeader.get(name.toLowerCase());

      if (index !== undefined) {
        return row[index] ?? '';
      }
    }

    return '';
  };

  const mapped: Array<BrokerInstrumentMasterRecord | null> = rows.map((row) => {
    const securityId = read(row, ['security_id', 'securityid', 'SEM_SMST_SECURITY_ID']);
    const optionType = read(row, ['option_type', 'optiontype', 'SEM_OPTION_TYPE']).toUpperCase();
    const lotSize = Number(read(row, ['lot_size', 'lotsize', 'SEM_LOT_UNITS']) || 0);
    const strikePrice = Number(read(row, ['strike_price', 'strikeprice', 'SEM_STRIKE_PRICE']) || 0);
    const instrumentName = read(row, ['instrument_name', 'instrument', 'SEM_INSTRUMENT_NAME']).toUpperCase();
    const underlyingSymbol = normalizeOptionalText(read(row, ['underlying_symbol', 'underlying', 'SEM_CUSTOM_SYMBOL', 'display_name']))?.toUpperCase() ?? '';

    if (!securityId || !underlyingSymbol) {
      return null;
    }

    return {
      broker: 'dhan',
      securityId,
      exchangeSegment: read(row, ['exchange_segment', 'exchange', 'SEM_EXM_EXCH_ID']),
      tradingSymbol: read(row, ['trading_symbol', 'tradingsymbol', 'SEM_TRADING_SYMBOL']),
      displayName: read(row, ['display_name', 'custom_symbol', 'SEM_CUSTOM_SYMBOL']) || underlyingSymbol,
      instrumentType: optionType === 'CE' || optionType === 'PE' || instrumentName.includes('OPT') ? 'option' : 'spot',
      underlyingSymbol,
      lotSize: lotSize || 1,
      tickSize: Number(read(row, ['tick_size', 'ticksize', 'SEM_TICK_SIZE']) || 0) || undefined,
      expiry: read(row, ['expiry_date', 'expiry', 'SEM_EXPIRY_DATE']) || undefined,
      strikePrice: strikePrice || undefined,
      optionType: optionType === 'CE' || optionType === 'PE' ? optionType : undefined,
    };
  });

  return mapped.filter((item): item is BrokerInstrumentMasterRecord => item !== null);
}

async function loadAndCacheDhanMaster(scripMasterUrl: string) {
  const cacheKey = scripMasterUrl;
  const cached = masterCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const response = await fetchWithTimeout(scripMasterUrl, {}, 12000, 'Dhan scrip master');

  if (!response.ok) {
    throw new Error(`Unable to fetch Dhan scrip master: ${response.status}`);
  }

  const value = parseDhanMasterCsv(await response.text());
  masterCache.set(cacheKey, {
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    value,
  });

  return value;
}

export async function warmQuickOrderCaches(scripMasterUrl = defaultScripMasterUrl) {
  await loadAndCacheDhanMaster(scripMasterUrl);
}

export async function listCachedDhanUnderlyings(scripMasterUrl = defaultScripMasterUrl): Promise<QuickOrderLookupResponse> {
  const master = await loadAndCacheDhanMaster(scripMasterUrl);

  return {
    broker: 'dhan',
    underlyings: buildUnderlyingLookupFromMaster(master),
  };
}

function pickUnderlyingRecord(master: BrokerInstrumentMasterRecord[], underlyingSymbol: string) {
  const normalizedUnderlying = normalizeSymbol(underlyingSymbol);
  const spotRecords = master.filter((item) => item.instrumentType === 'spot');

  return (
    spotRecords.find((item) => normalizeSymbol(item.underlyingSymbol) === normalizedUnderlying) ??
    spotRecords.find((item) => normalizeSymbol(item.tradingSymbol) === normalizedUnderlying) ??
    spotRecords.find((item) => normalizeSymbol(item.displayName).startsWith(normalizedUnderlying)) ??
    master.find((item) => normalizeSymbol(item.underlyingSymbol) === normalizedUnderlying) ??
    master[0] ??
    null
  );
}

function asDhanSecurityId(value: string) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid Dhan security id: ${value}`);
  }

  return parsed;
}

function resolveDhanUnderlyingSegment(underlyingSymbol: string, masterRecord?: BrokerInstrumentMasterRecord | null) {
  const normalized = normalizeSymbol(underlyingSymbol);

  if (normalized === 'GOLD' || normalized === 'CRUDEOIL') {
    return 'MCX_COMM';
  }

  if (normalized === 'NIFTY' || normalized === 'BANKNIFTY' || normalized === 'SENSEX' || normalized === 'MIDCPNIFTY') {
    return 'IDX_I';
  }

  const segment = normalizeSymbol(masterRecord?.exchangeSegment);

  if (segment.includes('MCX')) {
    return 'MCX_COMM';
  }

  if (segment.includes('BSE')) {
    return 'IDX_I';
  }

  return 'IDX_I';
}

function resolveDhanOrderExchangeSegment(underlyingSymbol: string, masterRecord?: BrokerInstrumentMasterRecord | null) {
  const normalized = normalizeSymbol(underlyingSymbol);

  if (normalized === 'GOLD' || normalized === 'CRUDEOIL') {
    return 'MCX_COMM';
  }

  if (normalized === 'SENSEX') {
    return 'BSE_FNO';
  }

  if (normalized === 'NIFTY' || normalized === 'BANKNIFTY' || normalized === 'MIDCPNIFTY') {
    return 'NSE_FNO';
  }

  const segment = normalizeSymbol(masterRecord?.exchangeSegment);

  if (segment.includes('MCX')) {
    return 'MCX_COMM';
  }

  if (segment.includes('BSE')) {
    return 'BSE_FNO';
  }

  return 'NSE_FNO';
}

function parseExpiryListResponse(response: DhanExpiryListResponse): string[] {
  if (Array.isArray(response)) {
    return response.map((item) => String(item)).filter(Boolean);
  }

  const data = 'data' in response ? response.data : undefined;

  if (Array.isArray(data)) {
    return data.map((item) => String(item)).filter(Boolean);
  }

  if (data && typeof data === 'object') {
    const objectData = data as { expiries?: unknown; expiry?: unknown; expiryList?: unknown };
    const raw = objectData.expiries ?? objectData.expiry ?? objectData.expiryList;

    if (Array.isArray(raw)) {
      return raw.map((item) => String(item)).filter(Boolean);
    }
  }

  return [];
}

function buildUnderlyingLookupFromMaster(master: BrokerInstrumentMasterRecord[]): QuickOrderLookupResponse['underlyings'] {
  const allowed = new Set(['NIFTY', 'BANKNIFTY', 'SENSEX', 'MIDCPNIFTY', 'GOLD', 'GOLDM', 'CRUDEOIL', 'CRUDEOILM']);
  const canonicalSymbol = (value: string) =>
    value === 'GOLDM' ? 'GOLD' : value === 'CRUDEOILM' ? 'CRUDEOIL' : value;

  return [...new Map(
    master
      .filter((item) => item.underlyingSymbol && allowed.has(item.underlyingSymbol))
      .map((item) => {
        const symbol = canonicalSymbol(item.underlyingSymbol);
        const preferredLotSize = item.instrumentType === 'option' || item.instrumentType === 'future' ? item.lotSize : 0;

        return [
          symbol,
          {
            symbol,
            displayName: item.displayName || symbol,
            exchangeSegment: item.exchangeSegment,
            lotSize: preferredLotSize,
            supportedStrikePreferences: [...defaultStrikePreferences] as QuickOrderStrikePreference[],
          },
        ] as const;
      })
      .reduce((map, [symbol, entry]) => {
        const current = map.get(symbol);

        if (!current) {
          map.set(symbol, entry);
          return map;
        }

        const nextLotSize = Math.max(current.lotSize || 0, entry.lotSize || 0);
        map.set(symbol, {
          ...current,
          displayName: current.displayName || entry.displayName,
          exchangeSegment: current.exchangeSegment || entry.exchangeSegment,
          lotSize: nextLotSize,
        });
        return map;
      }, new Map<string, QuickOrderLookupResponse['underlyings'][number]>()),
  ).values()].filter((item) => item.lotSize > 0);
}

async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs: number, label: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`);
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} failed: ${message}`);
  } finally {
    clearTimeout(timeout);
  }
}

const mockUnderlyings = [
  {
    symbol: 'NIFTY',
    displayName: 'NIFTY 50',
    exchangeSegment: 'NSE_INDEX',
    lotSize: 65,
    supportedStrikePreferences: ['itm', 'atm', 'otm'] as const,
  },
  {
    symbol: 'BANKNIFTY',
    displayName: 'NIFTY BANK',
    exchangeSegment: 'NSE_INDEX',
    lotSize: 30,
    supportedStrikePreferences: ['itm', 'atm', 'otm'] as const,
  },
  {
    symbol: 'SENSEX',
    displayName: 'SENSEX',
    exchangeSegment: 'BSE_INDEX',
    lotSize: 20,
    supportedStrikePreferences: ['itm', 'atm', 'otm'] as const,
  },
  {
    symbol: 'GOLD',
    displayName: 'GOLD',
    exchangeSegment: 'MCX_COMM',
    lotSize: 10,
    supportedStrikePreferences: ['itm', 'atm', 'otm'] as const,
  },
  {
    symbol: 'CRUDEOIL',
    displayName: 'CRUDEOIL',
    exchangeSegment: 'MCX_COMM',
    lotSize: 100,
    supportedStrikePreferences: ['itm', 'atm', 'otm'] as const,
  },
];

class MockQuickOrderProvider implements QuickOrderBrokerProvider {
  broker = 'dhan' as const;

  async listUnderlyings(): Promise<QuickOrderLookupResponse> {
    return {
      broker: this.broker,
      underlyings: mockUnderlyings.map((item) => ({ ...item, supportedStrikePreferences: [...defaultStrikePreferences] })),
    };
  }

  async loadInstrumentMaster(underlyingSymbol: string): Promise<BrokerInstrumentMasterRecord[]> {
    const chain = await this.getOptionChain(underlyingSymbol);
    const lotSize =
      underlyingSymbol === 'BANKNIFTY'
        ? 30
        : underlyingSymbol === 'SENSEX'
          ? 20
          : underlyingSymbol === 'GOLD'
            ? 10
            : underlyingSymbol === 'CRUDEOIL'
              ? 100
              : 65;

    return [
      {
        broker: this.broker,
        securityId: `${underlyingSymbol}-SPOT`,
        exchangeSegment: chain.exchangeSegment,
        tradingSymbol: underlyingSymbol,
        displayName: underlyingSymbol,
        instrumentType: 'spot',
        underlyingSymbol,
        lotSize: 1,
      },
      ...chain.quotes.map((quote) => ({
        broker: this.broker,
        securityId: quote.securityId,
        exchangeSegment: quote.exchangeSegment,
        tradingSymbol: quote.tradingSymbol,
        displayName: quote.tradingSymbol,
        instrumentType: 'option' as const,
        underlyingSymbol,
        lotSize,
        expiry: quote.expiry,
        strikePrice: quote.strikePrice,
        optionType: quote.optionType,
      })),
    ];
  }

  async getOptionChain(underlyingSymbol: string): Promise<BrokerOptionChainSnapshot> {
    const underlyingLastPrice =
      underlyingSymbol === 'BANKNIFTY'
        ? 53420
        : underlyingSymbol === 'SENSEX'
          ? 81200
          : underlyingSymbol === 'GOLD'
            ? 74250
            : underlyingSymbol === 'CRUDEOIL'
              ? 6120
              : 24920;
    const strikeStep = underlyingSymbol === 'BANKNIFTY' || underlyingSymbol === 'SENSEX' ? 100 : underlyingSymbol === 'CRUDEOIL' ? 10 : 50;
    const baseStrike = Math.round(underlyingLastPrice / strikeStep) * strikeStep;
    const expiry = '2026-07-09';
    const lotSize =
      underlyingSymbol === 'BANKNIFTY'
        ? 30
        : underlyingSymbol === 'SENSEX'
          ? 20
          : underlyingSymbol === 'GOLD'
            ? 10
            : underlyingSymbol === 'CRUDEOIL'
              ? 100
              : 65;
    const strikes = [-1, 0, 1].map((offset) => baseStrike + offset * strikeStep);
    const quotes = strikes.flatMap((strike, index) => {
      const distance = Math.abs(strike - underlyingLastPrice);
      const basePremium = Math.max(12, 110 - distance * 0.4);

      return (['CE', 'PE'] as const).map((optionType) => ({
        securityId: `${underlyingSymbol}-${expiry}-${strike}-${optionType}`,
        exchangeSegment: 'NSE_FNO',
        tradingSymbol: `${underlyingSymbol} ${expiry} ${strike} ${optionType}`,
        optionType,
        strikePrice: strike,
        expiry,
        lastPrice: Number((basePremium - index * 8).toFixed(2)),
        topBidPrice: Number((basePremium - index * 8 - 0.4).toFixed(2)),
        topAskPrice: Number((basePremium - index * 8 + 0.4).toFixed(2)),
        volume: 1200 - index * 180,
        openInterest: 22000 - index * 2400,
        delta: optionType === 'CE' ? (index === 0 ? 0.62 : index === 1 ? 0.5 : 0.36) : index === 0 ? -0.36 : index === 1 ? -0.5 : -0.62,
      }));
    });

    return {
      broker: this.broker,
      underlyingSymbol,
      exchangeSegment: 'NSE_FNO',
      expiry,
      underlyingLastPrice,
      priceSource: 'snapshot',
      quotes,
    };
  }
}

class DhanQuickOrderProvider implements QuickOrderBrokerProvider {
  broker = 'dhan' as const;
  private readonly clientId: string | undefined;
  private readonly accessToken: string | undefined;
  private readonly baseUrl: string;
  private readonly scripMasterUrl: string;

  constructor(config?: QuickOrderProviderConfig) {
    this.clientId = normalizeOptionalText(config?.credentials?.clientId) ?? process.env.DHAN_CLIENT_ID;
    this.accessToken = normalizeOptionalText(config?.credentials?.accessToken) ?? process.env.DHAN_ACCESS_TOKEN;
    this.baseUrl =
      normalizeOptionalText(config?.connection?.apiBaseUrl) ??
      normalizeOptionalText(process.env.DHAN_BASE_URL) ??
      'https://api.dhan.co/v2';
    this.scripMasterUrl =
      normalizeOptionalText(config?.scripMasterUrl) ??
      normalizeOptionalText(process.env.DHAN_SCRIP_MASTER_URL) ??
      'https://images.dhan.co/api-data/api-scrip-master.csv';
  }

  private assertConfigured() {
    if (!this.clientId || !this.accessToken) {
      throw new Error('Dhan provider is not configured. Set DHAN_CLIENT_ID and DHAN_ACCESS_TOKEN.');
    }
  }

  private async dhanPost<TResponse>(path: string, body: Record<string, unknown>): Promise<TResponse> {
    this.assertConfigured();

    const response = await fetchWithTimeout(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'access-token': this.accessToken as string,
        'client-id': this.clientId as string,
      },
      body: JSON.stringify(body),
    }, 12000, `Dhan request ${path}`);

    if (!response.ok) {
      const responseText = await response.text().catch(() => '');
      const details = responseText.trim().slice(0, 400);
      throw new Error(`Dhan request failed for ${path}: ${response.status}${details ? ` ${details}` : ''}`);
    }

    return (await response.json()) as TResponse;
  }

  private parseCsv(csv: string): string[][] {
    return csv
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        const cells: string[] = [];
        let current = '';
        let inQuotes = false;

        for (let index = 0; index < line.length; index += 1) {
          const char = line[index];

          if (char === '"') {
            inQuotes = !inQuotes;
            continue;
          }

          if (char === ',' && !inQuotes) {
            cells.push(current);
            current = '';
            continue;
          }

          current += char;
        }

        cells.push(current);
        return cells.map((cell) => cell.trim());
      });
  }

  async listUnderlyings(): Promise<QuickOrderLookupResponse> {
    const master = await this.loadRawMaster();
    return {
      broker: this.broker,
      underlyings: buildUnderlyingLookupFromMaster(master),
    };
  }

  async loadInstrumentMaster(underlyingSymbol: string): Promise<BrokerInstrumentMasterRecord[]> {
    const master = await this.loadRawMaster();
    const normalizedUnderlying = normalizeSymbol(underlyingSymbol);

    return master.filter((item) => {
      const recordUnderlying = normalizeSymbol(item.underlyingSymbol);
      const tradingSymbol = normalizeSymbol(item.tradingSymbol);
      const displayName = normalizeSymbol(item.displayName);

      return (
        recordUnderlying === normalizedUnderlying ||
        tradingSymbol.startsWith(normalizedUnderlying) ||
        displayName.startsWith(normalizedUnderlying)
      );
    });
  }

  private async loadRawMaster(): Promise<BrokerInstrumentMasterRecord[]> {
    return loadAndCacheDhanMaster(this.scripMasterUrl);
  }

  async getOptionChain(
    underlyingSymbol: string,
    expiryPreference: QuickOrderPreviewRequest['expiryPreference'],
  ): Promise<BrokerOptionChainSnapshot> {
    const master = await this.loadInstrumentMaster(underlyingSymbol);
    const underlying = pickUnderlyingRecord(master, underlyingSymbol);

    if (!underlying) {
      throw new Error(`No underlying record found for ${underlyingSymbol}`);
    }

    const segment = resolveDhanUnderlyingSegment(underlyingSymbol, underlying);
    const orderExchangeSegment = resolveDhanOrderExchangeSegment(underlyingSymbol, underlying);
    const expiryCacheKey = [this.baseUrl, underlying.securityId, segment].join('|');
    const cachedExpiryList = expiryListCache.get(expiryCacheKey);
    const expiries = cachedExpiryList && cachedExpiryList.expiresAt > Date.now()
      ? cachedExpiryList.value
      : await (async () => {
          const expiryListResponse = await this.dhanPost<DhanExpiryListResponse>('/optionchain/expirylist', {
            UnderlyingScrip: asDhanSecurityId(underlying.securityId),
            UnderlyingSeg: segment,
          });

          const nextExpiries = [...new Set(parseExpiryListResponse(expiryListResponse).filter((value): value is string => Boolean(value && value.trim().length > 0)))]
            .sort((left, right) => {
              const leftTime = Date.parse(left);
              const rightTime = Date.parse(right);

              if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) {
                return left.localeCompare(right);
              }

              return leftTime - rightTime;
            });

          expiryListCache.set(expiryCacheKey, {
            expiresAt: Date.now() + 15 * 60 * 1000,
            value: nextExpiries,
          });

          return nextExpiries;
        })();
    const expiry = expiries[expiryPreference === 'next' ? 1 : 0];

    if (!expiry) {
      throw new Error(`No expiry found for ${underlyingSymbol}`);
    }

    const cacheKey = [this.baseUrl, underlying.securityId, underlying.exchangeSegment, expiry].join('|');
    const cached = optionChainCache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const inflight = optionChainInflight.get(cacheKey);

    if (inflight) {
      return inflight;
    }

    const request = (async () => {
      const response = await this.dhanPost<DhanOptionChainResponse>('/optionchain', {
        UnderlyingScrip: asDhanSecurityId(underlying.securityId),
        UnderlyingSeg: segment,
        Expiry: expiry,
      });

      const oc = response.data?.oc ?? {};
      const quotes = Object.entries(oc).flatMap(([strikeKey, pair]) => {
        const strikePrice = Number(strikeKey);
        const toQuote = (side: 'CE' | 'PE', source?: Record<string, unknown>) => {
          if (!source) {
            return null;
          }

          return {
            securityId: String(source.security_id ?? source.securityId ?? ''),
            exchangeSegment: orderExchangeSegment,
            tradingSymbol: String(source.trading_symbol ?? source.tradingSymbol ?? `${underlyingSymbol} ${expiry} ${strikePrice} ${side}`),
            optionType: side,
            strikePrice,
            expiry,
            lastPrice: Number(source.last_price ?? source.lastPrice ?? 0),
            topBidPrice: Number(source.top_bid_price ?? source.topBidPrice ?? 0) || undefined,
            topAskPrice: Number(source.top_ask_price ?? source.topAskPrice ?? 0) || undefined,
            volume: Number(source.volume ?? 0) || undefined,
            openInterest: Number(source.oi ?? source.open_interest ?? 0) || undefined,
            delta: Number((source.greeks as Record<string, unknown> | undefined)?.delta ?? 0) || undefined,
          };
        };

        return [toQuote('CE', pair.ce), toQuote('PE', pair.pe)].filter((item): item is NonNullable<typeof item> => item !== null);
      });

      const value: BrokerOptionChainSnapshot = {
        broker: this.broker,
        underlyingSymbol,
        exchangeSegment: orderExchangeSegment,
        expiry,
        underlyingLastPrice: Number(response.data?.last_price ?? 0),
        priceSource: 'snapshot',
        quotes,
      };

      optionChainCache.set(cacheKey, {
        expiresAt: Date.now() + 30000,
        value,
      });

      return value;
    })();

    optionChainInflight.set(cacheKey, request);

    try {
      return await request;
    } finally {
      optionChainInflight.delete(cacheKey);
    }
  }
}

export function createQuickOrderProvider(
  broker: QuickOrderPreviewRequest['broker'],
  config?: QuickOrderProviderConfig,
): ProviderFactory {
  const hasExplicitDhanConfig = broker === 'dhan' && config?.credentials?.accessToken && config?.credentials?.clientId;
  const hasEnvDhanConfig = broker === 'dhan' && process.env.DHAN_ACCESS_TOKEN && process.env.DHAN_CLIENT_ID;
  const provider = hasExplicitDhanConfig || hasEnvDhanConfig ? new DhanQuickOrderProvider(config) : new MockQuickOrderProvider();

  if (broker !== provider.broker) {
    throw new Error(`Broker ${broker} is not available in the current runtime.`);
  }

  return {
    async listUnderlyings() {
      return provider.listUnderlyings();
    },
    async preview(request: QuickOrderPreviewRequest) {
      const [master, chain] = await Promise.all([
        provider.loadInstrumentMaster(request.underlyingSymbol),
        provider.getOptionChain(request.underlyingSymbol, request.expiryPreference),
      ]);

      return buildQuickOrderPreview(request, master, chain);
    },
  };
}
