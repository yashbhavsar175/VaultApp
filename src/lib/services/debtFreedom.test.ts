import {
  calculateCurrentMonthIncomePace,
  calculateDailyIncomeTarget,
  calculateDebtFreedomPlan,
  classifyIncomeCandidate,
  DebtFreedomOptions,
  DebtItem,
  ExpensePlan,
  IncomeEvent,
  IncomePlan,
} from './debtFreedom';

const NOW = '2026-06-03T12:00:00.000Z';
const JUNE_OPTIONS: DebtFreedomOptions = {
  now: NOW,
  monthStart: '2026-06-01T00:00:00.000Z',
  daysInMonth: 30,
  elapsedDaysInCurrentMonth: 3,
};

function debt(overrides: Partial<DebtItem> = {}): DebtItem {
  return {
    id: 'loan_1',
    sourceType: 'loan',
    label: 'Loan',
    outstanding: 10000,
    minimumMonthlyPayment: 1000,
    annualInterestRate: 0,
    confidence: 'exact',
    ...overrides,
  };
}

function incomeEvent(overrides: Partial<IncomeEvent> = {}): IncomeEvent {
  return {
    id: 'income_1',
    amount: 1000,
    receivedAt: NOW,
    sourceType: 'gig_work',
    confidence: 'high',
    includeInIncome: true,
    ...overrides,
  };
}

function income(overrides: Partial<IncomePlan> = {}): IncomePlan {
  return {
    confirmedMonthlyIncome: 30000,
    incomeSource: 'confirmed',
    ...overrides,
  };
}

function expenses(overrides: Partial<ExpensePlan> = {}): ExpensePlan {
  return {
    essentialMonthlyExpenses: 10000,
    emergencyContribution: 1000,
    emergencyFundAvailable: 10000,
    emergencyFundTarget: 10000,
    ...overrides,
  };
}

function plan(overrides: {
  debts?: DebtItem[];
  income?: IncomePlan;
  expenses?: ExpensePlan;
  options?: DebtFreedomOptions;
} = {}) {
  return calculateDebtFreedomPlan({
    debts: overrides.debts || [debt()],
    income: overrides.income || income(),
    expenses: overrides.expenses || expenses(),
    options: { ...JUNE_OPTIONS, ...overrides.options },
  });
}

function warningCodes(result: ReturnType<typeof plan>): string[] {
  return result.warnings.map(warning => warning.code);
}

