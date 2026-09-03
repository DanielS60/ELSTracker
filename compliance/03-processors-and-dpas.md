# Processors, DPAs and International Transfers

You are the **controller**. Each company below is a **processor** acting on
your instructions. Art. 28 requires a written contract with each one — you
cannot rely on a handshake or on their public privacy policy.

## Register

| Processor | What they do for you | Data they see | DPA in place | Date accepted |
|---|---|---|---|---|
| **Twilio** | Sends SMS, connects calls, optionally records | Phone numbers, message content, call audio | ☐ | |
| **Railway** | Hosts the CRM and its database | Everything in the CRM | ☐ | |
| **Typeform** | Application form | Name, email, phone, answers | ☐ | |
| **Calendly** | Call booking | Name, email, phone, booking answers | ☐ | |
| **GitHub** | Stores the source code | No lead data — code only | n/a | |

Tick each box and record the date once accepted. A regulator asking about
processors expects this table to exist and be current.

## Getting each DPA

Most are self-serve. None require a lawyer.

**Twilio** — their Data Protection Addendum is published at
`twilio.com/legal/data-protection-addendum`. For most accounts it is
incorporated automatically by their terms; check under Console → Legal and
record the version and date. If your account requires signature, request it
through support.

**Railway** — request a DPA via their support or legal contact. Smaller
platforms often issue one on request rather than publishing a click-through.
Do not skip this: Railway holds your entire database.

**Typeform** — available in the account area under legal or privacy settings;
accept and download the countersigned copy.

**Calendly** — published at `calendly.com/legal`, accepted through your
account settings.

> Links and processes change. Search each provider's site for "DPA" or "data
> processing addendum" rather than trusting a URL written here.

## Sub-processors

Each of these uses their own sub-processors (cloud hosting, carriers). Your DPA
should oblige them to notify you of changes. Twilio in particular passes
messages to mobile carriers, who are recipients in their own right — that's
normal and expected for SMS.

## International transfers

Twilio, Railway and Calendly involve transfers to the **United States**. Under
Chapter V you need a valid transfer mechanism for each:

1. **EU–US Data Privacy Framework** — check whether the provider is certified
   at `dataprivacyframework.gov`. If it is, record the certification.
2. **Standard Contractual Clauses** — if not certified, the DPA should
   incorporate SCCs. Confirm they are the 2021 EU Commission version.

Record what applies:

| Provider | Mechanism | Verified on |
|---|---|---|
| Twilio | ☐ DPF ☐ SCCs | |
| Railway | ☐ DPF ☐ SCCs | |
| Calendly | ☐ DPF ☐ SCCs | |

**Verify these yourself rather than assuming.** Certification status changes,
and companies drop off the DPF list. Your privacy notice tells people these
safeguards exist, so they need to actually be in place.

## Data minimisation note

Keeping this list short is itself a protection. Every additional tool is
another processor, another DPA, and another place your leads' phone numbers
live. Add tools deliberately.
