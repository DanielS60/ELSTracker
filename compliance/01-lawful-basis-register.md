# Lawful Basis Register

Controller: **[LEGAL ENTITY NAME]**, trading as Elite Level Sales
Address: **[REGISTERED ADDRESS]** · Contact: **[PRIVACY EMAIL]**
Owner: Kyle Cooke · Last reviewed: **[DATE]**

Every processing purpose needs a lawful basis under Art. 6, chosen *before*
processing starts. You cannot switch basis later to rescue a problem.

| # | Purpose | Data | Lawful basis | Notes |
|---|---|---|---|---|
| 1 | Responding to an application or enquiry | Name, email, phone, form answers | **Art. 6(1)(b)** — steps prior to a contract at the person's request | They asked to be contacted about the programme |
| 2 | **SMS marketing and follow-up** | Phone, message content | **Art. 6(1)(a) consent** + ePrivacy Reg. 13 | See the ePrivacy note below — this one is not negotiable |
| 3 | Phone calls to people who applied | Phone, call outcome, notes | Art. 6(1)(b) / 6(1)(f) legitimate interest | Only to people who gave their number for this purpose |
| 4 | Call recording (if enabled) | Voice recording | **Art. 6(1)(a) consent** | Must be announced at the start of every call |
| 5 | Delivering the programme to members | Contact details, progress | Art. 6(1)(b) contract | |
| 6 | Invoices and financial records | Name, amounts, dates | Art. 6(1)(c) legal obligation | Revenue retention rules override erasure requests |
| 7 | Security, audit and access logs | User email, action, timestamp | Art. 6(1)(f) legitimate interest | Needed to demonstrate accountability |
| 8 | Suppression list after erasure | Salted hashes only | Art. 6(1)(c) legal obligation | Keeping the record of "do not re-add" is itself required |

## The ePrivacy point that matters most

Under **S.I. 336/2011 Reg. 13**, unsolicited marketing by SMS to an individual
requires **prior consent**. Legitimate interest is *not* available for this,
however commercially reasonable it feels. The narrow exception is an existing
customer whose details you obtained during a sale of a similar product, who was
given an opt-out at the time and in every message since.

Practically, for Elite Level Sales:

- A lead who ticked an SMS consent box on the website or Typeform → **consent, marketing permitted**
- A lead who only booked a call via Calendly → contact them about **that booking**; do not drop them into a marketing sequence without consent
- A purchased or scraped list → **no lawful basis**. Do not import one.

Breaches here are enforced by the DPC and carry penalties per message.

## Marketing calls

Live marketing calls to individuals must be screened against the **National
Directory Database (NDD)** opt-out register. Calling someone who applied and
gave you their number for that purpose is fine; cold-calling a list is not.

## Evidence

The CRM records consent automatically at capture with the basis and source
(`consent_events`), so for any given lead you can show when consent arose and
where it came from. That evidence is what Art. 7(1) requires.
