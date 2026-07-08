import './styles.css';

import { appConfig } from '@tradepilot/config';
import {
  buildManualWorkspaceSnapshot,
  calculateChecklistCompletionRate,
  calculateFollowRate,
  calculateRealizedRiskReward,
  calculateRiskRewardFromPrices,
  manualTradingPlaybooks,
} from '@tradepilot/core';
import type {
  CorrelationStatus,
  DailySessionPlan,
  ManualWorkspaceSnapshot,
  PlannedTradeSetup,
  PostMarketReview,
  SentimentBias,
  SessionExpectation,
  TradeDirection,
  TradeExecution,
} from '@tradepilot/types';

const STORAGE_KEY = 'tradepilot.intraday-workspace.v2';
const appElement = document.querySelector<HTMLDivElement>('#app');

if (!appElement) {
  throw new Error('App root was not found');
}

const app: HTMLDivElement = appElement;

type WorkspaceTab = 'pre-market' | 'executions' | 'post-market' | 'summary' | 'setups';
type ExecutionMode = 'direct' | 'setup';

interface DayRecord {
  sessionPlan: DailySessionPlan;
  setups: PlannedTradeSetup[];
  executions: TradeExecution[];
  review: PostMarketReview;
}

interface AppStore {
  playbooks: ManualWorkspaceSnapshot['playbooks'];
  days: Record<string, DayRecord>;
  selectedDate: string;
}

let activeTab: WorkspaceTab = 'pre-market';
let executionMode: ExecutionMode = 'direct';

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function reviewList(items: string[]) {
  if (items.length === 0) {
    return '<li>No notes yet.</li>';
  }

  return items.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
}

function gradeSetup(projectedRiskReward: number, correlationStatus: CorrelationStatus): PlannedTradeSetup['setupGrade'] {
  if (projectedRiskReward < 5) {
    return 'invalid';
  }

  if (correlationStatus === 'confirming') {
    return 'A';
  }

  if (correlationStatus === 'neutral') {
    return 'B';
  }

  return 'C';
}

function cloneSnapshot(snapshot: ManualWorkspaceSnapshot): DayRecord {
  return {
    sessionPlan: structuredClone(snapshot.sessionPlan),
    setups: structuredClone(snapshot.setups),
    executions: structuredClone(snapshot.executions),
    review: structuredClone(snapshot.review),
  };
}

function createEmptyDayRecord(tradeDate: string): DayRecord {
  const base = buildManualWorkspaceSnapshot();
  const record = cloneSnapshot(base);

  record.sessionPlan.id = `session-${tradeDate}`;
  record.sessionPlan.tradeDate = tradeDate;
  record.sessionPlan.readyForTrading = false;
  record.sessionPlan.globalTrendNote = '';
  record.sessionPlan.crudeOilNote = '';
  record.sessionPlan.newsHeadline = '';
  record.sessionPlan.liquidityDraw = '';
  record.sessionPlan.checklist = record.sessionPlan.checklist.map((item) => ({
    ...item,
    completed: false,
  }));
  record.setups = [];
  record.executions = [];
  record.review = {
    id: `review-${tradeDate}`,
    sessionPlanId: record.sessionPlan.id,
    executionIds: [],
    disciplineScore: 0,
    biasQuality: 0,
    executionQuality: 0,
    whatWorked: [],
    whatFailed: [],
    mindsetNotes: '',
    tomorrowAdjustment: '',
  };

  return record;
}

function migrateOldShape(parsed: unknown): AppStore | null {
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const maybeStore = parsed as Partial<AppStore>;
  if (maybeStore.days && maybeStore.selectedDate) {
    return maybeStore as AppStore;
  }

  const maybeSnapshot = parsed as Partial<ManualWorkspaceSnapshot>;
  if (maybeSnapshot.sessionPlan && maybeSnapshot.playbooks) {
    const tradeDate = maybeSnapshot.sessionPlan.tradeDate;
    return {
      playbooks: maybeSnapshot.playbooks,
      days: {
        [tradeDate]: {
          sessionPlan: maybeSnapshot.sessionPlan,
          setups: maybeSnapshot.setups ?? [],
          executions: maybeSnapshot.executions ?? [],
          review: maybeSnapshot.review!,
        },
      },
      selectedDate: tradeDate,
    };
  }

  return null;
}

function hydrateStore(): AppStore {
  const fallback = buildManualWorkspaceSnapshot();
  const stored = window.localStorage.getItem(STORAGE_KEY);

  if (!stored) {
    return {
      playbooks: fallback.playbooks,
      days: {
        [fallback.sessionPlan.tradeDate]: cloneSnapshot(fallback),
      },
      selectedDate: fallback.sessionPlan.tradeDate,
    };
  }

  try {
    const parsed = JSON.parse(stored);
    return migrateOldShape(parsed) ?? {
      playbooks: fallback.playbooks,
      days: {
        [fallback.sessionPlan.tradeDate]: cloneSnapshot(fallback),
      },
      selectedDate: fallback.sessionPlan.tradeDate,
    };
  } catch {
    return {
      playbooks: fallback.playbooks,
      days: {
        [fallback.sessionPlan.tradeDate]: cloneSnapshot(fallback),
      },
      selectedDate: fallback.sessionPlan.tradeDate,
    };
  }
}

