import { normalizeText } from '../utils/normalize.js';

export const DEFAULT_CUSTOMIZATION = Object.freeze({ skin: 'classic', eyes: 'cute', mouth: 'cat', hat: 'leaf', prop: 'none' });
export const CUSTOMIZATION_ALIASES = {
  skin: { classic: ['classic', 'классика', 'классическая', 'оранжевая'], ghost: ['ghost', 'призрак', 'призрачная'], vampire: ['vampire', 'вампир', 'вампирская'], witch: ['witch', 'ведьма', 'фиолетовая'], gold: ['gold', 'золотая', 'золото'] },
  eyes: { cute: ['cute', 'милые', 'круглые'], sly: ['sly', 'хитрые', 'прищур'], stars: ['stars', 'звёзды', 'звезды', 'звёздные', 'звездные'], sleepy: ['sleepy', 'сонные', 'сонный'], hypno: ['hypno', 'спирали', 'гипноз', 'гипно'] },
  mouth: { cat: ['cat', 'улыбка', 'милый рот', 'кот'], fangs: ['fangs', 'клыки', 'вампирские зубы'], jack: ['jack', 'ухмылка', 'джек', 'тыквенная улыбка'], candy: ['candy', 'конфетка', 'леденец', 'конфета'], o: ['o', 'о', 'удивление', 'удивлённый', 'удивленный'] },
  hat: { witch: ['witch', 'ведьма', 'шляпа', 'ведьмина шляпа'], halo: ['halo', 'нимб', 'ангел'], horns: ['horns', 'рожки', 'рога', 'дьявол'], cat_ears: ['cat_ears', 'кот', 'ушки', 'кошачьи', 'кошачьи_ушки'], crown: ['crown', 'корона', 'король', 'королева'], leaf: ['leaf', 'листик', 'лист', 'без шляпы'] },
  prop: { lantern: ['lantern', 'фонарик', 'фонарь'], broom: ['broom', 'метла', 'веник'], cape: ['cape', 'плащ', 'шарф', 'накидка'], spider: ['spider', 'паучок', 'паук', 'паутинка'], candle: ['candle', 'свечка', 'свеча'], none: ['none', 'нет', 'ничего', 'без аксессуара'] },
};

const normalizedAliases = Object.fromEntries(Object.entries(CUSTOMIZATION_ALIASES).map(([slot, values]) => [slot, Object.fromEntries(Object.entries(values).flatMap(([value, aliases]) => aliases.map((alias) => [normalizeText(alias).toLocaleLowerCase(), value])))]));
const slots = Object.keys(CUSTOMIZATION_ALIASES);
export function parseCustomization(message, base = DEFAULT_CUSTOMIZATION) {
  const text = normalizeText(message, 4000).toLocaleLowerCase();
  const result = { ...DEFAULT_CUSTOMIZATION, ...base }; const match = /^!тыковка(?:\s+|$)(.*)$/iu.exec(text);
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
