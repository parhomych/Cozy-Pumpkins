import { normalizeText } from '../utils/normalize.js';

export const DEFAULT_CUSTOMIZATION = Object.freeze({ skin: 'classic', eyes: 'cute', mouth: 'cat', hat: 'leaf', prop: 'none' });
export const CUSTOMIZATION_ALIASES = {
  skin: { classic: ['classic', 'классика', 'классическая', 'оранжевая'], ghost: ['ghost', 'призрак', 'призрачная'], vampire: ['vampire', 'вампир', 'вампирская'], witch: ['witch', 'ведьма', 'фиолетовая'], gold: ['gold', 'золотая', 'золото'] },
  eyes: { cute: ['cute', 'милые', 'круглые'], sly: ['sly', 'хитрые', 'прищур'], stars: ['stars', 'звёзды', 'звезды', 'звёздные', 'звездные'], sleepy: ['sleepy', 'сонные', 'сонный'], hypno: ['hypno', 'спирали', 'гипноз', 'гипно'], neca_eyes: ['neca_eyes', 'neca eyes', 'глаза неки'] },
  mouth: { cat: ['cat', 'улыбка', 'милый рот', 'кот'], fangs: ['fangs', 'клыки', 'вампирские зубы'], jack: ['jack', 'ухмылка', 'джек', 'тыквенная улыбка'], candy: ['candy', 'конфетка', 'леденец', 'конфета'], o: ['o', 'о', 'удивление', 'удивлённый', 'удивленный'], neca_mouth: ['neca_mouth', 'neca mouth', 'рот неки'] },
  hat: {},
  prop: {},
};

const normalizedAliases = Object.fromEntries(Object.entries(CUSTOMIZATION_ALIASES).map(([slot, values]) => [slot, Object.fromEntries(Object.entries(values).flatMap(([value, aliases]) => aliases.map((alias) => [normalizeText(alias).toLocaleLowerCase(), value])))]));
const slots = Object.keys(CUSTOMIZATION_ALIASES);
export function parseCustomization(message, base = DEFAULT_CUSTOMIZATION, command = '!тыковка') {
  const text = normalizeText(message, 4000).toLocaleLowerCase();
  const result = { ...DEFAULT_CUSTOMIZATION, ...base };
  const prefix = String(command || '').normalize('NFKC').trim().replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  if (!prefix) return { customization: result, commandDetected: false, recognized: false };
  const match = new RegExp(`^${prefix}(?:\\s+|$)(.*)$`, 'iu').exec(text);
  if (!match) return { customization: result, commandDetected: false, recognized: false };
  const tokens = match[1].split(/\s+/u).filter(Boolean); let recognized = false;
  for (let i = 0; i < tokens.length; i += 1) {
    for (const slot of slots) {
      let found = null;
      for (let size = Math.min(3, tokens.length - i); size >= 1 && !found; size -= 1) {
        const alias = tokens.slice(i, i + size).join(' '); const value = normalizedAliases[slot][alias];
        if (value) found = { value, size };
      }
      if (found) { result[slot] = found.value; recognized = true; if (found.size > 1) i += found.size - 1; }
    }
  }
  return { customization: result, commandDetected: true, recognized };
}
export function sanitizeCustomization(value, base = DEFAULT_CUSTOMIZATION) {
  const result = { ...DEFAULT_CUSTOMIZATION, ...base };
  for (const slot of slots) if (typeof value?.[slot] === 'string' && CUSTOMIZATION_ALIASES[slot][value[slot]]) result[slot] = value[slot];
  return result;
}
export function customizationValues() { return Object.fromEntries(slots.map((slot) => [slot, Object.keys(CUSTOMIZATION_ALIASES[slot])])); }
export function customizationCatalog() {
  return slots.map((slot) => ({
    slot,
    values: Object.entries(CUSTOMIZATION_ALIASES[slot]).map(([value, keywords]) => ({ value, keywords: [...keywords] })),
  }));
}
