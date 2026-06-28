import EncryptedStorage from 'react-native-encrypted-storage';
import Aes from 'react-native-aes-crypto';
import { decryptField, encryptField } from './encryption';

jest.mock('../lib/core', () => ({
  supabase: {
    auth: {
      getUser: jest.fn(() => Promise.resolve({ data: { user: { id: 'user_a' } } })),
    },
  },
}));

jest.mock('react-native-aes-crypto', () => ({
  __esModule: true,
  default: {
    randomKey: jest.fn(),
    encrypt: jest.fn(),
    decrypt: jest.fn(),
    pbkdf2: jest.fn(),
  },
}));

describe('vault field encryption', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (EncryptedStorage.getItem as jest.Mock).mockResolvedValue(null);
    (EncryptedStorage.setItem as jest.Mock).mockResolvedValue(undefined);
    (EncryptedStorage.removeItem as jest.Mock).mockResolvedValue(undefined);
  });

  it('encrypts new fields with a random secure-storage data key instead of a user-id-derived key', async () => {
    (Aes.randomKey as jest.Mock)
      .mockResolvedValueOnce('random-vault-data-key-32-bytes-long')
      .mockResolvedValueOnce('random-iv-16byte');
    (Aes.encrypt as jest.Mock).mockResolvedValue('ciphertext');

    const encrypted = await encryptField('secret value');

    expect(encrypted).toBe('random-iv-16byte:ciphertext');
    expect(EncryptedStorage.setItem).toHaveBeenCalledWith(
      'vault:data-key:v2:user_a',
      'random-vault-data-key-32-bytes-long',
    );
    expect(Aes.pbkdf2).not.toHaveBeenCalled();
    expect(Aes.encrypt).toHaveBeenCalledWith(
      'secret value',
      'random-vault-data-key-32-bytes-long',
      'random-iv-16byte',
      'aes-256-cbc',
    );
  });

  it('falls back to the legacy user-id-derived key only for old encrypted rows', async () => {
    (EncryptedStorage.getItem as jest.Mock).mockResolvedValue('random-vault-data-key-32-bytes-long');
    (Aes.decrypt as jest.Mock)
      .mockRejectedValueOnce(new Error('wrong key'))
      .mockResolvedValueOnce('legacy plaintext');
    (Aes.pbkdf2 as jest.Mock).mockResolvedValue('legacy-derived-key');

    await expect(decryptField('legacy-iv:legacy-ciphertext')).resolves.toBe('legacy plaintext');

    expect(Aes.pbkdf2).toHaveBeenCalledWith('user_a', 'vault-salt-v1', 5000, 256, 'sha256');
    expect(Aes.decrypt).toHaveBeenLastCalledWith(
      'legacy-ciphertext',
      'legacy-derived-key',
      'legacy-iv',
      'aes-256-cbc',
    );
  });
});
