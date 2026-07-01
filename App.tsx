import 'react-native-gesture-handler';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ActivityIndicator, AppState, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Session } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import Toast, { BaseToast, ErrorToast, InfoToast } from 'react-native-toast-message';
import RootNavigator from './src/navigation/RootNavigator';
import { LoginScreen, SignupScreen } from './src/screens/auth/AuthScreens';
import ProfileScreen from './src/screens/user/ProfileScreen';
import AppIntroScreen from './src/screens/intro/AppIntroScreen';
import { supabase, configureGoogleSignIn, syncOfflineTransactions, handlePendingGeofenceClear } from './src/lib/core';
import {
  initializeForegroundListener,
  injectReminderDependencies,
} from './src/lib/services/notifications';
import { scheduleTransactionReminder } from './src/lib/services/scheduledNotifications';
import { storeTransactionReminder } from './src/components/modals/TransactionReminderModal';
import { initPorterDistanceCalculator } from './src/lib/services/porter';
import { startLocationMonitoring, stopLocationMonitoring } from './src/lib/services/placeReminders';
import PermissionPrompt from './src/components/modals/PermissionPrompt';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { CACHE_KEYS, clearCache, clearUserCache, getCached, prefetchAllData } from './src/lib/services/cache';
import { isAppLockEnabled, promptBiometricUnlock } from './src/lib/services/appLock';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import {
  AuthBootstrapState,
  verifySessionUser,
} from './src/lib/auth/offlineAuth';
import { startupMs } from './src/lib/utils/startupTimer';

const LEGACY_AUTH_TOKEN_KEY = 'supabase.auth.token';
const AUTH_STARTUP_TIMEOUT_MS = 4500;
const PROFILE_STARTUP_TIMEOUT_MS = 6000;
const AUTH_BOOTSTRAP_WATCHDOG_MS = 8000;
const APP_BACKGROUND_COLOR = '#050509';

if (__DEV__) console.log('[Startup] 🟢 JS bundle executed', startupMs());

const navigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: APP_BACKGROUND_COLOR,
  },
};

type ProfileStatus = 'unknown' | 'checking' | 'complete' | 'incomplete' | 'error';

interface CachedProfile {
  email?: string;
  name?: string;
  full_name?: string;
  userId?: string;
}

export const getCachedProfileRouteHint = (
  cachedProfile: CachedProfile | undefined,
  expectedUserId: string,
): ProfileStatus | null => {
  const cachedUserMatches = cachedProfile?.userId === expectedUserId;
  const cachedName = (cachedProfile?.full_name || cachedProfile?.name || '').trim();

  return cachedUserMatches && cachedName ? 'complete' : null;
};

export const withStartupTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

export const deferAuthStateChange = (callback: () => void) => setTimeout(callback, 0);

export type StartupErrorSummary = {
  code: string | null;
  name: string;
  status: number | string | null;
};

const readErrorField = (error: unknown, field: 'code' | 'name' | 'status'): unknown =>
  error && typeof error === 'object' ? (error as Record<string, unknown>)[field] : undefined;

export const summarizeStartupError = (error: unknown): StartupErrorSummary => {
  if (error && typeof error === 'object') {
    const code = readErrorField(error, 'code');
    const name = readErrorField(error, 'name');
    const status = readErrorField(error, 'status');
    return {
      code: typeof code === 'string' ? code : null,
      name: typeof name === 'string' ? name : 'Error',
      status: typeof status === 'number' || typeof status === 'string' ? status : null,
    };
  }

  return {
    code: null,
    name: error instanceof Error ? error.name : typeof error,
    status: null,
  };
};

const isStartupTimeout = (error: unknown, label: string, timeoutMs: number) =>
  error instanceof Error && error.message === `${label} timed out after ${timeoutMs}ms`;

function useAuthState(session: Session | null) {
  const [state, setState] = useState<AuthBootstrapState>({ status: 'loading' });

  const derived = useMemo(() => {
    const isAuthenticated = (
      state.status === 'authenticated_online' ||
      state.status === 'authenticated_offline_unverified'
    ) && Boolean(session?.user);

    return {
      isAuthenticated,
      isAuthLoading: state.status === 'loading',
      isOfflineUnverified: state.status === 'authenticated_offline_unverified',
    };
  }, [session?.user, state.status]);

  return {
    state,
    setState,
    ...derived,
  };
}

