/* ===========================================================================
   Accounts with admin approval.

   Anyone can request access; nobody gets in until an admin approves them.
   Passwords are scrypt-hashed with a per-user salt — never stored readable.
   Sessions are a signed cookie carrying only {uid, exp}, so a restart does
   not log everyone out, and the cookie proves nothing on its own.
   =========================================================================== */
'use strict';

const crypto = require('node:crypto');

module.exports = function createAuth({ db, json, readBody, sessionSecret, adminEmail }) {

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      email         TEXT NOT NULL UNIQUE,
      name          TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      salt          TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected | disabled
      role          TEXT NOT NULL DEFAULT 'member',    -- admin | member
      created_at    TEXT NOT NULL,
      approved_at   TEXT,
      approved_by   TEXT DEFAULT '',
      last_login    TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  `);

  const nowISO = () => new Date().toISOString();
  const norm = e => String(e || '').trim().toLowerCase();

  /* ------------------------------------------------------------- passwords */
  function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
    return { hash: crypto.scryptSync(password, salt, 64).toString('hex'), salt };
  }
  function passwordMatches(password, user) {
    const attempt = Buffer.from(crypto.scryptSync(password, user.salt, 64).toString('hex'));
    const stored  = Buffer.from(user.password_hash);
    if (attempt.length !== stored.length) return false;
    return crypto.timingSafeEqual(attempt, stored);
  }

  /* -------------------------------------------------------------- sessions */
  const SESSION_DAYS = 14;
  function sign(uid) {
    const payload = Buffer.from(JSON.stringify({
      uid, exp: Date.now() + SESSION_DAYS * 86400000
    })).toString('base64url');
    const mac = crypto.createHmac('sha256', sessionSecret).update(payload).digest('base64url');
    return `${payload}.${mac}`;
  }
  function readToken(token) {
    if (!token || !token.includes('.')) return null;
    const [payload, mac] = token.split('.');
    const expect = crypto.createHmac('sha256', sessionSecret).update(payload).digest('base64url');
    if (mac.length !== expect.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
    try {
      const d = JSON.parse(Buffer.from(payload, 'base64url').toString());
      return d.exp > Date.now() ? d : null;
    } catch { return null; }
  }
  function cookies(req) {
    return Object.fromEntries((req.headers.cookie || '').split(';')
      .map(c => c.trim().split('='))
      .filter(p => p[0])
      .map(p => [p[0], decodeURIComponent(p.slice(1).join('='))]));
  }

  /** The signed-in user, or null. Re-read from the DB each time so revoking
      an account takes effect immediately rather than in two weeks. */
  function sessionUser(req) {
    const d = readToken(cookies(req).els_session);
    if (!d) return null;
    const u = db.prepare('SELECT id,email,name,status,role FROM users WHERE id=?').get(d.uid);
    return (u && u.status === 'approved') ? u : null;
  }

  function setCookie(res, req, uid) {
    const secure = req.headers['x-forwarded-proto'] === 'https' ? ' Secure;' : '';
    res.setHeader('Set-Cookie',
      `els_session=${sign(uid)}; HttpOnly; SameSite=Lax; Path=/;${secure} Max-Age=${SESSION_DAYS * 86400}`);
  }

  /* --------------------------------------------------------- brute forcing */
  const attempts = new Map();                       // ip -> {n, until}
  const throttled = ip => { const a = attempts.get(ip); return a && a.n >= 8 && Date.now() < a.until; };
  function noteFailure(ip) {
    const a = attempts.get(ip) || { n: 0, until: 0 };
    a.n += 1;
    a.until = Date.now() + 15 * 60000;              // 15-min lockout after 8 tries
    attempts.set(ip, a);
  }
  const clearFailures = ip => attempts.delete(ip);

  /* -------------------------------------------------------------- bootstrap
     The first account is the risky one — on a public URL whoever signs up
     first would otherwise become admin. If ADMIN_EMAIL is set, only that
     address can claim it. */
  function isFirstAdmin(email) {
    /* When ADMIN_EMAIL is set, that address is the owner and is auto-approved
       as admin whenever they sign up — not only if they happen to be first.
       Checking "no users yet" first would let any stranger who signs up ahead
       of them permanently block the real admin, leaving nobody able to
       approve anyone and the whole system locked. */
    if (adminEmail) return norm(email) === norm(adminEmail);
    /* No ADMIN_EMAIL configured (local dev): first account wins. */
    return db.prepare('SELECT COUNT(*) c FROM users').get().c === 0;
  }

  /* ------------------------------------------------------------------ routes
     Returns true when it has handled the request. */
  async function routes(req, res, url) {
    const p = url.pathname;
    const m = req.method;
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '')
      .split(',')[0].trim();

    /* --- who am I --- */
    if (p === '/api/auth/me' && m === 'GET') {
      const u = sessionUser(req);
      json(res, u ? 200 : 401, u ? { user: u } : { error: 'Not signed in' });
      return true;
    }

    /* --- request access --- */
    if (p === '/api/auth/signup' && m === 'POST') {
      const b = await readBody(req);
      const email = norm(b.email);
      const name = String(b.name || '').trim();
      const password = String(b.password || '');

      if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 8) {
        json(res, 400, { error: 'Enter a valid email and a password of at least 8 characters.' });
        return true;
      }
      if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) {
        json(res, 200, { ok: true, status: 'pending' });   // don't confirm which emails exist
        return true;
      }

      const first = isFirstAdmin(email);
      const { hash, salt } = hashPassword(password);
      db.prepare(
        `INSERT INTO users (email,name,password_hash,salt,status,role,created_at,approved_at,approved_by)
         VALUES (?,?,?,?,?,?,?,?,?)`
      ).run(email, name, hash, salt,
            first ? 'approved' : 'pending',
            first ? 'admin' : 'member',
            nowISO(), first ? nowISO() : null, first ? 'bootstrap' : '');

      json(res, 200, { ok: true, status: first ? 'approved' : 'pending', admin: first });
      return true;
    }

    /* --- sign in --- */
    if (p === '/api/auth/login' && m === 'POST') {
      if (throttled(ip)) {
        json(res, 429, { error: 'Too many attempts. Try again in 15 minutes.' });
        return true;
      }
      const b = await readBody(req);
      const u = db.prepare('SELECT * FROM users WHERE email=?').get(norm(b.email));

      // Identical response for unknown email and wrong password.
      if (!u || !passwordMatches(String(b.password || ''), u)) {
        noteFailure(ip);
        await new Promise(r => setTimeout(r, 500));
        json(res, 401, { error: 'Email or password is incorrect.' });
        return true;
      }
      if (u.status === 'pending') {
        json(res, 403, { error: 'Your account is still waiting to be approved.' });
        return true;
      }
      if (u.status !== 'approved') {
        json(res, 403, { error: 'This account does not have access.' });
        return true;
      }

      clearFailures(ip);
      db.prepare('UPDATE users SET last_login=? WHERE id=?').run(nowISO(), u.id);
      setCookie(res, req, u.id);
      json(res, 200, { ok: true, user: { id: u.id, email: u.email, name: u.name, role: u.role } });
      return true;
    }

    /* --- sign out --- */
    if (p === '/api/auth/logout' && m === 'POST') {
      res.setHeader('Set-Cookie', 'els_session=; HttpOnly; Path=/; Max-Age=0');
      json(res, 200, { ok: true });
      return true;
    }

    /* ------------------- admin only from here ------------------- */
    if (p.startsWith('/api/auth/users')) {
      const me = sessionUser(req);
      if (!me || me.role !== 'admin') { json(res, 403, { error: 'Admins only' }); return true; }

      if (p === '/api/auth/users' && m === 'GET') {
        json(res, 200, db.prepare(
          `SELECT id,email,name,status,role,created_at,approved_at,last_login
             FROM users ORDER BY (status='pending') DESC, created_at DESC`).all());
        return true;
      }

      const hit = p.match(/^\/api\/auth\/users\/(\d+)$/);
      if (hit && m === 'PATCH') {
        const uid = Number(hit[1]);
        const b = await readBody(req);
        const target = db.prepare('SELECT * FROM users WHERE id=?').get(uid);
        if (!target) { json(res, 404, { error: 'No such user' }); return true; }

        // Never let the last admin lock everyone out.
        const admins = db.prepare(
          `SELECT COUNT(*) c FROM users WHERE role='admin' AND status='approved'`).get().c;
        const demoting = (b.role && b.role !== 'admin') || (b.status && b.status !== 'approved');
        if (target.role === 'admin' && target.status === 'approved' && demoting && admins <= 1) {
          json(res, 400, { error: 'This is the only admin — promote someone else first.' });
          return true;
        }

        /* Both columns drive authorisation decisions, so neither may be free
           text — an unrecognised value would silently mean "not approved". */
        const USER_STATUSES = ['pending', 'approved', 'rejected', 'disabled'];
        const USER_ROLES = ['admin', 'member'];
        if (b.status !== undefined && !USER_STATUSES.includes(b.status)) {
          json(res, 400, { error: 'Unknown status' }); return true;
        }
        if (b.role !== undefined && !USER_ROLES.includes(b.role)) {
          json(res, 400, { error: 'Unknown role' }); return true;
        }

        if (b.status) {
          db.prepare('UPDATE users SET status=?, approved_at=?, approved_by=? WHERE id=?')
            .run(b.status, b.status === 'approved' ? nowISO() : null, me.email, uid);
        }
        if (b.role) db.prepare('UPDATE users SET role=? WHERE id=?').run(b.role, uid);
        json(res, 200, { ok: true });
        return true;
      }

      if (hit && m === 'DELETE') {
        const uid = Number(hit[1]);
        if (uid === me.id) { json(res, 400, { error: "You can't delete your own account." }); return true; }
        db.prepare('DELETE FROM users WHERE id=?').run(uid);
        json(res, 200, { ok: true });
        return true;
      }
    }

    return false;
  }

  /* Reachable without a session. Twilio can't sign in, so its webhooks stay
     open; everything else falls through to the gate. */
  const OPEN_PATHS = new Set([
    '/health',
    '/api/auth/login', '/api/auth/signup', '/api/auth/me', '/api/auth/logout',
    '/api/webhooks/twilio/inbound', '/api/webhooks/twilio/voice-status',
    '/api/twiml/dial'          // Twilio fetches this mid-call; HMAC-signed instead
  ]);

  const pendingCount = () => db.prepare(`SELECT COUNT(*) c FROM users WHERE status='pending'`).get().c;
  const userCount    = () => db.prepare('SELECT COUNT(*) c FROM users').get().c;

  return { routes, sessionUser, OPEN_PATHS, pendingCount, userCount };
};
