import React, { useCallback, useEffect, useRef, useState } from 'react';
import { startupMs } from '../../lib/utils/startupTimer';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Image,
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

const MIN_INTRO_MS = 3700;       // fallback: intro ends here if video never loads
// 360ms fade-in + 3300ms play = 3660ms total — just under the 3700ms video length, no loop
const MIN_VIDEO_PLAY_MS = 3300;
const SKIP_INTRO_ANIMATION = process.env?.NODE_ENV === 'test';
const _splashRaw = SKIP_INTRO_ANIMATION ? undefined : require('../../assets/videos/splash.mp4');
// Resolve to a string URI so we can attach bufferConfig in the source object
const SPLASH_VIDEO_URI = _splashRaw !== undefined
  ? Image.resolveAssetSource(_splashRaw).uri
  : undefined;

export default function AppIntroScreen({ readyToExit, onIntroComplete }: AppIntroScreenProps) {
  const [reduceMotion, setReduceMotion] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const completeRef = useRef(false);
  const introReadyRef = useRef(false);
  const readyToExitRef = useRef(readyToExit);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // videoOpacity: 0 while loading, fades to 1 once first frame is ready
  const videoOpacity = useRef(new Animated.Value(0)).current;

  const finishIntro = useCallback(() => {
    if (completeRef.current || !readyToExitRef.current) return;
    completeRef.current = true;
    if (__DEV__) console.log('[Intro] ✅ onIntroComplete called — intro screen done', startupMs());
    onIntroComplete();
  }, [onIntroComplete]);

  const markIntroReady = useCallback(() => {
    if (__DEV__) console.log('[Intro] ⏱ markIntroReady called', startupMs());
    introReadyRef.current = true;
    finishIntro();
  }, [finishIntro]);

  const handleVideoReady = useCallback(() => {
    if (completeRef.current) return;
    if (__DEV__) console.log('[Intro] 🎥 Video ready — fading in', startupMs());
    timersRef.current.forEach(t => clearTimeout(t));
    timersRef.current = [];
    Animated.timing(videoOpacity, {
      toValue: 1,
      duration: 360,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (__DEV__ && finished) console.log('[Intro] ✨ Video fade-in complete', startupMs());
      timersRef.current.push(setTimeout(markIntroReady, MIN_VIDEO_PLAY_MS));
    });
  }, [videoOpacity, markIntroReady]);

  const handleVideoUnavailable = useCallback(() => {
    if (__DEV__) console.log('[Intro] ⚠️ Video failed — dark background until fallback timer', startupMs());
    setVideoFailed(true);
  }, []);

  // Accessibility: reduce motion listener
  useEffect(() => {
    if (SKIP_INTRO_ANIMATION) return;
    let isMounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then(enabled => { if (isMounted) setReduceMotion(enabled); })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener?.('reduceMotionChanged', enabled => {
      setReduceMotion(enabled);
    });
    return () => {
      isMounted = false;
      subscription?.remove();
    };
  }, []);

  // Sync readyToExit into ref so finishIntro can check without stale closure
  useEffect(() => {
    if (SKIP_INTRO_ANIMATION) return;
    readyToExitRef.current = readyToExit;
    if (introReadyRef.current) {
      finishIntro();
    }
  }, [finishIntro, readyToExit]);

  // Fallback timer: ends intro at MIN_INTRO_MS if video never loads
  useEffect(() => {
    if (__DEV__) console.log('[Intro] 🎬 AppIntroScreen mounted', startupMs());

    if (SKIP_INTRO_ANIMATION) {
      videoOpacity.setValue(0);
      return;
    }

    timersRef.current.push(setTimeout(markIntroReady, MIN_INTRO_MS));

    return () => {
      timersRef.current.forEach(t => clearTimeout(t));
      timersRef.current = [];
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['#050509', '#070b14', '#101827']}
        locations={[0, 0.58, 1]}
        style={StyleSheet.absoluteFill}
      />

      {/* Video fades in once first frame is ready; dark gradient shows underneath while loading */}
      {!reduceMotion && !videoFailed && SPLASH_VIDEO_URI && (
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: videoOpacity }]}>
          <Video
            source={{
              uri: SPLASH_VIDEO_URI,
              bufferConfig: {
                minBufferMs: 1000,
                maxBufferMs: 5000,
                bufferForPlaybackMs: 50,
                bufferForPlaybackAfterRebufferMs: 100,
              },
            }}
            style={StyleSheet.absoluteFill}
            resizeMode={ResizeMode.COVER}
            repeat={false}
            muted
            paused={false}
            playInBackground={false}
            playWhenInactive={false}
            ignoreSilentSwitch="ignore"
            onReadyForDisplay={handleVideoReady}
            onError={handleVideoUnavailable}
          />
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050509',
    overflow: 'hidden',
  },
});
