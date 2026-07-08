import './styles.css';

import { appConfig } from '../../../packages/config/src';
import type { TradeDirection } from '../../../packages/types/src';

const STORAGE_KEY = 'tradepilot.daily-planner.v1';
const appElement = document.querySelector<HTMLDivElement>('#app');

if (!appElement) {
  throw new Error('App root was not found');
}

const app = appElement;

type AppPage = 'trades' | 'calendar' | 'settings';

interface InstrumentConfig {
  id: string;
  name: string;
  lotSize: number;
  expiryType: string;
  expiryReference: string;
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
}

interface PlannerStore {
  activePage: AppPage;
  selectedDate: string;
  settings: PlannerSettings;
  trades: TradeRecord[];
}

interface TradeMetrics {
  lotSize: number;
  lots: number;
  value: number;
  risk: number;
  pnl: number | null;
  rr: number | null;
}

let editingTradeId: string | null = null;
let tradeFormClockTimer: number | null = null;

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function getTodayDate() {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function getCurrentTime() {
  const now = new Date();
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function clearTradeFormClockTimer() {
  if (tradeFormClockTimer !== null) {
    window.clearInterval(tradeFormClockTimer);
    tradeFormClockTimer = null;
  }
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

function defaultInstruments(): InstrumentConfig[] {
  return [
    {
      id: createId('instrument'),
      name: 'NIFTY',
      lotSize: 65,
      expiryType: 'Weekly',
      expiryReference: 'Tuesday',
      enabled: true,
    },
    {
      id: createId('instrument'),
      name: 'SENSEX',
      lotSize: 20,
      expiryType: 'Weekly',
      expiryReference: 'Tuesday',
      enabled: true,
    },
    {
      id: createId('instrument'),
      name: 'BANKNIFTY',
      lotSize: 30,
      expiryType: 'Monthly',
      expiryReference: 'Last Tuesday',
      enabled: true,
    },
    {
      id: createId('instrument'),
      name: 'MIDCPNIFTY',
      lotSize: 120,
      expiryType: 'Monthly',
      expiryReference: 'Last Tuesday',
      enabled: true,
    },
    {
      id: createId('instrument'),
      name: 'GOLD',
      lotSize: 1,
      expiryType: 'Commodity',
      expiryReference: 'Edit in settings',
      enabled: true,
    },
    {
      id: createId('instrument'),
      name: 'CRUDEOIL',
      lotSize: 1,
      expiryType: 'Commodity',
      expiryReference: 'Edit in settings',
      enabled: true,
    },
  ];
}

function defaultStore(): PlannerStore {
  return {
    activePage: 'trades',
    selectedDate: getTodayDate(),
    settings: {
      capital: 100000,
      riskPercent: 1,
      openingBalance: 100000,
      instruments: defaultInstruments(),
    },
    trades: [],
  };
}

function isInstrumentConfig(value: unknown): value is InstrumentConfig {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const item = value as Partial<InstrumentConfig>;
  return typeof item.id === 'string' && typeof item.name === 'string' && typeof item.lotSize === 'number';
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
      ? parsed.settings.instruments.filter(isInstrumentConfig)
      : fallback.settings.instruments;
    const trades = Array.isArray(parsed.trades) ? parsed.trades : [];

    return {
      activePage:
        parsed.activePage === 'settings' || parsed.activePage === 'calendar' ? parsed.activePage : 'trades',
      selectedDate: typeof parsed.selectedDate === 'string' ? parsed.selectedDate : fallback.selectedDate,
      settings: {
        capital: Number(parsed.settings?.capital ?? fallback.settings.capital),
        riskPercent: Number(parsed.settings?.riskPercent ?? fallback.settings.riskPercent),
        openingBalance: Number(parsed.settings?.openingBalance ?? fallback.settings.openingBalance),
        instruments: instruments.length > 0 ? instruments : fallback.settings.instruments,
      },
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
        };
      }),
    };
  } catch {
    return fallback;
  }
}

const store = hydrateStore();

