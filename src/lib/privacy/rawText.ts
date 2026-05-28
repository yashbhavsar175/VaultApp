export type RedactedRawTextKind = 'sms' | 'notification';

interface RedactedRawTextInput {
  kind: RedactedRawTextKind;
  text: string;
  sender?: string | null;
  source?: string | null;
  app?: string | null;
}

interface RedactedRawTextMetadata {
  kind: RedactedRawTextKind;
  sender?: string | null;
  source?: string | null;
  app?: string | null;
}

type TransactionRawTextLike = {
  raw_sms?: string | null;
  sms_source?: string | null;
  sms_sender?: string | null;
};

function normalizeForHash(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

function safeMetadataValue(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || /\d{7,}/.test(trimmed)) return undefined;

  return trimmed
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64) || undefined;
}

export function createRedactedRawTextRecord(input: RedactedRawTextInput): string {
  const normalizedText = normalizeForHash(input.text);
  const parts = [
    `redacted_${input.kind}`,
    `len=${input.text.length}`,
    `hash=${hashText(normalizedText)}`,
  ];

  const sender = safeMetadataValue(input.sender);
  const source = safeMetadataValue(input.source);
  const app = safeMetadataValue(input.app);

  if (sender) parts.push(`sender=${sender}`);
  if (source) parts.push(`source=${source}`);
  if (app) parts.push(`app=${app}`);

  return parts.join(' ');
}

export function isRedactedRawTextRecord(value?: string | null): boolean {
  return /^redacted_(?:sms|notification)\s/.test(value?.trim() || '');
}

export function ensureRedactedRawTextRecord(
  value: string | null | undefined,
  metadata: RedactedRawTextMetadata
): string {
  const rawValue = typeof value === 'string' ? value.trim() : '';
  if (isRedactedRawTextRecord(rawValue)) return rawValue;

  return createRedactedRawTextRecord({
    ...metadata,
    text: rawValue,
  });
}

export function sanitizeDebugBugReportEntry<T extends Record<string, any>>(report: T): T {
  const action = typeof report.type === 'string' ? report.type : '';
  const explicitKind = report.rawSmsKind === 'notification' || report.sourceType === 'notification'
    ? 'notification'
    : undefined;
  const kind: RedactedRawTextKind = explicitKind || (
    action.toLowerCase().includes('notification') ? 'notification' : 'sms'
  );

  return {
    ...report,
    rawSms: ensureRedactedRawTextRecord(report.rawSms, {
      kind,
      sender: typeof report.sender === 'string' ? report.sender : undefined,
      source: action || 'bug_report',
      app: typeof report.app === 'string' ? report.app : undefined,
    }),
    rawSmsKind: kind,
  };
}

export function sanitizeDebugBugReportsForPrivacy<T extends Record<string, any>>(reports: T[]): T[] {
  return reports.map(report => sanitizeDebugBugReportEntry(report));
}

function inferRawTextKindFromTransaction(transaction: TransactionRawTextLike): RedactedRawTextKind {
  const source = transaction.sms_source?.trim().toLowerCase() || '';
  const sender = transaction.sms_sender?.trim() || '';

  if (
    source === 'upi' ||
    source === 'notification' ||
    sender.includes('.') ||
    sender.toLowerCase().startsWith('com.')
  ) {
    return 'notification';
  }

  return 'sms';
}

export function sanitizeTransactionRawSmsForPrivacy<T extends TransactionRawTextLike>(transaction: T): T {
  const rawSms = transaction.raw_sms?.trim();
  if (!rawSms || isRedactedRawTextRecord(rawSms)) return transaction;

  const kind = inferRawTextKindFromTransaction(transaction);
  return {
    ...transaction,
    raw_sms: createRedactedRawTextRecord({
      kind,
      text: rawSms,
      sender: transaction.sms_sender,
      source: transaction.sms_source || 'historical_transaction',
      app: kind === 'notification' ? transaction.sms_sender : undefined,
    }),
  };
}

export function sanitizeTransactionRawSmsListForPrivacy<T extends TransactionRawTextLike>(transactions: T[]): T[] {
  return transactions.map(transaction => sanitizeTransactionRawSmsForPrivacy(transaction));
}
