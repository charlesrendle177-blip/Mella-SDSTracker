// Twilio dispatch/immediate-send Edge Function for scheduled_messages.
// Deno edge runtime — fetch only, no Twilio SDK.
//
// Two invocation modes, both funnelling through sendOne():
//   { mode: 'dispatch' }         — cron-invoked, sends every due 'pending' row.
//   { mode: 'immediate', id }    — frontend-invoked right after an
//                                   immediate-type row is inserted, so it
//                                   doesn't have to wait for the next cron tick.
//
// Stateless by design: this function only ever touches scheduled_messages,
// never candidate data — phone normalization and message copy are resolved
// client-side before a row is ever inserted (see index.html's
// sequence_schedule()).
//
// Required secrets (Supabase → Edge Functions → secrets):
//   TWILIO_ACCOUNT_SID
//   TWILIO_AUTH_TOKEN
//   TWILIO_MESSAGING_SERVICE_SID
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are auto-injected by Supabase.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// The frontend calls this function directly from the browser (GitHub Pages
// origin) right after inserting an immediate-type scheduled_messages row —
// without these headers the browser blocks the request at the CORS
// preflight before it ever reaches this function, and index.html's
// sb.functions.invoke(...).catch(() => {}) swallows that silently.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID')!;
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN')!;
const TWILIO_MESSAGING_SERVICE_SID = Deno.env.get('TWILIO_MESSAGING_SERVICE_SID')!;

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

async function sendOne(row: { id: string; to_number: string; message_body: string }) {
  const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
  const body = new URLSearchParams({
    To: row.to_number,
    MessagingServiceSid: TWILIO_MESSAGING_SERVICE_SID,
    Body: row.message_body
  });

  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body
      }
    );
    const json = await res.json();
    if (!res.ok) {
      await supabase.from('scheduled_messages')
        .update({ status: 'failed', error: json.message || `Twilio ${res.status}` })
        .eq('id', row.id);
      return;
    }
    await supabase.from('scheduled_messages')
      .update({ status: 'sent', sent_at: new Date().toISOString(), twilio_sid: json.sid })
      .eq('id', row.id);
  } catch (err) {
    await supabase.from('scheduled_messages')
      .update({ status: 'failed', error: String(err) })
      .eq('id', row.id);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  let body: { mode?: string; id?: string } = {};
  try { body = await req.json(); } catch { /* empty body is fine for neither mode */ }

  if (body.mode === 'immediate' && body.id) {
    const { data: row, error } = await supabase.from('scheduled_messages')
      .select('id, to_number, message_body, status')
      .eq('id', body.id)
      .single();
    if (error || !row || row.status !== 'pending') {
      return new Response(JSON.stringify({ ok: false, error: error?.message || 'row not pending' }), { status: 200, headers: corsHeaders });
    }
    await sendOne(row);
    return new Response(JSON.stringify({ ok: true, sent: 1 }), { status: 200, headers: corsHeaders });
  }

  if (body.mode === 'dispatch') {
    const { data: rows, error } = await supabase.from('scheduled_messages')
      .select('id, to_number, message_body')
      .eq('status', 'pending')
      .lte('scheduled_for', new Date().toISOString())
      .order('scheduled_for')
      .limit(50);
    if (error) return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 200, headers: corsHeaders });
    for (const row of rows || []) await sendOne(row);
    return new Response(JSON.stringify({ ok: true, sent: (rows || []).length }), { status: 200, headers: corsHeaders });
  }

  return new Response(JSON.stringify({ ok: false, error: 'unknown mode' }), { status: 400, headers: corsHeaders });
});
