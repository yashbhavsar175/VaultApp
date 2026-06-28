export type AuthBootstrapState =
  | { status: 'loading' }
  | { status: 'unauthenticated' }
  | { status: 'authenticated_online'; userId: string }
  | { status: 'authenticated_offline_unverified'; userId: string };

export type AuthSessionVerification =
  | { status: 'unauthenticated' }
  | { status: 'authenticated_online'; userId: string }
  | { status: 'authenticated_offline_unverified'; userId: string };

export function isNetworkAuthFailure(error: unknown): boolean {
  const message = String((error as any)?.message ?? error ?? '').toLowerCase();
  const name = String((error as any)?.name ?? '').toLowerCase();

  return (
    message.includes('network request failed') ||
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('offline') ||
    message.includes('internet') ||
    name.includes('typeerror')
  );
}

export function getAuthUserId(state: AuthBootstrapState | AuthSessionVerification): string | null {
  return state.status === 'authenticated_online' || state.status === 'authenticated_offline_unverified'
    ? state.userId
    : null;
}

type SupabaseUserResult = {
  data?: {
    user?: {
      id?: string | null;
    } | null;
  } | null;
  error?: unknown;
};

export async function verifySessionUser(
  getUser: () => Promise<SupabaseUserResult>,
  sessionUserId?: string | null,
): Promise<AuthSessionVerification> {
  if (!sessionUserId) {
    return { status: 'unauthenticated' };
  }

  try {
    const { data, error } = await getUser();
    if (error) {
      throw error;
    }

    const userId = data?.user?.id;
    if (!userId || userId !== sessionUserId) {
      return { status: 'unauthenticated' };
    }

    return { status: 'authenticated_online', userId };
  } catch (error) {
    if (isNetworkAuthFailure(error)) {
      return { status: 'authenticated_offline_unverified', userId: sessionUserId };
    }

    return { status: 'unauthenticated' };
  }
}
