// Single shared timestamp for measuring cold-start phases.
// Initialized when the module is first imported (very early in the JS bundle).
export const STARTUP_T0 = Date.now();
export const startupMs = () => `+${Date.now() - STARTUP_T0}ms`;
