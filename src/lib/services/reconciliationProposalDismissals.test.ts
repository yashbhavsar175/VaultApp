import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../core';
import {
  dismissReconciliationProposal,
  loadDismissedReconciliationProposalIds,
} from './reconciliationProposalDismissals';

jest.mock('../core', () => ({
  supabase: {
    auth: { getUser: jest.fn() },
  },
}));

const mockedSupabase = supabase as unknown as {
  auth: { getUser: jest.Mock };
};

describe('reconciliation proposal dismissals', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    mockedSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user_a' } } });
  });

  it('saves and loads dismissed proposals under the current user only', async () => {
    await dismissReconciliationProposal('reconcile:tx_1:same_reference_bank_evidence:ev_1');

    await expect(loadDismissedReconciliationProposalIds()).resolves.toEqual(
      new Set(['reconcile:tx_1:same_reference_bank_evidence:ev_1'])
    );

    mockedSupabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user_b' } } });
    await expect(loadDismissedReconciliationProposalIds()).resolves.toEqual(new Set());
  });

  it('rejects unsafe proposal ids without logging raw values', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await dismissReconciliationProposal('bad id with phone 9876543210');

    expect(await AsyncStorage.getAllKeys()).toHaveLength(0);
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain('9876543210');
    warnSpy.mockRestore();
  });
});