// Bug #M3 fix: ThemedToast renders inside ThemeProvider so it can call useTheme().
// Previously toastConfig was a static module-level object with hardcoded dark-mode colors
// that never adapted to the user's light/dark preference.
function ThemedToast() {
  const { colors } = useTheme();

  const toastConfig = useMemo(() => ({
    success: (props: any) => (
      <BaseToast
        {...props}
        style={{ borderLeftColor: colors.success, backgroundColor: colors.card, borderRadius: 12, marginTop: 8 }}
        contentContainerStyle={{ paddingHorizontal: 15 }}
        text1Style={{ color: colors.text, fontSize: 14, fontWeight: '600' }}
        text2Style={{ color: colors.subtext, fontSize: 12 }}
      />
    ),
    error: (props: any) => (
      <ErrorToast
        {...props}
        style={{ borderLeftColor: colors.error, backgroundColor: colors.card, borderRadius: 12, marginTop: 8 }}
        contentContainerStyle={{ paddingHorizontal: 15 }}
        text1Style={{ color: colors.text, fontSize: 14, fontWeight: '600' }}
        text2Style={{ color: colors.subtext, fontSize: 12 }}
      />
    ),
    info: (props: any) => (
      <InfoToast
        {...props}
        style={{ borderLeftColor: colors.info, backgroundColor: colors.card, borderRadius: 12, marginTop: 8 }}
        contentContainerStyle={{ paddingHorizontal: 15 }}
        text1Style={{ color: colors.text, fontSize: 14, fontWeight: '600' }}
        text2Style={{ color: colors.subtext, fontSize: 12 }}
      />
    ),
  }), [colors]);

  return (
    <Toast
      config={toastConfig}
      autoHide
      visibilityTime={3000}
      swipeable={false}
      onPress={() => Toast.hide()}
    />
  );
}

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const {
    state: authBootstrapState,
    setState: setAuthBootstrapState,
    isAuthenticated,
    isAuthLoading,
    isOfflineUnverified,
  } = useAuthState(session);
  const [introDone, setIntroDone] = useState(false);
  const [showSignup, setShowSignup] = useState(false);
  const [profileStatus, setProfileStatus] = useState<ProfileStatus>('unknown');
  const [startupRetryRevision, setStartupRetryRevision] = useState(0);
  const authRouteRevisionRef = useRef(0);
  const inFlightProfileCheckRef = useRef<{ userId: string; promise: Promise<ProfileStatus> } | null>(null);
  const prefetchedUserIdRef = useRef<string | null>(null);
  const verifyOfflineSessionRef = useRef<((nextSession: Session) => Promise<boolean>) | null>(null);
  const networkReconnectInFlightRef = useRef(false);
  const [isAppLocked, setIsAppLocked] = useState(false);
  // Bug #6 fix: rapid network bounce pe multiple syncs rokne ke liye debounce ref
  const reconnectDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Startup timing logs
  useEffect(() => {
    if (__DEV__) console.log('[Startup] 🏁 App component mounted', startupMs());
  }, []);
  useEffect(() => {
    if (__DEV__) console.log(`[Startup] 🔐 Auth state → isAuthLoading=${isAuthLoading} isAuthenticated=${isAuthenticated}`, startupMs());
  }, [isAuthLoading, isAuthenticated]);
  useEffect(() => {
    if (__DEV__) console.log(`[Startup] 🔒 isAppLocked=${isAppLocked}`, startupMs());
  }, [isAppLocked]);
  useEffect(() => {
    if (__DEV__) console.log(`[Startup] 🎬 introDone=${introDone}`, startupMs());
  }, [introDone]);

  // Configure Google Sign-In once on app start
  useEffect(() => {
    configureGoogleSignIn();
    // Bug #9 fix: pichle session mein geofence clear fail hua tha toh retry karo
    handlePendingGeofenceClear();
  }, []);

  // Initialize native background helpers on app start
  useEffect(() => {
    initPorterDistanceCalculator();
  }, []);

  // Sync offline queue only after a validated authenticated session exists.
  useEffect(() => {
    if (authBootstrapState.status !== 'authenticated_online' || !session?.user) {
      return;
    }

    // Sync offline queue when app comes to foreground
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active') {
        syncOfflineTransactions()
          .then(() => {
            if (__DEV__) console.log('✅ [OfflineSync] Foreground sync complete');
          })
          .catch(e => {
            if (__DEV__) console.error('❌ [OfflineSync] Foreground sync error:', e);
          });
      }
    });

    return () => {
      subscription.remove();
      // Note: Not stopping PorterDistanceCalculator here to allow it to continue
      // running in background scenarios where the app process remains active
    };
  }, [authBootstrapState.status, session]);

  // Offline sync: trigger whenever network reconnects
  useEffect(() => {
    if (!session?.user) {
      return;
    }

    const unsubscribe = NetInfo.addEventListener(state => {
      if (!state.isConnected) {
        // Disconnect pe pending debounce cancel karo aur flag reset karo
        if (reconnectDebounceRef.current) {
          clearTimeout(reconnectDebounceRef.current);
          reconnectDebounceRef.current = null;
        }
        networkReconnectInFlightRef.current = false;
        return;
      }

      // Bug #6 fix: debounce add kiya — Android pe network events rapidly fire karte hain
      // jo multiple simultaneous syncs cause karte the; 1.5s wait se bounce filter hota hai
      if (reconnectDebounceRef.current) {
        clearTimeout(reconnectDebounceRef.current);
      }

      reconnectDebounceRef.current = setTimeout(async () => {
        reconnectDebounceRef.current = null;

        if (networkReconnectInFlightRef.current) return;
        networkReconnectInFlightRef.current = true;

        try {
          if (authBootstrapState.status === 'authenticated_offline_unverified') {
            const verifyOfflineSession = verifyOfflineSessionRef.current;
            if (!verifyOfflineSession) return;

            const verified = await verifyOfflineSession(session);
            if (!verified) return;

            await syncOfflineTransactions();
            if (__DEV__) console.log('✅ [OfflineSync] Network reconnect verified and synced');

          } else if (authBootstrapState.status === 'authenticated_online') {
            await syncOfflineTransactions();
            if (__DEV__) console.log('✅ [OfflineSync] Network reconnect sync complete');
          }
        } catch (e) {
          if (__DEV__) console.error('❌ [OfflineSync] Network reconnect error:', e);
        } finally {
          // Bug #6 fix: pehle flag multiple scattered paths mein reset hota tha — race condition
          // finally guarantee karta hai ki flag hamesha reset hoga (success/error/early return sabme)
          networkReconnectInFlightRef.current = false;
        }
      }, 1500);
    });

    return () => {
      unsubscribe();
      // Cleanup: component unmount ya dependency change pe pending debounce cancel karo
      if (reconnectDebounceRef.current) {
        clearTimeout(reconnectDebounceRef.current);
        reconnectDebounceRef.current = null;
      }
    };
  }, [authBootstrapState.status, session]);

  // Initialize foreground listener for notifee events.
  // injectReminderDependencies must run before initializeForegroundListener so that
  // snooze actions dispatched while the app is in the foreground have the deps available.
  useEffect(() => {
    injectReminderDependencies({
      scheduleTransactionReminder,
      storeTransactionReminder,
    });
    if (__DEV__) console.log('🚀 [App] Initializing foreground listener for notifications...');
    const unsubscribe = initializeForegroundListener();
    return () => {
      unsubscribe();
    };
  }, []);

  // Initialize place reminders location monitoring
  useEffect(() => {
    if (authBootstrapState.status === 'authenticated_online' && session?.user) {
      startLocationMonitoring();
    } else {
      stopLocationMonitoring();
    }
    return () => stopLocationMonitoring();
  }, [authBootstrapState.status, session]);

  const getCachedProfileStatus = useCallback(async (nextSession: Session): Promise<ProfileStatus | null> => {
    try {
      const cached = await getCached<CachedProfile>(CACHE_KEYS.USER_PROFILE);
      return getCachedProfileRouteHint(cached?.data, nextSession.user.id);
    } catch {
      // Cache is only a route hint. Ignore corrupt or missing entries.
    }

    return null;
  }, []);

  const resolveProfileStatus = useCallback(async (nextSession: Session): Promise<ProfileStatus> => {
    const userId = nextSession.user.id;
    const activeCheck = inFlightProfileCheckRef.current;
    if (activeCheck?.userId === userId) {
      return activeCheck.promise;
    }

    const profileCheckPromise = (async (): Promise<ProfileStatus> => {
      try {
        const { data: profile, error } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', userId)
          .maybeSingle();

        if (error) {
          throw error;
        }

        if (profile?.full_name?.trim()) {
          return 'complete';
        }

        // Only a successful profile response with no usable name is treated as incomplete.
        return 'incomplete';
      } catch (error) {
        if (__DEV__) console.warn('[AuthStartup] Live profile lookup failed', {
          error: summarizeStartupError(error),
        });
        return await getCachedProfileStatus(nextSession) ?? 'error';
      }
    })();

    inFlightProfileCheckRef.current = { userId, promise: profileCheckPromise };

    try {
      return await profileCheckPromise;
    } finally {
      if (inFlightProfileCheckRef.current?.promise === profileCheckPromise) {
        inFlightProfileCheckRef.current = null;
      }
    }
  }, [getCachedProfileStatus]);

  const prefetchForSession = useCallback((nextSession: Session) => {
    const userId = nextSession.user.id;
    if (prefetchedUserIdRef.current === userId) {
      return;
    }

    prefetchedUserIdRef.current = userId;
    prefetchAllData();
  }, []);

  useEffect(() => {
    // Supabase persists sessions through the AsyncStorage-backed auth client.
    let isMounted = true;
    const deferredAuthTimers = new Set<ReturnType<typeof setTimeout>>();
    const isCurrentRoute = (routeRevision: number) =>
      isMounted && routeRevision === authRouteRevisionRef.current;

    const markUnauthenticated = async (
      startupWatchdog?: ReturnType<typeof setTimeout>,
      routeRevision?: number,
    ) => {
      if (startupWatchdog) clearTimeout(startupWatchdog);
      if (routeRevision !== undefined && !isCurrentRoute(routeRevision)) {
        return;
      }
      if (routeRevision === undefined) {
        ++authRouteRevisionRef.current;
      }
      // Bug #H2 fix: clear only the departing user's cache (user-scoped clear).
      // clearCache() clears ALL users' cache on a shared device; clearUserCache targets only
      // the signed-out user. Falls back to clearCache() when no userId is known.
      const departingUserId = await AsyncStorage.getItem('app_user_id').catch(() => null);
      if (departingUserId) {
        await clearUserCache(departingUserId);
      } else {
        await clearCache();
      }
      await AsyncStorage.removeItem('app_user_id').catch(() => undefined);
      prefetchedUserIdRef.current = null;
      inFlightProfileCheckRef.current = null;
      if (routeRevision !== undefined && !isCurrentRoute(routeRevision)) {
        return;
      }
      if (!isMounted) return;
      setProfileStatus('unknown');
      setSession(null);
      setAuthBootstrapState({ status: 'unauthenticated' });
    };

    const prepareLocalSessionUser = async (userId: string) => {
      const previousUserId = await AsyncStorage.getItem('app_user_id');
      if (previousUserId !== userId) {
        await clearCache();
      }
      await AsyncStorage.setItem('app_user_id', userId);
    };

    const validateSession = async (
      nextSession: Session | null,
    ): Promise<
      | { status: 'authenticated_online'; session: Session }
      | { status: 'authenticated_offline_unverified'; session: Session }
      | { status: 'unauthenticated' }
    > => {
      const sessionUserId = nextSession?.user?.id;
      if (!sessionUserId) {
        return { status: 'unauthenticated' };
      }

      const verification = await verifySessionUser(
        () => withStartupTimeout(
          supabase.auth.getUser(),
          AUTH_STARTUP_TIMEOUT_MS,
          'Supabase user validation',
        ),
        sessionUserId,
      );

      if (verification.status === 'authenticated_online') {
        return { status: 'authenticated_online', session: nextSession };
      }

      if (verification.status === 'authenticated_offline_unverified') {
        if (__DEV__) console.warn('[AuthStartup] User validation unavailable; using offline session');
        return { status: 'authenticated_offline_unverified', session: nextSession };
      }

      {
        if (__DEV__) console.warn('[AuthStartup] User validation failed; routing to login', {
          error: summarizeStartupError({ name: 'AuthVerificationFailed' }),
        });
        return { status: 'unauthenticated' };
      }
    };

    const resolveProfileRoute = async (nextSession: Session, routeRevision?: number) => {
      const cachedStatus = await getCachedProfileStatus(nextSession);
      if (cachedStatus) {
        void resolveProfileStatus(nextSession)
          .then(verifiedStatus => {
            if (
              !isMounted ||
              routeRevision === undefined ||
              routeRevision !== authRouteRevisionRef.current ||
              verifiedStatus === cachedStatus
            ) {
              return;
            }
            setProfileStatus(verifiedStatus);
          })
          .catch(error => {
            if (routeRevision === undefined || routeRevision === authRouteRevisionRef.current) {
              if (__DEV__) console.warn('[AuthStartup] Cached profile route kept; live profile verification failed', {
                error: summarizeStartupError(error),
              });
            }
          });

        return cachedStatus;
      }

      const liveProfileStatusPromise = resolveProfileStatus(nextSession);
      try {
        return await withStartupTimeout(
          liveProfileStatusPromise,
          PROFILE_STARTUP_TIMEOUT_MS,
          'Profile check',
        );
      } catch (error) {
        const isStaleRoute = routeRevision !== undefined && routeRevision !== authRouteRevisionRef.current;
        if (!isStaleRoute) {
          if (isStartupTimeout(error, 'Profile check', PROFILE_STARTUP_TIMEOUT_MS)) {
            console.info('[AuthStartup] Profile check deferred', {
              timeoutMs: PROFILE_STARTUP_TIMEOUT_MS,
            });
            void liveProfileStatusPromise.then(lateStatus => {
              if (
                !isMounted ||
                routeRevision === undefined ||
                routeRevision !== authRouteRevisionRef.current
              ) {
                return;
              }
              setProfileStatus(lateStatus);
            });
          } else {
            if (__DEV__) console.warn('[AuthStartup] Profile check unavailable', {
              error: summarizeStartupError(error),
            });
          }
        }
        return 'error';
      }
    };

    const verifyOfflineSession = async (nextSession: Session): Promise<boolean> => {
      const routeRevision = ++authRouteRevisionRef.current;
      const validatedSession = await validateSession(nextSession);
      if (!isCurrentRoute(routeRevision)) return false;

      if (validatedSession.status === 'authenticated_online') {
        await prepareLocalSessionUser(validatedSession.session.user.id);
        if (!isCurrentRoute(routeRevision)) return false;
        setSession(validatedSession.session);
        setAuthBootstrapState({
          status: 'authenticated_online',
          userId: validatedSession.session.user.id,
        });
        setProfileStatus('checking');

        const nextProfileStatus = await resolveProfileRoute(validatedSession.session, routeRevision);
        if (!isCurrentRoute(routeRevision)) return false;
        setProfileStatus(nextProfileStatus);
        if (nextProfileStatus === 'complete') {
          prefetchForSession(validatedSession.session);
        }
        return true;
      }

      if (validatedSession.status === 'unauthenticated') {
        await markUnauthenticated(undefined, routeRevision);
      }

      return false;
    };
    verifyOfflineSessionRef.current = verifyOfflineSession;

    const markSessionState = async (nextSession: Session, routeRevision: number) => {
      const validatedSession = await validateSession(nextSession);
      if (!isCurrentRoute(routeRevision)) return;

      if (validatedSession.status === 'unauthenticated') {
        await markUnauthenticated(startupWatchdog, routeRevision);
        return;
      }

      await prepareLocalSessionUser(validatedSession.session.user.id);
      if (!isCurrentRoute(routeRevision)) return;
      clearTimeout(startupWatchdog);
      setSession(validatedSession.session);

      if (validatedSession.status === 'authenticated_offline_unverified') {
        setAuthBootstrapState({
          status: 'authenticated_offline_unverified',
          userId: validatedSession.session.user.id,
        });
        setProfileStatus('complete');
        return;
      }

      setAuthBootstrapState({
        status: 'authenticated_online',
        userId: validatedSession.session.user.id,
      });
      setProfileStatus('checking');

      const nextProfileStatus = await resolveProfileRoute(validatedSession.session, routeRevision);
      if (!isCurrentRoute(routeRevision)) return;
      setProfileStatus(nextProfileStatus);

      if (nextProfileStatus === 'complete') {
        prefetchForSession(validatedSession.session);
      }
    };

    const startupWatchdog = setTimeout(() => {
      if (!isMounted) return;
      console.info('[AuthStartup] Bootstrap watchdog routed to logged-out state', {
        timeoutMs: AUTH_BOOTSTRAP_WATCHDOG_MS,
      });
      void markUnauthenticated(startupWatchdog);
    }, AUTH_BOOTSTRAP_WATCHDOG_MS);

    const markAuthenticated = async (nextSession: Session, routeRevision: number) => {
      await markSessionState(nextSession, routeRevision);
    };

    const initAuth = async () => {
      const startupRevision = ++authRouteRevisionRef.current;
      setAuthBootstrapState({ status: 'loading' });

      try {
        void AsyncStorage.removeItem(LEGACY_AUTH_TOKEN_KEY).catch(() => undefined);

        const initialSessionResult = await withStartupTimeout(
          supabase.auth.getSession(),
          AUTH_STARTUP_TIMEOUT_MS,
          'Supabase session load',
        );
        if (!isMounted || authRouteRevisionRef.current !== startupRevision) return;

        const initialSession = initialSessionResult?.data.session ?? null;
        if (initialSession?.user) {
          await markAuthenticated(initialSession, startupRevision);
        } else {
          await markUnauthenticated(startupWatchdog, startupRevision);
        }
      } catch (error) {
        if (__DEV__) console.warn('[AuthStartup] Session restore failed; routing to login', {
          error: summarizeStartupError(error),
        });
        if (isCurrentRoute(startupRevision)) {
          await markUnauthenticated(startupWatchdog, startupRevision);
        }
      }
    };

    const applyAuthStateChange = async (nextSession: Session | null) => {
      const routeRevision = ++authRouteRevisionRef.current;
      if (nextSession?.user) {
        await markAuthenticated(nextSession, routeRevision);
      } else {
        await markUnauthenticated(startupWatchdog, routeRevision);
      }
    };

    initAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      const deferredTimer = deferAuthStateChange(() => {
        deferredAuthTimers.delete(deferredTimer);
        void applyAuthStateChange(nextSession).catch(error => {
          if (!isMounted) return;
          if (__DEV__) console.warn('[AuthStartup] Auth change route unavailable', {
            error: summarizeStartupError(error),
          });
          void markUnauthenticated(startupWatchdog);
        });
      });
      deferredAuthTimers.add(deferredTimer);
    });

    return () => {
      isMounted = false;
      verifyOfflineSessionRef.current = null;
      clearTimeout(startupWatchdog);
      deferredAuthTimers.forEach(clearTimeout);
      subscription.unsubscribe();
    };
  }, [getCachedProfileStatus, prefetchForSession, resolveProfileStatus, startupRetryRevision]);

  const handleProfileComplete = useCallback(() => {
    setProfileStatus('complete');
  }, []);

  const retryProfileCheck = useCallback(async () => {
    if (!session?.user) return;

    const routeRevision = ++authRouteRevisionRef.current;
    setProfileStatus('checking');

    const nextProfileStatus = await withStartupTimeout(
      resolveProfileStatus(session),
      PROFILE_STARTUP_TIMEOUT_MS,
      'Profile check',
    ).catch(error => {
      if (routeRevision === authRouteRevisionRef.current) {
        if (__DEV__) console.warn('[AuthStartup] Profile retry unavailable', {
          error: summarizeStartupError(error),
        });
      }
      return 'error' as ProfileStatus;
    });

    if (routeRevision === authRouteRevisionRef.current) {
      setProfileStatus(nextProfileStatus);
    }
  }, [resolveProfileStatus, session]);

  const retryStartup = useCallback(() => {
    ++authRouteRevisionRef.current;
    setAuthBootstrapState({ status: 'loading' });
    setStartupRetryRevision(revision => revision + 1);
  }, []);

  // Lock on every fresh authentication (cold start / session restore)
  useEffect(() => {
    if (!isAuthenticated) {
      setIsAppLocked(false);
      return;
    }
    isAppLockEnabled().then(enabled => {
      if (enabled) setIsAppLocked(true);
    });
  }, [isAuthenticated]);

  // Mark pending lock when going to background; apply it only when the app
  // returns to foreground so the biometric prompt isn't fired while backgrounded
  // (which causes the dialog to hang and the overlay to get stuck on "Verifying…")
  useEffect(() => {
    if (!isAuthenticated) return;
    const pendingLock = { flag: false };
    const sub = AppState.addEventListener('change', async nextState => {
      if (nextState === 'background' || nextState === 'inactive') {
        const enabled = await isAppLockEnabled();
        if (enabled) pendingLock.flag = true;
      } else if (nextState === 'active' && pendingLock.flag) {
        pendingLock.flag = false;
        setIsAppLocked(true);
      }
    });
    return () => sub.remove();
  }, [isAuthenticated]);

  const handleIntroComplete = useCallback(() => {
    setIntroDone(true);
  }, []);

  const handleNavigateToLogin = useCallback(() => {
    setShowSignup(false);
  }, []);

  const handleNavigateToSignup = useCallback(() => {
    setShowSignup(true);
  }, []);

  return (
    <View style={styles.appContainer}>
      <ThemeProvider>
        <SafeAreaProvider>
          <ErrorBoundary>
            <NavigationContainer theme={navigationTheme}>
              {isAuthLoading ? (
                <AuthLoadingScreen />
              ) : isAuthenticated ? (
                profileStatus === 'complete' ? (
                  <RootNavigator />
                ) : profileStatus === 'incomplete' ? (
                  <ProfileScreen onProfileComplete={handleProfileComplete} />
                ) : (
                  <ProfileRouteStatusScreen status={profileStatus} onRetry={retryProfileCheck} />
                )
              ) : showSignup ? (
                <SignupScreen onNavigateToLogin={handleNavigateToLogin} />
              ) : (
                <LoginScreen
                  onNavigateToSignup={handleNavigateToSignup}
                  onAuthenticated={retryStartup}
                />
              )}
            </NavigationContainer>
          </ErrorBoundary>
          {isAuthenticated && isOfflineUnverified && profileStatus === 'complete' && (
            <View style={styles.offlineBanner}>
              <Text style={styles.offlineBannerText}>
                Offline mode. New transactions will sync when you are online.
              </Text>
            </View>
          )}
          <ThemedToast />

          {/* Render the global permission prompt only if user is fully authenticated and profile setup is done */}
          {introDone && authBootstrapState.status === 'authenticated_online' && profileStatus === 'complete' && <PermissionPrompt />}
        </SafeAreaProvider>
      </ThemeProvider>
      {!introDone && (
        <View style={styles.introOverlay}>
          <AppIntroScreen readyToExit={!isAuthLoading} onIntroComplete={handleIntroComplete} />
        </View>
      )}
      {/* App lock overlay — only shown after the intro finishes, so the
          animation plays without interruption, then fingerprint appears. */}
      {isAuthenticated && isAppLocked && introDone && (
        <View style={StyleSheet.absoluteFill}>
          <AppLockOverlay onUnlocked={() => setIsAppLocked(false)} />
        </View>
      )}
    </View>
  );
}