describe('debtFreedom income classification', () => {
  it.each(['gig_work', 'freelance', 'business', 'salary'] as const)(
    'counts structured %s income with usable confidence',
    sourceType => {
      expect(classifyIncomeCandidate(incomeEvent({ sourceType })).includeInIncome).toBe(true);
    }
  );

  it('keeps an unknown UPI credit out of income until review', () => {
    const result = classifyIncomeCandidate(incomeEvent({
      sourceType: 'upi_credit',
      confidence: 'high',
      label: 'Unknown Sender Name',
    }));

    expect(result.includeInIncome).toBe(false);
    expect(result.confidence).toBe('needs_review');
    expect(result.exclusionReason).toBe('unknown_credit');
    expect(result.label).toBe('income_needs_review_unknown_credit');
  });

  it('keeps an unknown bank credit out even if a caller tries to include it', () => {
    const result = classifyIncomeCandidate(incomeEvent({
      sourceType: 'bank_credit',
      includeInIncome: true,
      confidence: 'medium',
    }));

    expect(result.includeInIncome).toBe(false);
    expect(result.confidence).toBe('needs_review');
  });

  it('allows a reviewed bank credit only after explicit confirmation', () => {
    const result = classifyIncomeCandidate(incomeEvent({
      sourceType: 'bank_credit',
      includeInIncome: true,
      confidence: 'confirmed',
    }));

    expect(result.includeInIncome).toBe(true);
    expect(result.confidence).toBe('confirmed');
  });

  it('allows an explicitly confirmed unknown credit from income review', () => {
    const result = classifyIncomeCandidate(incomeEvent({
      sourceType: 'unknown',
      includeInIncome: true,
      confidence: 'confirmed',
    }));

    expect(result.includeInIncome).toBe(true);
    expect(result.confidence).toBe('confirmed');
    expect(result.exclusionReason).toBeUndefined();
  });

  it('allows a personal transfer only after explicit confirmation as income', () => {
    const result = classifyIncomeCandidate(incomeEvent({
      sourceType: 'personal_transfer',
      includeInIncome: true,
      confidence: 'confirmed',
    }));

    expect(result.includeInIncome).toBe(true);
    expect(result.confidence).toBe('confirmed');
  });

  it('always excludes earned income when includeInIncome is false', () => {
    const result = classifyIncomeCandidate(incomeEvent({
      sourceType: 'gig_work',
      includeInIncome: false,
      confidence: 'confirmed',
    }));

    expect(result.includeInIncome).toBe(false);
    expect(result.confidence).toBe('excluded');
  });

  it('excludes family or friend transfers with a token-safe label', () => {
    const result = classifyIncomeCandidate(incomeEvent({
      sourceType: 'personal_transfer',
      label: 'Private Person Name',
      counterpartyLabel: 'Private Person Name',
      exclusionReason: 'family_or_friend',
    }));

    expect(result.includeInIncome).toBe(false);
    expect(result.confidence).toBe('excluded');
    expect(result.label).toBe('income_excluded_family_or_friend');
    expect(result.counterpartyLabel).toBeNull();
    expect(JSON.stringify(result)).not.toContain('Private Person Name');
  });

  it('excludes a family or friend UPI credit without surfacing the person label', () => {
    const result = classifyIncomeCandidate(incomeEvent({
      sourceType: 'upi_credit',
      label: 'Private UPI Sender',
      counterpartyLabel: 'Private UPI Sender',
      exclusionReason: 'family_or_friend',
    }));

    expect(result.includeInIncome).toBe(false);
    expect(result.label).toBe('income_excluded_family_or_friend');
    expect(JSON.stringify(result)).not.toContain('Private UPI Sender');
  });

  it('excludes refund and borrowed money', () => {
    const refund = classifyIncomeCandidate(incomeEvent({ sourceType: 'refund' }));
    const borrowed = classifyIncomeCandidate(incomeEvent({ sourceType: 'borrowed' }));

    expect(refund).toEqual(expect.objectContaining({
      includeInIncome: false,
      exclusionReason: 'refund',
    }));
    expect(borrowed).toEqual(expect.objectContaining({
      includeInIncome: false,
      exclusionReason: 'borrowed_money',
    }));
  });

  it('strips runtime-only raw fields from classified candidates', () => {
    const candidate = {
      ...incomeEvent({ sourceType: 'upi_credit' }),
      raw_sms: 'OTP 123456 account 123456789012',
      rawNotification: 'Private notification body',
      metadata: {
        source: 'structured',
        raw_sms: 'OTP 123456',
        phone: '9876543210',
      },
    } as IncomeEvent;

    const serialized = JSON.stringify(classifyIncomeCandidate(candidate));
    expect(serialized).not.toContain('OTP');
    expect(serialized).not.toContain('123456789012');
    expect(serialized).not.toContain('9876543210');
    expect(serialized).not.toContain('Private notification body');
  });
});

