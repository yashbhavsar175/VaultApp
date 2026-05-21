export const FINANCE_DATA_CHANGED_EVENT = 'finance:dataChanged';

export type FinanceDataArea = 'transactions' | 'accounts' | 'ledger';

export type FinanceDataChangedPayload = {
  areas?: FinanceDataArea[];
  source?: string;
  transactionId?: string;
  at: number;
};

type FinanceDataChangedInput = Omit<FinanceDataChangedPayload, 'at'>;
type FinanceDataChangedListener = (payload: FinanceDataChangedPayload) => void;

const financeDataListeners = new Set<FinanceDataChangedListener>();

export function emitFinanceDataChanged(payload: FinanceDataChangedInput = {}): void {
  const event: FinanceDataChangedPayload = {
    ...payload,
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
