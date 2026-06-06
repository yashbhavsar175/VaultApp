import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  View,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Video, { ResizeMode } from 'react-native-video';

declare const process: { env?: { NODE_ENV?: string } };

interface AppIntroScreenProps {
  readyToExit: boolean;
  onIntroComplete: () => void;
}

const MIN_INTRO_MS = 3700;
const MAX_INTRO_MS = 3700;
const SKIP_INTRO_ANIMATION = process.env?.NODE_ENV === 'test';
const SPLASH_VIDEO_SOURCE = SKIP_INTRO_ANIMATION
  ? undefined
  : require('../../assets/videos/splash.mp4');

export default function AppIntroScreen({ readyToExit, onIntroComplete }: AppIntroScreenProps) {
  const [reduceMotion, setReduceMotion] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const completeRef = useRef(false);
  const introReadyRef = useRef(false);
  const readyToExitRef = useRef(readyToExit);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const sceneOpacity = useRef(new Animated.Value(0)).current;
  const sceneLift = useRef(new Animated.Value(18)).current;

  const finishIntro = useCallback(() => {
    if (completeRef.current || !readyToExitRef.current) return;
    completeRef.current = true;
    onIntroComplete();
  }, [onIntroComplete]);

  const markIntroReady = useCallback(() => {
    introReadyRef.current = true;
    finishIntro();
  }, [finishIntro]);

  const handleVideoUnavailable = useCallback(() => {
    if (introReadyRef.current) return;
    setVideoFailed(true);
    timersRef.current.push(setTimeout(markIntroReady, MIN_INTRO_MS));
  }, [markIntroReady]);

  useEffect(() => {
    if (SKIP_INTRO_ANIMATION) return;

    let isMounted = true;

    AccessibilityInfo.isReduceMotionEnabled()
      .then(enabled => {
        if (isMounted) setReduceMotion(enabled);
      })
      .catch(() => undefined);

    const subscription = AccessibilityInfo.addEventListener?.('reduceMotionChanged', enabled => {
      setReduceMotion(enabled);
    });

    return () => {
      isMounted = false;
      subscription?.remove();
    };
  }, []);

  useEffect(() => {
    if (SKIP_INTRO_ANIMATION) return;

    readyToExitRef.current = readyToExit;
    if (introReadyRef.current) {
      finishIntro();
    }
  }, [finishIntro, readyToExit]);

  useEffect(() => {
    if (SKIP_INTRO_ANIMATION) {
      sceneOpacity.setValue(1);
      sceneLift.setValue(0);
      return;
    }

    if (reduceMotion) {
      sceneOpacity.setValue(1);
      sceneLift.setValue(0);
      timersRef.current.push(setTimeout(markIntroReady, MIN_INTRO_MS));
      timersRef.current.push(setTimeout(markIntroReady, MAX_INTRO_MS));
      return () => {
        timersRef.current.forEach(timer => clearTimeout(timer));
        timersRef.current = [];
      };
    }

    const introAnimation = Animated.parallel([
      Animated.timing(sceneOpacity, {
        toValue: 1,
        duration: 360,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(sceneLift, {
        toValue: 0,
        duration: 420,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);

    introAnimation.start();
    timersRef.current.push(setTimeout(markIntroReady, MIN_INTRO_MS));
    timersRef.current.push(setTimeout(markIntroReady, MAX_INTRO_MS));

    return () => {
      introAnimation.stop();
      timersRef.current.forEach(timer => clearTimeout(timer));
      timersRef.current = [];
    };
  }, [
    markIntroReady,
    reduceMotion,
    sceneLift,
    sceneOpacity,
  ]);

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['#050509', '#070b14', '#101827']}
        locations={[0, 0.58, 1]}
        style={StyleSheet.absoluteFill}
      />
      {!reduceMotion && !videoFailed && SPLASH_VIDEO_SOURCE && (
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            {
              opacity: sceneOpacity,
              transform: [{ translateY: sceneLift }],
            },
          ]}
        >
          <Video
            source={SPLASH_VIDEO_SOURCE}
            style={StyleSheet.absoluteFill}
            resizeMode={ResizeMode.COVER}
            repeat
            muted
            paused={false}
            playInBackground={false}
            playWhenInactive={false}
            ignoreSilentSwitch="ignore"
            onError={handleVideoUnavailable}
          />
        </Animated.View>
      )}
      {(reduceMotion || videoFailed) && (
        <>
          <View style={styles.softGlow} />
          <View style={styles.lowerGlow} />
          <Animated.View
            style={[
              styles.cardStack,
              {
                opacity: sceneOpacity,
                transform: [{ translateY: sceneLift }],
              },
            ]}
          >
            <View style={styles.backPlate} />
            <LinearGradient
              colors={['#161b2d', '#0d1320', '#05070d']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.frontPlate}
            >
              <View style={styles.metalLine} />
              <View style={styles.metalChip}>
                <View style={styles.chipLine} />
                <View style={styles.chipLineShort} />
              </View>
              <View style={styles.balanceRows}>
                <View style={styles.balanceRowWide} />
                <View style={styles.balanceRowNarrow} />
              </View>
            </LinearGradient>
          </Animated.View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    // TODO: Replace with useTheme() colors.* token
    backgroundColor: '#050509',
    overflow: 'hidden',
  },
  softGlow: {
    position: 'absolute',
    top: '18%',
    width: 320,
    height: 320,
    borderRadius: 160,
    // TODO: Replace with useTheme() colors.* token
    backgroundColor: 'rgba(99,102,241,0.18)',
    // TODO: Replace with useTheme() colors.* token
    shadowColor: '#818cf8',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 42,
    elevation: 18,
  },
  lowerGlow: {
    position: 'absolute',
    bottom: -120,
    width: 420,
    height: 240,
    borderRadius: 210,
    // TODO: Replace with useTheme() colors.* token
    backgroundColor: 'rgba(16,185,129,0.08)',
  },
  cardStack: {
    width: 210,
    height: 156,
    marginBottom: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backPlate: {
    position: 'absolute',
    width: 178,
    height: 116,
    borderRadius: 22,
    // TODO: Replace with useTheme() colors.* token
    backgroundColor: 'rgba(99,102,241,0.22)',
    borderWidth: 1,
    // TODO: Replace with useTheme() colors.* token
    borderColor: 'rgba(199,210,254,0.18)',
    transform: [{ rotateZ: '-9deg' }, { translateY: 8 }],
  },
  frontPlate: {
    width: 188,
    height: 122,
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    // TODO: Replace with useTheme() colors.* token
    borderColor: 'rgba(255,255,255,0.16)',
    // TODO: Replace with useTheme() colors.* token
    shadowColor: '#6366f1',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.28,
    shadowRadius: 28,
    elevation: 22,
  },
  metalLine: {
    width: 62,
    height: 4,
    borderRadius: 2,
    // TODO: Replace with useTheme() colors.* token
    backgroundColor: 'rgba(255,255,255,0.28)',
    marginBottom: 22,
  },
  metalChip: {
    width: 42,
    height: 32,
    borderRadius: 9,
    borderWidth: 1,
    // TODO: Replace with useTheme() colors.* token
    borderColor: 'rgba(251,191,36,0.72)',
    // TODO: Replace with useTheme() colors.* token
    backgroundColor: 'rgba(251,191,36,0.16)',
    justifyContent: 'center',
    paddingHorizontal: 8,
    gap: 5,
  },
  chipLine: {
    width: 24,
    height: 2,
    borderRadius: 1,
    // TODO: Replace with useTheme() colors.* token
    backgroundColor: 'rgba(253,230,138,0.9)',
  },
  chipLineShort: {
    width: 16,
    height: 2,
    borderRadius: 1,
    // TODO: Replace with useTheme() colors.* token
    backgroundColor: 'rgba(253,230,138,0.7)',
  },
  balanceRows: {
    position: 'absolute',
    right: 18,
    bottom: 20,
    alignItems: 'flex-end',
    gap: 8,
  },
  balanceRowWide: {
    width: 76,
    height: 5,
    borderRadius: 3,
    // TODO: Replace with useTheme() colors.* token
    backgroundColor: 'rgba(45,212,191,0.78)',
  },
  balanceRowNarrow: {
    width: 48,
    height: 5,
    borderRadius: 3,
    // TODO: Replace with useTheme() colors.* token
    backgroundColor: 'rgba(167,139,250,0.72)',
  },
});
