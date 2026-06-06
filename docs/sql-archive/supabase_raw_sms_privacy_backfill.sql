-- Task 24F manual privacy backfill for historical transactions.raw_sms.
--
-- Review and back up the project before running. This intentionally updates
-- only rows that still have non-redacted raw_sms text. It preserves existing
-- parsed fields such as amount, note, reference_number, account_last4,
-- sms_sender, and sms_source.
-- The hash matches the app helper in src/lib/privacy/rawText.ts
-- (FNV-1a 32-bit over whitespace-normalized text) so duplicate checks that
-- compare redacted metadata keep working for historical rows.
--
-- Temporary helper for this SQL Editor session only:
create or replace function pg_temp.task24f_fnv1a_32(input_text text)
returns text
language plpgsql
immutable
as $$
declare
  normalized text := regexp_replace(btrim(coalesce(input_text, '')), '[[:space:]]+', ' ', 'g');
  hash_value bigint := 2166136261;
  index_value integer;
begin
  if char_length(normalized) = 0 then
    return lpad(to_hex(hash_value), 8, '0');
  end if;

  for index_value in 1..char_length(normalized) loop
    hash_value := ((hash_value # ascii(substr(normalized, index_value, 1))) * 16777619) % 4294967296;
  end loop;

  return lpad(to_hex(hash_value), 8, '0');
end;
$$;
--
-- Preflight count:
select count(*) as raw_sms_rows_to_redact
from public.transactions
where raw_sms is not null
  and btrim(raw_sms) <> ''
  and raw_sms !~ '^redacted_(sms|notification)\s';

-- Manual backfill:
update public.transactions
set raw_sms = concat(
  case
    when lower(coalesce(sms_source, '')) in ('upi', 'notification')
      or coalesce(sms_sender, '') like '%.%'
      then 'redacted_notification'
    else 'redacted_sms'
  end,
  ' len=', char_length(raw_sms),
  ' hash=', pg_temp.task24f_fnv1a_32(raw_sms),
  case
    when nullif(btrim(sms_sender), '') is not null
      and sms_sender !~ '\d{7,}'
      then concat(
        ' sender=',
        left(
          regexp_replace(
            regexp_replace(btrim(sms_sender), '[^A-Za-z0-9._-]+', '_', 'g'),
            '^_+|_+$',
            '',
            'g'
          ),
          64
        )
      )
    else ''
  end,
  case
    when nullif(btrim(sms_source), '') is not null
      and sms_source !~ '\d{7,}'
      then concat(
        ' source=',
        left(
          regexp_replace(
            regexp_replace(btrim(sms_source), '[^A-Za-z0-9._-]+', '_', 'g'),
            '^_+|_+$',
            '',
            'g'
          ),
          64
        )
      )
    else ''
  end
)
where raw_sms is not null
  and btrim(raw_sms) <> ''
  and raw_sms !~ '^redacted_(sms|notification)\s';

-- Postflight count should be 0:
select count(*) as raw_sms_rows_still_unredacted
from public.transactions
where raw_sms is not null
  and btrim(raw_sms) <> ''
  and raw_sms !~ '^redacted_(sms|notification)\s';
