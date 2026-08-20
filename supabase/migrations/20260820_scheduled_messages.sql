-- scheduled_messages: single source of truth for every automated SMS the
-- app sends (interview reminders, no-answer chase, "got the job"
-- start-date confirmation + day-before check-in). See index.html's
-- "MESSAGE SEQUENCES" block for what writes/reads this table.
--
-- candidate_id is text, not uuid — candidate ids come from newId()
-- (Date.now().toString(36) + a few random base36 chars), not real UUIDs.
--
-- Run this once Supabase project access (ref ttxokegaunuiwvjtpdnb) is
-- connected — via the SQL editor, the Supabase CLI, or the Supabase MCP's
-- apply_migration.

create table if not exists public.scheduled_messages (
  id uuid primary key default gen_random_uuid(),
  candidate_id text not null,
  role text not null check (role in ('manufacturing','site')),
  sequence_type text not null check (sequence_type in (
    'interview_confirmation','interview_reminder',
    'no_answer_followup','offer_confirmation','start_reminder'
  )),
  message_body text not null,       -- resolved text at insert time, not a template ref
  to_number text not null,          -- E.164, normalized client-side before insert
  scheduled_for timestamptz not null,
  status text not null default 'pending' check (status in ('pending','sent','failed','cancelled')),
  sent_at timestamptz,
  twilio_sid text,
  error text,
  created_at timestamptz not null default now()
);

-- Used by the dispatch Edge Function's due-message query.
create index if not exists scheduled_messages_dispatch_idx
  on public.scheduled_messages (status, scheduled_for)
  where status = 'pending';

-- Used by the candidate detail card's message-audit trail.
create index if not exists scheduled_messages_candidate_idx
  on public.scheduled_messages (candidate_id, created_at desc);

alter table public.scheduled_messages enable row level security;

-- Matches hub_data's existing posture: this is a single-user internal tool
-- with no auth layer anywhere in the app, and candidates/hub_data are
-- already open to the public anon key by design. This policy intentionally
-- mirrors that same posture rather than silently tightening or loosening
-- it. If hub_data's actual policy turns out to differ once you can inspect
-- it directly, adjust this to match.
create policy "anon full access (matches hub_data posture)"
  on public.scheduled_messages
  for all
  to anon
  using (true)
  with check (true);

-- ---------------------------------------------------------------------
-- pg_cron dispatch schedule — run this section AFTER the send-messages
-- Edge Function has been deployed and its Twilio secrets are set
-- (Phase C). Replace <project-ref> and <anon-or-service-role-key> below.
-- ---------------------------------------------------------------------
-- create extension if not exists pg_cron;
-- create extension if not exists pg_net;
--
-- select cron.schedule(
--   'dispatch-scheduled-messages',
--   '*/10 * * * *',
--   $$
--   select net.http_post(
--     url := 'https://<project-ref>.supabase.co/functions/v1/send-messages',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'Authorization', 'Bearer <anon-or-service-role-key>'
--     ),
--     body := jsonb_build_object('mode', 'dispatch')
--   );
--   $$
-- );
