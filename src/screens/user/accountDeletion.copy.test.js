const fs = require('fs');
const path = require('path');

describe('Settings whole-account deletion copy', () => {
  const settings = fs.readFileSync(path.join(__dirname, 'Settings.tsx'), 'utf8');
  const service = fs.readFileSync(path.join(__dirname, '../../lib/services/accountDeletion.ts'), 'utf8');

  it('routes Settings through the centralized app-data deletion service', () => {
    expect(settings).toContain('deleteCurrentUserAppData');
    expect(settings).toContain('ACCOUNT_DELETION_COPY.dangerButton');
    expect(settings).not.toContain("'This will permanently delete your account and all your data. This cannot be undone.'");
  });

  it('does not pretend to delete the Supabase Auth user from the client', () => {
    expect(service).toContain('AUTH_USER_DELETION_IMPLEMENTED = false');
    expect(service).not.toContain('auth.admin');
    expect(service).not.toContain('deleteUser(');
    expect(service).not.toContain('.rpc(');
    expect(service).not.toContain('functions.invoke');
  });

  it('does not log raw deletion failures from Settings', () => {
    expect(settings).not.toContain("console.error('Error deleting account:', error)");
    expect(service).not.toContain('console.');
  });
});
