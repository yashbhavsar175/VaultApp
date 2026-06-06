import 'react-native-gesture-handler';
import React, { useState, useEffect, useCallback, useRef } from 'react';
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
import { supabase, configureGoogleSignIn, syncOfflineTransactions } from './src/lib/core';
import { initializeForegroundListener } from './src/lib/services/notifications';
import { initPorterDistanceCalculator } from './src/lib/services/porter';
import PermissionPrompt from './src/components/modals/PermissionPrompt';
import { CACHE_KEYS, getCached, prefetchAllData } from './src/lib/services/cache';
import { ThemeProvider } from './src/context/ThemeContext';

const LEGACY_AUTH_TOKEN_KEY = 'supabase.auth.token';
const AUTH_STARTUP_TIMEOUT_MS = 4500;
const PROFILE_STARTUP_TIMEOUT_MS = 6000;
const AUTH_BOOTSTRAP_WATCHDOG_MS = 8000;
const STARTUP_CACHE_CLEAR_TIMEOUT_MS = 1500;
const APP_BACKGROUND_COLOR = '#050509';

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

export const summarizeStartupError = (error: unknown) => {
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
};

const isStartupTimeout = (error: unknown, label: string, timeoutMs: number) =>
  error instanceof Error && error.message === `${label} timed out after ${timeoutMs}ms`;

