export const DEFAULT_PUMPKIN_NAME_FONT_SIZE = 14;
export const PUMPKIN_NAME_FONT_SIZE_LIMITS = Object.freeze({ min: 8, max: 48 });

export function pumpkinNameFontSize(value, fallback = DEFAULT_PUMPKIN_NAME_FONT_SIZE) {
  if (value === undefined) return fallback;
  const size = Number(value);
  return Number.isInteger(size)
    && size >= PUMPKIN_NAME_FONT_SIZE_LIMITS.min
    && size <= PUMPKIN_NAME_FONT_SIZE_LIMITS.max
    ? size
    : null;
}
