# Handling Data Subject Requests

**You have one month to respond.** Extendable by two further months for
genuinely complex requests, but you must tell the person within the first month
that you're extending and why.

No fee, unless the request is manifestly unfounded or excessive.

## Requests can arrive anywhere

Email, a text reply, an Instagram DM, or in conversation. There is no required
form of words — "delete my details" in a DM is a valid erasure request and the
clock starts then. Make sure anyone handling the Instagram account knows to
forward these to **[PRIVACY EMAIL]** the same day.

## Log every request

| Date received | Person | Type | Identity verified | Due date | Completed | Notes |
|---|---|---|---|---|---|---|
| | | | | | | |

## Verifying identity

Confirm they are who they say before disclosing anything — sending someone's
data to an impersonator is itself a breach. For this business, a reply from the
email address or phone number already on the record is usually enough. Don't
demand ID documents by reflex; that collects more data than you need.

## Access request (Art. 15)

1. Find the contact in the CRM
2. Open their record → **Export data**
3. Send them the JSON file, plus a plain-English summary of what it contains
   and the retention periods from doc 05

The export includes their record, all messages, all calls, stage history,
consent history, and the log of who accessed their data.

## Erasure request (Art. 17)

1. Verify identity
2. Check for financial records — if you have invoices, those must be kept for
   6 years. Delete everything else and tell them exactly that
3. Open their record → **Erase** (admin only)
4. Confirm in writing that it's done

Erasure removes the contact, messages, calls, stage history and consent
records, and adds a salted hash of their phone and email to the suppression
list so no future import or webhook can re-create them.

## Objection / withdrawing consent (Art. 21, Art. 7(3))

Simplest case: **replying STOP to a text** is handled automatically — the
contact is opted out and every queued message cancelled. Nothing further needed.

For a broader objection, record it against the contact and stop the relevant
processing. Note that objecting to marketing is absolute; you cannot weigh it
against your interests.

## Rectification (Art. 16)

Correct the record and confirm. If the wrong data went to a processor, tell
them too.

## Portability (Art. 20)

The same JSON export satisfies this — it's structured and machine-readable.

## When you can refuse

Rarely. If you genuinely believe a request is unfounded or excessive, you must
still respond within a month explaining why and telling them they may complain
to the DPC. Get advice before refusing — this is the area most likely to turn
into a complaint.
