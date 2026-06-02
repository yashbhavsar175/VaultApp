/**
 * Type augmentation for react-native-config
 * Maps every key in .env to a typed property on NativeConfig.
 * All values are `string | undefined` — they are undefined if the key
 * is missing from the .env file (e.g., on CI or a fresh clone).
 *
 * Add new keys here whenever you add them to .env.
 */
declare module 'react-native-config' {
  interface NativeConfig {
    // Supabase
    SUPABASE_URL?: string;
    SUPABASE_ANON_KEY?: string;

    // Google
    GOOGLE_WEB_CLIENT_ID?: string;
    GOOGLE_MAPS_API_KEY?: string;

    // App metadata
    APP_NAME?: string;
    APP_VERSION?: string;
  }
}

export {};
