/** Logical scene coordinate helpers. The scene always remains 1920 × 1080. */
export const SCENE_WIDTH = 1920;
export const SCENE_HEIGHT = 1080;

export function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

export function toLogical(clientX, clientY, element, width = SCENE_WIDTH, height = SCENE_HEIGHT) {
  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height) return { x: 0, y: 0 };
  return {
    x: clamp((clientX - rect.left) * width / rect.width, 0, width),
    y: clamp((clientY - rect.top) * height / rect.height, 0, height),
  };
}

export function fromLogical(x, y, element, width = SCENE_WIDTH, height = SCENE_HEIGHT) {
  const rect = element.getBoundingClientRect();
  return { x: rect.left + x * rect.width / width, y: rect.top + y * rect.height / height };
}

export function eventToLogical(event, element, width = SCENE_WIDTH, height = SCENE_HEIGHT) {
  return toLogical(event.clientX, event.clientY, element, width, height);
}

export function rectToCss(zone, element, width = SCENE_WIDTH, height = SCENE_HEIGHT) {
  const rect = element.getBoundingClientRect();
  return {
    left: `${zone.x * rect.width / width}px`, top: `${zone.y * rect.height / height}px`,
    width: `${zone.width * rect.width / width}px`, height: `${zone.height * rect.height / height}px`,
  };
}

export function logicalRectFromPoints(start, current) {
  return {
    x: Math.min(start.x, current.x), y: Math.min(start.y, current.y),
    width: Math.abs(current.x - start.x), height: Math.abs(current.y - start.y),
  };
}