function AppLockOverlay({ onUnlocked }: { onUnlocked: () => void }) {
  const [unlocking, setUnlocking] = useState(false);
  const [failed, setFailed] = useState(false);
  const mountedRef = useRef(true);
  const onUnlockedRef = useRef(onUnlocked);
  useEffect(() => { onUnlockedRef.current = onUnlocked; }, [onUnlocked]);
  useEffect(() => () => { mountedRef.current = false; }, []);
  useEffect(() => {
    if (__DEV__) console.log('[AppLock] 🔒 AppLockOverlay mounted — fingerprint prompt appearing', startupMs());
  }, []);

  const tryUnlock = useCallback(async () => {
    if (unlocking) return;
    setUnlocking(true);
    setFailed(false);
    const result = await promptBiometricUnlock('Unlock SpendSense');
    if (!mountedRef.current) return;
    setUnlocking(false);
    if (result === 'success') {
      onUnlockedRef.current();
    } else {
      setFailed(result === 'error');
    }
  }, [unlocking]);

  // Auto-prompt on mount
  useEffect(() => { void tryUnlock(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={appLockStyles.overlay}>
      <MaterialCommunityIcons name="shield-lock" size={72} color="#8b5cf6" />
      <Text style={appLockStyles.title}>SpendSense is locked</Text>
      <Text style={appLockStyles.subtitle}>Your financial data is protected</Text>

      <TouchableOpacity
        style={[appLockStyles.fingerprintBtn, unlocking && appLockStyles.fingerprintBtnActive]}
        onPress={tryUnlock}
        disabled={unlocking}
        accessibilityRole="button"
        accessibilityLabel="Unlock with fingerprint"
      >
        <MaterialCommunityIcons
          name="fingerprint"
          size={52}
          color={unlocking ? '#6b7280' : '#8b5cf6'}
        />
      </TouchableOpacity>

      <Text style={appLockStyles.hint}>
        {unlocking
          ? 'Verifying…'
          : failed
          ? 'Authentication failed — tap to try again'
          : 'Touch fingerprint to unlock'}
      </Text>
    </View>
  );
}

const appLockStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: '#050509',
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    color: '#f8fafc',
    fontSize: 22,
    fontWeight: '700',
    marginTop: 24,
  },
  subtitle: {
    color: '#64748b',
    fontSize: 14,
    marginTop: 6,
  },
  fingerprintBtn: {
    marginTop: 52,
    padding: 22,
    borderRadius: 60,
    backgroundColor: 'rgba(139, 92, 246, 0.12)',
    borderWidth: 1.5,
    borderColor: 'rgba(139, 92, 246, 0.35)',
  },
  fingerprintBtnActive: {
    backgroundColor: 'rgba(139, 92, 246, 0.06)',
    borderColor: 'rgba(139, 92, 246, 0.15)',
  },
  hint: {
    color: '#64748b',
    fontSize: 13,
    marginTop: 20,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
});

