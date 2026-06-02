declare const require: (moduleName: string) => any;
declare const __dirname: string;

const fs = require('fs');
const path = require('path');
const materialCommunityIcons = require('react-native-vector-icons/glyphmaps/MaterialCommunityIcons.json');

import React from 'react';
import { Text, TextInput, TouchableOpacity } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import DebtFreedomScreen, {
  APPROVED_DEBT_FREEDOM_ICONS,
  DEBT_FREEDOM_ICONS,
  warningCopyForCode,
} from './DebtFreedomScreen';
import { getDebtFreedomCoachViewModel } from '../../lib/services/debtFreedomViewModel';
import { DebtFreedomCoachViewModel } from '../../lib/services/debtFreedomViewModel';
import { upsertDebtFreedomSettings } from '../../lib/services/debtFreedomSettings';

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
      h1: { fontSize: 28, fontWeight: '700' },
      h2: { fontSize: 22, fontWeight: '700' },
      h3: { fontSize: 18, fontWeight: '700' },
      body: { fontSize: 16, fontWeight: '400' },
      bodyBold: { fontSize: 16, fontWeight: '700' },
      caption: { fontSize: 12, fontWeight: '400' },
    },
    spacing: { xs: 4, sm: 8, md: 16, lg: 24 },
    borderRadius: { md: 8, lg: 8 },
    shadows: { sm: {} },
  }),
}));

jest.mock('../../lib/services/debtFreedomViewModel', () => ({
  getDebtFreedomCoachViewModel: jest.fn(),
}));

jest.mock('../../lib/services/debtFreedomSettings', () => ({
  buildDefaultDebtFreedomSettings: () => ({
    confirmed_monthly_income: null,
    essential_monthly_expenses: null,
    emergency_contribution: 0,
    target_monthly_income: null,
    planned_monthly_debt_payment: null,
    target_debt_free_months: null,
    strategy: 'balanced',
    income_mode: 'auto',
  }),
  upsertDebtFreedomSettings: jest.fn(),
}));

const mockedGetViewModel = getDebtFreedomCoachViewModel as jest.Mock;
const mockedUpsertSettings = upsertDebtFreedomSettings as jest.Mock;

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

function touchableByText(renderer: ReactTestRenderer.ReactTestRenderer, text: string) {
  return renderer.root
    .findAllByType(TouchableOpacity)
    .find(node => node.findAllByType(Text).some(textNode => childText(textNode.props.children).includes(text)));
}

