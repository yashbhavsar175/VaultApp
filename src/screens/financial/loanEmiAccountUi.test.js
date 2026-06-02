const fs = require('fs');
const path = require('path');

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', '..', '..', relativePath), 'utf8');
}

describe('Loan/EMI account UI fields', () => {
  const bankConfigSource = read('src/screens/financial/BankConfigScreen.tsx');
  const banksSource = read('src/screens/financial/FinancialScreens.tsx');
  const combined = `${bankConfigSource}\n${banksSource}`;

  it('renders Monthly EMI Amount only in Loan/EMI account forms', () => {
    expect(combined).toContain('Loan/EMI');
    expect(combined).toContain('Monthly EMI Amount');
    expect(combined).toContain('Used for Debt Freedom monthly payment estimates.');
    expect(combined).toContain("accountType === 'loan' && (");
    expect(bankConfigSource).toContain("{(['savings', 'current', 'credit_card', 'loan'] as const)");
    expect(bankConfigSource).toContain("{(accountType === 'savings' || accountType === 'current') && (");
  });

  it('blocks negative EMI and saves blank EMI as null', () => {
    expect(combined).toContain('parseAmountField(monthlyEmiAmount, true)');
    expect(combined).toContain('parsedMonthlyEmi !== null && (!Number.isFinite(parsedMonthlyEmi) || parsedMonthlyEmi < 0)');
    expect(combined).toContain("monthly_emi_amount: accountType === 'loan' ? parsedMonthlyEmi : null");
    expect(combined).toContain('Please enter a valid monthly EMI amount');
  });

  it('keeps new account copy English-only and avoids visible question-mark icons', () => {
    expect(combined).not.toMatch(/[\u0900-\u097F]/);
    expect(combined).not.toMatch(/<MaterialCommunityIcons[^>]+name=["']\?["']/);
    expect(combined).not.toMatch(/<DebtFreedomIcon[^>]+name=["']\?["']/);
  });
});
