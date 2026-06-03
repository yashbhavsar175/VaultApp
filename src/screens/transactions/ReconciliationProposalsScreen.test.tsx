declare const require: (moduleName: string) => any;
declare const __dirname: string;

const fs = require('fs');
const path = require('path');

import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import ReconciliationProposalsScreen from './ReconciliationProposalsScreen';
import { getRecentReconciliationProposals } from '../../lib/services/transactionReconciliationProposals';
import {
  dismissReconciliationProposal,
  loadDismissedReconciliationProposalIds,
} from '../../lib/services/reconciliationProposalDismissals';
import {
  buildConfirmPayloadFromProposal,
  confirmTransactionAccountMatch,
} from '../../lib/services/transactionReconciliationActions';
import Toast from 'react-native-toast-message';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn() }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      background: '#f8fafc',
      card: '#ffffff',
      text: '#111827',
      subtext: '#6b7280',
      accent: '#7c3aed',
      border: '#e5e7eb',
    },
    typography: {
      h2: { fontSize: 22, fontWeight: '700' },
      body: { fontSize: 16, fontWeight: '400' },
      bodyBold: { fontSize: 16, fontWeight: '700' },
      caption: { fontSize: 12, fontWeight: '400' },
    },
    spacing: { xs: 4, sm: 8, md: 16 },
    borderRadius: { md: 8, lg: 8 },
    shadows: { sm: {} },
  }),
}));

jest.mock('../../lib/services/transactionReconciliationProposals', () => ({
  getRecentReconciliationProposals: jest.fn(),
}));

jest.mock('../../lib/services/reconciliationProposalDismissals', () => ({
  dismissReconciliationProposal: jest.fn(),
  loadDismissedReconciliationProposalIds: jest.fn(),
}));

jest.mock('../../lib/services/transactionReconciliationActions', () => ({
  buildConfirmPayloadFromProposal: jest.fn((proposal: any) => ({
    transactionId: proposal.transactionId,
    ownerType: proposal.matchedOwnerType,
    ownerId: proposal.matchedOwnerId,
    evidenceIds: proposal.evidenceIds,
    confidence: proposal.confidence,
    reason: proposal.reasonCode,
  })),
  confirmTransactionAccountMatch: jest.fn(),
}));

jest.mock('../../lib/services/transactionReconciliationConfirmability', () => ({
  validateProposalCanBeConfirmed: jest.fn((proposal: any) => (
    Boolean(proposal.transactionId && proposal.matchedOwnerId && proposal.matchedOwnerType) &&
    proposal.evidenceIds.length > 0 &&
    (proposal.decision === 'attach_account' || proposal.decision === 'link_existing_transaction') &&
    proposal.matchStatus !== 'ambiguous' &&
    proposal.matchStatus !== 'review_required' &&
    (
      (proposal.confidence === 'exact' && proposal.reasonCode === 'same_reference_bank_evidence') ||
      (proposal.confidence === 'high' && proposal.reasonCode === 'amount_time_single_bank_evidence')
    )
  )),
}));

jest.mock('react-native-toast-message', () => ({
  show: jest.fn(),
  hide: jest.fn(),
}));

const mockedGetRecent = getRecentReconciliationProposals as jest.Mock;
const mockedLoadDismissed = loadDismissedReconciliationProposalIds as jest.Mock;
const mockedDismissProposal = dismissReconciliationProposal as jest.Mock;
const mockedBuildPayload = buildConfirmPayloadFromProposal as jest.Mock;
const mockedConfirmMatch = confirmTransactionAccountMatch as jest.Mock;
const mockedToast = Toast as unknown as { show: jest.Mock; hide: jest.Mock };
const NOW = '2026-05-30T12:00:00.000Z';

