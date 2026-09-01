/* ===========================================================================
   ELITE LEVEL SALES — CRM
   Zero-dependency Node server: node:http + node:sqlite + fetch -> Twilio.
   Run:  node server.js       (then open http://localhost:4300)
   =========================================================================== */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT || 4300);
const ROOT = __dirname;
/* DATA_DIR is env-configurable so a host can point it at a mounted volume.
   Railway/Render wipe the container filesystem on every deploy — without a
   volume, every lead would vanish on redeploy. */
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const PUBLIC_DIR = path.join(ROOT, 'public');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

/* ------------------------------------------------------------------- auth
   Accounts live in auth.js. Anyone can request access; nobody gets in until
   an admin approves them. ADMIN_EMAIL decides who may claim the very first
   (admin) account — without it, whoever signs up first would become admin. */
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';

const SECRET_FILE = path.join(DATA_DIR, 'session.key');
if (!fs.existsSync(SECRET_FILE)) {
  fs.writeFileSync(SECRET_FILE, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
}
const SESSION_SECRET = process.env.SESSION_SECRET || fs.readFileSync(SECRET_FILE, 'utf8').trim();

/* Sessions, password hashing and the approval queue all live in auth.js. */

/* ---------------------------------------------------------------- database */
const db = new DatabaseSync(path.join(DATA_DIR, 'crm.db'));
db.exec(`
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS contacts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name  TEXT NOT NULL,
  last_name   TEXT DEFAULT '',
  phone       TEXT NOT NULL,
  email       TEXT DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'New',
  source      TEXT DEFAULT '',
  notes       TEXT DEFAULT '',
  tags        TEXT DEFAULT '',
  consent_sms INTEGER NOT NULL DEFAULT 1,
  opted_out   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id    INTEGER NOT NULL,
  direction     TEXT NOT NULL,
  body          TEXT NOT NULL,
  status        TEXT NOT NULL,
  provider_sid  TEXT DEFAULT '',
  error         TEXT DEFAULT '',
  scheduled_for TEXT,
  sent_at       TEXT,
  automation_id INTEGER,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS calls (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id       INTEGER NOT NULL,
  direction        TEXT NOT NULL DEFAULT 'out',
  provider_sid     TEXT DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'initiated',
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  outcome          TEXT DEFAULT '',
  notes            TEXT DEFAULT '',
  error            TEXT DEFAULT '',
  started_at       TEXT,
  created_at       TEXT NOT NULL
);

/* Stage history — a contact's current status alone cannot answer
   "how many booked this week", so every transition is recorded here. */
CREATE TABLE IF NOT EXISTS stage_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id  INTEGER NOT NULL,
  from_status TEXT DEFAULT '',
  to_status   TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS templates (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS automations (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  trigger_type   TEXT NOT NULL,
  trigger_status TEXT DEFAULT '',
  enabled        INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS automation_steps (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  automation_id INTEGER NOT NULL,
  step_order    INTEGER NOT NULL,
  delay_minutes INTEGER NOT NULL DEFAULT 0,
  body          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_msg_due ON messages(status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_msg_contact ON messages(contact_id);
`);

/* ---------------------------------------------------------------- settings */
const DEFAULT_SETTINGS = {
  twilio_account_sid: '',
  twilio_auth_token: '',
  twilio_from: '',
  dry_run: '1',
  quiet_start: '21',
  quiet_end: '9',
  business_name: 'Elite Level Sales',
  agent_phone: '',               // your mobile — rings first on click-to-call
  typeform_secret: '',           // HMAC secret from Typeform's webhook settings
  calendly_secret: ''            // signing key from the Calendly webhook subscription
};

/* Credentials may be supplied as environment variables instead of being
   stored in the database at all. The env value always wins, so on a hosted
   deployment the secrets live in the platform's secret store and never touch
   crm.db — which matters because the database is what gets backed up, copied
   about, and mounted on a shared volume. */
const ENV_SETTING = {
  twilio_account_sid: 'TWILIO_ACCOUNT_SID',
  twilio_auth_token:  'TWILIO_AUTH_TOKEN',
  twilio_from:        'TWILIO_FROM',
  agent_phone:        'AGENT_PHONE',
  typeform_secret:    'TYPEFORM_SECRET',
  calendly_secret:    'CALENDLY_SECRET'
};

function getSetting(key) {
  const envKey = ENV_SETTING[key];
  if (envKey && process.env[envKey]) return process.env[envKey];
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : (DEFAULT_SETTINGS[key] ?? '');
}

/** True when a value comes from the environment — the UI shows those as
    locked rather than pretending they can be edited in Settings. */
function isEnvManaged(key) {
  const envKey = ENV_SETTING[key];
  return !!(envKey && process.env[envKey]);
}
function setSetting(key, value) {
  db.prepare(`INSERT INTO settings (key,value) VALUES (?,?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, String(value));
}
function allSettings() {
  const out = { ...DEFAULT_SETTINGS };
  for (const r of db.prepare('SELECT key,value FROM settings').all()) out[r.key] = r.value;
  return out;
}
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
  if (!db.prepare('SELECT 1 FROM settings WHERE key = ?').get(k)) setSetting(k, v);
}

/* ------------------------------------------------------------------ seeding */
const STATUSES = ['New', 'Contacted', 'Booked', 'Showed', 'Closed', 'Lost'];

if (db.prepare('SELECT COUNT(*) c FROM automations').get().c === 0) {
  const now = new Date().toISOString();

  const a1 = db.prepare(
    `INSERT INTO automations (name,trigger_type,trigger_status,enabled,created_at)
     VALUES (?,?,?,1,?)`
  ).run('New lead — instant follow-up', 'contact_created', '', now).lastInsertRowid;

  const step = db.prepare(
    `INSERT INTO automation_steps (automation_id,step_order,delay_minutes,body) VALUES (?,?,?,?)`
  );
  step.run(a1, 1, 0,
    "Hey {{first_name}}, Kyle here from Elite Level Sales. Thanks for applying — I'll be in touch shortly to get you booked in. Reply STOP to opt out.");
  step.run(a1, 2, 60,
    "{{first_name}} — did you get a chance to grab a slot yet? Spots are limited this intake.");
  step.run(a1, 3, 1440,
    "{{first_name}}, still keen? Takes 2 mins to book your strategy session and there's no obligation.");

  const a2 = db.prepare(
    `INSERT INTO automations (name,trigger_type,trigger_status,enabled,created_at)
     VALUES (?,?,?,1,?)`
  ).run('Booked — show-up reminders', 'status_changed', 'Booked', now).lastInsertRowid;

  step.run(a2, 1, 0,
    "You're booked in, {{first_name}}. Save this number so you don't miss the call. See you soon — Kyle");
  step.run(a2, 2, 1440,
    "{{first_name}} — your Elite Level Sales call is coming up. Come with questions, it's a real conversation not a pitch.");
}

if (db.prepare('SELECT COUNT(*) c FROM templates').get().c === 0) {
  const now = new Date().toISOString();
  const t = db.prepare('INSERT INTO templates (name,body,created_at) VALUES (?,?,?)');
  t.run('No-show follow-up',
    "{{first_name}}, sorry we missed each other. Want me to hold another slot for you this week?", now);
  t.run('Re-engage cold lead',
    "{{first_name}} — still thinking about getting into high ticket sales? Happy to answer any questions, no pressure.", now);
  t.run('Booking nudge',
    "Hey {{first_name}}, grab a time that suits you here and we'll take it from there.", now);
}

/* ----------------------------------------------------------------- helpers */
const nowISO = () => new Date().toISOString();

function renderBody(body, contact) {
  return String(body).replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key) => {
    const v = contact[key];
    return (v === undefined || v === null) ? '' : String(v);
  });
}

/** E.164-ish normalisation. Bare Irish mobiles default to +353. */
function normalisePhone(raw, defaultCc = '353') {
  let p = String(raw || '').replace(/[^\d+]/g, '');
  if (!p) return '';
  if (p.startsWith('+')) return p;
  if (p.startsWith('00')) return '+' + p.slice(2);
  if (p.startsWith('0')) return '+' + defaultCc + p.slice(1);
  return '+' + p;
}

/** Quiet hours: push a send time forward if it lands inside the window. */
function nextAllowedSend(when = new Date()) {
  const qs = Number(getSetting('quiet_start'));
  const qe = Number(getSetting('quiet_end'));
  if (!Number.isFinite(qs) || !Number.isFinite(qe) || qs === qe) return when;

  const d = new Date(when);
  const h = d.getHours();
  const inQuiet = qs > qe ? (h >= qs || h < qe) : (h >= qs && h < qe);
  if (!inQuiet) return when;

  const out = new Date(d);
  if (qs > qe && h >= qs) out.setDate(out.getDate() + 1);
  out.setHours(qe, 0, 0, 0);
  return out;
}

function segments(text) { return Math.ceil((text || '').length / 160) || 1; }

/* ------------------------------------------------------------------ twilio */
async function sendViaTwilio(to, body) {
  const sid = getSetting('twilio_account_sid').trim();
  const token = getSetting('twilio_auth_token').trim();
  const from = getSetting('twilio_from').trim();
  const dryRun = getSetting('dry_run') === '1';

  if (dryRun || !sid || !token || !from) {
    return {
      ok: true,
      simulated: true,
      sid: 'DRYRUN-' + Math.random().toString(36).slice(2, 10),
      reason: dryRun ? 'dry_run enabled' : 'missing Twilio credentials'
    };
  }

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ To: to, From: from, Body: body })
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: json.message || `Twilio HTTP ${res.status}` };
  return { ok: true, simulated: false, sid: json.sid || '' };
}

/* -------------------------------------------------------- automation engine */
function enqueueAutomation(automation, contact) {
  const steps = db.prepare(
    'SELECT * FROM automation_steps WHERE automation_id = ? ORDER BY step_order'
  ).all(automation.id);

  const ins = db.prepare(
    `INSERT INTO messages (contact_id,direction,body,status,scheduled_for,automation_id,created_at)
     VALUES (?,'out',?,'queued',?,?,?)`
  );

  for (const s of steps) {
    const due = nextAllowedSend(new Date(Date.now() + s.delay_minutes * 60000));
    ins.run(contact.id, renderBody(s.body, contact), due.toISOString(), automation.id, nowISO());
  }
  return steps.length;
}

function fireTriggers(type, contact, status) {
  if (contact.opted_out || !contact.consent_sms) return 0;

  const rows = type === 'status_changed'
    ? db.prepare(`SELECT * FROM automations WHERE enabled=1 AND trigger_type='status_changed' AND trigger_status=?`).all(status)
    : db.prepare(`SELECT * FROM automations WHERE enabled=1 AND trigger_type='contact_created'`).all();

  let n = 0;
  for (const a of rows) n += enqueueAutomation(a, contact);
  return n;
}

function cancelQueued(contactId) {
  return db.prepare(
    `UPDATE messages SET status='cancelled' WHERE contact_id=? AND status='queued'`
  ).run(contactId).changes;
}

/* ------------------------------------------------------------- the scheduler */
let ticking = false;
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const due = db.prepare(
      `SELECT m.*, c.phone, c.opted_out, c.consent_sms
         FROM messages m JOIN contacts c ON c.id = m.contact_id
        WHERE m.status='queued' AND m.scheduled_for <= ?
        ORDER BY m.scheduled_for LIMIT 25`
    ).all(nowISO());

    for (const m of due) {
      if (m.opted_out || !m.consent_sms) {
        db.prepare(`UPDATE messages SET status='cancelled', error='contact opted out' WHERE id=?`).run(m.id);
        continue;
      }
      const allowed = nextAllowedSend(new Date());
      if (allowed.getTime() > Date.now() + 1000) {
        db.prepare(`UPDATE messages SET scheduled_for=? WHERE id=?`).run(allowed.toISOString(), m.id);
        continue;
      }

      let r;
      try { r = await sendViaTwilio(normalisePhone(m.phone), m.body); }
      catch (e) { r = { ok: false, error: e.message }; }

      if (r.ok) {
        db.prepare(`UPDATE messages SET status=?, provider_sid=?, sent_at=?, error='' WHERE id=?`)
          .run(r.simulated ? 'simulated' : 'sent', r.sid || '', nowISO(), m.id);
      } else {
        db.prepare(`UPDATE messages SET status='failed', error=? WHERE id=?`)
          .run(String(r.error).slice(0, 300), m.id);
      }
    }
  } catch (e) {
    console.error('[scheduler]', e.message);
  } finally {
    ticking = false;
  }
}
setInterval(tick, 20000);
setTimeout(tick, 2000);

/* -------------------------------------------------------------------- http */
function json(res, code, payload) {
  const s = JSON.stringify(payload);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(s) });
  res.end(s);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', c => { d += c; if (d.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch { resolve({}); } });
    req.on('error', reject);
  });
}
function formBody(req) {
  return new Promise(resolve => {
    let d = '';
    req.on('data', c => { d += c; });
    req.on('end', () => resolve(Object.fromEntries(new URLSearchParams(d))));
  });
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
               '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath).replace(/^\/+/, '');
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('Not found');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

/* --------------------------------------------------------------- API routes */
async function api(req, res, url) {
  const p = url.pathname;
  const m = req.method;
  const id = () => Number(p.split('/')[3]);

  if (p === '/api/stats' && m === 'GET') {
    const byStatus = {};
    for (const s of STATUSES) {
      byStatus[s] = db.prepare('SELECT COUNT(*) c FROM contacts WHERE status=?').get(s).c;
    }
    return json(res, 200, {
      contacts: db.prepare('SELECT COUNT(*) c FROM contacts').get().c,
      byStatus,
      queued: db.prepare(`SELECT COUNT(*) c FROM messages WHERE status='queued'`).get().c,
      sent: db.prepare(`SELECT COUNT(*) c FROM messages WHERE status IN ('sent','simulated')`).get().c,
      failed: db.prepare(`SELECT COUNT(*) c FROM messages WHERE status='failed'`).get().c,
      optedOut: db.prepare('SELECT COUNT(*) c FROM contacts WHERE opted_out=1').get().c,
      dryRun: getSetting('dry_run') === '1',
      upcoming: db.prepare(
        `SELECT m.id,m.body,m.scheduled_for,c.first_name,c.phone
           FROM messages m JOIN contacts c ON c.id=m.contact_id
          WHERE m.status='queued' ORDER BY m.scheduled_for LIMIT 8`).all()
    });
  }

  if (p === '/api/contacts' && m === 'GET') {
    const q = (url.searchParams.get('q') || '').trim();
    const st = url.searchParams.get('status') || '';
    let sql = 'SELECT * FROM contacts WHERE 1=1'; const args = [];
    if (q) { sql += ' AND (first_name LIKE ? OR last_name LIKE ? OR phone LIKE ? OR email LIKE ?)';
             args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
    if (st) { sql += ' AND status=?'; args.push(st); }
    sql += ' ORDER BY updated_at DESC LIMIT 500';
    return json(res, 200, db.prepare(sql).all(...args));
  }

  if (p === '/api/contacts' && m === 'POST') {
    const b = await readBody(req);
    if (!b.first_name || !b.phone) return json(res, 400, { error: 'first_name and phone are required' });
    const t = nowISO();
    const info = db.prepare(
      `INSERT INTO contacts (first_name,last_name,phone,email,status,source,notes,tags,consent_sms,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).run(sec.str(b.first_name, 80), sec.str(b.last_name, 80), normalisePhone(b.phone),
          sec.str(b.email, 200), sec.enumOr(b.status, STATUSES) || 'New',
          sec.str(b.source, 80), sec.str(b.notes, 20000),
          sec.str(b.tags, 200), b.consent_sms === false ? 0 : 1, t, t);

    const contact = db.prepare('SELECT * FROM contacts WHERE id=?').get(info.lastInsertRowid);
    const queued = fireTriggers('contact_created', contact);
    tick();
    return json(res, 201, { contact, queued });
  }

  if (/^\/api\/contacts\/\d+$/.test(p) && m === 'GET') {
    const c = db.prepare('SELECT * FROM contacts WHERE id=?').get(id());
    if (!c) return json(res, 404, { error: 'not found' });
    c.messages = db.prepare('SELECT * FROM messages WHERE contact_id=? ORDER BY COALESCE(sent_at,scheduled_for,created_at)').all(c.id);
    return json(res, 200, c);
  }

  if (/^\/api\/contacts\/\d+$/.test(p) && m === 'PATCH') {
    const b = await readBody(req);
    const before = db.prepare('SELECT * FROM contacts WHERE id=?').get(id());
    if (!before) return json(res, 404, { error: 'not found' });

    const fields = ['first_name','last_name','phone','email','status','source','notes','tags','consent_sms','opted_out'];
    const CAPS = { first_name:80, last_name:80, email:200, source:80, tags:200, notes:20000 };
    const sets = [], args = [];
    for (const f of fields) {
      if (!Object.hasOwn(b, f)) continue;

      /* status reaches the UI inside a class attribute, so it must be one of
         the known stages — never free text. */
      if (f === 'status') {
        const s = sec.enumOr(b.status, STATUSES);
        if (s === undefined) return json(res, 400, { error: 'Unknown status' });
        sets.push('status=?'); args.push(s);
        continue;
      }
      sets.push(`${f}=?`);
      args.push(f === 'phone' ? normalisePhone(b[f])
              : (f === 'consent_sms' || f === 'opted_out') ? (b[f] ? 1 : 0)
              : sec.str(b[f], CAPS[f] || 500));
    }
    if (sets.length) {
      sets.push('updated_at=?'); args.push(nowISO(), id());
      db.prepare(`UPDATE contacts SET ${sets.join(',')} WHERE id=?`).run(...args);
    }

    const after = db.prepare('SELECT * FROM contacts WHERE id=?').get(id());
    let queued = 0;
    if (b.status && b.status !== before.status) {
      db.prepare(`INSERT INTO stage_events (contact_id,from_status,to_status,created_at)
                  VALUES (?,?,?,?)`).run(after.id, before.status, b.status, nowISO());
      queued = fireTriggers('status_changed', after, b.status);
    }
    if (after.opted_out && !before.opted_out) cancelQueued(after.id);
    tick();
    return json(res, 200, { contact: after, queued });
  }

  if (/^\/api\/contacts\/\d+$/.test(p) && m === 'DELETE') {
    /* Clear every child row too — stage_events feed the weekly report, so an
       orphaned one would keep counting toward booked/showed/closed forever. */
    db.prepare('DELETE FROM messages WHERE contact_id=?').run(id());
    db.prepare('DELETE FROM calls WHERE contact_id=?').run(id());
    db.prepare('DELETE FROM stage_events WHERE contact_id=?').run(id());
    db.prepare('DELETE FROM contacts WHERE id=?').run(id());
    return json(res, 200, { ok: true });
  }

  if (p === '/api/messages/send' && m === 'POST') {
    const b = await readBody(req);
    const c = db.prepare('SELECT * FROM contacts WHERE id=?').get(Number(b.contact_id));
    if (!c) return json(res, 404, { error: 'contact not found' });
    if (c.opted_out) return json(res, 400, { error: 'contact has opted out of SMS' });
    if (!b.body) return json(res, 400, { error: 'body required' });

    const body = renderBody(b.body, c);
    const when = b.schedule_in_minutes
      ? nextAllowedSend(new Date(Date.now() + Number(b.schedule_in_minutes) * 60000))
      : new Date();

    const info = db.prepare(
      `INSERT INTO messages (contact_id,direction,body,status,scheduled_for,created_at)
       VALUES (?,'out',?,'queued',?,?)`
    ).run(c.id, body, when.toISOString(), nowISO());

    await tick();
    return json(res, 201, db.prepare('SELECT * FROM messages WHERE id=?').get(info.lastInsertRowid));
  }

  if (p === '/api/messages' && m === 'GET') {
    return json(res, 200, db.prepare(
      `SELECT m.*, c.first_name, c.last_name, c.phone
         FROM messages m JOIN contacts c ON c.id=m.contact_id
        ORDER BY m.id DESC LIMIT 200`).all());
  }

  if (/^\/api\/messages\/\d+$/.test(p) && m === 'DELETE') {
    db.prepare(`UPDATE messages SET status='cancelled' WHERE id=? AND status='queued'`).run(id());
    return json(res, 200, { ok: true });
  }

  if (p === '/api/messages/bulk' && m === 'POST') {
    const b = await readBody(req);
    if (!b.body || !b.status) return json(res, 400, { error: 'status and body required' });
    const list = db.prepare('SELECT * FROM contacts WHERE status=? AND opted_out=0 AND consent_sms=1').all(b.status);
    const ins = db.prepare(
      `INSERT INTO messages (contact_id,direction,body,status,scheduled_for,created_at)
       VALUES (?,'out',?,'queued',?,?)`);
    const when = nextAllowedSend(new Date()).toISOString();
    for (const c of list) ins.run(c.id, renderBody(b.body, c), when, nowISO());
    tick();
    return json(res, 200, { queued: list.length });
  }

  if (p === '/api/templates' && m === 'GET')
    return json(res, 200, db.prepare('SELECT * FROM templates ORDER BY id DESC').all());
  if (p === '/api/templates' && m === 'POST') {
    const b = await readBody(req);
    if (!b.name || !b.body) return json(res, 400, { error: 'name and body required' });
    const i = db.prepare('INSERT INTO templates (name,body,created_at) VALUES (?,?,?)')
                .run(b.name, b.body, nowISO());
    return json(res, 201, db.prepare('SELECT * FROM templates WHERE id=?').get(i.lastInsertRowid));
  }
  if (/^\/api\/templates\/\d+$/.test(p) && m === 'DELETE') {
    db.prepare('DELETE FROM templates WHERE id=?').run(id());
    return json(res, 200, { ok: true });
  }

  if (p === '/api/automations' && m === 'GET') {
    const rows = db.prepare('SELECT * FROM automations ORDER BY id').all();
    for (const a of rows)
      a.steps = db.prepare('SELECT * FROM automation_steps WHERE automation_id=? ORDER BY step_order').all(a.id);
    return json(res, 200, rows);
  }
  if (p === '/api/automations' && m === 'POST') {
    const b = await readBody(req);
    if (!b.name || !Array.isArray(b.steps) || !b.steps.length)
      return json(res, 400, { error: 'name and at least one step required' });
    const i = db.prepare(
      `INSERT INTO automations (name,trigger_type,trigger_status,enabled,created_at) VALUES (?,?,?,?,?)`
    ).run(b.name, b.trigger_type || 'contact_created', b.trigger_status || '', b.enabled === false ? 0 : 1, nowISO());
    const st = db.prepare('INSERT INTO automation_steps (automation_id,step_order,delay_minutes,body) VALUES (?,?,?,?)');
    b.steps.forEach((s, idx) => st.run(i.lastInsertRowid, idx + 1, Number(s.delay_minutes) || 0, s.body || ''));
    return json(res, 201, { id: i.lastInsertRowid });
  }
  if (/^\/api\/automations\/\d+$/.test(p) && m === 'PATCH') {
    const b = await readBody(req);
    if (b.enabled !== undefined)
      db.prepare('UPDATE automations SET enabled=? WHERE id=?').run(b.enabled ? 1 : 0, id());
    return json(res, 200, { ok: true });
  }
  if (/^\/api\/automations\/\d+$/.test(p) && m === 'DELETE') {
    db.prepare('DELETE FROM automation_steps WHERE automation_id=?').run(id());
    db.prepare('DELETE FROM automations WHERE id=?').run(id());
    return json(res, 200, { ok: true });
  }

  /* Secrets are never echoed back to the browser — the UI shows a mask, and a
     value still wearing that mask on save means "unchanged", so it's skipped. */
  const SECRET_KEYS = ['twilio_auth_token', 'typeform_secret', 'calendly_secret'];

  if (p === '/api/settings' && m === 'GET') {
    const s = allSettings();
    /* Reflect the value actually in force, which may come from the
       environment rather than the database — otherwise a secret supplied as
       an env var looks unset, and someone re-enters it into crm.db. */
    for (const k of Object.keys(DEFAULT_SETTINGS)) {
      if (isEnvManaged(k)) s[k] = getSetting(k);
    }
    for (const k of SECRET_KEYS) s[k] = s[k] ? '••••••••' : '';
    s.env_managed = Object.keys(DEFAULT_SETTINGS).filter(isEnvManaged);
    return json(res, 200, s);
  }
  if (p === '/api/settings' && m === 'POST') {
    const b = await readBody(req);
    for (const [k, v] of Object.entries(b)) {
      if (SECRET_KEYS.includes(k) && String(v).startsWith('••')) continue;
      if (k in DEFAULT_SETTINGS) setSetting(k, v);
    }
    return json(res, 200, { ok: true });
  }

  /* Twilio posts form-encoded inbound messages here. Handles STOP/START. */
  if (p === '/api/webhooks/twilio/inbound' && m === 'POST') {
    const f = await formBody(req);
    const from = normalisePhone(f.From || '');
    const text = (f.Body || '').trim();
    const c = db.prepare('SELECT * FROM contacts WHERE phone=?').get(from);

    if (c) {
      db.prepare(`INSERT INTO messages (contact_id,direction,body,status,sent_at,created_at)
                  VALUES (?,'in',?,'received',?,?)`).run(c.id, text, nowISO(), nowISO());

      const word = text.toUpperCase();
      if (['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'].includes(word)) {
        db.prepare('UPDATE contacts SET opted_out=1, updated_at=? WHERE id=?').run(nowISO(), c.id);
        cancelQueued(c.id);
      } else if (['START', 'UNSTOP', 'YES'].includes(word)) {
        db.prepare('UPDATE contacts SET opted_out=0, updated_at=? WHERE id=?').run(nowISO(), c.id);
      }
    }
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    return res.end('<Response></Response>');
  }

  if (p === '/api/preview' && m === 'POST') {
    const b = await readBody(req);
    const c = db.prepare('SELECT * FROM contacts WHERE id=?').get(Number(b.contact_id))
           || { first_name: 'Conor', last_name: 'Murphy', phone: '+353871234567', email: 'conor@example.ie' };
    const text = renderBody(b.body || '', c);
    return json(res, 200, { text, length: text.length, segments: segments(text) });
  }

  /* ============================ CALLING ============================
     Click-to-call bridge: Twilio rings YOUR mobile first, you answer, then
     it dials the lead and connects the two. No browser mic, no SDK, and it
     works from a phone as well as the desktop.                            */

  if (p === '/api/calls/dial' && m === 'POST') {
    const b = await readBody(req);
    const c = db.prepare('SELECT * FROM contacts WHERE id=?').get(Number(b.contact_id));
    if (!c) return json(res, 404, { error: 'contact not found' });

    const agent = normalisePhone(getSetting('agent_phone'));
    const from  = getSetting('twilio_from').trim();
    const sid   = getSetting('twilio_account_sid').trim();
    const token = getSetting('twilio_auth_token').trim();
    const dryRun = getSetting('dry_run') === '1';
    const lead  = normalisePhone(c.phone);

    if (!agent) return json(res, 400, {
      error: 'Add your own mobile under Settings → Your number. It rings first, then we dial the lead.' });

    const callId = db.prepare(
      `INSERT INTO calls (contact_id,direction,status,started_at,created_at)
       VALUES (?,'out','initiated',?,?)`).run(c.id, nowISO(), nowISO()).lastInsertRowid;

    if (dryRun || !sid || !token || !from) {
      db.prepare(`UPDATE calls SET status='simulated', provider_sid=? WHERE id=?`)
        .run('DRYRUN-' + Math.random().toString(36).slice(2, 10), callId);
      return json(res, 200, { ok: true, simulated: true, call_id: callId,
        message: `Dry run — this would ring ${agent}, then dial ${lead}.` });
    }

    const base = (req.headers['x-forwarded-proto'] || 'http') + '://' + req.headers.host;
    /* Twilio blocks the inline `Twiml` parameter on trial accounts, so the call
       instructions are served from /api/twiml/dial and passed as `Url` instead.
       That works on every account tier — but Twilio has to be able to fetch it,
       so the dialler needs a publicly reachable address. */
    if (/^(localhost|127\.|\[?::1)/.test(req.headers.host || '')) {
      db.prepare(`UPDATE calls SET status='failed', error=? WHERE id=?`)
        .run('dialling needs a public URL', callId);
      return json(res, 400, {
        error: 'Calling needs a public address — Twilio fetches the call instructions from this '
             + 'server, and it cannot reach localhost. Run "ngrok http 4300" and open the CRM on '
             + 'the ngrok URL, or deploy it. Texting works fine on localhost.' });
    }

    const safeName = String(c.first_name).replace(/[<>&"']/g, '').slice(0, 40);
    const sig = crypto.createHmac('sha256', SESSION_SECRET)
      .update(lead + '|' + callId).digest('hex').slice(0, 32);
    const twimlUrl = `${base}/api/twiml/dial?to=${encodeURIComponent(lead)}`
                   + `&name=${encodeURIComponent(safeName)}&call=${callId}&sig=${sig}`;

    try {
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`, {
        method: 'POST',
        headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
                   'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          To: agent, From: from, Url: twimlUrl, Method: 'GET',
          StatusCallback: `${base}/api/webhooks/twilio/voice-status?call_id=${callId}`,
          StatusCallbackEvent: 'completed'
        })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        db.prepare(`UPDATE calls SET status='failed', error=? WHERE id=?`)
          .run(String(j.message || 'Twilio HTTP ' + r.status).slice(0, 300), callId);
        return json(res, 400, { error: j.message || 'Twilio HTTP ' + r.status });
      }
      db.prepare(`UPDATE calls SET provider_sid=?, status='ringing' WHERE id=?`).run(j.sid || '', callId);
      return json(res, 200, { ok: true, call_id: callId, sid: j.sid,
        message: `Ringing ${agent} now — answer it and you'll be connected to ${c.first_name}.` });
    } catch (e) {
      db.prepare(`UPDATE calls SET status='failed', error=? WHERE id=?`).run(e.message, callId);
      return json(res, 500, { error: e.message });
    }
  }

  if (p === '/api/calls' && m === 'GET') {
    const cid = url.searchParams.get('contact_id');
    return json(res, 200, cid
      ? db.prepare('SELECT * FROM calls WHERE contact_id=? ORDER BY id DESC').all(Number(cid))
      : db.prepare(`SELECT ca.*, c.first_name, c.last_name, c.phone
                      FROM calls ca JOIN contacts c ON c.id=ca.contact_id
                     ORDER BY ca.id DESC LIMIT 200`).all());
  }

  /* Disposition a call — outcome + notes, entered by the rep after hanging up. */
  if (/^\/api\/calls\/\d+$/.test(p) && m === 'PATCH') {
    const b = await readBody(req);
    db.prepare(`UPDATE calls SET outcome = COALESCE(?, outcome),
                                 notes   = COALESCE(?, notes),
                                 duration_seconds = COALESCE(?, duration_seconds)
                 WHERE id=?`)
      .run(b.outcome ?? null, b.notes ?? null,
           b.duration_seconds === undefined ? null : Number(b.duration_seconds), id());
    return json(res, 200, { ok: true });
  }

  /* Call instructions, fetched by Twilio when it answers the agent's leg.
     Necessarily public — Twilio can't sign in — so the URL carries an HMAC.
     Without that, anyone could make this bridge a call to any number they
     liked, including premium-rate ones, on your account. */
  if (p === '/api/twiml/dial' && (m === 'GET' || m === 'POST')) {
    const to   = url.searchParams.get('to') || '';
    const name = url.searchParams.get('name') || '';
    const call = url.searchParams.get('call') || '';
    const sig  = url.searchParams.get('sig') || '';

    const expect = crypto.createHmac('sha256', SESSION_SECRET)
      .update(to + '|' + call).digest('hex').slice(0, 32);
    const ok = sig.length === expect.length &&
               crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect));

    res.writeHead(200, { 'Content-Type': 'text/xml' });
    if (!ok) {
      console.warn('[twiml] refused: bad signature');
      return res.end('<Response><Say>This call could not be authorised.</Say><Hangup/></Response>');
    }

    const callerId = getSetting('twilio_from').trim();
    const safe = String(name).replace(/[<>&"']/g, '');
    return res.end(
      `<Response><Say voice="alice">Connecting you to ${safe}</Say>` +
      `<Dial callerId="${callerId}" timeout="25">${to.replace(/[^\d+]/g, '')}</Dial></Response>`);
  }

  /* Twilio posts here when the call ends, with the real duration. */
  if (p === '/api/webhooks/twilio/voice-status' && m === 'POST') {
    const f = await formBody(req);
    const callId = Number(url.searchParams.get('call_id'));
    if (callId) {
      db.prepare(`UPDATE calls SET status=?, duration_seconds=? WHERE id=?`)
        .run(f.CallStatus || 'completed', Number(f.CallDuration || 0), callId);
    }
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    return res.end('<Response></Response>');
  }

  /* ============================ REPORTING ============================ */

  if (p === '/api/reports/weekly' || p === '/api/reports/weekly.csv') {
    // Week runs Monday 00:00 -> Sunday 23:59:59 local.
    const anchor = url.searchParams.get('start')
      ? new Date(url.searchParams.get('start') + 'T00:00:00')
      : new Date();
    const start = new Date(anchor);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));   // back to Monday
    start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setDate(end.getDate() + 7);

    const from = start.toISOString(), to = end.toISOString();
    const n = (sql, ...a) => db.prepare(sql).get(...a).c;

    const newLeads = n(`SELECT COUNT(*) c FROM contacts WHERE created_at>=? AND created_at<?`, from, to);
    const smsSent  = n(`SELECT COUNT(*) c FROM messages WHERE direction='out'
                          AND status IN ('sent','simulated') AND sent_at>=? AND sent_at<?`, from, to);
    const replies  = n(`SELECT COUNT(*) c FROM messages WHERE direction='in'
                          AND created_at>=? AND created_at<?`, from, to);

    // A "conversation" = a lead who replied by SMS or actually connected on a call.
    const conversations = n(`SELECT COUNT(*) c FROM (
        SELECT contact_id FROM messages WHERE direction='in' AND created_at>=? AND created_at<?
        UNION
        SELECT contact_id FROM calls    WHERE created_at>=? AND created_at<?
               AND (duration_seconds>0 OR outcome IN ('connected','booked'))
      )`, from, to, from, to);

    const dials     = n(`SELECT COUNT(*) c FROM calls WHERE created_at>=? AND created_at<?`, from, to);
    const connected = n(`SELECT COUNT(*) c FROM calls WHERE created_at>=? AND created_at<?
                           AND (duration_seconds>0 OR outcome IN ('connected','booked'))`, from, to);
    const talkTime  = db.prepare(`SELECT COALESCE(SUM(duration_seconds),0) c FROM calls
                                   WHERE created_at>=? AND created_at<?`).get(from, to).c;

    const stage = s => n(`SELECT COUNT(*) c FROM stage_events WHERE to_status=?
                            AND created_at>=? AND created_at<?`, s, from, to);
    const booked = stage('Booked'), showed = stage('Showed'),
          closed = stage('Closed'), lost = stage('Lost');

    const optOuts = n(`SELECT COUNT(*) c FROM contacts WHERE opted_out=1
                         AND updated_at>=? AND updated_at<?`, from, to);

    const pct = (a, b) => b ? Math.round((a / b) * 1000) / 10 : 0;
    /* Label from LOCAL date parts. toISOString() would roll midnight in
       Irish summer time back to the previous day and mislabel the week. */
    const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const label = ymd(start);

    const rows = [
      ['Week starting (Mon)', label],
      ['New leads', newLeads],
      ['Conversations had', conversations],
      ['SMS sent', smsSent],
      ['SMS replies received', replies],
      ['Dials made', dials],
      ['Calls connected', connected],
      ['Talk time (minutes)', Math.round(talkTime / 60)],
      ['Calls booked', booked],
      ['Calls showed', showed],
      ['Calls closed', closed],
      ['Lost', lost],
      ['Opt-outs', optOuts],
      ['Connect rate %', pct(connected, dials)],
      ['Show rate %', pct(showed, booked)],
      ['Close rate %', pct(closed, showed)],
      ['Booked per 100 leads', pct(booked, newLeads)]
    ];

    if (p.endsWith('.csv')) {
      const csv = 'Metric,Value\n' + rows.map(r => `"${r[0]}",${r[1]}`).join('\n') + '\n';
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="els-weekly-${label}.csv"`
      });
      return res.end(csv);
    }

    return json(res, 200, {
      week_start: label,
      week_end: ymd(new Date(end - 1)),
      rows,
      metrics: { newLeads, conversations, smsSent, replies, dials, connected,
                 talkMinutes: Math.round(talkTime / 60), booked, showed, closed, lost, optOuts,
                 connectRate: pct(connected, dials), showRate: pct(showed, booked),
                 closeRate: pct(closed, showed) }
    });
  }

  if (p === '/api/tick' && m === 'POST') { await tick(); return json(res, 200, { ok: true }); }

  return json(res, 404, { error: 'no such endpoint' });
}

/* ------------------------------------------------------------------ server */
/* json() and readBody() are function declarations, so they're hoisted and
   available to the auth module even though they're defined further up. */
const auth = require('./auth')({
  db, json, readBody,
  sessionSecret: SESSION_SECRET,
  adminEmail: ADMIN_EMAIL
});

/* Typeform + Calendly. These post their own signed payloads, so they read the
   raw body themselves rather than going through readBody(). */
const integrations = require('./integrations')({
  db, json, getSetting, nowISO, normalisePhone, fireTriggers, tick
});

const sec = require('./security');

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  sec.applyHeaders(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  /* CSRF defence in depth. SameSite=Lax already stops cross-site cookie POSTs;
     this rejects any state-changing request carrying a foreign Origin. */
  if (['POST', 'PATCH', 'DELETE'].includes(req.method) && !sec.sameOrigin(req)) {
    return json(res, 403, { error: 'Cross-origin request refused' });
  }

  try {
    /* Health check — hosts poll this to decide if the container is alive. */
    if (p === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, uptime: Math.round(process.uptime()) }));
    }

    /* Sign up, sign in, sign out, and the admin approval queue. */
    if (await auth.routes(req, res, url)) return;

    /* Typeform / Calendly. Checked before the session gate — they authenticate
       with an HMAC signature instead, since neither service can log in. */
    if (await integrations.routes(req, res, url)) return;

    /* Everything else needs an approved account. */
    if (!auth.OPEN_PATHS.has(p) && !auth.sessionUser(req)) {
      if (p.startsWith('/api/')) return json(res, 401, { error: 'Not signed in' });
      return serveStatic(res, '/login.html');
    }

    if (p.startsWith('/api/')) return await api(req, res, url);
    return serveStatic(res, p);
  } catch (e) {
    return json(res, 500, { error: sec.safeError(e, 'request') });
  }
}).listen(PORT, () => {
  const s = allSettings();
  const users = auth.userCount();
  console.log(`\n  ELITE LEVEL SALES — CRM`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  SMS mode: ${s.dry_run === '1' ? 'DRY RUN (nothing is actually sent)' : 'LIVE via Twilio'}`);
  console.log(`  Quiet hours: ${s.quiet_start}:00 - ${s.quiet_end}:00`);
  console.log(`  Data dir: ${DATA_DIR}`);
  console.log(users === 0
    ? `  Accounts: none yet — the first sign-up${ADMIN_EMAIL ? ` from ${ADMIN_EMAIL}` : ''} becomes admin\n`
    : `  Accounts: ${users} total, ${auth.pendingCount()} awaiting your approval\n`);
});
