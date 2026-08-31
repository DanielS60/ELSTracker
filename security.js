/* ===========================================================================
   Security helpers: response headers, input validation, origin checks.

   Nothing here makes the app "unhackable" — that isn't achievable. What it
   does is close the specific holes this codebase actually has: missing
   headers, unvalidated enum values, unbounded string inputs, and error
   responses that leak internals.
   =========================================================================== */
'use strict';

const IS_PROD = process.env.NODE_ENV === 'production';

/* Content-Security-Policy.
   NOTE ON script-src: the UI attaches behaviour with inline onclick=""
   attributes, so 'unsafe-inline' is required for scripts until those are
   refactored to delegated listeners. Everything else is locked down —
   crucially script-src allows no external origins, so even if markup were
   injected it could not pull in a remote payload. */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",        // clickjacking
  "object-src 'none'",
  "base-uri 'none'"                // stops <base> hijacking relative URLs
].join('; ');

function applyHeaders(req, res) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  // Only meaningful over TLS, and only safe to send when we know we're on it.
  if (req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  // Lead data should never sit in a shared or browser cache.
  res.setHeader('Cache-Control', 'no-store');
}

/* ---------------------------------------------------------------- validation */

/** Returns the value only if it's in the allowed list, else undefined. */
function enumOr(value, allowed) {
  return allowed.includes(value) ? value : undefined;
}

/** Trim, cap length, and strip control characters (including NUL) that have
    no business in a name, note or tag. Newlines and tabs are preserved. */
function str(value, maxLen = 500) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim()
    .slice(0, maxLen);
}

/** Defence in depth against CSRF. SameSite=Lax already blocks cross-site
    cookie-bearing POSTs; this rejects anything whose Origin isn't us.
    Requests with no Origin header (curl, server-to-server) pass through so
    webhooks keep working — those authenticate with an HMAC signature. */
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    return new URL(origin).host === host;
  } catch { return false; }
}

/** Client-safe error text. Real detail goes to the server log, never the wire. */
function safeError(err, label) {
  console.error(`[${label}]`, err && err.stack ? err.stack : err);
  return IS_PROD ? 'Something went wrong' : String((err && err.message) || err);
}

module.exports = { applyHeaders, enumOr, str, sameOrigin, safeError, IS_PROD, CSP };
