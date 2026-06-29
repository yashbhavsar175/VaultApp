declare module 'react-native-config' {
  export interface NativeConfig {
    SUPABASE_URL?: string;
    SUPABASE_PUBLISHABLE_KEY?: string;
    GOOGLE_WEB_CLIENT_ID?: string;
    APP_NAME?: string;
    APP_VERSION?: string;
  }

  export const Config: NativeConfig;
  export default Config;
}
