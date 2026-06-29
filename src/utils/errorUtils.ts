/**
 * Safely extracts a loggable error code from any error shape.
 * Handles Supabase/PostgREST errors (code), native errors (name), and unknown throwables.
 * Single source of truth — TransactionProcessors, notifications, scheduledNotifications
 * sabne apni copy rakh li thi (same logic), yahan merge kiya.
 */
export function safeErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return 'unknown_error';
  const value = (error as { code?: unknown; name?: unknown; status?: unknown }).code
    || (error as { name?: unknown }).name
    || (error as { status?: unknown }).status;
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48) || 'unknown_error'
    : 'unknown_error';
}
