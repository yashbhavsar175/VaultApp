// ═══════════════════════════════════════════════════════════════════════════════
// LIB MODULE - MAIN BARREL EXPORT
// Central export point for all lib modules
// ═══════════════════════════════════════════════════════════════════════════════

// Core utilities (supabase, auth, AI parser, basic DB operations)
export * from './core';

// Services (cache, notifications, porter)
export * from './services';

// Processors (SMS and notification transaction processing)
export * from './processors';

// Database operations (financial, userdata, vault)
export * from './database';
