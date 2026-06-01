export const FINANCE_DATA_CHANGED_EVENT = 'finance:dataChanged';

export type FinanceDataArea = 'transactions' | 'accounts' | 'ledger' | 'balances' | 'review';

export type FinanceDataChangedPayload = {
  areas?: FinanceDataArea[];
  source?: string;
  transactionId?: string;
  at: number;
};

type FinanceDataChangedInput = Omit<FinanceDataChangedPayload, 'at'>;
type FinanceDataChangedListener = (payload: FinanceDataChangedPayload) => void;

const financeDataListeners = new Set<FinanceDataChangedListener>();
const FINANCE_DATA_AREAS = new Set<FinanceDataArea>([
  'transactions',
  'accounts',
  'ledger',
  'balances',
  'review',
]);

export function emitFinanceDataChanged(payload: FinanceDataChangedInput = {}): void {
  const areas = payload.areas?.filter(area => FINANCE_DATA_AREAS.has(area));
  const source = typeof payload.source === 'string' && /^[a-z0-9:_-]+$/i.test(payload.source)
    ? payload.source
    : undefined;
  const transactionId = typeof payload.transactionId === 'string' &&
    /^[a-z0-9_-]{1,128}$/i.test(payload.transactionId)
    ? payload.transactionId
    : undefined;
  const event: FinanceDataChangedPayload = {
    ...(areas ? { areas } : {}),
    ...(source ? { source } : {}),
    ...(transactionId ? { transactionId } : {}),
    at: Date.now(),
  };

  financeDataListeners.forEach(listener => {
    try {
      listener(event);
    } catch (error) {
      console.warn('[FinanceDataEvents] Listener failed:', error);
    }
  });
}

export function subscribeFinanceDataChanged(
  listener: FinanceDataChangedListener
): () => void {
  financeDataListeners.add(listener);
  return () => {
    financeDataListeners.delete(listener);
  };
}

export function financeDataChangedAffects(
  payload: FinanceDataChangedPayload,
  areas: FinanceDataArea[]
): boolean {
  if (!payload.areas || payload.areas.length === 0) return true;
  return payload.areas.some(area => areas.includes(area));
}
