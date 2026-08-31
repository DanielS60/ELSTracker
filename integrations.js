/* ===========================================================================
   Typeform + Calendly webhooks.

   Both land the submitter's answers in the lead's notes, matching an existing
   contact by email then phone, and creating one when there's no match.
   Notes are APPENDED — a webhook must never wipe a rep's own notes.
   =========================================================================== */
'use strict';

const crypto = require('node:crypto');

module.exports = function createIntegrations(ctx) {
  const { db, json, getSetting, nowISO, normalisePhone, fireTriggers, tick } = ctx;

  /* Both providers retry on failure; remember what we've handled so a retry
     doesn't append the same answers to the notes twice. */
  db.exec(`
    CREATE TABLE IF NOT EXISTS webhook_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      source      TEXT NOT NULL,
      event_id    TEXT NOT NULL,
      contact_id  INTEGER,
      received_at TEXT NOT NULL,
      UNIQUE(source, event_id)
    );
  `);

  const seen = (source, eventId) =>
    !!db.prepare('SELECT 1 FROM webhook_events WHERE source=? AND event_id=?').get(source, eventId);

  const remember = (source, eventId, contactId) =>
    db.prepare(`INSERT OR IGNORE INTO webhook_events (source,event_id,contact_id,received_at)
                VALUES (?,?,?,?)`).run(source, eventId, contactId ?? null, nowISO());

  /* --------------------------------------------------------------- raw body
     Signatures are computed over the exact bytes received, so these routes
     can't use the shared JSON body parser. */
  function readRaw(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', c => {
        size += c.length;
        if (size > 2e6) { req.destroy(); return reject(new Error('payload too large')); }
        chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }

  function safeEqual(a, b) {
    const x = Buffer.from(String(a)), y = Buffer.from(String(b));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  }

  /** Typeform sends `sha256=<base64 hmac of the raw body>`. */
  function typeformOk(raw, header, secret) {
    if (!secret) return null;                    // not configured -> caller decides
    if (!header) return false;
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('base64');
    return safeEqual(header, expected);
  }

  /** Calendly sends `t=<unix>,v1=<hex hmac of "t.rawBody">`. */
  function calendlyOk(raw, header, secret) {
    if (!secret) return null;
    if (!header) return false;
    const parts = Object.fromEntries(String(header).split(',').map(p => p.trim().split('=')));
    if (!parts.t || !parts.v1) return false;
    const expected = crypto.createHmac('sha256', secret)
      .update(parts.t + '.' + raw.toString('utf8')).digest('hex');
    return safeEqual(parts.v1, expected);
  }

  /* ------------------------------------------------------------------ notes */
  function appendNote(contactId, block) {
    const row = db.prepare('SELECT notes FROM contacts WHERE id=?').get(contactId);
    const merged = (row && row.notes ? row.notes.trim() + '\n\n' : '') + block;
    db.prepare('UPDATE contacts SET notes=?, updated_at=? WHERE id=?')
      .run(merged, nowISO(), contactId);
  }

  function noteBlock(title, pairs, extras = []) {
    const stamp = new Date().toLocaleString('en-IE', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    const lines = pairs
      .filter(p => p.a !== '' && p.a != null)
      .map(p => `${p.q}: ${p.a}`);
    return [`--- ${title} · ${stamp} ---`, ...lines, ...extras].join('\n');
  }

  /* --------------------------------------------------------------- matching */
  function findContact(email, phone) {
    if (email) {
      const byEmail = db.prepare('SELECT * FROM contacts WHERE lower(email)=lower(?)').get(email);
      if (byEmail) return byEmail;
    }
    if (phone) {
      const byPhone = db.prepare('SELECT * FROM contacts WHERE phone=?').get(normalisePhone(phone));
      if (byPhone) return byPhone;
    }
    return null;
  }

  /** Find the lead, or create one. Creating fires the new-lead automation. */
  function upsertContact({ first_name, last_name, email, phone, source }) {
    const existing = findContact(email, phone);
    if (existing) {
      // Backfill anything we now know but didn't have before.
      const patch = {};
      if (!existing.email && email) patch.email = email;
      if (!existing.phone && phone) patch.phone = normalisePhone(phone);
      if (Object.keys(patch).length) {
        const sets = Object.keys(patch).map(k => `${k}=?`).join(',');
        db.prepare(`UPDATE contacts SET ${sets}, updated_at=? WHERE id=?`)
          .run(...Object.values(patch), nowISO(), existing.id);
      }
      return { contact: db.prepare('SELECT * FROM contacts WHERE id=?').get(existing.id), created: false };
    }

    if (!phone && !email) return { contact: null, created: false };

    const t = nowISO();
    const id = db.prepare(
      `INSERT INTO contacts (first_name,last_name,phone,email,status,source,notes,tags,consent_sms,created_at,updated_at)
       VALUES (?,?,?,?,'New',?,'','',1,?,?)`
    ).run(first_name || 'Unknown', last_name || '', normalisePhone(phone || ''), email || '',
          source || '', t, t).lastInsertRowid;

    const contact = db.prepare('SELECT * FROM contacts WHERE id=?').get(id);
    fireTriggers('contact_created', contact);
    return { contact, created: true };
  }

  /* --------------------------------------------------------------- typeform
     Answers are typed; the value lives under a key matching the type. */
  function answerValue(a) {
    switch (a.type) {
      case 'choice':  return a.choice ? (a.choice.label || a.choice.other || '') : '';
      case 'choices': return a.choices
        ? [].concat(a.choices.labels || [], a.choices.other || []).join(', ') : '';
      case 'boolean': return a.boolean ? 'Yes' : 'No';
      case 'payment': return a.payment ? `${a.payment.amount} ${a.payment.name || ''}`.trim() : '';
      default:        return a[a.type] != null ? String(a[a.type]) : '';
    }
  }

  function handleTypeform(body) {
    const fr = body.form_response || {};
    const answers = fr.answers || [];
    const fields = ((fr.definition || {}).fields) || [];
    const titleById = Object.fromEntries(fields.map(f => [f.id, f.title || f.ref || 'Question']));

    const pairs = answers.map(a => ({
      q: titleById[(a.field || {}).id] || (a.field || {}).ref || 'Question',
      a: answerValue(a)
    }));

    // Pull the identity fields out of the same answer set.
    const byType = t => {
      const hit = answers.find(a => a.type === t);
      return hit ? answerValue(hit) : '';
    };
    const email = byType('email');
    const phone = byType('phone_number');

    let name = '';
    const nameAnswer = answers.find(a => {
      const ref = ((a.field || {}).ref || '').toLowerCase();
      const title = (titleById[(a.field || {}).id] || '').toLowerCase();
      return /name/.test(ref) || /name/.test(title);
    });
    if (nameAnswer) name = answerValue(nameAnswer);
    if (!name) {
      const firstText = answers.find(a => a.type === 'text');
      if (firstText) name = answerValue(firstText);
    }
    const [first, ...rest] = String(name).trim().split(/\s+/);

    const { contact, created } = upsertContact({
      first_name: first || 'Unknown',
      last_name: rest.join(' '),
      email, phone,
      source: 'Typeform'
    });
    if (!contact) return { ok: false, reason: 'no email or phone in submission' };

    appendNote(contact.id, noteBlock(
      `Typeform — ${(fr.definition || {}).title || 'submission'}`, pairs));

    return { ok: true, contact_id: contact.id, created, answers: pairs.length };
  }

  /* --------------------------------------------------------------- calendly */
  function handleCalendly(body) {
    const kind = body.event || '';
    const p = body.payload || {};
    const qa = (p.questions_and_answers || [])
      .slice()
      .sort((a, b) => (a.position || 0) - (b.position || 0))
      .map(x => ({ q: x.question, a: x.answer }));

    const ev = p.scheduled_event || {};
    const email = p.email || '';
    const phone = p.text_reminder_number || '';
    const [first, ...rest] = String(p.name || '').trim().split(/\s+/);

    const { contact, created } = upsertContact({
      first_name: first || 'Unknown',
      last_name: rest.join(' '),
      email, phone,
      source: 'Calendly'
    });
    if (!contact) return { ok: false, reason: 'no email or phone in booking' };

    const when = ev.start_time
      ? new Date(ev.start_time).toLocaleString('en-IE', {
          weekday: 'short', day: '2-digit', month: 'short',
          hour: '2-digit', minute: '2-digit'
        })
      : 'unknown time';

    const extras = [];
    if (ev.name) extras.push(`Event: ${ev.name}`);
    extras.push(kind === 'invitee.canceled' ? `CANCELLED (was ${when})` : `Scheduled: ${when}`);
    if (p.tracking && p.tracking.utm_source) {
      extras.push(`Source: ${[p.tracking.utm_source, p.tracking.utm_campaign].filter(Boolean).join(' / ')}`);
    }
    if (kind === 'invitee.canceled' && p.cancellation && p.cancellation.reason) {
      extras.push(`Reason: ${p.cancellation.reason}`);
    }

    appendNote(contact.id, noteBlock(
      kind === 'invitee.canceled' ? 'Calendly — cancelled' : 'Calendly — booked', qa, extras));

    /* A new booking moves the lead to Booked, which fires the existing show-up
       reminder sequence. A cancellation is NOT auto-downgraded — deciding
       whether that's a reschedule or a dead lead is a human judgement. */
    let queued = 0;
    if (kind === 'invitee.created' && contact.status !== 'Booked') {
      db.prepare(`INSERT INTO stage_events (contact_id,from_status,to_status,created_at)
                  VALUES (?,?,?,?)`).run(contact.id, contact.status, 'Booked', nowISO());
      db.prepare('UPDATE contacts SET status=?, updated_at=? WHERE id=?')
        .run('Booked', nowISO(), contact.id);
      const fresh = db.prepare('SELECT * FROM contacts WHERE id=?').get(contact.id);
      queued = fireTriggers('status_changed', fresh, 'Booked');
    }

    return { ok: true, contact_id: contact.id, created, answers: qa.length, queued };
  }

  /* ----------------------------------------------------------------- routes */
  async function routes(req, res, url) {
    const p = url.pathname;
    if (req.method !== 'POST') return false;
    if (p !== '/api/webhooks/typeform' && p !== '/api/webhooks/calendly') return false;

    const isTypeform = p.endsWith('/typeform');
    const source = isTypeform ? 'typeform' : 'calendly';
    const secret = getSetting(isTypeform ? 'typeform_secret' : 'calendly_secret').trim();

    let raw;
    try { raw = await readRaw(req); }
    catch (e) { json(res, 413, { error: e.message }); return true; }

    const header = req.headers[isTypeform ? 'typeform-signature' : 'calendly-webhook-signature'];
    const verdict = isTypeform
      ? typeformOk(raw, header, secret)
      : calendlyOk(raw, header, secret);

    if (verdict === false) {
      console.warn(`[${source}] rejected: bad signature`);
      json(res, 401, { error: 'Invalid signature' });
      return true;
    }
    if (verdict === null) {
      console.warn(`[${source}] accepted UNVERIFIED — no signing secret set in Settings. ` +
                   `Anyone who knows this URL can post leads.`);
    }

    let body;
    try { body = JSON.parse(raw.toString('utf8')); }
    catch { json(res, 400, { error: 'Body was not valid JSON' }); return true; }

    const eventId = isTypeform
      ? (body.event_id || ((body.form_response || {}).token) || '')
      : ((body.payload || {}).uri || body.created_at || '');

    if (eventId && seen(source, eventId)) {
      json(res, 200, { ok: true, duplicate: true });
      return true;
    }

    let out;
    try {
      out = isTypeform ? handleTypeform(body) : handleCalendly(body);
    } catch (e) {
      console.error(`[${source}]`, e.message);
      json(res, 500, { error: e.message });
      return true;
    }

    if (eventId && out.ok) remember(source, eventId, out.contact_id);
    if (out.ok) tick();                     // flush anything the triggers queued

    json(res, 200, out);
    return true;
  }

  const OPEN_PATHS = ['/api/webhooks/typeform', '/api/webhooks/calendly'];

  return { routes, OPEN_PATHS };
};
