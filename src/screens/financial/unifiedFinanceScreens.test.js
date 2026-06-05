const fs = require('fs');
const path = require('path');

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', '..', '..', relativePath), 'utf8');
}

describe('unified finance setup and review surfaces', () => {
  it('renders Accounts & Cards as the single account management surface', () => {
    const settings = read('src/screens/user/Settings.tsx');
    const accounts = read('src/screens/financial/FinancialScreens.tsx');

    expect(settings).toContain('Accounts & Cards');
    expect(settings).toContain('Manage balances, cards, loans, and auto-detection');
    expect(settings).not.toContain('Cards & Accounts');
    expect(settings).not.toContain('Bank & Card Setup');

    expect(accounts).toContain('title="Accounts & Cards"');
    expect(accounts).toContain('Summary');
    expect(accounts).toContain('Cash & bank balance');
    expect(accounts).toContain('Credit card outstanding');
    expect(accounts).toContain('Loan outstanding');
    expect(accounts).toContain('Hidden / Archived');
    expect(accounts).toContain('Accounts');
    expect(accounts).toContain('Credit Cards');
    expect(accounts).toContain('Loans / EMI');
    expect(accounts).toContain('detected account');
    expect(accounts).toContain('Restore');
  });



  it('keeps unified surfaces privacy-safe and avoids question-mark fallback icons', () => {
    const combined = [
      read('src/screens/user/Settings.tsx'),
      read('src/screens/financial/FinancialScreens.tsx'),
    ].join('\n');

    [
      'raw_sms',
      'raw notification',
      'notification_text',
      'raw_source_metadata',
      'rawJson',
      'raw JSON',
    ].forEach(blocked => {
      expect(combined).not.toContain(blocked);
    });
    expect(combined).not.toMatch(/[6-9][0-9]{9}/);
    expect(combined).not.toMatch(/[a-z0-9._-]+@(oksbi|okaxis|ybl|paytm|upi)/i);
    expect(combined).not.toMatch(/<MaterialCommunityIcons[^>]+name=["']\?["']/);
    expect(combined).not.toMatch(/console\.(log|debug|warn|error)\([^)]*(raw|sms|notification|phone|token|session)/i);
  });
});