describe('debtFreedom current-month income pace', () => {
  it('projects day 1 income across the month', () => {
    const result = calculateCurrentMonthIncomePace(
      [incomeEvent({ amount: 500, receivedAt: '2026-06-01T12:00:00.000Z' })],
      { ...JUNE_OPTIONS, elapsedDaysInCurrentMonth: 1 }
    );

    expect(result.includedIncomeTotal).toBe(500);
    expect(result.averageDailyIncome).toBe(500);
    expect(result.projectedMonthEndIncome).toBe(15000);
    expect(result.confidence).toBe('low');
  });

  it('updates day 2 and day 3 projections from month-to-date totals', () => {
    const events = [
      incomeEvent({ id: 'one', amount: 500, receivedAt: '2026-06-01T12:00:00.000Z' }),
      incomeEvent({ id: 'two', amount: 1200, receivedAt: '2026-06-02T12:00:00.000Z' }),
    ];
    const day2 = calculateCurrentMonthIncomePace(events, {
      ...JUNE_OPTIONS,
      elapsedDaysInCurrentMonth: 2,
    });
    const day3 = calculateCurrentMonthIncomePace([
      ...events,
      incomeEvent({ id: 'three', amount: 400, receivedAt: '2026-06-03T12:00:00.000Z' }),
    ], JUNE_OPTIONS);

    expect(day2.averageDailyIncome).toBe(850);
    expect(day2.projectedMonthEndIncome).toBe(25500);
    expect(day3.averageDailyIncome).toBe(700);
    expect(day3.projectedMonthEndIncome).toBe(21000);
  });

  it('calculates remaining-day and today targets', () => {
    const result = calculateDailyIncomeTarget({
      incomeEvents: [
        incomeEvent({ amount: 900, receivedAt: '2026-06-10T12:00:00.000Z' }),
      ],
      options: {
        ...JUNE_OPTIONS,
        now: '2026-06-10T12:00:00.000Z',
        elapsedDaysInCurrentMonth: 10,
        targetMonthlyIncome: 3000,
      },
    });

    expect(result.requiredAverageDailyIncome).toBe(100);
    expect(result.requiredRemainingDailyIncome).toBe(105);
    expect(result.todayIncomeTarget).toBe(105);
  });

  it('derives a daily target from essentials, debt payment, and emergency contribution', () => {
    const result = calculateDailyIncomeTarget({
      incomeEvents: [
        incomeEvent({ amount: 1000, receivedAt: '2026-06-10T12:00:00.000Z' }),
      ],
      options: {
        ...JUNE_OPTIONS,
        now: '2026-06-10T12:00:00.000Z',
        elapsedDaysInCurrentMonth: 10,
        plannedMonthlyDebtPayment: 3000,
      },
      expenses: {
        essentialMonthlyExpenses: 6000,
        emergencyContribution: 1000,
      },
    });

    expect(result.targetMonthlyIncome).toBe(10000);
    expect(result.todayIncomeTarget).toBe(450);
  });

  it('counts only current-month reviewed income events', () => {
    const result = calculateCurrentMonthIncomePace([
      incomeEvent({ id: 'included', amount: 900 }),
      incomeEvent({ id: 'old', amount: 5000, receivedAt: '2026-05-31T23:59:00.000Z' }),
      incomeEvent({ id: 'refund', amount: 200, sourceType: 'refund' }),
      incomeEvent({ id: 'unknown', amount: 300, sourceType: 'upi_credit' }),
    ], JUNE_OPTIONS);

    expect(result.includedIncomeTotal).toBe(900);
    expect(result.includedIncomeCount).toBe(1);
    expect(result.excludedIncomeCount).toBe(2);
    expect(result.needsReviewCount).toBe(1);
  });

  it('excludes future-dated events from month-to-date income', () => {
    const result = calculateCurrentMonthIncomePace([
      incomeEvent({ id: 'today', amount: 900 }),
      incomeEvent({ id: 'future', amount: 5000, receivedAt: '2026-06-20T12:00:00.000Z' }),
    ], JUNE_OPTIONS);

    expect(result.includedIncomeTotal).toBe(900);
    expect(result.includedIncomeCount).toBe(1);
  });

  it('clamps unsafe elapsed-day and month-length overrides', () => {
    const result = calculateCurrentMonthIncomePace([
      incomeEvent({ amount: 3100 }),
    ], {
      ...JUNE_OPTIONS,
      daysInMonth: 1000,
      elapsedDaysInCurrentMonth: 1000,
    });

    expect(result.daysInMonth).toBe(31);
    expect(result.elapsedDaysInCurrentMonth).toBe(31);
    expect(result.remainingDaysInMonth).toBe(0);
    expect(result.projectedMonthEndIncome).toBe(3100);
  });

  it('calculates the recovery pace when current income is behind target', () => {
    const result = calculateDailyIncomeTarget({
      incomeEvents: [
        incomeEvent({ amount: 1000, receivedAt: '2026-06-10T12:00:00.000Z' }),
      ],
      options: {
        ...JUNE_OPTIONS,
        now: '2026-06-10T12:00:00.000Z',
        elapsedDaysInCurrentMonth: 10,
        targetMonthlyIncome: 10000,
      },
    });

    expect(result.projectedMonthEndIncome).toBe(3000);
    expect(result.incomePaceGap).toBe(-7000);
    expect(result.requiredRemainingDailyIncome).toBe(450);
    expect(result.todayIncomeTarget).toBe(450);
  });
});

