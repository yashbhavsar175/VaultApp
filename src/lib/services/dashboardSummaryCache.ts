import { supabase } from '../core';
import { getCached, setCache, CACHE_KEYS, scopedCacheKey } from './cache';
import { MonthlyTransactionTotals } from '../../utils/financeSummary';

export interface DashboardPeopleSummarySnapshot {
  totalLent: number;
  totalBorrowed: number;
  lentCount: number;
  borrowedCount: number;
}

export interface DashboardSummarySnapshot {
  monthKey: string;
  monthlyTotals: MonthlyTransactionTotals;
  peopleSummary: DashboardPeopleSummarySnapshot;
  createdAt: string;
}

export function dashboardMonthKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function dashboardSummaryCacheKey(userId: string, date: Date): string {
  return scopedCacheKey(
    scopedCacheKey(CACHE_KEYS.DASHBOARD_SUMMARY, userId),
    dashboardMonthKey(date),
  );
}

async function getCurrentUserId(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id || null;
}

export async function getCachedDashboardSummary(date: Date): Promise<DashboardSummarySnapshot | null> {
  const userId = await getCurrentUserId();
  if (!userId) return null;

  const cached = await getCached<DashboardSummarySnapshot>(dashboardSummaryCacheKey(userId, date));
  if (!cached?.data || cached.data.monthKey !== dashboardMonthKey(date)) return null;

  return cached.data;
}

export async function setCachedDashboardSummary(
  date: Date,
  snapshot: Omit<DashboardSummarySnapshot, 'monthKey' | 'createdAt'>
): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) return;

  await setCache(dashboardSummaryCacheKey(userId, date), {
    ...snapshot,
    monthKey: dashboardMonthKey(date),
    createdAt: new Date().toISOString(),
  });
}
