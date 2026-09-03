# Elite Level Sales — Data Protection Pack

Working documents supporting GDPR and the Irish ePrivacy Regulations
(S.I. 336/2011). They pair with the technical controls built into the CRM
(`gdpr.js`): subject access, erasure, consent records, retention and audit.

| # | Document | What it's for |
|---|---|---|
| 01 | Lawful basis register | Why you may process each kind of data |
| 02 | Privacy notice | The text people actually see at capture |
| 03 | Processors & DPAs | Who handles your data, and the contracts you need |
| 04 | Record of Processing (Art. 30) | What a regulator asks for first |
| 05 | Retention schedule | How long you keep things, and why |
| 06 | Breach procedure | What to do in the first 72 hours |
| 07 | Subject request procedure | Handling access/erasure requests in time |

## Before these are real

Anything in **[SQUARE BRACKETS]** is a blank only you can fill — legal entity
name, registered address, contact email. Do not publish the privacy notice
with placeholders still in it.

**These are drafts, not legal advice.** They are thorough and specific to how
this CRM actually works, which puts you far ahead of a generic template — but
a solicitor or data protection advisor should review them before you rely on
them, particularly the lawful basis register.

## Order of work

1. Fill the placeholders in 01 and 02
2. Publish the privacy notice and link it from every capture point
3. Accept the four DPAs in 03 and record the dates
4. Set `retention_days` in CRM Settings to match 05
5. Keep 04 updated whenever you add a tool or a new purpose
