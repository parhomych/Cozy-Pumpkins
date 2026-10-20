import crypto from 'node:crypto';

function keyBytes(value) {
  const text = String(value || '');
  if (/^[0-9a-f]{64}$/iu.test(text)) return Buffer.from(text, 'hex');
  return crypto.createHash('sha256').update(text).digest();
}
export class TokenStore {
  constructor(db, encryptionKey) { this.db = db; this.key = keyBytes(encryptionKey); }
  encrypt(plain) {
    if (plain == null || plain === '') return null;
    const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
    return [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
  }
  decrypt(value) {
    if (!value) return null;
    try { const [iv, tag, encrypted] = value.split('.'); const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url')); decipher.setAuthTag(Buffer.from(tag, 'base64url')); return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8'); } catch { return null; }
  }
  save(provider, token) { this.db.saveToken(provider, { ...token, accessTokenEnc: this.encrypt(token.accessToken), refreshTokenEnc: this.encrypt(token.refreshToken) }); }
  get(provider) { const row = this.db.getToken(provider); if (!row) return null; return { accessToken: this.decrypt(row.access_token_enc), refreshToken: this.decrypt(row.refresh_token_enc), expiresAt: row.expires_at, scopes: row.scopes, providerUserId: row.provider_user_id, providerLogin: row.provider_login, updatedAt: row.updated_at }; }
  delete(provider) { this.db.deleteToken(provider); }
}
