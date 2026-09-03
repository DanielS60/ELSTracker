# Retention Schedule

Storage limitation (Art. 5(1)(e)) means keeping personal data no longer than
necessary. "We might need it someday" is not a purpose. Indefinite retention
of lead data is one of the more common findings against small businesses.

| Data | Keep for | Why | Enforced by |
|---|---|---|---|
| Applicant who never joined | **60 days** from last contact | Realistic window for a lead to come back | CRM `retention_days` |
| Member record | Membership + **[24] months** | Support, disputes, testimonials | Manual |
| SMS content and delivery status | **[24] months** | Prove what was sent and consented to | Deleted with the contact |
| Call metadata | **[24] months** | Same | Deleted with the contact |
| Call recordings | **[90] days** | Training value decays quickly; risk doesn't | Twilio auto-delete |
| Invoices and financial records | **6 years** | Revenue requirement | Manual — **overrides erasure** |
| Audit log | **[12] months** | Accountability | Manual |
| Suppression hashes | Indefinite | The only way to honour "never contact me again" | Permanent by design |

## Turning it on

CRM → **Settings → retention_days**. Set to `60`. The sweep runs
hourly and only removes contacts in **New** or **Lost** that haven't been
touched since the cutoff — live deals and members are never swept by a timer.

`0` disables it, which is the default. **Leaving it at 0 is a compliance
weakness**, not a neutral choice.

## The financial records exception

If someone asks for erasure but you hold invoices for them, you must keep the
financial records — Art. 17(3)(b) — while deleting everything else. Tell them
that plainly in your response and say when the remainder will go.

## Review

Check yearly that the periods still match reality. If leads never convert after
12 months, 24 is too long and you should shorten it.
