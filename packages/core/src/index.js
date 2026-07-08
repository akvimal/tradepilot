export const supportedBrokers = [
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
export function calculateRiskReward(plan) {
    if (!plan.targetPrice) {
        return null;
    }
    const risk = Math.abs(plan.entryPrice - plan.stopLossPrice);
    const reward = Math.abs(plan.targetPrice - plan.entryPrice);
    if (risk === 0) {
        return null;
    }
    return Number((reward / risk).toFixed(2));
}
//# sourceMappingURL=index.js.map