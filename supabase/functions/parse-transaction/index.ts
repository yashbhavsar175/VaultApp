// Supabase Edge Function: parse-transaction
// Provider secrets stay in Supabase Function secrets and must never ship in the mobile app.

type TransactionType =
  | 'income'
  | 'expense'
  | 'investment'
  | 'emi'
  | 'lent'
  | 'borrowed'
  | 'transfer'
  | 'refund';

type ParsedTransaction = {
  amount: number;
  note: string;
  type: TransactionType;
  category: string;
};

const AI_TIMEOUT_MS = 15000;
const OPENAI_MODEL = Deno.env.get('OPENAI_MODEL') || 'gpt-4o-mini';
const MAX_TRANSACTION_TEXT_LENGTH = 2000;

const jsonHeaders = {
  'Content-Type': 'application/json',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: jsonHeaders,
  });
}

// Bug #H4 fix: verifyAuthenticatedRequest now returns the userId so the handler
// can use it for rate limiting without a second auth round-trip.
async function verifyAuthenticatedRequest(req: Request): Promise<{ authorized: false } | { authorized: true; userId: string }> {
  const authorization = req.headers.get('Authorization');
  if (!authorization || !authorization.startsWith('Bearer ')) {
    return { authorized: false };
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
  if (!supabaseUrl || !anonKey) {
    throw new Error('Supabase auth environment is not configured');
  }

  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      Authorization: authorization,
      apikey: anonKey,
    },
  });

  if (!response.ok) return { authorized: false };

  const body = await response.json().catch(() => null);
  const userId = typeof body?.id === 'string' ? body.id : null;
  if (!userId) return { authorized: false };

  return { authorized: true, userId };
}

const RATE_LIMIT_MAX_CALLS = 50;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

async function checkAndIncrementRateLimit(userId: string): Promise<boolean> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    // If rate-limit infra is not configured, fail open — don't block users.
    return true;
  }

  const tableUrl = `${supabaseUrl}/rest/v1/parse_transaction_rate_limits`;
  const headers = {
    'Content-Type': 'application/json',
    'apikey': serviceRoleKey,
    'Authorization': `Bearer ${serviceRoleKey}`,
    'Prefer': 'return=representation',
  };

  const getRes = await fetch(`${tableUrl}?user_id=eq.${encodeURIComponent(userId)}&select=call_count,window_start`, { headers });
  if (!getRes.ok) return true; // fail open on DB error

  const rows = await getRes.json().catch(() => []);
  const row = Array.isArray(rows) ? rows[0] : null;

  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
  const isInCurrentWindow = row && new Date(row.window_start) >= new Date(windowStart);

  if (isInCurrentWindow && row.call_count >= RATE_LIMIT_MAX_CALLS) {
    return false; // rate limited
  }

  const upsertPayload = isInCurrentWindow
    ? { user_id: userId, call_count: row.call_count + 1, window_start: row.window_start }
    : { user_id: userId, call_count: 1, window_start: new Date().toISOString() };

  await fetch(tableUrl, {
    method: 'POST',
    headers: { ...headers, 'Prefer': 'resolution=merge-duplicates' },
    body: JSON.stringify(upsertPayload),
  }).catch(() => undefined); // non-blocking — counter failure should not block the request

  return true;
}

function isTransactionType(value: unknown): value is TransactionType {
  return [
    'income',
    'expense',
    'investment',
    'emi',
    'lent',
    'borrowed',
    'transfer',
    'refund',
  ].includes(String(value));
}

function validateParsedTransaction(value: unknown): ParsedTransaction {
  const parsed = value as Partial<ParsedTransaction> | null;
  const amount = Number(parsed?.amount);

  if (!parsed || !Number.isFinite(amount) || amount <= 0) {
    throw new Error('AI response did not include a valid amount');
  }

  if (!isTransactionType(parsed.type)) {
    throw new Error('AI response did not include a valid transaction type');
  }

  const note = String(parsed.note || '').trim();
  if (!note) {
    throw new Error('AI response did not include a note');
  }

  return {
    amount,
    type: parsed.type,
    note,
    category: String(parsed.category || parsed.type).trim() || parsed.type,
  };
}

async function callOpenAI(text: string): Promise<ParsedTransaction> {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey || apiKey === 'your_openai_key_here') {
    throw new Error('OPENAI_API_KEY is not configured for parse-transaction');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        ...jsonHeaders,
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'Extract one personal-finance transaction from the user text. Return only JSON with amount, type, category, note. type must be one of income, expense, investment, emi, lent, borrowed, transfer, refund. Amount must be a positive number.',
          },
          { role: 'user', content: text },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI request failed with status ${response.status}`);
    }

    const body = await response.json();
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new Error('OpenAI response was missing content');
    }

    return validateParsedTransaction(JSON.parse(content));
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('AI parsing timed out after 15 seconds');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    const auth = await verifyAuthenticatedRequest(req);
    if (!auth.authorized) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const allowed = await checkAndIncrementRateLimit(auth.userId);
    if (!allowed) {
      return jsonResponse({ error: 'Rate limit exceeded. Try again in an hour.' }, 429);
    }

    const body = await req.json().catch(() => null);
    const text = String(body?.text || '').trim();

    if (!text) {
      return jsonResponse({ error: 'Transaction text is required' }, 400);
    }
    if (text.length > MAX_TRANSACTION_TEXT_LENGTH) {
      return jsonResponse({ error: 'Transaction text is too long' }, 413);
    }

    const parsed = await callOpenAI(text);
    return jsonResponse(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI parsing failed';
    console.error('[parse-transaction]', message);
    return jsonResponse({ error: message }, 500);
  }
});
