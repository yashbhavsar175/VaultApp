import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../core';

const DISMISSED_PROPOSALS_BASE_KEY = 'reconciliation_proposal_dismissals_v1';
const MAX_DISMISSED_PROPOSALS = 200;

function storageKey(userId: string): string {
  return `${DISMISSED_PROPOSALS_BASE_KEY}:${userId}`;
}

function safeProposalId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 240) return null;
  return /^[A-Za-z0-9_.:-]+$/.test(trimmed) ? trimmed : null;
}

function safeLogCode(error: unknown): string {
  if (error && typeof error === 'object') {
    const code = (error as { code?: unknown; name?: unknown }).code || (error as { name?: unknown }).name;
    if (typeof code === 'string') return code.replace(/[^a-z0-9_:-]/gi, '').slice(0, 32) || 'unknown';
  }
  return 'unknown';
}

async function getCurrentUserId(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) throw new Error('Not authenticated');
  return user.id;
}

export async function loadDismissedReconciliationProposalIds(): Promise<Set<string>> {
  const userId = await getCurrentUserId();
  try {
    const raw = await AsyncStorage.getItem(storageKey(userId));
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.map(safeProposalId).filter((id): id is string => Boolean(id)));
  } catch (error) {
    console.warn('[ReconciliationProposals] Dismissal load failed', {
      action: 'load',
      code: safeLogCode(error),
    });
    return new Set();
  }
}

export async function dismissReconciliationProposal(proposalId: string): Promise<void> {
  const userId = await getCurrentUserId();
  const safeId = safeProposalId(proposalId);
  if (!safeId) return;

  try {
    const existing = await loadDismissedReconciliationProposalIds();
    const next = [safeId, ...Array.from(existing).filter(id => id !== safeId)].slice(0, MAX_DISMISSED_PROPOSALS);
    await AsyncStorage.setItem(storageKey(userId), JSON.stringify(next));
  } catch (error) {
    console.warn('[ReconciliationProposals] Dismissal save failed', {
      action: 'save',
      count: 1,
      code: safeLogCode(error),
    });
  }
}