function proposal(overrides: Record<string, unknown> = {}) {
  return {
    proposalId: 'proposal_1',
    transactionId: 'tx_existing',
    evidenceIds: ['ev_app', 'ev_bank'],
    decision: 'attach_account',
    confidence: 'exact',
    matchStatus: 'linked',
    matchedOwnerType: 'bank_account',
    matchedOwnerId: 'bank_hdfc',
    matchedOwnerLabel: 'HDFC Bank ••1234',
    reasonCode: 'same_reference_bank_evidence',
    explanationTokens: ['reference_match', 'bank_evidence', 'owner_unique'],
    evidenceSummary: {
      sourceTypes: ['notification', 'sms'],
      direction: 'debit',
      amountPresent: true,
      referencePresent: true,
      bankProofCount: 1,
      accountLast4s: ['1234'],
      cardLast4s: [],
      bankNames: ['HDFC Bank'],
      paymentAppHint: true,
    },
    score: 100,
    createdAt: NOW,
    ...overrides,
  };
}

function read(relativePath: string): string {
  return fs.readFileSync(path.join(__dirname, '..', '..', '..', relativePath), 'utf8');
}

function childText(children: unknown): string {
  if (Array.isArray(children)) return children.map(childText).join('');
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  return '';
}

function renderedText(renderer: ReactTestRenderer.ReactTestRenderer): string {
  return renderer.root
    .findAllByType(Text)
    .map(node => childText(node.props.children))
    .join(' ');
}

function findByTestID(renderer: ReactTestRenderer.ReactTestRenderer, testID: string) {
  return renderer.root.findByProps({ testID });
}

async function pressByTestID(renderer: ReactTestRenderer.ReactTestRenderer, testID: string) {
  await ReactTestRenderer.act(async () => {
    findByTestID(renderer, testID).props.onPress();
    await Promise.resolve();
  });
}

async function renderScreen(proposals: any[]) {
  mockedGetRecent.mockResolvedValueOnce(proposals);
  mockedLoadDismissed.mockResolvedValueOnce(new Set());
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<ReconciliationProposalsScreen />);
  });
  await ReactTestRenderer.act(async () => {
    await Promise.resolve();
  });

  return renderer!;
}

