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
//# sourceMappingURL=index.d.ts.map