describe('debtFreedom plan debt model', () => {
  it('sums loan, card, and borrowed people debt', () => {
    const result = plan({
      debts: [
        debt({ id: 'loan', outstanding: 10000 }),
        debt({ id: 'card', sourceType: 'credit_card', outstanding: 5000 }),
        debt({ id: 'person', sourceType: 'people_borrowed', outstanding: 2000 }),
      ],
    });

    expect(result.totalDebt).toBe(17000);
  });

  it('ignores zero and negative debt', () => {
    const result = plan({
      debts: [
        debt({ id: 'positive', outstanding: 1000 }),
        debt({ id: 'zero', outstanding: 0 }),
        debt({ id: 'negative', outstanding: -100 }),
      ],
    });

    expect(result.totalDebt).toBe(1000);
    expect(result.debts.map(item => item.id)).toEqual(['positive']);
  });

  it('includes hidden nonzero debt and warns', () => {
    const result = plan({ debts: [debt({ outstanding: 2500, isHidden: true })] });

    expect(result.totalDebt).toBe(2500);
    expect(warningCodes(result)).toContain('hidden_debt_included');
  });

  it('deduplicates debt groups by confidence before outstanding', () => {
    const result = plan({
      debts: [
        debt({
          id: 'rich_loan',
          outstanding: 10000,
          confidence: 'exact',
          duplicateGroupKey: 'loan:hdfc:1234',
        }),
        debt({
          id: 'snapshot',
          sourceType: 'loan_account',
          outstanding: 12000,
          confidence: 'estimated',
          duplicateGroupKey: 'loan:hdfc:1234',
        }),
      ],
    });

    expect(result.totalDebt).toBe(10000);
    expect(result.debts.map(item => item.id)).toEqual(['rich_loan']);
    expect(warningCodes(result)).toContain('duplicate_debt_possible');
  });

  it('uses the larger balance when duplicate confidences match', () => {
    const result = plan({
      debts: [
        debt({ id: 'smaller', outstanding: 1000, duplicateGroupKey: 'same' }),
        debt({ id: 'larger', outstanding: 1500, duplicateGroupKey: 'same' }),
      ],
    });

    expect(result.totalDebt).toBe(1500);
    expect(result.debts[0].id).toBe('larger');
  });

  it('estimates missing card minimum payments at five percent', () => {
    const result = plan({
      debts: [
        debt({
          sourceType: 'credit_card',
          outstanding: 10000,
          minimumMonthlyPayment: null,
        }),
      ],
    });

    expect(result.minimumDebtPayment).toBe(500);
    expect(result.insightTokens).toContain('credit_card_minimum_payment_estimated');
    expect(result.isEstimate).toBe(true);
  });
});

