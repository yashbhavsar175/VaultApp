/**
 * Configuration Module
 * Consolidated: env.ts + constants/bankLogos.ts
 * 
 * Contains:
 * - Environment configuration (Supabase, API keys)
 * - Bank information (colors, emojis, domains)
 * - App configuration and feature flags
 */

import Config from 'react-native-config';

// ═══════════════════════════════════════════════════════════════════════════════
// ENVIRONMENT CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Environment variables are now loaded from .env file using react-native-config
 * This keeps sensitive API keys out of version control.
 * 
 * Setup:
 * 1. Copy .env.example to .env
 * 2. Fill in your actual API keys in .env
 * 3. Never commit .env to git (it's in .gitignore)
 */

// Supabase Configuration
export const SUPABASE_URL = Config.SUPABASE_URL!;
export const SUPABASE_ANON_KEY = Config.SUPABASE_ANON_KEY!;

// AI Configuration
export const GEMINI_API_KEY = Config.GEMINI_API_KEY!;
export const OPENAI_API_KEY = Config.OPENAI_API_KEY!; // Not currently used

// Google Sign-In Configuration
export const GOOGLE_WEB_CLIENT_ID = Config.GOOGLE_WEB_CLIENT_ID!;

// App Configuration
export const APP_NAME = Config.APP_NAME || 'SpendSense';
export const APP_VERSION = Config.APP_VERSION || '1.0.0';

// Feature Flags
export const FEATURES = {
  AI_PARSING: true,
  SMS_AUTO_CAPTURE: false, // Not yet implemented
  GOOGLE_SIGNIN: true,
};

// AI Provider Selection
export const AI_PROVIDER: 'openai' | 'gemini' = 'gemini';

// ═══════════════════════════════════════════════════════════════════════════════
// BANK INFORMATION
// ═══════════════════════════════════════════════════════════════════════════════

export const BANK_INFO: Record<string, { color: string; emoji: string }> = {
  'sbi': { color: '#1B4F9B', emoji: '🏦' },
  'state bank': { color: '#1B4F9B', emoji: '🏦' },
  'hdfc': { color: '#004C8F', emoji: '🏦' },
  'icici': { color: '#F58220', emoji: '🏦' },
  'axis': { color: '#800000', emoji: '🏦' },
  'kotak': { color: '#EF3E33', emoji: '🏦' },
  'yes bank': { color: '#0033A0', emoji: '🏦' },
  'pnb': { color: '#1B3A6B', emoji: '🏦' },
  'punjab national': { color: '#1B3A6B', emoji: '🏦' },
  'bank of baroda': { color: '#F68B1F', emoji: '🏦' },
  'bob': { color: '#F68B1F', emoji: '🏦' },
  'canara': { color: '#F7941D', emoji: '🏦' },
  'union bank': { color: '#005DAA', emoji: '🏦' },
  'idfc': { color: '#97144D', emoji: '🏦' },
  'idbi': { color: '#1B4F9B', emoji: '🏦' },
  'indusind': { color: '#98272A', emoji: '🏦' },
  'federal': { color: '#005DAA', emoji: '🏦' },
  'rbl': { color: '#003087', emoji: '🏦' },
  'bandhan': { color: '#D32F2F', emoji: '🏦' },
  'paytm': { color: '#00BAF2', emoji: '💳' },
  'phonepe': { color: '#5F259F', emoji: '📱' },
  'gpay': { color: '#4285F4', emoji: '📱' },
  'google pay': { color: '#4285F4', emoji: '📱' },
  'slice': { color: '#FF4D6D', emoji: '💳' },
  'fi': { color: '#00D09C', emoji: '💚' },
  'jupiter': { color: '#6C5CE7', emoji: '🪐' },
  'niyo': { color: '#00C9A7', emoji: '💳' },
  'cash': { color: '#10b981', emoji: '💵' },
};

// Keep BANK_DOMAINS for autocomplete suggestions
export const BANK_DOMAINS: Record<string, string | null> = {
  'sbi': 'sbi.co.in',
  'state bank': 'sbi.co.in',
  'hdfc': 'hdfcbank.com',
  'icici': 'icicibank.com',
  'axis': 'axisbank.com',
  'kotak': 'kotak.com',
  'yes bank': 'yesbank.in',
  'pnb': 'pnbindia.in',
  'punjab national': 'pnbindia.in',
  'bank of baroda': 'bankofbaroda.in',
  'bob': 'bankofbaroda.in',
  'canara': 'canarabank.com',
  'union bank': 'unionbankofindia.co.in',
  'idfc': 'idfcfirstbank.com',
  'idbi': 'idbi.com',
  'indusind': 'indusind.com',
  'federal': 'federalbank.co.in',
  'rbl': 'rblbank.com',
  'bandhan': 'bandhanbank.com',
  'paytm': 'paytm.com',
  'phonepe': 'phonepe.com',
  'gpay': 'pay.google.com',
  'google pay': 'pay.google.com',
  'slice': 'sliceit.com',
  'fi': 'fi.money',
  'jupiter': 'jupitermoney.com',
  'niyo': 'niyoglobal.com',
  'cash': null,
};

export const getBankColor = (bankName: string): string => {
  const lower = bankName.toLowerCase();
  for (const [key, info] of Object.entries(BANK_INFO)) {
    if (lower.includes(key)) return info.color;
  }
  return '#7c3aed'; // default purple
};

export const getBankEmoji = (bankName: string): string => {
  const lower = bankName.toLowerCase();
  for (const [key, info] of Object.entries(BANK_INFO)) {
    if (lower.includes(key)) return info.emoji;
  }
  return '🏦'; // default
};

export const getBankSuggestions = (query: string): string[] => {
  if (!query || query.length < 1) return [];
  
  // Sanitize input to prevent issues with special characters
  const sanitized = query.replace(/[^a-zA-Z\s]/g, '').toLowerCase();
  
  if (!sanitized) return [];
  
  const suggestions = Object.keys(BANK_DOMAINS)
    .filter(key => key.toLowerCase().includes(sanitized))
    .map(key => {
      // Capitalize first letter of each word
      return key.split(' ').map(word => 
        word.charAt(0).toUpperCase() + word.slice(1)
      ).join(' ');
    })
    .filter((value, index, self) => self.indexOf(value) === index) // Remove duplicates
    .slice(0, 5);
  
  return suggestions;
};