const store = hydrateStore();

function getCurrentDay(): DayRecord {
  const existing = store.days[store.selectedDate];

  if (existing) {
    return existing;
  }

  const created = createEmptyDayRecord(store.selectedDate);
  store.days[store.selectedDate] = created;
  return created;
}

function persistStore() {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function calculateDayMetrics(day: DayRecord) {
  return {
    netPnl: day.executions.reduce((sum, execution) => sum + execution.netPnl, 0),
    avgRealizedR: average(day.executions.map((execution) => execution.realizedRiskReward)),
    avgProjectedR: average(day.setups.map((setup) => setup.projectedRiskReward)),
    followRate: calculateFollowRate(day.executions),
    checklistRate: calculateChecklistCompletionRate(day.sessionPlan.checklist),
    tradeCount: day.executions.length,
  };
}

function calculateOverallMetrics() {
  const days = Object.values(store.days);
  const executions = days.flatMap((day) => day.executions);
  const allSetups = days.flatMap((day) => day.setups);
  const totalNetPnl = executions.reduce((sum, execution) => sum + execution.netPnl, 0);
  const positiveDays = days.filter((day) => calculateDayMetrics(day).netPnl > 0).length;

  return {
    totalNetPnl,
    averageRealizedR: average(executions.map((execution) => execution.realizedRiskReward)),
    averageProjectedR: average(allSetups.map((setup) => setup.projectedRiskReward)),
    followRate: calculateFollowRate(executions),
    disciplineAverage: average(days.map((day) => day.review.disciplineScore)),
    tradedDays: days.filter((day) => day.executions.length > 0).length,
    positiveDays,
  };
}

function getDayStatus(day: DayRecord) {
  if (day.review.executionIds.length > 0) {
    return 'reviewed';
  }

  if (day.executions.length > 0) {
    return 'traded';
  }

  if (day.sessionPlan.readyForTrading) {
    return 'ready';
  }

  return 'planning';
}

function switchDay(tradeDate: string) {
  store.selectedDate = tradeDate;

  if (!store.days[tradeDate]) {
    store.days[tradeDate] = createEmptyDayRecord(tradeDate);
  }

  persistStore();
  render();
}

function renderCalendar() {
  const current = getCurrentDay();
  const [year, month] = current.sessionPlan.tradeDate.split('-').map(Number);
  const firstDay = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  const offset = (firstDay.getDay() + 6) % 7;
  const tiles: string[] = [];

  for (let i = 0; i < offset; i += 1) {
    tiles.push('<div class="calendar-tile blank"></div>');
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const tradeDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const record = store.days[tradeDate] ?? createEmptyDayRecord(tradeDate);
    const metrics = calculateDayMetrics(record);
    const tone = metrics.netPnl > 0 ? 'positive' : metrics.netPnl < 0 ? 'negative' : 'neutral';

    tiles.push(`
      <button type="button" class="calendar-tile ${tone} ${tradeDate === store.selectedDate ? 'selected' : ''}" data-role="select-day" data-date="${tradeDate}">
        <strong>${day}</strong>
        <span>${metrics.netPnl === 0 ? '-' : `Rs ${Math.round(metrics.netPnl).toLocaleString('en-IN')}`}</span>
      </button>
    `);
  }

  return `
    <section class="panel">
      <div class="section-head">
        <div>
          <span class="eyebrow muted">Month view</span>
          <h2>Profit / Loss by Day</h2>
        </div>
        <span class="pill">${firstDay.toLocaleString('en-US', { month: 'long', year: 'numeric' })}</span>
      </div>
      <div class="calendar-head">
        <span>Mon</span>
        <span>Tue</span>
        <span>Wed</span>
        <span>Thu</span>
        <span>Fri</span>
        <span>Sat</span>
        <span>Sun</span>
      </div>
      <div class="calendar-grid">${tiles.join('')}</div>
    </section>
  `;
}

function renderOverview() {
  const overall = calculateOverallMetrics();

  return `
    <section class="stats-grid">
      <article class="stat-card">
        <span class="label">Total Net P&amp;L</span>
        <strong>Rs ${overall.totalNetPnl.toLocaleString('en-IN')}</strong>
        <span>All recorded intraday trades</span>
      </article>
      <article class="stat-card">
        <span class="label">Average Realized R</span>
        <strong>${overall.averageRealizedR}R</strong>
        <span>Across all executions</span>
      </article>
      <article class="stat-card">
        <span class="label">Plan Follow Rate</span>
        <strong>${overall.followRate}%</strong>
        <span>Broad day-plan compliance</span>
      </article>
      <article class="stat-card">
        <span class="label">Disciplined Days</span>
        <strong>${overall.positiveDays}/${overall.tradedDays}</strong>
        <span>Positive P&amp;L days</span>
      </article>
    </section>
  `;
}

function renderTabButton(tab: WorkspaceTab, label: string, optional = false) {
  return `<button type="button" class="tab-button ${activeTab === tab ? 'active' : ''}" data-role="switch-tab" data-tab="${tab}">
    ${label}${optional ? ' <span class="optional-tag">optional</span>' : ''}
  </button>`;
}

function renderDayHeader(day: DayRecord) {
  const metrics = calculateDayMetrics(day);
  const playbook = store.playbooks.find((item) => item.id === day.sessionPlan.playbookId) ?? manualTradingPlaybooks[0];

  return `
    <section class="panel day-header">
      <div class="day-title">
        <span class="eyebrow">Intraday Trading</span>
        <h2>${escapeHtml(day.sessionPlan.tradeDate)}</h2>
        <p>${escapeHtml(playbook.label)}</p>
      </div>
      <div class="day-meta">
        <div><span>Primary</span><strong>${escapeHtml(day.sessionPlan.primaryInstrument)}</strong></div>
        <div><span>Correlation</span><strong>${escapeHtml(day.sessionPlan.correlationInstrument)}</strong></div>
        <div><span>Status</span><strong>${escapeHtml(getDayStatus(day))}</strong></div>
        <div><span>Checklist</span><strong>${metrics.checklistRate}%</strong></div>
        <div><span>Trades</span><strong>${metrics.tradeCount}</strong></div>
        <div><span>Net P&amp;L</span><strong>Rs ${metrics.netPnl.toLocaleString('en-IN')}</strong></div>
      </div>
    </section>
  `;
}

function renderPreMarket(day: DayRecord) {
  const checklistRows = day.sessionPlan.checklist
    .map(
      (item, index) => `
        <label class="check-item ${item.completed ? 'done' : 'pending'}">
          <span>${escapeHtml(item.label)}</span>
          <input type="checkbox" data-role="toggle-check" data-index="${index}" ${item.completed ? 'checked' : ''} />
        </label>
      `,
    )
    .join('');

  return `
    <section class="content-grid">
      <article class="panel">
        <div class="section-head">
          <div>
            <span class="eyebrow muted">Required before market</span>
            <h2>Pre-Market Plan</h2>
          </div>
          <span class="badge ${day.sessionPlan.readyForTrading ? 'ready' : 'blocked'}">${day.sessionPlan.readyForTrading ? 'ready' : 'not ready'}</span>
        </div>
        <form id="session-plan-form" class="form-grid">
          <label>
            <span>Trade date</span>
            <input name="tradeDate" type="date" value="${escapeHtml(day.sessionPlan.tradeDate)}" />
          </label>
          <label>
            <span>Playbook</span>
            <select name="playbookId">
              ${store.playbooks
                .map(
                  (item) =>
                    `<option value="${item.id}" ${item.id === day.sessionPlan.playbookId ? 'selected' : ''}>${escapeHtml(item.label)}</option>`,
                )
                .join('')}
            </select>
          </label>
          <label>
            <span>Primary instrument</span>
            <input name="primaryInstrument" value="${escapeHtml(day.sessionPlan.primaryInstrument)}" />
          </label>
          <label>
            <span>Correlation instrument</span>
            <input name="correlationInstrument" value="${escapeHtml(day.sessionPlan.correlationInstrument)}" />
          </label>
          <label>
            <span>Global sentiment</span>
            <select name="globalSentiment">
              ${['bullish', 'bearish', 'neutral', 'mixed']
                .map(
                  (value) =>
                    `<option value="${value}" ${value === day.sessionPlan.globalSentiment ? 'selected' : ''}>${value}</option>`,
                )
                .join('')}
            </select>
          </label>
          <label>
            <span>Crude bias</span>
            <select name="crudeOilBias">
              ${['bullish', 'bearish', 'neutral', 'mixed']
                .map(
                  (value) =>
                    `<option value="${value}" ${value === day.sessionPlan.crudeOilBias ? 'selected' : ''}>${value}</option>`,
                )
                .join('')}
            </select>
          </label>
          <label class="full">
            <span>Global trend note</span>
            <textarea name="globalTrendNote" rows="3">${escapeHtml(day.sessionPlan.globalTrendNote)}</textarea>
          </label>
          <label class="full">
            <span>Crude oil note</span>
            <textarea name="crudeOilNote" rows="3">${escapeHtml(day.sessionPlan.crudeOilNote)}</textarea>
          </label>
          <label>
            <span>News risk</span>
            <select name="newsRisk">
              ${['low', 'medium', 'high']
                .map(
                  (value) =>
                    `<option value="${value}" ${value === day.sessionPlan.newsRisk ? 'selected' : ''}>${value}</option>`,
                )
                .join('')}
            </select>
          </label>
          <label>
            <span>Session expectation</span>
            <select name="sessionExpectation">
              ${['trend_day', 'range_day', 'event_driven', 'uncertain']
                .map(
                  (value) =>
                    `<option value="${value}" ${value === day.sessionPlan.sessionExpectation ? 'selected' : ''}>${value.replace('_', ' ')}</option>`,
                )
                .join('')}
            </select>
          </label>
          <label class="full">
            <span>News headline / risk note</span>
            <textarea name="newsHeadline" rows="3">${escapeHtml(day.sessionPlan.newsHeadline)}</textarea>
          </label>
          <label class="full">
            <span>Liquidity draw</span>
            <textarea name="liquidityDraw" rows="3">${escapeHtml(day.sessionPlan.liquidityDraw)}</textarea>
          </label>
          <label class="checkbox-row full">
            <input name="readyForTrading" type="checkbox" ${day.sessionPlan.readyForTrading ? 'checked' : ''} />
            <span>Mark day ready for trading</span>
          </label>
          <div class="actions full">
            <button type="submit">Save pre-market plan</button>
          </div>
        </form>
      </article>
      <aside class="panel">
        <div class="section-head">
          <div>
            <span class="eyebrow muted">Checklist</span>
            <h2>Readiness</h2>
          </div>
          <span class="pill">${calculateChecklistCompletionRate(day.sessionPlan.checklist)}%</span>
        </div>
        <div class="checklist">${checklistRows}</div>
      </aside>
    </section>
  `;
}

function renderExecutions(day: DayRecord) {
  const setupOptions = day.setups
    .map((setup) => `<option value="${setup.id}">${escapeHtml(setup.primaryInstrument)} | ${escapeHtml(setup.setupType)}</option>`)
    .join('');

  const rows = day.executions
    .slice()
    .reverse()
    .map(
      (execution) => `
        <tr>
          <td>${escapeHtml(execution.instrumentSymbol)}</td>
          <td>${escapeHtml(execution.accountLabel)}</td>
          <td>${execution.followedPlan ? 'Planned' : 'Direct'}</td>
          <td>${execution.actualEntry}</td>
          <td>${execution.exitPrice}</td>
          <td>${execution.realizedRiskReward}R</td>
          <td class="${execution.netPnl >= 0 ? 'positive' : 'negative'}">Rs ${execution.netPnl.toLocaleString('en-IN')}</td>
        </tr>
      `,
    )
    .join('');

  return `
    <section class="content-grid wide">
      <article class="panel">
        <div class="section-head">
          <div>
            <span class="eyebrow muted">Primary working area</span>
            <h2>Executions</h2>
          </div>
          <div class="segmented">
            <button type="button" class="segment ${executionMode === 'direct' ? 'active' : ''}" data-role="execution-mode" data-mode="direct">Direct trade</button>
            <button type="button" class="segment ${executionMode === 'setup' ? 'active' : ''}" data-role="execution-mode" data-mode="setup">From setup</button>
          </div>
        </div>
        <form id="execution-form" class="form-grid">
          ${
            executionMode === 'setup'
              ? `
            <label class="full">
              <span>Linked setup</span>
              <select name="setupId" ${day.setups.length === 0 ? 'disabled' : ''}>${setupOptions}</select>
            </label>
          `
              : `
            <label>
              <span>Primary instrument</span>
              <input name="directPrimaryInstrument" value="${escapeHtml(day.sessionPlan.primaryInstrument)}" />
            </label>
            <label>
              <span>Correlation instrument</span>
              <input name="directCorrelationInstrument" value="${escapeHtml(day.sessionPlan.correlationInstrument)}" />
            </label>
            <label>
              <span>Direction</span>
              <select name="directDirection">
                <option value="long">long</option>
                <option value="short">short</option>
              </select>
            </label>
            <label>
              <span>Instrument type</span>
              <select name="directInstrumentType">
                <option value="index_option">index option</option>
                <option value="perpetual">perpetual</option>
                <option value="spot">spot</option>
                <option value="future">future</option>
                <option value="stock">stock</option>
                <option value="fx_pair">fx pair</option>
              </select>
            </label>
            <label class="full">
              <span>Order flow / trigger</span>
              <textarea name="directTrigger" rows="3" placeholder="Current order flow, displacement, sweep, reversal trigger"></textarea>
            </label>
            <label>
              <span>Entry timeframe</span>
              <input name="directEntryTimeframe" placeholder="15s / 1m / 3m" />
            </label>
            <label>
              <span>Correlation status</span>
              <select name="directCorrelationStatus">
                <option value="confirming">confirming</option>
                <option value="neutral">neutral</option>
                <option value="diverging">diverging</option>
              </select>
            </label>
          `
          }
          <label>
            <span>Broker label</span>
            <input name="brokerLabel" value="Manual Entry" required />
          </label>
          <label>
            <span>Account label</span>
            <input name="accountLabel" placeholder="Primary Intraday" required />
          </label>
          <label>
            <span>Instrument symbol</span>
            <input name="instrumentSymbol" placeholder="NIFTY 24300 CE" required />
          </label>
          <label>
            <span>Actual entry</span>
            <input name="actualEntry" type="number" step="any" required />
          </label>
          <label>
            <span>Stop price</span>
            <input name="stopLossPrice" type="number" step="any" required />
          </label>
          <label>
            <span>Target price</span>
            <input name="targetPrice" type="number" step="any" required />
          </label>
          <label>
            <span>Exit price</span>
            <input name="exitPrice" type="number" step="any" required />
          </label>
          <label>
            <span>Quantity</span>
            <input name="quantity" type="number" step="any" value="1" required />
          </label>
          <label>
            <span>Fees</span>
            <input name="fees" type="number" step="any" value="0" required />
          </label>
          <label class="checkbox-row full">
            <input name="followedPlan" type="checkbox" ${executionMode === 'setup' ? 'checked' : ''} />
            <span>Execution followed the broader day plan</span>
          </label>
          <div class="actions full">
            <button type="submit">Save execution</button>
          </div>
        </form>
      </article>
      <article class="panel">
        <div class="section-head">
          <div>
            <span class="eyebrow muted">Captured trades</span>
            <h2>Trade Log</h2>
          </div>
          <span class="pill">${day.executions.length} trades</span>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Instrument</th>
                <th>Account</th>
                <th>Type</th>
                <th>Entry</th>
                <th>Exit</th>
                <th>R</th>
                <th>Net P&amp;L</th>
              </tr>
            </thead>
            <tbody>${rows || '<tr><td colspan="7" class="empty-cell">No executions logged for this day.</td></tr>'}</tbody>
          </table>
        </div>
      </article>
    </section>
  `;
}

function renderPostMarket(day: DayRecord) {
  return `
    <section class="content-grid">
      <article class="panel">
        <div class="section-head">
          <div>
            <span class="eyebrow muted">Required after trading</span>
            <h2>Post-Market Review</h2>
          </div>
          <span class="badge review">${day.review.executionQuality}/100 execution</span>
        </div>
        <form id="review-form" class="form-grid">
          <label>
            <span>Discipline score</span>
            <input name="disciplineScore" type="number" min="0" max="100" value="${day.review.disciplineScore}" />
          </label>
          <label>
            <span>Bias quality</span>
            <input name="biasQuality" type="number" min="0" max="100" value="${day.review.biasQuality}" />
          </label>
          <label>
            <span>Execution quality</span>
            <input name="executionQuality" type="number" min="0" max="100" value="${day.review.executionQuality}" />
          </label>
          <label class="full">
            <span>What worked (one line per item)</span>
            <textarea name="whatWorked" rows="4">${escapeHtml(day.review.whatWorked.join('\n'))}</textarea>
          </label>
          <label class="full">
            <span>What failed (one line per item)</span>
            <textarea name="whatFailed" rows="4">${escapeHtml(day.review.whatFailed.join('\n'))}</textarea>
          </label>
          <label class="full">
            <span>Mindset notes</span>
            <textarea name="mindsetNotes" rows="3">${escapeHtml(day.review.mindsetNotes)}</textarea>
          </label>
          <label class="full">
            <span>Tomorrow adjustment</span>
            <textarea name="tomorrowAdjustment" rows="3">${escapeHtml(day.review.tomorrowAdjustment)}</textarea>
          </label>
          <div class="actions full split">
            <button type="submit">Save review</button>
            <button type="button" id="reset-data">Reset sample data</button>
          </div>
        </form>
      </article>
      <aside class="panel">
        <div class="section-head">
          <div>
            <span class="eyebrow muted">Review recap</span>
            <h2>Notes</h2>
          </div>
          <span class="pill">${day.review.disciplineScore}/100</span>
        </div>
        <div class="review-stack">
          <div class="note-box">
            <strong>What worked</strong>
            <ul class="text-list">${reviewList(day.review.whatWorked)}</ul>
          </div>
          <div class="note-box caution">
            <strong>What failed</strong>
            <ul class="text-list">${reviewList(day.review.whatFailed)}</ul>
          </div>
        </div>
      </aside>
    </section>
  `;
}

function renderSummary(day: DayRecord) {
  const metrics = calculateDayMetrics(day);

  return `
    <section class="stats-grid">
      <article class="stat-card">
        <span class="label">Checklist</span>
        <strong>${metrics.checklistRate}%</strong>
        <span>Pre-market completion</span>
      </article>
      <article class="stat-card">
        <span class="label">Trades</span>
        <strong>${metrics.tradeCount}</strong>
        <span>Logged for day</span>
      </article>
      <article class="stat-card">
        <span class="label">Avg R</span>
        <strong>${metrics.avgRealizedR}R</strong>
        <span>Realized</span>
      </article>
      <article class="stat-card">
        <span class="label">Net P&amp;L</span>
        <strong>Rs ${metrics.netPnl.toLocaleString('en-IN')}</strong>
        <span>After fees</span>
      </article>
      <article class="panel summary-panel">
        <div class="section-head">
          <div>
            <span class="eyebrow muted">Bias recap</span>
            <h2>Pre-Market Summary</h2>
          </div>
        </div>
        <ul class="text-list">
          <li>Global: ${escapeHtml(day.sessionPlan.globalSentiment)} - ${escapeHtml(day.sessionPlan.globalTrendNote)}</li>
          <li>Crude: ${escapeHtml(day.sessionPlan.crudeOilBias)} - ${escapeHtml(day.sessionPlan.crudeOilNote)}</li>
          <li>News: ${escapeHtml(day.sessionPlan.newsRisk)} - ${escapeHtml(day.sessionPlan.newsHeadline)}</li>
          <li>Liquidity draw: ${escapeHtml(day.sessionPlan.liquidityDraw)}</li>
        </ul>
      </article>
      <article class="panel summary-panel">
        <div class="section-head">
          <div>
            <span class="eyebrow muted">Review recap</span>
            <h2>Post-Market Summary</h2>
          </div>
        </div>
        <ul class="text-list">
          <li>Discipline score: ${day.review.disciplineScore}</li>
          <li>Bias quality: ${day.review.biasQuality}</li>
          <li>Execution quality: ${day.review.executionQuality}</li>
          <li>Tomorrow: ${escapeHtml(day.review.tomorrowAdjustment)}</li>
        </ul>
      </article>
    </section>
  `;
}

function renderSetups(day: DayRecord) {
  const setupRows = day.setups
    .slice()
    .reverse()
    .map(
      (setup) => `
        <article class="setup-card">
          <div class="section-head">
            <div>
              <span class="eyebrow muted">${escapeHtml(setup.primaryInstrument)} / ${escapeHtml(setup.correlationInstrument)}</span>
              <h3>${escapeHtml(setup.setupType)}</h3>
            </div>
            <span class="badge grade-${setup.setupGrade.toLowerCase()}">${setup.setupGrade} grade</span>
          </div>
          <p>${escapeHtml(setup.confirmationNarrative)}</p>
          <dl class="metric-grid">
            <div><dt>Entry TF</dt><dd>${escapeHtml(setup.entryTimeframe)}</dd></div>
            <div><dt>Projected R:R</dt><dd>${setup.projectedRiskReward}R</dd></div>
            <div><dt>Risk</dt><dd>Rs ${setup.riskAmount.toLocaleString('en-IN')}</dd></div>
            <div><dt>Correlation</dt><dd>${escapeHtml(setup.correlationStatus)}</dd></div>
          </dl>
        </article>
      `,
    )
    .join('');

  return `
    <section class="content-grid">
      <article class="panel">
        <div class="section-head">
          <div>
            <span class="eyebrow muted">Optional support</span>
            <h2>Setups</h2>
          </div>
          <span class="pill">${day.setups.length} saved</span>
        </div>
        <form id="setup-form" class="form-grid">
          <label>
            <span>Primary instrument</span>
            <input name="primaryInstrument" value="${escapeHtml(day.sessionPlan.primaryInstrument)}" />
          </label>
          <label>
            <span>Correlation instrument</span>
            <input name="correlationInstrument" value="${escapeHtml(day.sessionPlan.correlationInstrument)}" />
          </label>
          <label>
            <span>Direction</span>
            <select name="direction">
              <option value="long">long</option>
              <option value="short">short</option>
            </select>
          </label>
          <label>
            <span>Instrument type</span>
            <select name="instrumentType">
              <option value="index_option">index option</option>
              <option value="perpetual">perpetual</option>
              <option value="spot">spot</option>
              <option value="future">future</option>
              <option value="stock">stock</option>
              <option value="fx_pair">fx pair</option>
            </select>
          </label>
          <label class="full">
            <span>Setup type</span>
            <input name="setupType" placeholder="sell-side sweep -> MSS -> FVG reclaim" />
          </label>
          <label class="full">
            <span>Confirmation narrative</span>
            <textarea name="confirmationNarrative" rows="3"></textarea>
          </label>
          <label class="full">
            <span>Execution narrative</span>
            <textarea name="executionNarrative" rows="3"></textarea>
          </label>
          <label>
            <span>Entry timeframe</span>
            <input name="entryTimeframe" placeholder="15s / 3m / 1m" />
          </label>
          <label>
            <span>Correlation status</span>
            <select name="correlationStatus">
              <option value="confirming">confirming</option>
              <option value="neutral">neutral</option>
              <option value="diverging">diverging</option>
            </select>
          </label>
          <label>
            <span>Entry price</span>
            <input name="entryPrice" type="number" step="any" required />
          </label>
          <label>
            <span>Stop price</span>
            <input name="stopLossPrice" type="number" step="any" required />
          </label>
          <label>
            <span>Target price</span>
            <input name="targetPrice" type="number" step="any" required />
          </label>
          <label>
            <span>Risk amount</span>
            <input name="riskAmount" type="number" step="any" required />
          </label>
          <label class="full">
            <span>Invalidation</span>
            <textarea name="invalidation" rows="2"></textarea>
          </label>
          <label class="full">
            <span>Target narrative</span>
            <textarea name="targetNarrative" rows="2"></textarea>
          </label>
          <label class="full">
            <span>Notes</span>
            <textarea name="notes" rows="2"></textarea>
          </label>
          <div class="actions full">
            <button type="submit">Save setup</button>
          </div>
        </form>
      </article>
      <aside class="panel">
        <div class="section-head">
          <div>
            <span class="eyebrow muted">Setup board</span>
            <h2>Optional Queue</h2>
          </div>
        </div>
        <div class="setup-grid">${setupRows || '<p class="muted-copy">No setups saved. Use direct execution if you trade from live order flow.</p>'}</div>
      </aside>
    </section>
  `;
}

function renderActiveTab(day: DayRecord) {
  if (activeTab === 'pre-market') {
    return renderPreMarket(day);
  }

  if (activeTab === 'executions') {
    return renderExecutions(day);
  }

  if (activeTab === 'post-market') {
    return renderPostMarket(day);
  }

  if (activeTab === 'setups') {
    return renderSetups(day);
  }

  return renderSummary(day);
}

function render() {
  const currentDay = getCurrentDay();

  app.innerHTML = `
    <main class="page-shell">
      <section class="hero-banner panel">
        <div>
          <span class="eyebrow">Manual-first intraday journal</span>
          <h1>${appConfig.name}</h1>
          <p>Separate intraday page with dashboard metrics, monthly P&amp;L calendar, and a selected trading day workspace.</p>
        </div>
      </section>

      ${renderOverview()}
      ${renderCalendar()}

      <section class="workspace-zone">
        ${renderDayHeader(currentDay)}
        <nav class="tab-row panel">
          ${renderTabButton('pre-market', 'Pre-Market')}
          ${renderTabButton('executions', 'Executions')}
          ${renderTabButton('post-market', 'Post-Market')}
          ${renderTabButton('summary', 'Summary')}
          ${renderTabButton('setups', 'Setups', true)}
        </nav>
        ${renderActiveTab(currentDay)}
      </section>
    </main>
  `;

  bindEvents();
}

function bindEvents() {
  const day = getCurrentDay();
  const sessionPlanForm = document.querySelector<HTMLFormElement>('#session-plan-form');
  const setupForm = document.querySelector<HTMLFormElement>('#setup-form');
  const executionForm = document.querySelector<HTMLFormElement>('#execution-form');
  const reviewForm = document.querySelector<HTMLFormElement>('#review-form');
  const resetButton = document.querySelector<HTMLButtonElement>('#reset-data');

  document.querySelectorAll<HTMLButtonElement>('[data-role="switch-tab"]').forEach((button) => {
    button.addEventListener('click', () => {
      activeTab = button.dataset.tab as WorkspaceTab;
      render();
    });
  });

  document.querySelectorAll<HTMLButtonElement>('[data-role="execution-mode"]').forEach((button) => {
    button.addEventListener('click', () => {
      executionMode = button.dataset.mode as ExecutionMode;
      render();
    });
  });

  document.querySelectorAll<HTMLButtonElement>('[data-role="select-day"]').forEach((button) => {
    button.addEventListener('click', () => {
      const tradeDate = button.dataset.date;

      if (tradeDate) {
        switchDay(tradeDate);
      }
    });
  });

  document.querySelectorAll<HTMLInputElement>('[data-role="toggle-check"]').forEach((input) => {
    input.addEventListener('change', () => {
      const index = Number(input.dataset.index);
      const item = day.sessionPlan.checklist[index];

      if (!item) {
        return;
      }

      item.completed = input.checked;
      persistStore();
      render();
    });
  });

  sessionPlanForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(sessionPlanForm);
    const nextDate = String(formData.get('tradeDate') ?? day.sessionPlan.tradeDate);

    day.sessionPlan = {
      ...day.sessionPlan,
      tradeDate: nextDate,
      playbookId: String(formData.get('playbookId') ?? day.sessionPlan.playbookId),
      primaryInstrument: String(formData.get('primaryInstrument') ?? day.sessionPlan.primaryInstrument),
      correlationInstrument: String(formData.get('correlationInstrument') ?? day.sessionPlan.correlationInstrument),
      globalSentiment: String(formData.get('globalSentiment') ?? day.sessionPlan.globalSentiment) as SentimentBias,
      crudeOilBias: String(formData.get('crudeOilBias') ?? day.sessionPlan.crudeOilBias) as SentimentBias,
      globalTrendNote: String(formData.get('globalTrendNote') ?? ''),
      crudeOilNote: String(formData.get('crudeOilNote') ?? ''),
      newsRisk: String(formData.get('newsRisk') ?? day.sessionPlan.newsRisk) as DailySessionPlan['newsRisk'],
      newsHeadline: String(formData.get('newsHeadline') ?? ''),
      sessionExpectation: String(formData.get('sessionExpectation') ?? day.sessionPlan.sessionExpectation) as SessionExpectation,
      liquidityDraw: String(formData.get('liquidityDraw') ?? ''),
      readyForTrading: formData.get('readyForTrading') === 'on',
    };

    if (nextDate !== store.selectedDate) {
      delete store.days[store.selectedDate];
      store.days[nextDate] = day;
      store.selectedDate = nextDate;
    }

    persistStore();
    render();
  });

  setupForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(setupForm);
    const entryPrice = Number(formData.get('entryPrice'));
    const stopLossPrice = Number(formData.get('stopLossPrice'));
    const targetPrice = Number(formData.get('targetPrice'));
    const riskAmount = Number(formData.get('riskAmount'));
    const correlationStatus = String(formData.get('correlationStatus')) as CorrelationStatus;
    const projectedRiskReward = calculateRiskRewardFromPrices(entryPrice, stopLossPrice, targetPrice) ?? 0;

    const setup: PlannedTradeSetup = {
      id: createId('setup'),
      sessionPlanId: day.sessionPlan.id,
      playbookId: day.sessionPlan.playbookId,
      primaryInstrument: String(formData.get('primaryInstrument') ?? day.sessionPlan.primaryInstrument),
      correlationInstrument: String(formData.get('correlationInstrument') ?? day.sessionPlan.correlationInstrument),
      instrumentType: String(formData.get('instrumentType') ?? 'index_option') as PlannedTradeSetup['instrumentType'],
      direction: String(formData.get('direction') ?? 'long') as TradeDirection,
      setupType: String(formData.get('setupType') ?? ''),
      setupGrade: gradeSetup(projectedRiskReward, correlationStatus),
      correlationStatus,
      confirmationNarrative: String(formData.get('confirmationNarrative') ?? ''),
      executionNarrative: String(formData.get('executionNarrative') ?? ''),
      entryTimeframe: String(formData.get('entryTimeframe') ?? ''),
      entryPrice,
      stopLossPrice,
      targetPrice,
      riskAmount,
      projectedRiskReward,
      invalidation: String(formData.get('invalidation') ?? ''),
      targetNarrative: String(formData.get('targetNarrative') ?? ''),
      notes: String(formData.get('notes') ?? ''),
    };

    day.setups.push(setup);
    persistStore();
    render();
  });

  executionForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(executionForm);
    const actualEntry = Number(formData.get('actualEntry'));
    const stopLossPrice = Number(formData.get('stopLossPrice'));
    const targetPrice = Number(formData.get('targetPrice'));
    const exitPrice = Number(formData.get('exitPrice'));
    const quantity = Number(formData.get('quantity'));
    const fees = Number(formData.get('fees'));
    let setupId = '';
    let direction: TradeDirection = 'long';
    let instrumentType: TradeExecution['instrumentType'] = 'index_option';
    let plannedEntry = actualEntry;
    let optionType: TradeExecution['optionType'];

    if (executionMode === 'setup') {
      setupId = String(formData.get('setupId') ?? '');
      const linkedSetup = day.setups.find((item) => item.id === setupId);

      if (!linkedSetup) {
        return;
      }

      direction = linkedSetup.direction;
      instrumentType = linkedSetup.instrumentType;
      plannedEntry = linkedSetup.entryPrice;
      if (instrumentType === 'index_option') {
        optionType = direction === 'long' ? 'CE' : 'PE';
      }
    } else {
      direction = String(formData.get('directDirection') ?? 'long') as TradeDirection;
      instrumentType = String(formData.get('directInstrumentType') ?? 'index_option') as TradeExecution['instrumentType'];
      const projectedRiskReward = calculateRiskRewardFromPrices(actualEntry, stopLossPrice, targetPrice) ?? 0;
      const correlationStatus = String(formData.get('directCorrelationStatus') ?? 'neutral') as CorrelationStatus;

      const directSetup: PlannedTradeSetup = {
        id: createId('setup'),
        sessionPlanId: day.sessionPlan.id,
        playbookId: day.sessionPlan.playbookId,
        primaryInstrument: String(formData.get('directPrimaryInstrument') ?? day.sessionPlan.primaryInstrument),
        correlationInstrument: String(formData.get('directCorrelationInstrument') ?? day.sessionPlan.correlationInstrument),
        instrumentType,
        direction,
        setupType: 'direct order-flow execution',
        setupGrade: gradeSetup(projectedRiskReward, correlationStatus),
        correlationStatus,
        confirmationNarrative: String(formData.get('directTrigger') ?? ''),
        executionNarrative: 'Captured directly from live order flow without pre-planned setup.',
        entryTimeframe: String(formData.get('directEntryTimeframe') ?? ''),
        entryPrice: actualEntry,
        stopLossPrice,
        targetPrice,
        riskAmount: 0,
        projectedRiskReward,
        invalidation: 'Defined live at execution time.',
        targetNarrative: 'Captured in direct execution mode.',
        notes: 'Direct trade.',
      };

      day.setups.push(directSetup);
      setupId = directSetup.id;
      if (instrumentType === 'index_option') {
        optionType = direction === 'long' ? 'CE' : 'PE';
      }
    }

    const priceDelta = direction === 'long' ? exitPrice - actualEntry : actualEntry - exitPrice;
    const grossPnl = Number((priceDelta * quantity).toFixed(2));
    const netPnl = Number((grossPnl - fees).toFixed(2));

    const execution: TradeExecution = {
      id: createId('execution'),
      setupId,
      brokerLabel: String(formData.get('brokerLabel') ?? 'Manual Entry'),
      accountLabel: String(formData.get('accountLabel') ?? ''),
      instrumentSymbol: String(formData.get('instrumentSymbol') ?? ''),
      instrumentType,
      direction,
      optionType,
      plannedEntry,
      actualEntry,
      stopLossPrice,
      targetPrice,
      exitPrice,
      quantity,
      fees,
      grossPnl,
      netPnl,
      realizedRiskReward: calculateRealizedRiskReward(actualEntry, stopLossPrice, exitPrice, direction) ?? 0,
      followedPlan: formData.get('followedPlan') === 'on',
    };

    day.executions.push(execution);
    persistStore();
    render();
  });

  reviewForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(reviewForm);

    day.review = {
      ...day.review,
      executionIds: day.executions.map((execution) => execution.id),
      disciplineScore: Number(formData.get('disciplineScore') ?? day.review.disciplineScore),
      biasQuality: Number(formData.get('biasQuality') ?? day.review.biasQuality),
      executionQuality: Number(formData.get('executionQuality') ?? day.review.executionQuality),
      whatWorked: String(formData.get('whatWorked') ?? '')
        .split('\n')
        .map((item) => item.trim())
        .filter(Boolean),
      whatFailed: String(formData.get('whatFailed') ?? '')
        .split('\n')
        .map((item) => item.trim())
        .filter(Boolean),
      mindsetNotes: String(formData.get('mindsetNotes') ?? ''),
      tomorrowAdjustment: String(formData.get('tomorrowAdjustment') ?? ''),
    };

    persistStore();
    render();
  });

  resetButton?.addEventListener('click', () => {
    const fresh = buildManualWorkspaceSnapshot();
    store.playbooks = fresh.playbooks;
    store.days = {
      [fresh.sessionPlan.tradeDate]: cloneSnapshot(fresh),
    };
    store.selectedDate = fresh.sessionPlan.tradeDate;
    activeTab = 'pre-market';
    executionMode = 'direct';
    persistStore();
    render();
  });
}

render();
