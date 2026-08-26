-- Adds 'attendance_check' as a valid scheduled_messages.sequence_type —
-- a post-first-shift check-in ("how did you get on?"), scheduled alongside
-- offer_confirmation/start_reminder from sequence_scheduleOfferMessages()
-- in index.html whenever a candidate is booked with a start date.
--
-- Note: this message is outbound-only, same as every other sequence here.
-- "Mella" is an Alphanumeric Sender ID, which UK carriers do not route
-- replies back through — there's no real inbound number behind it. So
-- candidate replies can't be captured or auto-logged. Attendance is still
-- recorded manually via the existing "✓ Showed up / ✗ No show" buttons
-- (candidate_setAttendance()) in the candidate's Attendance tab. Real
-- two-way reply capture would need a genuine UK long code with an inbound
-- webhook — a separate piece of work, and the UK number search was
-- previously blocked by Twilio's regulatory bundle requirements (which is
-- why the alpha sender was used in the first place).

alter table public.scheduled_messages drop constraint scheduled_messages_sequence_type_check;
alter table public.scheduled_messages add constraint scheduled_messages_sequence_type_check
  check (sequence_type in (
    'interview_confirmation','interview_reminder',
    'no_answer_followup','offer_confirmation','start_reminder','attendance_check'
  ));
