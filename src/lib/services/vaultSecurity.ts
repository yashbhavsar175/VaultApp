import { NativeModules, Platform } from 'react-native';

const { VaultSecurityModule } = NativeModules;

function summarizeVaultSecurityError(error: unknown) {
  if (error && typeof error === 'object') {
    const maybeError = error as { code?: unknown; name?: unknown; status?: unknown };
    return {
      code: typeof maybeError.code === 'string' ? maybeError.code : null,
      name: typeof maybeError.name === 'string' ? maybeError.name : null,
      status: typeof maybeError.status === 'number' || typeof maybeError.status === 'string' ? maybeError.status : null,
    };
  }

  return {
    code: null,
    name: typeof error,
    status: null,
  };
}

export async function setVaultSecureWindow(enabled: boolean): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  if (typeof VaultSecurityModule?.setSecureWindow !== 'function') return false;

  try {
    return Boolean(await VaultSecurityModule.setSecureWindow(enabled));
  } catch (error) {
    console.warn('[VaultSecurity] Secure window update failed', {
      enabled,
      error: summarizeVaultSecurityError(error),
    });
    return false;
  }
}
