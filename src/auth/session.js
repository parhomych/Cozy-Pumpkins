import crypto from 'node:crypto';
const COOKIE_NAME = 'cozy_pumpkins_admin';
function sign(value, secret) { return crypto.createHmac('sha256', secret).update(value).digest('base64url'); }
export function createSession(secret, ttlMs = 8 * 60 * 60 * 1000) { const payload = `${Date.now() + ttlMs}.${crypto.randomBytes(16).toString('base64url')}`; return `${payload}.${sign(payload, secret)}`; }
export function verifySession(value, secret) { if (!value) return false; const parts = value.split('.'); if (parts.length !== 3) return false; const [expires, nonce, signature] = parts; const payload = `${expires}.${nonce}`; if (!/^\d+$/.test(expires) || Number(expires) < Date.now()) return false; const expected = sign(payload, secret); const actual = Buffer.from(signature); const wanted = Buffer.from(expected); return actual.length === wanted.length && crypto.timingSafeEqual(actual, wanted); }
export function parseCookies(header = '') { const result = {}; for (const part of header.split(';')) { const index = part.indexOf('='); if (index < 0) continue; try { const key = decodeURIComponent(part.slice(0, index).trim()); const value = decodeURIComponent(part.slice(index + 1).trim()); if (key) result[key] = value; } catch { /* ignore malformed cookie */ } } return result; }
export function isLoopbackRequest(req) { const address = req.socket?.remoteAddress || ''; return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'; }
export function sessionMiddleware({ secret, cookieName = COOKIE_NAME } = {}) {
  return (req, res, next) => { const cookies = parseCookies(req.headers.cookie); if (!verifySession(cookies[cookieName], secret) && isLoopbackRequest(req)) { const value = createSession(secret); res.setHeader('Set-Cookie', `${cookieName}=${encodeURIComponent(value)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`); req.adminSession = true; } else req.adminSession = verifySession(cookies[cookieName], secret); next(); };
}
export function requireAdminSession(req, res, next) { if (req.adminSession) return next(); return res.status(401).json({ error: 'admin_session_required' }); }
export function socketHasAdminSession(cookieHeader, secret, cookieName = COOKIE_NAME) { return verifySession(parseCookies(cookieHeader)[cookieName], secret); }
export { COOKIE_NAME };
