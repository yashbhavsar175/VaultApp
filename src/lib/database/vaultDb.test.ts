import { supabase } from '../core';
import { addVaultItem, getVaultItems, updateVaultItem } from './vaultDb';
import { encryptVaultText } from '../../utils/encryption';

jest.mock('../core', () => ({
  supabase: {
    auth: {
      getUser: jest.fn(),
    },
    from: jest.fn(),
  },
}));

jest.mock('../../utils/encryption', () => ({
  decryptVaultFields: jest.fn(async fields => fields),
  decryptVaultText: jest.fn(async value => (
    typeof value === 'string' && value.startsWith('vault:v1:')
      ? value.replace('vault:v1:', '')
      : value
  )),
  encryptVaultFields: jest.fn(async fields => fields),
  encryptVaultText: jest.fn(async value => value ? `vault:v1:${value}` : value),
}));

const mockSupabase = supabase as any;
const mockEncryptVaultText = encryptVaultText as jest.Mock;

describe('vaultDb emergency notes hardening', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user_1' } },
    });
  });

  it('encrypts notes for new vault saves', async () => {
    const single = jest.fn().mockResolvedValue({
      data: {
        id: 'vault_1',
        title: 'Codex40D',
        category: 'other',
        fields: [],
        notes: 'vault:v1:secret note',
        created_at: '2026-06-02T00:00:00.000Z',
        updated_at: '2026-06-02T00:00:00.000Z',
      },
      error: null,
    });
    const select = jest.fn(() => ({ single }));
    const insert = jest.fn(() => ({ select }));
    mockSupabase.from.mockReturnValue({ insert });

    const item = await addVaultItem({
      title: 'Codex40D',
      category: 'other',
      fields: [],
      notes: 'secret note',
    });

    expect(mockEncryptVaultText).toHaveBeenCalledWith('secret note');
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      notes: 'vault:v1:secret note',
    }));
    expect(item.notes).toBe('secret note');
  });

  it('encrypts notes on vault updates without rotating fields', async () => {
    const single = jest.fn().mockResolvedValue({
      data: {
        id: 'vault_1',
        title: 'Codex40D',
        category: 'other',
        fields: [],
        notes: 'vault:v1:updated note',
        created_at: '2026-06-02T00:00:00.000Z',
        updated_at: '2026-06-02T00:00:01.000Z',
      },
      error: null,
    });
    const select = jest.fn(() => ({ single }));
    const eqUser = jest.fn(() => ({ select }));
    const eqId = jest.fn(() => ({ eq: eqUser }));
    const update = jest.fn(() => ({ eq: eqId }));
    mockSupabase.from.mockReturnValue({ update });

    await updateVaultItem('vault_1', { notes: 'updated note' });

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      notes: 'vault:v1:updated note',
    }));
  });

  it('keeps existing plaintext notes readable for backward compatibility', async () => {
    const order = jest.fn().mockResolvedValue({
      data: [{
        id: 'vault_legacy',
        title: 'Legacy',
        category: 'other',
        fields: [],
        notes: 'legacy plaintext note: with colon',
        created_at: '2026-06-02T00:00:00.000Z',
        updated_at: '2026-06-02T00:00:00.000Z',
      }],
      error: null,
    });
    const eq = jest.fn(() => ({ order }));
    const select = jest.fn(() => ({ eq }));
    mockSupabase.from.mockReturnValue({ select });

    const items = await getVaultItems();

    expect(items[0].notes).toBe('legacy plaintext note: with colon');
  });
});
