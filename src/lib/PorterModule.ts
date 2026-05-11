import { NativeModules, NativeEventEmitter, Platform } from 'react-native';

const { PorterModule } = NativeModules;

export const isAccessibilityServiceEnabled = async (): Promise<boolean> => {
  if (Platform.OS !== 'android') return false;
  return await PorterModule.isAccessibilityServiceEnabled();
};

export const openAccessibilitySettings = () => {
  if (Platform.OS === 'android') {
    PorterModule.openAccessibilitySettings();
  }
};

export const showToastOverlay = (message: string) => {
  if (Platform.OS === 'android') {
    PorterModule.showToastOverlay(message);
  }
};

// You can subscribe to this event emitter in your component
// const subscription = porterEventEmitter.addListener('onPorterScreenChange', (event) => {
//   console.log(event.packageName, event.textContent);
// });
// export const porterEventEmitter = new NativeEventEmitter(PorterModule);