function baseViewModel(overrides: Partial<DebtFreedomCoachViewModel> = {}): DebtFreedomCoachViewModel {
  const plan = {
    totalDebt: 75000,
    minimumDebtPayment: 5200,
    monthlyIncomeUsed: 45000,
    incomeProjection: {
      monthlyIncome: 45000,
      source: 'current_month_daily_average' as const,
      confidence: 'estimated' as const,
      includedIncomeTotal: 15000,
      includedIncomeCount: 3,
      excludedIncomeCount: 1,
      needsReviewCount: 1,
      elapsedDaysInCurrentMonth: 10,
      daysInMonth: 30,
      remainingDaysInMonth: 20,
      averageDailyIncome: 1500,
      projectedMonthEndIncome: 45000,
      targetMonthlyIncome: 60000,
      requiredAverageDailyIncome: 2000,
      requiredRemainingDailyIncome: 2250,
      todayIncomeTarget: 2250,
      incomePaceGap: -15000,
      explanationToken: 'income_projection_current_month_daily_average',
    },
    debtToIncomePercent: 12,
    safeSpendAmount: null,
    freeCashflowAfterDebt: null,
    estimatedMonthsToDebtFree: 15,
    estimatedDebtFreeDate: '2027-08-01',
    extraMonthlyNeededForTarget: null,
    debtFreedomScore: 68,
    scoreLabel: 'caution' as const,
    strategy: 'balanced' as const,
    orderedDebts: [],
    debts: [],
    warnings: [
      { code: 'income_variable_estimate' as const, severity: 'info' as const, messageToken: 'raw unsafe token' },
      { code: 'income_needs_review' as const, severity: 'info' as const, messageToken: 'raw note yash@oksbi' },
      { code: 'daily_target_high' as const, severity: 'caution' as const, messageToken: 'raw 9876543210' },
      { code: 'hidden_debt_included' as const, severity: 'info' as const, messageToken: 'raw account 123456789012' },
      { code: 'duplicate_debt_possible' as const, severity: 'caution' as const, messageToken: 'raw sms body' },
    ],
    insightTokens: [],
    isEstimate: true,
  };
  const debtItems = [
    {
      id: 'credit_card:1',
      sourceType: 'credit_card' as const,
      ownerId: 'card:1',
      label: 'Credit card',
      outstanding: 50000,
      minimumMonthlyPayment: 2500,
      dueDate: '2026-06-18',
      annualInterestRate: 36,
      confidence: 'exact' as const,
      isHidden: true,
      duplicateGroupKey: 'credit_card:dupe',
      metadata: { last4: '1234', bankName: 'Do Not Render Bank Name', source: 'credit_cards' },
    },
    {
      id: 'people_borrowed:1',
      sourceType: 'people_borrowed' as const,
      ownerId: 'people:1',
      label: 'Borrowed balance',
      outstanding: 25000,
      minimumMonthlyPayment: null,
      dueDate: null,
      annualInterestRate: null,
      confidence: 'needs_review' as const,
      metadata: { source: 'people_ledger' },
    },
  ];
  return {
    plan: { ...plan, orderedDebts: debtItems, debts: debtItems },
    debtItems,
    incomeEvents: [],
    summary: {
      totalDebtLabel: '₹75,000',
      monthlyIncomeLabel: 'Estimate: ₹45,000',
      dailyTargetLabel: 'Today’s target: ₹2,250',
      debtFreeDateLabel: 'Debt-free date estimate: 1 Aug 2027',
      safeSpendLabel: 'Needs review',
      scoreLabel: 'Caution',
    },
    dataQuality: {
      hasConfirmedIncome: false,
      hasVariableIncomeEstimate: true,
      needsIncomeReviewCount: 1,
      duplicateDebtWarningCount: 1,
      missingAprCount: 1,
      missingEmiCount: 1,
      hiddenDebtCount: 1,
    },
    settings: null,
    settingsStatus: 'missing',
    incomeReviewStatus: 'missing',
    ...overrides,
  };
}

async function renderLoaded(vm: DebtFreedomCoachViewModel) {
  mockedGetViewModel.mockResolvedValueOnce(vm);
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<DebtFreedomScreen />);
  });
  await ReactTestRenderer.act(async () => {
    await Promise.resolve();
  });

  return renderer!;
}

