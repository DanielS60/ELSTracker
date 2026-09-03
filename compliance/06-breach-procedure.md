# Personal Data Breach Procedure

**You have 72 hours from becoming aware of a breach to notify the DPC.**
The clock starts at awareness, not at confirmation. Being unsure of the full
scope is not a reason to delay — you can file an initial notification and
follow up.

Breach owner: **Kyle Cooke** · Deputy: **[NAME]**

---

## What counts as a breach

Not just hacking. Any accidental or unlawful destruction, loss, alteration,
unauthorised disclosure of, or access to personal data. Realistic examples here:

- The CRM database is exposed or downloaded by someone unauthorised
- An SMS sequence sends to the wrong list
- A laptop with an active CRM session is lost or stolen
- Someone's account stays active after they leave and is misused
- Twilio, Railway, Typeform or Calendly reports a breach to you
- An export containing lead data is emailed to the wrong person

## Step 1 — Contain (immediately)

- Change `APP_PASSWORD` / rotate `SESSION_SECRET` to invalidate all sessions
- Rotate Twilio credentials in the Twilio console and update Railway variables
- Disable or delete the compromised account under **Team & access**
- If it's the host: take the service offline rather than leave data exposed
- **Do not delete evidence.** Preserve logs — you need them, and destroying
  them makes everything worse

## Step 2 — Assess (same day)

Record in the breach log:

- What happened, and when you became aware
- Categories and rough number of people affected
- Categories and volume of data (names? phone numbers? call recordings?)
- Likely consequences for those people
- What you've done already

The CRM's audit log (**admin → GDPR audit**) shows who accessed or exported
what, which is usually where this assessment starts.

## Step 3 — Notify the DPC (within 72 hours)

Notify unless the breach is **unlikely to result in a risk** to people's rights
and freedoms. Given this system holds names, phone numbers, emails and
conversation notes, most breaches here will meet the threshold. If in doubt,
notify — under-reporting is treated far more harshly than over-reporting.

**Data Protection Commission** — report via the online form at
`forms.dataprotection.ie`
6 Pembroke Row, Dublin 2, D02 X963 · +353 1 765 0100

If you're past 72 hours, still notify, and explain the delay.

## Step 4 — Tell the individuals

Required when the breach is likely to result in a **high risk** to them.
Communicate directly, in plain language: what happened, likely consequences,
what you're doing, and who they can contact.

For this system, high risk would include a full export of lead records, or any
loss of call recordings.

## Step 5 — Record it

**Every breach goes in the log below, including ones you decide not to
report.** Art. 33(5) requires the record regardless, and the reasoning for a
decision not to notify is exactly what gets scrutinised later.

## Breach log

| Date aware | What happened | People affected | Data | DPC notified? | Individuals told? | Reasoning | Actions taken |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

## Prevention already in place

Password-protected accounts with admin approval; admin-only erasure and audit;
audit logging of exports and deletions; secrets held as environment variables
rather than in the database; signed webhooks; no lead data in the Git repo.
