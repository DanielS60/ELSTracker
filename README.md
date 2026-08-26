# Elite Level Sales — CRM

A lead pipeline with automated SMS sequences, built in the ELS brand.
**Zero npm dependencies** — it runs on Node's built-ins alone.

```bash
cd "/Users/danielreidy/Desktop/Sales/ELS/crm"
node server.js
```

Then open **http://localhost:4300**. Stop it with `Ctrl-C`.

Requires Node 22+ (uses the built-in `node:sqlite`). You're on v24 — fine.

---

## It starts in DRY RUN

Nothing is sent to anyone until you say so. In dry run, messages are queued,
personalised and logged exactly as they would be — they just never leave the
machine. You'll see a gold banner across the top while this is on.

Go live in **Settings**: paste your Twilio Account SID, Auth Token and From
number, then switch Mode to *Live*. The banner turns green.

---

## What's in it

| Section | What it does |
|---|---|
| **Dashboard** | Lead counts, pipeline breakdown, and the next messages due to go out |
| **Pipeline** | Kanban across the six stages. Click any lead to open it |
| **Contacts** | Searchable table, add leads, full detail drawer |
| **Message log** | Everything queued / sent / received / failed, with a manual "run queue" |
| **Automations** | Multi-step SMS sequences with delays, on a trigger |
| **Templates** | Reusable one-off messages |
| **Settings** | Twilio credentials, live/dry-run, quiet hours |

Stages: `New → Contacted → Booked → Showed → Closed / Lost`

---

## Automations

A sequence fires on one of two triggers:

- **When a new lead is added** — the moment a contact is created
- **When a lead moves to a stage** — e.g. as soon as you move someone to *Booked*

Each step has a delay in minutes and a message body. Two sequences ship enabled:

**New lead — instant follow-up**
1. immediately — intro from Kyle, with `Reply STOP to opt out`
2. +1 hour — "did you get a chance to grab a slot yet?"
3. +24 hours — "still keen?"

**Booked — show-up reminders**
1. immediately — confirmation, save this number
2. +24 hours — pre-call nudge

Personalise with `{{first_name}}`, `{{last_name}}`, `{{phone}}`, `{{email}}`.

---

## Calling leads

Click **Call [name]** in any lead's drawer. It uses a bridge, not a browser
softphone: Twilio rings **your** mobile first, you answer, and it then dials the
lead and connects you. That means it works from your phone as well as the desktop,
needs no microphone permissions, and the lead sees your Twilio number as caller ID.

Set **Settings → Your mobile** first — without it the call is refused, because
there'd be nothing to ring.

After each call, log the outcome from the drawer: `connected`, `no answer`,
`voicemail`, `booked`, `not interested`, `callback`, plus optional notes.
Twilio posts the real duration back to `/api/webhooks/twilio/voice-status` when
the call ends, so talk time is measured rather than estimated.

In dry run nothing dials — you get a message telling you which two numbers
*would* have been bridged.

---

## Weekly report

**Weekly report** in the sidebar. Runs Monday 00:00 → Sunday 23:59 local, with
prev / next / this-week navigation and a CSV export.

| Number | How it's counted |
|---|---|
| New leads | contacts created in the week |
| **Conversations had** | distinct leads who replied by SMS **or** actually connected on a call |
| SMS sent / replies received | outbound sent + inbound received |
| Dials made / connected | calls placed, and those with talk time or a connected outcome |
| Talk time | summed real call duration |
| **Calls booked / showed / closed** | stage transitions into Booked / Showed / Closed |
| Connect / show / close rate | connected÷dials, showed÷booked, closed÷showed |

A note on how this works: a contact's *current* stage can't tell you how many
were booked last week, so every stage change is recorded in a `stage_events`
table as it happens. **This only counts forward from now** — transitions that
happened before this was added don't exist, so your first full week of numbers
is the first week you run it.

CSV comes down as `els-weekly-YYYY-MM-DD.csv` with a `Metric,Value` pair per row,
ready to drop into Sheets.

---

## The compliance bits (don't remove these)

You're texting Irish consumers, so these are built in deliberately:

- **Consent** is recorded per contact and required before any automation fires.
- **STOP works automatically.** Point your Twilio number's *"A message comes in"*
  webhook at `http://your-host/api/webhooks/twilio/inbound`. On STOP / UNSUBSCRIBE /
  CANCEL / END / QUIT the contact is flagged opted-out **and every queued message
  for them is cancelled immediately**. START or UNSTOP re-subscribes them.
- **Quiet hours** default to 21:00–09:00. Anything that comes due inside the window
  is held and released at the end of it — so a lead who signs up at midnight gets
  their first text at 9am, not at 00:01.
- Opted-out contacts have the compose box removed entirely, not just disabled.

To expose the webhook while testing locally you'll need a tunnel
(`ngrok http 4300` or similar) — Twilio can't reach `localhost`.

---

## Phone numbers

Entered numbers are normalised to E.164 on save, defaulting to Ireland:
`087 123 4567` → `+353871234567`. Numbers already in `+…` or `00…` form are
respected as-is.

---

## Where the data lives

`data/crm.db` — a single SQLite file. Back it up by copying it.

| Table | Shape |
|---|---|
| `contacts` | `id, first_name, last_name, phone, email, status, source, notes, tags, consent_sms, opted_out, created_at, updated_at` |
| `messages` | `id, contact_id, direction(out/in), body, status, provider_sid, error, scheduled_for, sent_at, automation_id, created_at` |
| `automations` | `id, name, trigger_type, trigger_status, enabled, created_at` |
| `automation_steps` | `id, automation_id, step_order, delay_minutes, body` |
| `templates` | `id, name, body, created_at` |
| `settings` | `key, value` |

Message states: `queued → sent` (or `simulated` in dry run) / `failed` / `cancelled`;
inbound messages are `received`. Timestamps are ISO-8601 UTC.

---

## Connecting it to the website

The rebuilt site in `../website/` posts its lead form to a webhook. Point that
`WEBHOOK_URL` at this CRM instead and leads land in the pipeline automatically,
with the follow-up sequence firing on arrival:

```
POST http://your-host/api/contacts
{ "first_name": "Conor", "phone": "+353871234567", "email": "conor@example.ie", "source": "website" }
```

The field names already match what the site sends.

---

## Before you send a single real text

1. Buy a Twilio number that can send to Ireland and put it in Settings.
2. Send yourself one message first — add yourself as a lead in Live mode.
3. Check the quiet hours suit you (they run on *this machine's* local time).
4. Every Live send costs money, and messages over 160 characters count as
   multiple segments — the compose box shows the count as you type.

---

## Note on the brand

Colours and type come from `ELS Brand Guidelines.pptx`, not from the live site:
Elite Red `#CC1E1E`, Level Gold `#E8C040`, Sales Green `#22AA22`, Brand Black
`#0A0A0A`, Card `#1A1A1A`, Muted Grey `#888888`; Montserrat Black for display,
Carlito/Calibri for body. The live site currently renders a brighter green
(`#00E626`) than the brand guide specifies — this CRM uses the guide's value.
