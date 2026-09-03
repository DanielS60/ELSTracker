# Record of Processing Activities (Art. 30)

Controller: **[LEGAL ENTITY NAME]** t/a Elite Level Sales
Address: **[REGISTERED ADDRESS]** · Contact: **[PRIVACY EMAIL]**
Last reviewed: **[DATE]** · Review: every 6 months, or on any new tool

This is the first document a regulator asks for. Keep it current.

---

## Activity 1 — Lead capture and application handling

| | |
|---|---|
| **Purpose** | Receive applications and arrange a strategy call |
| **Categories of person** | Prospective clients, mainly adults 18–30 in Ireland |
| **Data** | Name, email, phone, application answers, marketing source |
| **Lawful basis** | Art. 6(1)(b) pre-contractual steps |
| **Source** | Website form, Typeform, Calendly, manual entry |
| **Recipients** | Typeform, Calendly, Railway |
| **Transfers** | US — Calendly, Railway (see doc 03) |
| **Retention** | [24] months from last contact |
| **Security** | Password auth with approval, TLS, encrypted at rest by host, audit log |

## Activity 2 — SMS marketing and follow-up

| | |
|---|---|
| **Purpose** | Send follow-up sequences and one-off messages |
| **Categories of person** | Leads who consented to SMS |
| **Data** | Phone number, message content, delivery status, replies |
| **Lawful basis** | **Art. 6(1)(a) consent** + ePrivacy Reg. 13 |
| **Recipients** | Twilio, then mobile carriers |
| **Transfers** | US — Twilio |
| **Retention** | [24] months; consent record kept as evidence |
| **Safeguards** | Consent recorded at capture; STOP handled automatically and cancels queued messages; quiet hours 21:00–09:00 |

## Activity 3 — Outbound calling

| | |
|---|---|
| **Purpose** | Call applicants about their application |
| **Data** | Phone number, call time, duration, outcome, notes |
| **Lawful basis** | Art. 6(1)(b) / 6(1)(f) |
| **Recipients** | Twilio |
| **Retention** | [24] months |
| **Safeguards** | Only numbers given for this purpose; NDD screening before any cold calling |

## Activity 4 — Call recording *(only if enabled)*

| | |
|---|---|
| **Purpose** | Training and quality |
| **Data** | Voice recording of both parties |
| **Lawful basis** | **Art. 6(1)(a) consent** |
| **Retention** | [90] days, then automatic deletion |
| **Safeguards** | Spoken announcement before connection; recording refused if objected to |

## Activity 5 — Programme delivery

| | |
|---|---|
| **Purpose** | Deliver coaching to paying members |
| **Lawful basis** | Art. 6(1)(b) contract |
| **Retention** | Duration of membership + [24] months |

## Activity 6 — Financial records

| | |
|---|---|
| **Purpose** | Invoicing, tax |
| **Lawful basis** | Art. 6(1)(c) legal obligation |
| **Retention** | 6 years — overrides erasure requests |

## Activity 7 — System access and audit logging

| | |
|---|---|
| **Purpose** | Security, and demonstrating accountability |
| **Data** | Staff email, action taken, record touched, timestamp |
| **Lawful basis** | Art. 6(1)(f) legitimate interest |
| **Retention** | [12] months |

## Activity 8 — Suppression list

| | |
|---|---|
| **Purpose** | Ensure an erased person is never re-added |
| **Data** | Salted HMAC hashes of phone and email — no readable identifiers |
| **Lawful basis** | Art. 6(1)(c) |
| **Retention** | Indefinite, by necessity |