export function AuthLoadingScreen() {
  return (
    <View style={styles.routeStatusContainer}>
      <ActivityIndicator size="large" color="#8b5cf6" />
      <Text style={styles.routeStatusTitle}>Preparing your session</Text>
      <Text style={styles.routeStatusText}>
        SpendSense is checking whether your saved login is still valid.
      </Text>
    </View>
  );
}

export function StartupRepairScreen({
  onRetry,
  onClearLocalCache,
}: {
  onRetry: () => void;
  onClearLocalCache: () => void;
}) {
  return (
    <View style={styles.routeStatusContainer}>
      <Text style={styles.routeStatusTitle}>Startup needs a retry</Text>
      <Text style={styles.routeStatusText}>
        SpendSense could not finish preparing your session. Retry, or clear the local startup cache and try again.
      </Text>
      <TouchableOpacity style={styles.retryButton} onPress={onRetry}>
        <Text style={styles.retryButtonText}>Retry</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.clearCacheButton} onPress={onClearLocalCache}>
        <Text style={styles.clearCacheButtonText}>Clear local startup cache</Text>
      </TouchableOpacity>
    </View>
  );
}

function ProfileRouteStatusScreen({
  status,
  onRetry,
}: {
  status: ProfileStatus;
  onRetry: () => void;
}) {
  const isError = status === 'error';

  return (
    <View style={styles.routeStatusContainer}>
      {!isError && <ActivityIndicator size="large" color="#8b5cf6" />}
      <Text style={styles.routeStatusTitle}>
        {isError ? 'Profile check needs a retry' : 'Checking your profile'}
      </Text>
      <Text style={styles.routeStatusText}>
        {isError
          ? 'We could not confirm your profile status. Retry once your connection is stable.'
          : 'Preparing the right screen for your account.'}
      </Text>
      {isError && (
        <TouchableOpacity style={styles.retryButton} onPress={onRetry}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  appContainer: {
    flex: 1,
    backgroundColor: APP_BACKGROUND_COLOR,
  },
  introOverlay: {
    position: 'absolute',
    top: 0, right: 0, bottom: 0, left: 0,
    backgroundColor: APP_BACKGROUND_COLOR,
  },
  routeStatusContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    backgroundColor: '#050509',
  },
  routeStatusTitle: {
    color: '#f8fafc',
    fontSize: 22,
    fontWeight: '800',
    marginTop: 18,
    textAlign: 'center',
  },
  routeStatusText: {
    color: '#94a3b8',
    fontSize: 14,
    lineHeight: 21,
    marginTop: 10,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 22,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#7c3aed',
  },
  retryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  clearCacheButton: {
    marginTop: 12,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  clearCacheButtonText: {
    color: '#c4b5fd',
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  offlineBanner: {
    position: 'absolute',
    left: 12,
    right: 12,
    top: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#1f2937',
  },
  offlineBannerText: {
    color: '#e5e7eb',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
});

export default App;