describe('debtFreedom plan income and spending', () => {
  it('uses confirmed income before a variable projection', () => {
    const result = plan({
      income: income({
        confirmedMonthlyIncome: 40000,
        incomeEvents: [incomeEvent({ amount: 100 })],
      }),
    });

    expect(result.monthlyIncomeUsed).toBe(40000);
    expect(result.incomeProjection.monthlyIncome).toBe(40000);
    expect(result.incomeProjection.source).toBe('confirmed');
    expect(result.incomeProjection.projectedMonthEndIncome).toBe(1000);
  });

  it('uses current month daily pace when fixed income is absent', () => {
    const result = plan({
      income: {
        incomeSource: 'current_month_daily_average',
        incomeEvents: [incomeEvent({ amount: 2100 })],
      },
    });

    expect(result.monthlyIncomeUsed).toBe(21000);
    expect(result.incomeProjection.averageDailyIncome).toBe(700);
    expect(warningCodes(result)).toContain('income_variable_estimate');
    expect(warningCodes(result)).toContain('income_sample_too_small');
  });

  it('falls back to a manual estimate only when explicitly selected', () => {
    const result = plan({
      income: {
        estimatedMonthlyIncome: 18000,
        incomeSource: 'manual_estimate',
      },
    });

    expect(result.monthlyIncomeUsed).toBe(18000);
    expect(result.incomeProjection.source).toBe('manual_estimate');
  });

  it('uses a manual estimate before current-month reviewed income pace', () => {
    const result = plan({
      income: {
        estimatedMonthlyIncome: 22000,
        incomeSource: 'manual_estimate',
        incomeEvents: [incomeEvent({ amount: 600, receivedAt: '2026-06-01T10:00:00.000Z' })],
      },
    });

    expect(result.monthlyIncomeUsed).toBe(22000);
    expect(result.incomeProjection.monthlyIncome).toBe(22000);
    expect(result.incomeProjection.source).toBe('manual_estimate');
    expect(result.incomeProjection.projectedMonthEndIncome).toBe(6000);
  });

  it('falls back to current-month pace when manual estimate has no usable amount', () => {
    const result = plan({
      income: {
        estimatedMonthlyIncome: 0,
        incomeSource: 'manual_estimate',
        incomeEvents: [incomeEvent({ amount: 600, receivedAt: '2026-06-01T10:00:00.000Z' })],
      },
    });

    expect(result.monthlyIncomeUsed).toBe(6000);
    expect(result.incomeProjection.source).toBe('current_month_daily_average');
  });

  it('returns null DTI and an income warning when income is missing', () => {
    const result = plan({ income: { incomeSource: 'missing' } });

    expect(result.debtToIncomePercent).toBeNull();
    expect(result.scoreLabel).toBe('unknown');
    expect(warningCodes(result)).toContain('income_missing');
  });

  it('adds DTI warnings above forty and fifty percent', () => {
    const caution = plan({
      debts: [debt({ minimumMonthlyPayment: 4500 })],
      income: income({ confirmedMonthlyIncome: 10000 }),
    });
    const high = plan({
      debts: [debt({ minimumMonthlyPayment: 5500 })],
      income: income({ confirmedMonthlyIncome: 10000 }),
    });

    expect(warningCodes(caution)).toContain('high_dti');
    expect(warningCodes(high)).toContain('very_high_dti');
  });

  it('warns when minimum debt payments exceed income', () => {
    const result = plan({
      debts: [debt({ minimumMonthlyPayment: 12000 })],
      income: income({ confirmedMonthlyIncome: 10000 }),
    });

    expect(warningCodes(result)).toContain('minimum_payment_exceeds_income');
    expect(result.scoreLabel).toBe('high_risk');
  });

  it('scores a healthy nonzero low-DTI plan as good', () => {
    const result = plan({
      debts: [debt({ outstanding: 5000, minimumMonthlyPayment: 500 })],
      income: income({ confirmedMonthlyIncome: 30000 }),
      expenses: expenses(),
    });

    expect(result.totalDebt).toBe(5000);
    expect(result.debtToIncomePercent).toBeCloseTo(1.67, 2);
    expect(result.scoreLabel).toBe('good');
  });

  it('calculates and clamps safe spend', () => {
    const available = plan({
      income: income({ confirmedMonthlyIncome: 20000 }),
      expenses: expenses({ essentialMonthlyExpenses: 10000, emergencyContribution: 1000 }),
      options: { plannedMonthlyDebtPayment: 5000 },
    });
    const clamped = plan({
      income: income({ confirmedMonthlyIncome: 10000 }),
      expenses: expenses({ essentialMonthlyExpenses: 9000, emergencyContribution: 1000 }),
      options: { plannedMonthlyDebtPayment: 5000 },
    });

    expect(available.safeSpendAmount).toBe(4000);
    expect(available.freeCashflowAfterDebt).toBe(9000);
    expect(clamped.safeSpendAmount).toBe(0);
  });

  it('returns null safe spend when essentials are missing', () => {
    const result = plan({ expenses: {} });

    expect(result.safeSpendAmount).toBeNull();
    expect(warningCodes(result)).toContain('essential_expense_missing');
  });

  it('warns about review-required income and a pace gap', () => {
    const result = plan({
      income: {
        incomeSource: 'current_month_daily_average',
        incomeEvents: [
          incomeEvent({ amount: 300 }),
          incomeEvent({ id: 'unknown', sourceType: 'upi_credit', amount: 10000 }),
        ],
      },
      options: { targetMonthlyIncome: 9000 },
    });

    expect(result.monthlyIncomeUsed).toBe(3000);
    expect(warningCodes(result)).toEqual(expect.arrayContaining([
      'income_needs_review',
      'income_pace_behind',
      'daily_target_high',
    ]));
  });
});

