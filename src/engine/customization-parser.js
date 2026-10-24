import { normalizeText } from '../utils/normalize.js';

export const DEFAULT_CUSTOMIZATION = Object.freeze({ skin: 'classic', eyes: 'cute', mouth: 'cat', hat: 'none', prop: 'none' });
export const CUSTOMIZATION_ALIASES = {
  skin: { classic: ['classic', 'классика', 'классическая', 'оранжевая'], ghost: ['ghost', 'призрак', 'призрачная'], vampire: ['vampire', 'вампир', 'вампирская'], witch: ['witch', 'ведьма', 'фиолетовая'], gold: ['gold', 'золотая', 'золото'] },
  eyes: { cute: ['cute', 'милые', 'круглые'], sly: ['sly', 'хитрые', 'прищур'], stars: ['stars', 'звёзды', 'звезды', 'звёздные', 'звездные'], sleepy: ['sleepy', 'сонные', 'сонный'], hypno: ['hypno', 'спирали', 'гипноз', 'гипно'], neca_eyes: ['neca_eyes', 'neca eyes', 'глаза неки'] },
  mouth: { cat: ['cat', 'улыбка', 'милый рот', 'кот'], fangs: ['fangs', 'клыки', 'вампирские зубы'], jack: ['jack', 'ухмылка', 'джек', 'тыквенная улыбка'], candy: ['candy', 'конфетка', 'леденец', 'конфета'], o: ['o', 'о', 'удивление', 'удивлённый', 'удивленный'], neca_mouth: ['neca_mouth', 'neca mouth', 'рот неки'] },
  hat: { witch: ['witch hat', 'witch_hat', 'шляпа ведьмы', 'ведьминская шляпа'] },
  prop: {
    none: ['none', 'нет', 'ничего', 'без аксессуара'],
    cocoa_hands: ['cocoa_hands', 'cocoa hands', 'cocoa', 'какао', 'руки с какао'],
    blanket: ['blanket', 'plaid', 'плед', 'пледик', 'одеяло', 'одеялко'],
  },
};

const normalizedAliases = Object.fromEntries(Object.entries(CUSTOMIZATION_ALIASES).map(([slot, values]) => [slot, Object.fromEntries(Object.entries(values).flatMap(([value, aliases]) => aliases.map((alias) => [normalizeText(alias).toLocaleLowerCase(), value])))]));
const slots = Object.keys(CUSTOMIZATION_ALIASES);
const requestAliases = Object.entries(CUSTOMIZATION_ALIASES).flatMap(([slot, values]) =>
  Object.entries(values).flatMap(([value, aliases]) => aliases.map((alias) => {
    const normalized = normalizeText(alias).toLocaleLowerCase();
    const pattern = normalized.split(/\s+/u).map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('\\s+');
    return { slot, value, length: normalized.length, pattern: new RegExp(`^${pattern}(?![\\p{L}\\p{N}_])`, 'iu') };
  })),
).sort((left, right) => right.length - left.length);
const REQUEST_MAX_LENGTH = 256;
const WORD_CHARACTER = /[\p{L}\p{N}_]/u;

export function parseCustomizationRequest(message) {
  const text = String(message ?? '').normalize('NFKC');
  if (text.length > REQUEST_MAX_LENGTH) return [];
  const normalized = text.trim().toLocaleLowerCase();
  const changes = [];
  for (let position = 0; position < normalized.length;) {
    if (position > 0 && WORD_CHARACTER.test(normalized[position - 1])) {
      position += 1;
      continue;
    }
    let recognized = null;
    for (const alias of requestAliases) {
      const match = alias.pattern.exec(normalized.slice(position));
      if (match) {
        recognized = { ...alias, matchedLength: match[0].length };
        break;
      }
    }
    if (!recognized) {
      position += 1;
      continue;
    }
    changes.push({ slot: recognized.slot, value: recognized.value });
    position += recognized.matchedLength;
  }
  return changes;
}

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
