const REDACTED_KEYS = /token|secret|password|authorization|encryption|cookie/i;
function sanitize(value, depth = 0) {
  if (depth > 4) return '[truncated]';
  if (Array.isArray(value)) return value.map((item) => sanitize(item, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, REDACTED_KEYS.test(key) ? '[redacted]' : sanitize(item, depth + 1)]));
  return value;
}
export function createLogger({ logger = console } = {}) {
  return {
    info(message, meta = {}) { logger.info(`[cozy-pumpkins] ${message}`, sanitize(meta)); },
    warn(message, meta = {}) { logger.warn(`[cozy-pumpkins] ${message}`, sanitize(meta)); },
    error(message, meta = {}) { logger.error(`[cozy-pumpkins] ${message}`, sanitize(meta)); },
  };
}
export { sanitize };