describe('debtFreedom plan timeline and ordering', () => {
  it('estimates a simple no-interest timeline', () => {
    const result = plan({
      debts: [debt({ outstanding: 10000, annualInterestRate: null })],
      options: { plannedMonthlyDebtPayment: 3000, now: '2026-06-01T00:00:00.000Z' },
    });

    expect(result.estimatedMonthsToDebtFree).toBe(4);
    expect(result.estimatedDebtFreeDate).toBe('2026-10-01');
    expect(result.isEstimate).toBe(true);
  });

  it('returns a healthy zero-debt result', () => {
    const result = plan({
      debts: [],
      income: { incomeSource: 'missing' },
      expenses: {},
    });

    expect(result.totalDebt).toBe(0);
    expect(result.estimatedMonthsToDebtFree).toBe(0);
    expect(result.debtFreedomScore).toBe(100);
    expect(result.scoreLabel).toBe('good');
  });

  it('returns a null timeline when debt has no payment', () => {
    const result = plan({
      debts: [debt({ minimumMonthlyPayment: null })],
      options: {},
    });

    expect(result.minimumDebtPayment).toBe(0);
    expect(result.estimatedMonthsToDebtFree).toBeNull();
    expect(warningCodes(result)).toContain('target_unreachable');
  });

  it('calculates extra monthly payment required for a target', () => {
    const result = plan({
      debts: [debt({ outstanding: 10000, annualInterestRate: null })],
      options: { plannedMonthlyDebtPayment: 1000, targetDebtFreeMonths: 5 },
    });

    expect(result.extraMonthlyNeededForTarget).toBe(1000);
  });

  it('warns when a zero-month target is impossible', () => {
    const result = plan({ options: { targetDebtFreeMonths: 0 } });

    expect(result.extraMonthlyNeededForTarget).toBeNull();
    expect(warningCodes(result)).toContain('target_unreachable');
  });

  it('simulates a known interest rate without mutating the source debt', () => {
    const sourceDebt = debt({ outstanding: 12000, annualInterestRate: 12 });
    const before = JSON.stringify(sourceDebt);
    const result = plan({
      debts: [sourceDebt],
      options: { plannedMonthlyDebtPayment: 1100 },
    });

    expect(result.estimatedMonthsToDebtFree).toBe(12);
    expect(JSON.stringify(sourceDebt)).toBe(before);
  });

  it('orders snowball debts from smallest balance', () => {
    const result = plan({
      debts: [
        debt({ id: 'large', outstanding: 3000 }),
        debt({ id: 'small', outstanding: 1000 }),
      ],
      options: { strategy: 'snowball' },
    });

    expect(result.orderedDebts.map(item => item.id)).toEqual(['small', 'large']);
  });

  it('orders avalanche debts by known APR and warns for missing rates', () => {
    const result = plan({
      debts: [
        debt({ id: 'missing', annualInterestRate: null }),
        debt({ id: 'low', annualInterestRate: 8 }),
        debt({ id: 'high', annualInterestRate: 18 }),
      ],
      options: { strategy: 'avalanche' },
    });

    expect(result.orderedDebts.map(item => item.id)).toEqual(['high', 'low', 'missing']);
    expect(warningCodes(result)).toContain('missing_interest_rates');
  });

  it('orders balanced debt by due risk before card and balance fallbacks', () => {
    const result = plan({
      debts: [
        debt({ id: 'normal', outstanding: 1000 }),
        debt({ id: 'card', sourceType: 'credit_card', outstanding: 2000 }),
        debt({ id: 'overdue', outstanding: 3000, dueDate: '2026-06-01' }),
      ],
      options: { strategy: 'balanced', now: NOW },
    });

    expect(result.orderedDebts.map(item => item.id)).toEqual(['overdue', 'card', 'normal']);
  });
});