function persistStore() {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function getRiskPerTrade() {
  return Number(((store.settings.capital * store.settings.riskPercent) / 100).toFixed(2));
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

function getAllTradesSorted() {
  return [...store.trades].sort((left, right) =>
    `${right.tradeDate} ${right.tradeTime}`.localeCompare(`${left.tradeDate} ${left.tradeTime}`),
  );
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

function getTradesForMonth(monthDate: Date) {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();

  return store.trades.filter((trade) => {
    const tradeDate = new Date(`${trade.tradeDate}T00:00:00`);
    return tradeDate.getFullYear() === year && tradeDate.getMonth() === month;
  });
}

function getDayTrades(tradeDate: string) {
  return store.trades.filter((trade) => trade.tradeDate === tradeDate);
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

function renderNav() {
  return `
    <header class="topbar">
      <div>
        <span class="eyebrow">Daily planner</span>
        <h1>${appConfig.name}</h1>
      </div>
      <nav class="menu">
        <button type="button" class="menu-button ${store.activePage === 'trades' ? 'active' : ''}" data-role="switch-page" data-page="trades">Trades</button>
        <button type="button" class="menu-button ${store.activePage === 'calendar' ? 'active' : ''}" data-role="switch-page" data-page="calendar">Calendar</button>
        <button type="button" class="menu-button ${store.activePage === 'settings' ? 'active' : ''}" data-role="switch-page" data-page="settings">Settings</button>
      </nav>
    </header>
  `;
}

function renderTradeForm() {
  const activeInstruments = getActiveInstruments();
  const editingTrade = editingTradeId ? store.trades.find((trade) => trade.id === editingTradeId) ?? null : null;
  const fallbackInstrument = activeInstruments[0] ?? store.settings.instruments[0];
  const useCurrentDateTime = editingTrade ? false : true;

  return `
    <section class="panel">
      <div class="section-head">
        <div>
          <span class="eyebrow muted">Planner input</span>
          <h2>${editingTrade ? 'Edit Trade' : 'Add Trade'}</h2>
        </div>
        <span class="chip">${formatCurrency(getRiskPerTrade())} risk per trade</span>
      </div>
      <form id="trade-form" class="form-grid trade-form">
        <input type="hidden" name="tradeId" value="${editingTrade?.id ?? ''}" />
        <label class="toggle-row full">
          <input name="useCurrentDateTime" type="checkbox" ${useCurrentDateTime ? 'checked' : ''} />
          <span>Use current date and time</span>
        </label>
        <label class="trade-span-date">
          <span>Date</span>
          <input name="tradeDate" type="date" value="${escapeHtml(editingTrade?.tradeDate ?? getTodayDate())}" ${useCurrentDateTime ? 'disabled' : ''} required />
        </label>
        <label class="trade-span-time">
          <span>Time</span>
          <input name="tradeTime" type="time" value="${escapeHtml(editingTrade?.tradeTime ?? getCurrentTime())}" ${useCurrentDateTime ? 'disabled' : ''} required />
        </label>
        <label class="trade-span-instrument">
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
        <label class="trade-span-direction">
          <span>Direction</span>
          <select name="direction">
            <option value="long" ${(editingTrade?.direction ?? 'long') === 'long' ? 'selected' : ''}>Long</option>
            <option value="short" ${(editingTrade?.direction ?? 'long') === 'short' ? 'selected' : ''}>Short</option>
          </select>
        </label>
        <label class="trade-span-entry">
          <span>Entry</span>
          <input name="entry" type="number" step="any" value="${editingTrade ? editingTrade.entry : ''}" required />
        </label>
        <label class="trade-span-stop-loss">
          <span>SL</span>
          <input name="stopLoss" type="number" step="any" value="${editingTrade ? editingTrade.stopLoss : ''}" required />
        </label>
        <label class="trade-span-exit">
          <span>Exit</span>
          <input name="exit" type="number" step="any" value="${editingTrade?.exit ?? ''}" />
        </label>
        <label class="span-4">
          <span>Description</span>
          <input name="description" value="${escapeHtml(editingTrade?.description ?? '')}" placeholder="25000 CE / breakout / pullback entry" />
        </label>
        <label class="span-4">
          <span>Remarks</span>
          <input name="remarks" value="${escapeHtml(editingTrade?.remarks ?? '')}" placeholder="Any quick note for the trade" />
        </label>
        <div class="calc-strip full" id="trade-preview">
          <div><span>Lot Size</span><strong id="preview-lot-size">-</strong></div>
          <div><span>Lots</span><strong id="preview-lots">-</strong></div>
          <div><span>Value</span><strong id="preview-value">-</strong></div>
          <div><span>Risk</span><strong id="preview-risk">-</strong></div>
          <div><span>P/L</span><strong id="preview-pnl">-</strong></div>
          <div><span>RR</span><strong id="preview-rr">-</strong></div>
        </div>
        <div class="actions full">
          <button type="button" class="secondary-button" data-role="reset-trade-calculation">Reset calculations</button>
          ${editingTrade ? '<button type="button" class="secondary-button" data-role="cancel-edit">Cancel</button>' : ''}
          <button type="submit">${editingTrade ? 'Update trade' : 'Save trade'}</button>
        </div>
      </form>
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
              <th>Value</th>
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
                      <small>${escapeHtml(`${instrument?.expiryType ?? '-'} | ${instrument?.expiryReference ?? '-'}`)}</small>
                    </td>
                    <td>${escapeHtml(trade.description)}</td>
                    <td>${escapeHtml(trade.direction)}</td>
                    <td>${formatNumber(trade.entry)}</td>
                    <td>${formatNumber(trade.stopLoss)}</td>
                    <td>${formatNumber(metrics.lots)}</td>
                    <td>${formatCurrency(metrics.value)}</td>
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

function renderSettingsPage() {
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
            <h3>Configurable lot sizes and expiry reference</h3>
          </div>
          <button type="button" class="secondary-button slim" data-role="add-instrument">Add instrument</button>
        </div>
        <div class="full table-wrap">
          <table>
            <thead>
              <tr>
                <th>Instrument</th>
                <th>Lot Size</th>
                <th>Expiry Type</th>
                <th>Expiry Reference</th>
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
                      <td><input name="name:${instrument.id}" value="${escapeHtml(instrument.name)}" required /></td>
                      <td><input name="lotSize:${instrument.id}" type="number" step="1" min="1" value="${instrument.lotSize}" required /></td>
                      <td><input name="expiryType:${instrument.id}" value="${escapeHtml(instrument.expiryType)}" /></td>
                      <td><input name="expiryReference:${instrument.id}" value="${escapeHtml(instrument.expiryReference)}" /></td>
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
      </form>
    </section>
  `;
}

function render() {
  clearTradeFormClockTimer();
  app.innerHTML = `
    <main class="page-shell">
      ${renderNav()}
      ${store.activePage === 'trades' ? renderTradesPage() : store.activePage === 'calendar' ? renderCalendarPage() : renderSettingsPage()}
    </main>
  `;

  bindEvents();
}

function bindTradePreview() {
  const form = document.querySelector<HTMLFormElement>('#trade-form');

  if (!form) {
    return;
  }

  clearTradeFormClockTimer();
  const tradeDateInput = form.querySelector<HTMLInputElement>('input[name="tradeDate"]');
  const tradeTimeInput = form.querySelector<HTMLInputElement>('input[name="tradeTime"]');
  const useCurrentDateTimeInput = form.querySelector<HTMLInputElement>('input[name="useCurrentDateTime"]');
  const instrumentInput = form.querySelector<HTMLSelectElement>('select[name="instrumentId"]');
  const directionInput = form.querySelector<HTMLSelectElement>('select[name="direction"]');
  const entryInput = form.querySelector<HTMLInputElement>('input[name="entry"]');
  const stopLossInput = form.querySelector<HTMLInputElement>('input[name="stopLoss"]');
  const exitInput = form.querySelector<HTMLInputElement>('input[name="exit"]');
  const resetCalculationButton = form.querySelector<HTMLButtonElement>('[data-role="reset-trade-calculation"]');

  const syncCurrentDateTime = () => {
    if (!useCurrentDateTimeInput?.checked) {
      return;
    }

    if (tradeDateInput) {
      tradeDateInput.value = getTodayDate();
    }

    if (tradeTimeInput) {
      tradeTimeInput.value = getCurrentTime();
    }
  };

  const applyDateTimeMode = () => {
    const useCurrentDateTime = useCurrentDateTimeInput?.checked ?? false;

    if (tradeDateInput) {
      tradeDateInput.disabled = useCurrentDateTime;
    }

    if (tradeTimeInput) {
      tradeTimeInput.disabled = useCurrentDateTime;
    }

    syncCurrentDateTime();
  };

  const resetCalculationFields = () => {
    const fallbackInstrumentId = getActiveInstruments()[0]?.id ?? store.settings.instruments[0]?.id ?? '';

    if (instrumentInput && fallbackInstrumentId) {
      instrumentInput.value = fallbackInstrumentId;
    }

    if (directionInput) {
      directionInput.value = 'long';
    }

    if (entryInput) {
      entryInput.value = '';
    }

    if (stopLossInput) {
      stopLossInput.value = '';
    }

    if (exitInput) {
      exitInput.value = '';
    }
  };

  const updatePreview = () => {
    syncCurrentDateTime();
    const formData = new FormData(form);
    const trade: Pick<TradeRecord, 'instrumentId' | 'entry' | 'stopLoss' | 'exit' | 'direction'> = {
      instrumentId: String(formData.get('instrumentId') ?? ''),
      direction: formData.get('direction') === 'short' ? 'short' : 'long',
      entry: Number(formData.get('entry') ?? 0),
      stopLoss: Number(formData.get('stopLoss') ?? 0),
      exit:
        formData.get('exit') === null || formData.get('exit') === ''
          ? null
          : Number(formData.get('exit')),
    };

    const metrics = calculateTradeMetrics(trade);
    const lotSize = document.querySelector<HTMLElement>('#preview-lot-size');
    const lots = document.querySelector<HTMLElement>('#preview-lots');
    const value = document.querySelector<HTMLElement>('#preview-value');
    const risk = document.querySelector<HTMLElement>('#preview-risk');
    const pnl = document.querySelector<HTMLElement>('#preview-pnl');
    const rr = document.querySelector<HTMLElement>('#preview-rr');

    if (lotSize) {
      lotSize.textContent = metrics.lotSize > 0 ? formatNumber(metrics.lotSize) : '-';
    }

    if (lots) {
      lots.textContent = formatNumber(metrics.lots);
    }

    if (value) {
      value.textContent = formatCurrency(metrics.value);
    }

    if (risk) {
      risk.textContent = formatCurrency(metrics.risk);
    }

    if (pnl) {
      pnl.textContent = formatCurrency(metrics.pnl);
      pnl.className = metrics.pnl === null ? '' : metrics.pnl >= 0 ? 'positive' : 'negative';
    }

    if (rr) {
      rr.textContent = formatRatio(metrics.rr);
    }
  };

  useCurrentDateTimeInput?.addEventListener('change', () => {
    applyDateTimeMode();
    updatePreview();
  });

  resetCalculationButton?.addEventListener('click', () => {
    resetCalculationFields();
    updatePreview();
  });

  form.addEventListener('input', updatePreview);
  form.addEventListener('change', updatePreview);
  tradeFormClockTimer = window.setInterval(() => {
    syncCurrentDateTime();
    updatePreview();
  }, 1000);
  applyDateTimeMode();
  updatePreview();
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

function bindEvents() {
  document.querySelectorAll<HTMLButtonElement>('[data-role="switch-page"]').forEach((button) => {
    button.addEventListener('click', () => {
      const page =
        button.dataset.page === 'settings' ? 'settings' : button.dataset.page === 'calendar' ? 'calendar' : 'trades';
      store.activePage = page;
      editingTradeId = null;
      persistStore();
      render();
    });
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
    const useCurrentDateTime = formData.get('useCurrentDateTime') === 'on';
    const nextTrade: TradeRecord = {
      id: tradeId || createId('trade'),
      tradeDate: useCurrentDateTime ? getTodayDate() : String(formData.get('tradeDate') ?? store.selectedDate),
      tradeTime: useCurrentDateTime ? getCurrentTime() : String(formData.get('tradeTime') ?? getCurrentTime()),
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
    const formData = new FormData(settingsForm);

    store.settings.capital = Number(formData.get('capital') ?? store.settings.capital);
    store.settings.riskPercent = Number(formData.get('riskPercent') ?? store.settings.riskPercent);
    store.settings.openingBalance = Number(formData.get('openingBalance') ?? store.settings.openingBalance);
    store.settings.instruments = store.settings.instruments.map((instrument) => ({
      ...instrument,
      name: String(formData.get(`name:${instrument.id}`) ?? instrument.name).trim() || instrument.name,
      lotSize: Number(formData.get(`lotSize:${instrument.id}`) ?? instrument.lotSize),
      expiryType: String(formData.get(`expiryType:${instrument.id}`) ?? instrument.expiryType),
      expiryReference: String(formData.get(`expiryReference:${instrument.id}`) ?? instrument.expiryReference),
      enabled: formData.get(`enabled:${instrument.id}`) === 'on',
    }));

    persistStore();
    render();
  });

  document.querySelector<HTMLButtonElement>('[data-role="add-instrument"]')?.addEventListener('click', () => {
    store.settings.instruments.push({
      id: createId('instrument'),
      name: 'NEWINSTRUMENT',
      lotSize: 1,
      expiryType: 'Custom',
      expiryReference: '',
      enabled: true,
    });
    render();
  });

  document.querySelectorAll<HTMLButtonElement>('[data-role="delete-instrument"]').forEach((button) => {
    button.addEventListener('click', () => {
      const instrumentId = button.dataset.id;

      if (!instrumentId) {
        return;
      }

      store.settings.instruments = store.settings.instruments.filter((instrument) => instrument.id !== instrumentId);
      persistStore();
      render();
    });
  });

  document.querySelector<HTMLButtonElement>('[data-role="reset-planner"]')?.addEventListener('click', () => {
    const fresh = defaultStore();
    store.activePage = 'trades';
    store.selectedDate = fresh.selectedDate;
    store.settings = fresh.settings;
    store.trades = [];
    editingTradeId = null;
    persistStore();
    render();
  });

  bindTradePreview();
  bindSettingsPreview();
}

render();
