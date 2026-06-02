/**
 * Environment Configuration Example
 * 
 * Copy this file to env.ts and fill in your actual values.
 * 
 * Steps:
 * 1. Copy this file: cp src/config/env.example.ts src/config/env.ts
 * 2. Fill in your actual API keys and URLs in env.ts
 * 3. Never commit env.ts to version control
 */

// Supabase Configuration
export const SUPABASE_URL = 'https://your-project.supabase.co';
export const SUPABASE_ANON_KEY = 'your-supabase-anon-key-here';

// App Configuration
export const APP_NAME = 'SpendSense';
export const APP_VERSION = '1.0.0';

// Feature Flags
export const FEATURES = {
  AI_PARSING: true,
  SMS_AUTO_CAPTURE: false,
  GOOGLE_SIGNIN: true,
};
