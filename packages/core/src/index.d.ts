import type { BrokerSummary, TradePlan } from '@tradepilot/types';
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
export declare const supportedBrokers: BrokerSummary[];
export declare function calculateRiskReward(plan: Pick<TradePlan, 'entryPrice' | 'stopLossPrice' | 'targetPrice'>): number | null;
//# sourceMappingURL=index.d.ts.map