describe('ReconciliationProposalsScreen', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date(NOW));
    jest.clearAllMocks();
    mockedLoadDismissed.mockResolvedValue(new Set());
    mockedDismissProposal.mockResolvedValue(undefined);
    mockedConfirmMatch.mockResolvedValue({
      transaction_id: 'tx_existing',
      status: 'manual_confirmed',
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders the empty state', async () => {
    const renderer = await renderScreen([]);
    const text = renderedText(renderer);

    expect(text).toContain('No safe matches available yet');
    expect(text).toContain('Payment match suggestions appear here only when there is enough sanitized evidence to review.');
    expect(mockedGetRecent).toHaveBeenCalledTimes(1);
  });

  it('renders an exact proposal with a safe owner label', async () => {
    const renderer = await renderScreen([proposal()]);
    const text = renderedText(renderer);

    expect(text).toContain('Account match');
    expect(text).toContain('Exact');
    expect(text).toContain('HDFC Bank ••1234');
    expect(text).toContain('Matched by same UTR/reference');
    expect(text).toContain('Can confirm after review');
    expect(text).toContain('This match has bank evidence. Confirmation will require your tap.');
    expect(text).toContain('Confirm Match');
    expect(text).toContain('Score 100');
    expect(text).toContain('2 evidence signals');
    expect(text).toContain('Signals: Notification, SMS');
    expect(text).toContain('Movement: Debit with amount');
    expect(text).toContain('Reference: present');
    expect(text).toContain('Bank proof: account ...1234');
    expect(text).not.toContain('Attach');
    expect(text).not.toContain('Apply');
    expect(text).not.toContain('Accept');
  });

  it('renders a high proposal as confirmable after review', async () => {
    const renderer = await renderScreen([
      proposal({
        proposalId: 'high_match',
        confidence: 'high',
        reasonCode: 'amount_time_single_bank_evidence',
        score: 85,
      }),
    ]);
    const text = renderedText(renderer);

    expect(text).toContain('High');
    expect(text).toContain('Matched by bank evidence + amount/time');
    expect(text).toContain('Can confirm after review');
    expect(text).toContain('This match has bank evidence. Confirmation will require your tap.');
    expect(text).toContain('Confirm Match');
  });

  it('renders UPI-only proposals as review without attaching a bank', async () => {
    const renderer = await renderScreen([
      proposal({
        proposalId: 'upi_only',
        evidenceIds: ['ev_app'],
        decision: 'review_required',
        confidence: 'low',
        matchStatus: 'review_required',
        matchedOwnerType: null,
        matchedOwnerId: null,
        matchedOwnerLabel: 'Axis Bank ••8888',
        reasonCode: 'upi_only_not_bank_proof',
        score: 15,
        evidenceSummary: {
          sourceTypes: ['notification'],
          direction: 'debit',
          amountPresent: true,
          referencePresent: false,
          bankProofCount: 0,
          accountLast4s: [],
          cardLast4s: [],
          bankNames: [],
          paymentAppHint: true,
        },
      }),
    ]);
    const text = renderedText(renderer);

    expect(text).toContain('Review required');
    expect(text).toContain('Needs review');
    expect(text).toContain('Unknown account');
    expect(text).toContain('UPI handle is not bank proof');
    expect(text).toContain('Bank proof: not available');
    expect(text).not.toContain('SBI');
    expect(text).not.toContain('Axis Bank');
    expect(text).not.toContain('Confirm Match');
    expect(text).not.toContain('Attach');
    expect(text).not.toContain('Apply');
  });

  it('renders multiple candidates as manual review required', async () => {
    const renderer = await renderScreen([
      proposal({
        proposalId: 'multiple_candidates',
        decision: 'review_required',
        confidence: 'medium',
        matchStatus: 'ambiguous',
        matchedOwnerType: null,
        matchedOwnerId: null,
        matchedOwnerLabel: null,
        reasonCode: 'multiple_bank_candidates',
        score: 40,
      }),
    ]);
    const text = renderedText(renderer);

    expect(text).toContain('Manual review required');
    expect(text).toContain('Multiple possible accounts. Choose carefully.');
    expect(text).not.toContain('Can confirm after review');
    expect(text).not.toContain('Confirm Match');
  });

  it('renders mapping proposals as hint only', async () => {
    const renderer = await renderScreen([
      proposal({
        proposalId: 'mapping_hint',
        confidence: 'exact',
        reasonCode: 'user_mapping_hint',
        score: 55,
      }),
    ]);
    const text = renderedText(renderer);

    expect(text).toContain('Medium');
    expect(text).toContain('Hint only');
    expect(text).toContain('User mapping is a hint. Bank SMS can override it.');
    expect(text).not.toContain('Exact');
    expect(text).not.toContain('Confirm Match');
    expect(text).not.toContain('Attach');
    expect(text).not.toContain('Apply');
  });

  it('opens a safe confirmation modal for an eligible exact match', async () => {
    const renderer = await renderScreen([proposal()]);

    await pressByTestID(renderer, 'confirm-match-proposal_1');

    const text = renderedText(renderer);
    expect(text).toContain('Confirm Account Match');
    expect(text).toContain('HDFC Bank ••1234');
    expect(text).toContain('Exact');
    expect(text).toContain('Same UTR/reference');
    expect(text).toContain('2 evidence signals');
    expect(text).toContain('This links the transaction to this account. It does not create a new transaction or change balances.');
    expect(text).toContain('Cancel');
  });

  it('cancels the modal without calling the RPC', async () => {
    const renderer = await renderScreen([proposal()]);

    await pressByTestID(renderer, 'confirm-match-proposal_1');
    await pressByTestID(renderer, 'confirm-match-modal-cancel');

    expect(mockedBuildPayload).not.toHaveBeenCalled();
    expect(mockedConfirmMatch).not.toHaveBeenCalled();
    expect(renderedText(renderer)).not.toContain('This links the transaction to this account');
  });

  it('confirms with the minimal safe payload and refreshes after success', async () => {
    const renderer = await renderScreen([proposal()]);
    mockedGetRecent.mockResolvedValueOnce([]);

    await pressByTestID(renderer, 'confirm-match-proposal_1');
    await pressByTestID(renderer, 'confirm-match-modal-submit');

    expect(mockedBuildPayload).toHaveBeenCalledWith(expect.objectContaining({
      proposalId: 'proposal_1',
      transactionId: 'tx_existing',
      matchedOwnerType: 'bank_account',
      matchedOwnerId: 'bank_hdfc',
      confidence: 'exact',
      reasonCode: 'same_reference_bank_evidence',
      evidenceIds: ['ev_app', 'ev_bank'],
    }));
    expect(mockedConfirmMatch).toHaveBeenCalledWith({
      transactionId: 'tx_existing',
      ownerType: 'bank_account',
      ownerId: 'bank_hdfc',
      evidenceIds: ['ev_app', 'ev_bank'],
      confidence: 'exact',
      reason: 'same_reference_bank_evidence',
    });
    expect(mockedGetRecent).toHaveBeenCalledTimes(2);
    expect(mockedToast.show).toHaveBeenCalledWith(expect.objectContaining({
      type: 'success',
      text1: 'Match confirmed',
    }));
  });

  it('guards against double taps while confirmation is in flight', async () => {
    let resolveRpc: (value: unknown) => void = () => {};
    mockedConfirmMatch.mockReturnValueOnce(new Promise(resolve => {
      resolveRpc = resolve;
    }));
    const renderer = await renderScreen([proposal()]);
    mockedGetRecent.mockResolvedValueOnce([]);

    await pressByTestID(renderer, 'confirm-match-proposal_1');
    await ReactTestRenderer.act(async () => {
      findByTestID(renderer, 'confirm-match-modal-submit').props.onPress();
      findByTestID(renderer, 'confirm-match-modal-submit').props.onPress();
      await Promise.resolve();
    });

    expect(mockedConfirmMatch).toHaveBeenCalledTimes(1);

    await ReactTestRenderer.act(async () => {
      resolveRpc({ transaction_id: 'tx_existing', status: 'manual_confirmed' });
      await Promise.resolve();
    });
  });

  it('shows a safe failure error and keeps the proposal visible', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockedConfirmMatch.mockRejectedValueOnce({
      code: '42702',
      message: 'raw SQL payload with account 123456789012 and yash@oksbi',
      details: '{"raw_source_metadata":"secret"}',
    });
    const renderer = await renderScreen([proposal()]);

    await pressByTestID(renderer, 'confirm-match-proposal_1');
    await pressByTestID(renderer, 'confirm-match-modal-submit');

    const text = renderedText(renderer);
    expect(text).toContain('Account match');
    expect(text).toContain('Confirm Account Match');
    expect(text).not.toContain('raw SQL payload');
    expect(text).not.toContain('123456789012');
    expect(text).not.toContain('yash@oksbi');
    expect(mockedToast.show).toHaveBeenCalledWith(expect.objectContaining({
      type: 'error',
      text1: 'Match not confirmed',
      text2: 'Could not confirm this match. Please refresh and review again.',
    }));
    expect(warnSpy).toHaveBeenCalledWith('[ReconciliationProposals] Confirm match failed', { code: '42702' });
    warnSpy.mockRestore();
  });

  it('does not render raw metadata, full UPI IDs, phone, OTP, or full account numbers', async () => {
    const unsafeProposal = proposal({
      proposalId: 'unsafe_payload',
      matchedOwnerLabel: 'yash@oksbi 9876543210',
      reasonCode: 'payment_app_only',
      explanationTokens: ['raw_sms_body', 'yash@oksbi', 'otp_123456'],
      raw_source_metadata: {
        rawText: 'raw notification body OTP 123456 phone 9876543210',
        payload: { text: 'account 123456789012 yash@oksbi' },
      },
    });

    const renderer = await renderScreen([unsafeProposal]);
    const text = renderedText(renderer);

    expect(text).toContain('Unknown account');
    expect(text).not.toContain('Confirm Match');
    expect(text).not.toContain('raw notification body');
    expect(text).not.toContain('raw_sms_body');
    expect(text).not.toContain('OTP');
    expect(text).not.toContain('123456');
    expect(text).not.toContain('9876543210');
    expect(text).not.toContain('123456789012');
    expect(text).not.toContain('yash@oksbi');
  });

  it('does not call RPC for ineligible cards', async () => {
    const renderer = await renderScreen([
      proposal({
        proposalId: 'mapping_hint',
        confidence: 'exact',
        reasonCode: 'user_mapping_hint',
        score: 55,
      }),
    ]);

    expect(renderedText(renderer)).not.toContain('Confirm Match');
    expect(renderer.root.findAllByProps({ testID: 'confirm-match-mapping_hint' })).toHaveLength(0);
    expect(mockedBuildPayload).not.toHaveBeenCalled();
    expect(mockedConfirmMatch).not.toHaveBeenCalled();
  });

  it('filters locally dismissed proposals for the current user', async () => {
    mockedGetRecent.mockResolvedValueOnce([
      proposal({ proposalId: 'kept_proposal' }),
      proposal({ proposalId: 'dismissed_proposal', matchedOwnerLabel: 'ICICI Bank ••4321' }),
    ]);
    mockedLoadDismissed.mockResolvedValueOnce(new Set(['dismissed_proposal']));

    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<ReconciliationProposalsScreen />);
    });
    await ReactTestRenderer.act(async () => {
      await Promise.resolve();
    });

    const text = renderedText(renderer!);
    expect(text).toContain('HDFC Bank ••1234');
    expect(text).not.toContain('ICICI Bank');
  });

  it('dismisses a proposal locally without confirming or mutating transactions', async () => {
    const renderer = await renderScreen([proposal({ proposalId: 'dismiss_me' })]);

    await pressByTestID(renderer, 'dismiss-proposal-dismiss_me');

    expect(mockedDismissProposal).toHaveBeenCalledWith('dismiss_me');
    expect(mockedBuildPayload).not.toHaveBeenCalled();
    expect(mockedConfirmMatch).not.toHaveBeenCalled();
    expect(renderedText(renderer)).not.toContain('HDFC Bank ••1234');
    expect(mockedToast.show).toHaveBeenCalledWith(expect.objectContaining({
      type: 'success',
      text1: 'Proposal dismissed',
    }));
  });

  it('has no direct database mutation code and only imports the explicit action wrapper', () => {
    const screen = read('src/screens/transactions/ReconciliationProposalsScreen.tsx');
    const proposalService = read('src/lib/services/transactionReconciliationProposals.ts');

    expect(screen).not.toMatch(/\.(?:insert|update|delete|upsert|rpc)\s*\(/);
    expect(screen).not.toMatch(/from ['"].*(?:core|transactionEvidence|balanceSnapshots|autoTransactionReviewQueue|financial)['"]/);
    expect(screen).not.toMatch(/account_id|account_match_status|match_status\s*=/);
    expect(screen).toContain("import { validateProposalCanBeConfirmed } from '../../lib/services/transactionReconciliationConfirmability';");
    expect(screen).toContain("} from '../../lib/services/transactionReconciliationActions';");
    expect(screen).toMatch(/\bconfirmTransactionAccountMatch\b/);
    expect(proposalService).not.toMatch(/\.(?:insert|update|delete|upsert|rpc)\s*\(/);
  });

  it('is reachable from the Settings stack and Settings screen', () => {
    const settingsStack = read('src/navigation/SettingsStack.tsx');
    const settingsScreen = read('src/screens/user/Settings.tsx');
    const bottomTabs = read('src/navigation/BottomTabNavigator.tsx');

    expect(settingsStack).toContain('ReconciliationProposals: undefined');
    expect(settingsStack).toContain('<Stack.Screen name="ReconciliationProposals" component={ReconciliationProposalsScreen} />');
    expect(settingsScreen).toContain('Reconciliation Proposals');
    expect(settingsScreen).toContain("navigate('ReconciliationProposals')");
    expect(bottomTabs).toContain("'ReconciliationProposals'");
  });
});