describe('DebtFreedomScreen', () => {
  beforeEach(() => {
    mockedGetViewModel.mockReset();
    mockedUpsertSettings.mockReset();
  });

  it('renders the loading state', () => {
    mockedGetViewModel.mockReturnValue(new Promise(() => {}));
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(<DebtFreedomScreen />);
    });

    expect(renderedText(renderer!)).toContain('Loading Debt Freedom Coach');
  });

  it('renders the empty debt and missing income states', async () => {
    const vm = baseViewModel({
      plan: {
        ...baseViewModel().plan,
        totalDebt: 0,
        minimumDebtPayment: 0,
        monthlyIncomeUsed: null,
        incomeProjection: {
          ...baseViewModel().plan.incomeProjection,
          source: 'missing',
          monthlyIncome: null,
          projectedMonthEndIncome: null,
          todayIncomeTarget: null,
          incomePaceGap: null,
        },
        warnings: [{ code: 'income_missing', severity: 'caution', messageToken: 'raw unsafe' }],
        debtFreedomScore: 100,
        estimatedDebtFreeDate: null,
      },
      debtItems: [],
      summary: {
        ...baseViewModel().summary,
        totalDebtLabel: '₹0',
        monthlyIncomeLabel: 'Needs review',
        dailyTargetLabel: 'Today’s target: Needs review',
        debtFreeDateLabel: 'Debt-free date estimate: Needs review',
      },
    });

    const renderer = await renderLoaded(vm);
    const text = renderedText(renderer);

    expect(text).toContain('No active debt found.');
    expect(text).toContain('Keep tracking income and spending to stay debt-free.');
    expect(text).toContain('No active debt found');
    expect(text).toContain('Income estimate missing.');
    expect(text).toContain('Gig/freelance income will appear here when earning transactions are safely recognized.');
  });

  it('renders normal read-only cards, pace labels, warning copies, and debt markers', async () => {
    const renderer = await renderLoaded(baseViewModel());
    const text = renderedText(renderer);

    expect(text).toContain('Debt Freedom Coach');
    expect(text).toContain('Debt Freedom Score');
    expect(text).toContain('Guidance score, not a credit score');
    expect(text).toContain('Total Debt');
    expect(text).toContain('Debt-free estimate');
    expect(text).toContain('Today’s target');
    expect(text).toContain('Current month income pace');
    expect(text).toContain('Safe spend estimate');
    expect(text).toContain('Free cashflow after debt');
    expect(text).toContain('Minimum debt payment');
    expect(text).toContain('Debt-to-income ratio');
    expect(text).toContain('Average so far');
    expect(text).toContain('Month-end estimate');
    expect(text).toContain('Target progress');
    expect(text).toContain('This estimate is based on your current-month earning pace.');
    expect(text).toContain('Some credits need review before they can count as income. Count: 1');
    expect(text).toContain('Credit card ••1234');
    expect(text).toContain('Hidden included');
    expect(text).toContain('Duplicate risk');
    expect(text).toContain('Minimum exact ₹2,500');
    expect(text).toContain('Minimum unknown');
    expect(text).toContain('APR unknown');
    expect(text).toContain('Income is an estimate');
    expect(text).toContain('Today’s target is high');
    expect(text).toContain('hidden does not mean ignored');
    expect(text).toContain('Refresh');
    expect(text).toContain('Set planning targets');
    expect(text).toContain('Optional. Leave income blank to use your current-month earning pace.');
  });

  it('renders manual estimate income labels clearly', async () => {
    const vm = baseViewModel({
      plan: {
        ...baseViewModel().plan,
        monthlyIncomeUsed: 22000,
        incomeProjection: {
          ...baseViewModel().plan.incomeProjection,
          monthlyIncome: 22000,
          source: 'manual_estimate',
        },
      },
      summary: {
        ...baseViewModel().summary,
        monthlyIncomeLabel: 'Manual estimate: ₹22,000',
      },
    });
    const renderer = await renderLoaded(vm);
    const text = renderedText(renderer);

    expect(text).toContain('Manual estimate: ₹22,000');
    expect(text).not.toContain('Manual estimate: ?');
  });

  it('labels estimated credit card minimum payments without saving anything', async () => {
    const vm = baseViewModel({
      debtItems: [
        {
          ...baseViewModel().debtItems[0],
          minimumMonthlyPayment: null,
          outstanding: 50000,
        },
      ],
    });
    vm.plan.debts = vm.debtItems;
    vm.plan.orderedDebts = vm.debtItems;

    const renderer = await renderLoaded(vm);
    const text = renderedText(renderer);

    expect(text).toContain('Minimum estimated ₹2,500');
  });

  it('labels Loan/EMI rows with outstanding EMI status and missing EMI copy', async () => {
    const loanWithEmi = {
      id: 'loan_account:with_emi',
      sourceType: 'loan_account' as const,
      ownerId: 'loan_with_emi',
      label: 'Loan account',
      outstanding: 125000,
      minimumMonthlyPayment: 5000,
      dueDate: null,
      annualInterestRate: null,
      confidence: 'exact' as const,
      metadata: { last4: '4321', source: 'bank_accounts', totalLoanAmount: 150000 },
    };
    const loanMissingEmi = {
      ...loanWithEmi,
      id: 'loan_account:missing_emi',
      ownerId: 'loan_missing_emi',
      minimumMonthlyPayment: null,
      metadata: { last4: '8765', source: 'bank_accounts', totalLoanAmount: 150000 },
    };
    const vm = baseViewModel({
      debtItems: [loanWithEmi, loanMissingEmi],
      dataQuality: {
        ...baseViewModel().dataQuality,
        missingEmiCount: 1,
      },
    });
    vm.plan.debts = vm.debtItems;
    vm.plan.orderedDebts = vm.debtItems;

    const renderer = await renderLoaded(vm);
    const text = renderedText(renderer);

    expect(text).toContain('Loan account ••4321');
    expect(text).toContain('Outstanding ₹1,25,000');
    expect(text).toContain('EMI ₹5,000');
    expect(text).toContain('Loan account ••8765');
    expect(text).toContain('EMI unknown');
    expect(text).toContain('EMI amount missing for this loan.');
  });

  it('uses a safe fallback when debt-free estimate data is missing', async () => {
    const vm = baseViewModel({
      plan: {
        ...baseViewModel().plan,
        estimatedDebtFreeDate: null,
      },
      summary: {
        ...baseViewModel().summary,
        debtFreeDateLabel: 'Debt-free date estimate: Needs review',
      },
    });

    const renderer = await renderLoaded(vm);
    const text = renderedText(renderer);

    expect(text).toContain('Not enough data');
  });

  it('does not render rolling-window copy or mutation actions', async () => {
    const renderer = await renderLoaded(baseViewModel());
    const text = renderedText(renderer).toLowerCase();

    expect(text).not.toContain('last 7');
    expect(text).not.toContain('last 14');
    expect(text).not.toContain('last 30');
    expect(text).not.toContain('rolling average');
    expect(text).not.toContain('confirm income');
    expect(text).not.toContain('create debt');
    expect(text).not.toContain('create payment');
    expect(text).not.toContain('change balance');
    expect(text).not.toContain('auto categorize');
    expect(text).not.toContain('delete debt');
    expect(text).not.toContain('archive debt');
  });

  it('renders settings modal copy and mode options', async () => {
    const renderer = await renderLoaded(baseViewModel());
    const button = touchableByText(renderer, 'Set planning targets');

    await ReactTestRenderer.act(async () => {
      button!.props.onPress();
    });

    const text = renderedText(renderer);
    expect(text).toContain('Set planning targets');
    expect(text).toContain('Auto from current month pace');
    expect(text).toContain('Confirmed monthly income');
    expect(text).toContain('Manual estimate');
    expect(text).toContain('This does not change transactions or balances.');
    expect(text).toContain('Use essential expenses for rent, food, fuel, bills - not entertainment.');
    expect(text).toContain('Debt Freedom Score is guidance, not a credit score.');
    expect(text).toContain('Balanced');
    expect(text).toContain('Snowball');
    expect(text).toContain('Avalanche');
  });

  it('blocks negative settings values before save', async () => {
    const renderer = await renderLoaded(baseViewModel());
    const button = touchableByText(renderer, 'Set planning targets');

    await ReactTestRenderer.act(async () => {
      button!.props.onPress();
    });

    const inputs = renderer.root.findAllByType(TextInput);
    await ReactTestRenderer.act(async () => {
      inputs[0].props.onChangeText('-1');
    });

    const saveButton = touchableByText(renderer, 'Save settings');
    await ReactTestRenderer.act(async () => {
      await saveButton!.props.onPress();
    });

    expect(mockedUpsertSettings).not.toHaveBeenCalled();
    expect(renderedText(renderer)).toContain('Essential monthly expenses must be a valid non-negative amount');
  });

  it('saves settings through settings service only and reloads the view model', async () => {
    const reloaded = baseViewModel({
      summary: {
        ...baseViewModel().summary,
        monthlyIncomeLabel: 'Confirmed: ₹45,000',
      },
    });
    mockedGetViewModel.mockReset();
    mockedGetViewModel
      .mockResolvedValueOnce(baseViewModel())
      .mockResolvedValueOnce(reloaded);
    mockedUpsertSettings.mockResolvedValueOnce({});
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<DebtFreedomScreen />);
    });

    const openButton = touchableByText(renderer!, 'Set planning targets');
    await ReactTestRenderer.act(async () => {
      openButton!.props.onPress();
    });

    const confirmedButton = touchableByText(renderer!, 'Confirmed monthly income');
    await ReactTestRenderer.act(async () => {
      confirmedButton!.props.onPress();
    });

    const inputs = renderer!.root.findAllByType(TextInput);
    await ReactTestRenderer.act(async () => {
      inputs[0].props.onChangeText('45000');
      inputs[1].props.onChangeText('12000');
      inputs[2].props.onChangeText('1000');
      inputs[3].props.onChangeText('60000');
      inputs[4].props.onChangeText('8000');
      inputs[5].props.onChangeText('18');
    });

    const saveButton = touchableByText(renderer!, 'Save settings');
    await ReactTestRenderer.act(async () => {
      await saveButton!.props.onPress();
    });

    expect(mockedUpsertSettings).toHaveBeenCalledWith({
      income_mode: 'confirmed',
      confirmed_monthly_income: 45000,
      essential_monthly_expenses: 12000,
      emergency_contribution: 1000,
      target_monthly_income: 60000,
      planned_monthly_debt_payment: 8000,
      target_debt_free_months: 18,
      strategy: 'balanced',
    });
    expect(mockedGetViewModel).toHaveBeenCalledTimes(2);
  });

  it('shows a safe setup prompt when settings table is missing', async () => {
    const renderer = await renderLoaded(baseViewModel({ settingsStatus: 'error' }));
    const text = renderedText(renderer);

    expect(text).toContain('Settings table not ready. Run SQL migration before live settings use.');
    expect(text).not.toContain('42P01');
    expect(text).not.toContain('42703');
  });

  it('does not render raw SMS, notes, UPI, phone, full numbers, raw people names, or raw warning messages', async () => {
    const vm = baseViewModel({
      debtItems: [
        {
          ...baseViewModel().debtItems[0],
          label: 'raw note OTP 123456 phone 9876543210 yash@oksbi account 123456789012',
          metadata: {
            last4: '1234567898764321',
            bankName: 'Raw Person Name Should Not Render',
            source: 'raw_source_metadata',
          },
        },
      ],
    });
    vm.plan.debts = vm.debtItems;
    vm.plan.orderedDebts = vm.debtItems;

    const renderer = await renderLoaded(vm);
    const text = renderedText(renderer);

    expect(text).toContain('Debt ••4321');
    expect(text).not.toContain('raw sms body');
    expect(text).not.toContain('raw note');
    expect(text).not.toContain('OTP');
    expect(text).not.toContain('123456');
    expect(text).not.toContain('9876543210');
    expect(text).not.toContain('123456789012');
    expect(text).not.toContain('yash@oksbi');
    expect(text).not.toContain('Raw Person Name');
    expect(text).not.toContain('raw_source_metadata');
    expect(text).not.toContain('Do Not Render Bank Name');
  });

  it('maps warning codes to safe copy', () => {
    expect(warningCopyForCode('high_dti').title).toBe('Debt payment is high');
    expect(warningCopyForCode('very_high_dti').title).toBe('Debt payment is very high');
    expect(warningCopyForCode('income_missing').body).toContain('Gig/freelance income');
    expect(warningCopyForCode('income_needs_review').body).toBe('Some credits need review before they can count as income.');
    expect(warningCopyForCode('missing_interest_rates').title).toBe('APR missing');
    expect(warningCopyForCode('duplicate_debt_possible').title).toBe('Duplicate debt possible');
    expect(warningCopyForCode('hidden_debt_included').title).toBe('Hidden debt included');
    expect(warningCopyForCode('hidden_debt_included').body).toContain('hidden does not mean ignored');
    expect(warningCopyForCode('emergency_buffer_low').title).toBe('Emergency buffer low');
    expect(warningCopyForCode('essential_expense_missing').title).toBe('Essential expenses missing');
  });

  it('has no direct database mutation code', () => {
    const screen = read('src/screens/financial/DebtFreedomScreen.tsx');

    expect(screen).not.toMatch(/\.(?:insert|update|delete|upsert|rpc)\s*\(/);
    expect(screen).not.toMatch(/from ['"].*(?:core|financial|userdata|cache)['"]/);
    expect(screen).not.toContain('setCache');
    expect(screen).not.toContain('AsyncStorage.setItem');
    expect(screen).not.toContain('raw_sms');
    expect(screen).not.toContain('raw_source_metadata');
    expect(screen).not.toContain('notification_text');
  });

  it('does not contain known Hinglish or Hindi app-facing tokens', () => {
    const screen = read('src/screens/financial/DebtFreedomScreen.tsx');
    const blockedTokens = [
      '\u0041aj',
      '\u0041b tak',
      'p' + 'iche',
      'a' + 'age',
      'Y' + 'eh',
      'p' + 'aisa',
      'k' + 'ama',
      'k' + 'amana',
      'k' + 'arna',
      'h' + 'ai',
      'n' + 'ahi',
    ];

    for (const token of blockedTokens) {
      expect(screen).not.toContain(token);
    }
  });

  it('uses approved MaterialCommunityIcons without fallback-style names', () => {
    const approvedIcons = new Set(APPROVED_DEBT_FREEDOM_ICONS);
    const blockedIconTokens = [
      'q' + 'uestion',
      'q' + 'uestion-mark',
      'h' + 'elp',
      'u' + 'nknown',
    ];
    const screen = read('src/screens/financial/DebtFreedomScreen.tsx');
    const staticIconNames = Array.from(screen.matchAll(/MaterialCommunityIcons name="([^"]+)"/g))
      .map(match => match[1]);

    for (const icon of APPROVED_DEBT_FREEDOM_ICONS) {
      expect(materialCommunityIcons).toHaveProperty(icon);
    }

    for (const icon of Object.values(DEBT_FREEDOM_ICONS)) {
      expect(approvedIcons.has(icon as any)).toBe(true);
      expect(materialCommunityIcons).toHaveProperty(icon as string);
      for (const token of blockedIconTokens) {
        expect(icon as string).not.toContain(token);
      }
    }

    for (const icon of staticIconNames) {
      expect(materialCommunityIcons).toHaveProperty(icon);
      for (const token of blockedIconTokens) {
        expect(icon).not.toContain(token);
      }
    }

    expect(DEBT_FREEDOM_ICONS.metricMinimumDebtPayment).toBe('calendar-clock');
    expect(DEBT_FREEDOM_ICONS.metricDebtToIncomeRatio).toBe('percent-outline');
  });

  it('is reachable from the hidden Settings route and Financial Setup row', () => {
    const settingsStack = read('src/navigation/SettingsStack.tsx');
    const bottomTabs = read('src/navigation/BottomTabNavigator.tsx');
    const settingsScreen = read('src/screens/user/Settings.tsx');

    expect(settingsStack).toContain('DebtFreedomCoach: undefined');
    expect(settingsStack).toContain('<Stack.Screen name="DebtFreedomCoach" component={DebtFreedomScreen} />');
    expect(bottomTabs).toContain("'DebtFreedomCoach'");
    expect(settingsScreen).toContain('Debt Freedom Coach');
    expect(settingsScreen).toContain("navigate('DebtFreedomCoach')");
  });
});
