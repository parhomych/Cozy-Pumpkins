export function normalizeText(value, maxLength = 256) {
  return String(value ?? '').normalize('NFKC').trim().slice(0, maxLength);
}
export function normalizeName(value) { return normalizeText(value, 128).toLocaleLowerCase(); }
export function finiteNumber(value, { min = -Infinity, max = Infinity } = {}) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}
export function safeId(value, maxLength = 256) {
  const id = normalizeText(value, maxLength);
  return id && /^[\p{L}\p{N}_.:@/-]+$/u.test(id) ? id : null;
}