const toastConfig = {
  success: (props: any) => (
    <BaseToast
      {...props}
      style={{ borderLeftColor: '#10b981', backgroundColor: '#1e1e2e', borderRadius: 12, marginTop: 8 }}
      contentContainerStyle={{ paddingHorizontal: 15 }}
      text1Style={{ color: '#ffffff', fontSize: 14, fontWeight: '600' }}
      text2Style={{ color: '#a0a0b0', fontSize: 12 }}
    />
  ),
  error: (props: any) => (
    <ErrorToast
      {...props}
      style={{ borderLeftColor: '#ef4444', backgroundColor: '#1e1e2e', borderRadius: 12, marginTop: 8 }}
      contentContainerStyle={{ paddingHorizontal: 15 }}
      text1Style={{ color: '#ffffff', fontSize: 14, fontWeight: '600' }}
      text2Style={{ color: '#a0a0b0', fontSize: 12 }}
    />
  ),
  info: (props: any) => (
    <InfoToast
      {...props}
      style={{ borderLeftColor: '#6366f1', backgroundColor: '#1e1e2e', borderRadius: 12, marginTop: 8 }}
      contentContainerStyle={{ paddingHorizontal: 15 }}
      text1Style={{ color: '#ffffff', fontSize: 14, fontWeight: '600' }}
      text2Style={{ color: '#a0a0b0', fontSize: 12 }}
    />
  ),
};

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [introDone, setIntroDone] = useState(false);
  const [showSignup, setShowSignup] = useState(false);
  const [profileStatus, setProfileStatus] = useState<ProfileStatus>('unknown');
  const [startupRepairRequired, setStartupRepairRequired] = useState(false);
  const [startupRetryRevision, setStartupRetryRevision] = useState(0);
  const authRouteRevisionRef = useRef(0);
  const inFlightProfileCheckRef = useRef<{ userId: string; promise: Promise<ProfileStatus> } | null>(null);
  const prefetchedUserIdRef = useRef<string | null>(null);

  // Configure Google Sign-In once on app start
  useEffect(() => {
    configureGoogleSignIn();
  }, []);

  // One-time cleanup script for dirty transaction notes
  useEffect(() => {
    const cleanNames = async () => {
      if (!session?.user) return;
      try {
        const { data } = await supabase.from('transactions').select('id, note').eq('user_id', session.user.id);
        if (data) {
          let count = 0;
          for (const tx of data) {
            if (tx.note && /\b(?:deposited|credited|received)\b/i.test(tx.note)) {
              const newNote = tx.note.replace(/\b(?:deposited|credited|received)\b/ig, '').replace(/\s+/g, ' ').trim();
              await supabase.from('transactions').update({ note: newNote }).eq('id', tx.id);
              count++;
            }
          }
          if (count > 0) console.log(`✅ [Cleanup] Cleaned ${count} old transaction names!`);
        }
      } catch (e) {
        console.error('[Cleanup] Error cleaning names:', e);
      }
    };
    cleanNames();
  }, [session]);

  // Initialize native background helpers on app start
  useEffect(() => {
    initPorterDistanceCalculator();

    // Sync offline queue when app comes to foreground
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active') {
        syncOfflineTransactions()
          .then(() => console.log('✅ [OfflineSync] Foreground sync complete'))
          .catch(e => console.error('❌ [OfflineSync] Foreground sync error:', e));
      }
    });

    return () => {
      subscription.remove();
      // Note: Not stopping PorterDistanceCalculator here to allow it to continue
      // running in background scenarios where the app process remains active
    };
  }, []);

  // Offline sync: trigger whenever network reconnects
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      if (state.isConnected) {
        syncOfflineTransactions()
          .then(() => console.log('✅ [OfflineSync] Network reconnect sync complete'))
          .catch(e => console.error('❌ [OfflineSync] Network reconnect sync error:', e));
      }
    });
    return () => unsubscribe();
  }, []);

  // Initialize foreground listener for notifee events
  useEffect(() => {
    console.log('🚀 [App] Initializing foreground listener for notifications...');
    const unsubscribe = initializeForegroundListener();
    return () => {
      unsubscribe();
    };
  }, []);

  const getCachedProfileStatus = useCallback(async (nextSession: Session): Promise<ProfileStatus | null> => {
    try {
      const cached = await getCached<CachedProfile>(CACHE_KEYS.USER_PROFILE);
      const cachedProfile = cached?.data;
      return getCachedProfileRouteHint(cachedProfile, nextSession.user.id);
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
        console.warn('[AuthStartup] Live profile lookup failed', {
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
    const startupWatchdog = setTimeout(() => {
      if (!isMounted) return;
      ++authRouteRevisionRef.current;
      console.info('[AuthStartup] Bootstrap watchdog opened repair route', {
        timeoutMs: AUTH_BOOTSTRAP_WATCHDOG_MS,
      });
      setStartupRepairRequired(true);
      setAuthReady(true);
    }, AUTH_BOOTSTRAP_WATCHDOG_MS);
    const markAuthReady = () => {
      clearTimeout(startupWatchdog);
      setStartupRepairRequired(false);
      setAuthReady(true);
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
              console.warn('[AuthStartup] Cached profile route kept; live profile verification failed', {
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
            console.warn('[AuthStartup] Profile check unavailable', {
              error: summarizeStartupError(error),
            });
          }
        }
        return 'error';
      }
    };

    const initAuth = async () => {
      const startupRevision = authRouteRevisionRef.current;
      let sessionLoadTimedOut = false;

      try {
        void AsyncStorage.removeItem(LEGACY_AUTH_TOKEN_KEY).catch(() => undefined);

        const initialSessionPromise = supabase.auth.getSession();
        const initialSessionResult = await withStartupTimeout(
          initialSessionPromise,
          AUTH_STARTUP_TIMEOUT_MS,
          'Supabase session load',
        ).catch(error => {
          if (authRouteRevisionRef.current !== startupRevision) {
            return null;
          }

          sessionLoadTimedOut = isStartupTimeout(error, 'Supabase session load', AUTH_STARTUP_TIMEOUT_MS);
          console.warn(sessionLoadTimedOut
            ? '[AuthStartup] Session load timed out; waiting for late recovery'
            : '[AuthStartup] Session load fallback shows logged-out route', {
            error: summarizeStartupError(error),
          });

          void initialSessionPromise
            .then(async ({ data: { session: lateSession } }) => {
              if (!isMounted) return;
              if (!lateSession?.user) {
                if (authRouteRevisionRef.current === startupRevision) {
                  prefetchedUserIdRef.current = null;
                  setProfileStatus('unknown');
                  setSession(null);
                  markAuthReady();
                }
                return;
              }
              const routeRevision = ++authRouteRevisionRef.current;
              setSession(lateSession);
              setProfileStatus('checking');
              const nextProfileStatus = await resolveProfileRoute(lateSession, routeRevision);
              if (!isMounted || routeRevision !== authRouteRevisionRef.current) return;
              setProfileStatus(nextProfileStatus);
              prefetchForSession(lateSession);
              markAuthReady();
            })
            .catch(lateError => {
              console.warn('[AuthStartup] Late session recovery failed', {
                error: summarizeStartupError(lateError),
              });
            });

          return null;
        });
        if (!isMounted) return;

        if (authRouteRevisionRef.current !== startupRevision) {
          markAuthReady();
          return;
        }

        if (sessionLoadTimedOut) {
          return;
        }

        const initialSession = initialSessionResult?.data.session ?? null;
        if (initialSession?.user) {
          const routeRevision = ++authRouteRevisionRef.current;
          setSession(initialSession);
          setProfileStatus('checking');
          const nextProfileStatus = await resolveProfileRoute(initialSession, routeRevision);
          if (!isMounted || routeRevision !== authRouteRevisionRef.current) return;
          setProfileStatus(nextProfileStatus);
          prefetchForSession(initialSession); // Prefetch all data for instant screen loads
        } else {
          prefetchedUserIdRef.current = null;
          setProfileStatus('unknown');
          setSession(null);
        }
      } catch (error) {
        console.warn('[AuthStartup] Falling back to logged-out route', {
          error: summarizeStartupError(error),
        });
        if (!isMounted) return;
        prefetchedUserIdRef.current = null;
        setProfileStatus('unknown');
        setSession(null);
      }
      if (isMounted) {
        markAuthReady();
      }
    };

    initAuth();

    const deferredAuthTimers = new Set<ReturnType<typeof setTimeout>>();
    const applyAuthStateChange = async (nextSession: Session | null) => {
      const routeRevision = ++authRouteRevisionRef.current;
      if (nextSession?.user) {
        setSession(nextSession);
        setProfileStatus('checking');
        const nextProfileStatus = await resolveProfileRoute(nextSession, routeRevision);
        if (!isMounted || routeRevision !== authRouteRevisionRef.current) return;
        setProfileStatus(nextProfileStatus);
        prefetchForSession(nextSession);
      } else {
        if (!isMounted || routeRevision !== authRouteRevisionRef.current) return;
        prefetchedUserIdRef.current = null;
        setProfileStatus('unknown');
        setSession(null);
      }
      if (isMounted && routeRevision === authRouteRevisionRef.current) {
        markAuthReady();
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      const deferredTimer = deferAuthStateChange(() => {
        deferredAuthTimers.delete(deferredTimer);
        void applyAuthStateChange(nextSession).catch(error => {
          if (!isMounted) return;
          console.warn('[AuthStartup] Auth change route unavailable', {
            error: summarizeStartupError(error),
          });
          if (nextSession?.user) {
            setSession(nextSession);
            setProfileStatus('error');
          } else {
            prefetchedUserIdRef.current = null;
            setProfileStatus('unknown');
            setSession(null);
          }
          markAuthReady();
        });
      });
      deferredAuthTimers.add(deferredTimer);
    });

    return () => {
      isMounted = false;
      clearTimeout(startupWatchdog);
      deferredAuthTimers.forEach(clearTimeout);
      subscription.unsubscribe();
    };
  }, [getCachedProfileStatus, prefetchForSession, resolveProfileStatus, startupRetryRevision]);

  const handleProfileComplete = () => {
    setProfileStatus('complete');
  };

  const retryProfileCheck = useCallback(async () => {
    if (!session?.user) return;

    const routeRevision = ++authRouteRevisionRef.current;
    setProfileStatus('checking');

    const nextProfileStatus = await withStartupTimeout(
      resolveProfileStatus(session),
      PROFILE_STARTUP_TIMEOUT_MS,
      'Profile check',
    ).catch(async error => {
      const cachedStatus = await getCachedProfileStatus(session);
      if (routeRevision === authRouteRevisionRef.current) {
        if (cachedStatus) {
          console.warn('[AuthStartup] Profile retry unavailable; using cached profile route', {
            error: summarizeStartupError(error),
          });
        } else {
          console.warn('[AuthStartup] Profile retry unavailable', {
            error: summarizeStartupError(error),
          });
        }
      }
      return cachedStatus ?? 'error';
    });

    if (routeRevision === authRouteRevisionRef.current) {
      setProfileStatus(nextProfileStatus);
    }
  }, [getCachedProfileStatus, resolveProfileStatus, session]);

  const retryStartup = useCallback(() => {
    ++authRouteRevisionRef.current;
    setStartupRepairRequired(false);
    setAuthReady(false);
    setStartupRetryRevision(revision => revision + 1);
  }, []);

  const clearLocalStartupCache = useCallback(async () => {
    await withStartupTimeout(
      AsyncStorage.removeItem(CACHE_KEYS.USER_PROFILE),
      STARTUP_CACHE_CLEAR_TIMEOUT_MS,
      'Startup profile cache clear',
    ).catch(error => {
      console.warn('[AuthStartup] Local startup cache clear unavailable', {
        error: summarizeStartupError(error),
      });
    });
    retryStartup();
  }, [retryStartup]);

  const handleIntroComplete = useCallback(() => {
    setIntroDone(true);
  }, []);

  return (
    <View style={styles.appContainer}>
      {authReady && (
        <ThemeProvider>
          <SafeAreaProvider>
            <NavigationContainer theme={navigationTheme}>
              {startupRepairRequired ? (
                <StartupRepairScreen onRetry={retryStartup} onClearLocalCache={clearLocalStartupCache} />
              ) : session ? (
                profileStatus === 'complete' ? (
                  <RootNavigator />
                ) : profileStatus === 'incomplete' ? (
                  <ProfileScreen onProfileComplete={handleProfileComplete} />
                ) : (
                  <ProfileRouteStatusScreen status={profileStatus} onRetry={retryProfileCheck} />
                )
              ) : showSignup ? (
                <SignupScreen onNavigateToLogin={() => setShowSignup(false)} />
              ) : (
                <LoginScreen onNavigateToSignup={() => setShowSignup(true)} />
              )}
            </NavigationContainer>
            <Toast
              config={toastConfig}
              autoHide
              visibilityTime={3000}
              swipeable={false}
              onPress={() => Toast.hide()}
            />
            
            {/* Render the global permission prompt only if user is fully authenticated and profile setup is done */}
            {introDone && session && profileStatus === 'complete' && <PermissionPrompt />}
          </SafeAreaProvider>
        </ThemeProvider>
      )}
      {!introDone && (
        <View style={styles.introOverlay}>
          <AppIntroScreen readyToExit={authReady} onIntroComplete={handleIntroComplete} />
        </View>
      )}
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
    ...StyleSheet.absoluteFillObject,
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
});

export default App;