describe('debtFreedom privacy and purity', () => {
  it('does not import Supabase, AsyncStorage, or UI dependencies', () => {
    const fs = jest.requireActual<{ readFileSync(filePath: string, encoding: string): string }>('fs');
    const source = fs.readFileSync('src/lib/services/debtFreedom.ts', 'utf8');

    expect(source).not.toMatch(/supabase/i);
    expect(source).not.toMatch(/AsyncStorage/i);
    expect(source).not.toMatch(/react-native|from ['"]react['"]/i);
    expect(source).not.toMatch(/\.from\(|\.insert\(|\.update\(|\.delete\(|\.rpc\(/);
    expect(source).not.toMatch(/console\./);
    expect(source).not.toMatch(/rolling_average|last\s*(?:7|14|30)/i);
  });

  it('does not mutate input arrays or nested input objects', () => {
    const input = {
      debts: [
        debt({
          duplicateGroupKey: 'same',
          metadata: { bankName: 'Safe Bank', last4: '1234', source: 'manual' },
        }),
        debt({ id: 'loan_2', outstanding: 12000, duplicateGroupKey: 'same' }),
      ],
      income: {
        incomeSource: 'current_month_daily_average' as const,
        incomeEvents: [incomeEvent()],
      },
      expenses: expenses(),
      options: { ...JUNE_OPTIONS, strategy: 'avalanche' as const },
    };
    const before = JSON.stringify(input);

    calculateDebtFreedomPlan(input);

    expect(JSON.stringify(input)).toBe(before);
  });

  it('returns only safe debt metadata keys', () => {
    const result = plan({
      debts: [
        {
          ...debt({
            metadata: { bankName: 'Safe Bank', last4: '1234', source: 'manual' },
          }),
          raw_sms: 'OTP 123456 account 123456789012',
          metadata: {
            bankName: 'Safe Bank',
            last4: '1234',
            source: 'manual',
            rawNotification: 'Private body',
            phone: '9876543210',
          },
        } as DebtItem,
      ],
    });

    const serialized = JSON.stringify(result);
    expect(serialized).toContain('"last4":"1234"');
    expect(serialized).not.toContain('OTP');
    expect(serialized).not.toContain('Private body');
    expect(serialized).not.toContain('9876543210');
    expect(serialized).not.toContain('123456789012');
  });

  it('does not require full account or card numbers', () => {
    const result = plan({
      debts: [
        debt({
          sourceType: 'credit_card',
          metadata: { last4: '4321' },
        }),
      ],
    });

    expect(result.totalDebt).toBe(10000);
    expect(result.debts[0].metadata?.last4).toBe('4321');
  });

  it('keeps a variable-income low-sample plan explicitly estimated', () => {
    const result = plan({
      income: {
        incomeSource: 'current_month_daily_average',
        incomeEvents: [incomeEvent({ amount: 500 })],
      },
      options: { elapsedDaysInCurrentMonth: 1 },
    });

    expect(result.isEstimate).toBe(true);
    expect(result.incomeProjection.confidence).toBe('low');
    expect(result.scoreLabel).not.toBe('good');
  });

  it('uses token-like warning messages without user-provided labels', () => {
    const result = plan({
      debts: [debt({ label: 'Private Debt Label', isHidden: true })],
    });

    expect(result.warnings).toContainEqual(expect.objectContaining({
      code: 'hidden_debt_included',
      messageToken: 'debt_freedom_warning_hidden_debt_included',
    }));
    expect(JSON.stringify(result.warnings)).not.toContain('Private Debt Label');
  });
});
