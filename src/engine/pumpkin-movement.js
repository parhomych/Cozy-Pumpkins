import { dimensionsFor, isPositionValid } from './spatial-rules.js';
import { DEFAULT_ROAMING_SETTINGS } from './roaming-settings.js';

const MAX_ATTEMPTS = 20;
const MIN_DISTANCE = 30;
const DEFAULT_INTERVAL_MS = DEFAULT_ROAMING_SETTINGS.roamingIntervalSeconds * 1000;

function destinationIsAvailable(pumpkin, x, y, pumpkins, context) {
  if (!isPositionValid(pumpkin, x, y, context)) return false;
  return pumpkins.every((other) => other.id === pumpkin.id
    || Math.abs(x - other.x) >= MIN_DISTANCE);
}

export function findRoamingTarget(pumpkin, pumpkins, context, {
  random = Math.random,
  maxAttempts = MAX_ATTEMPTS,
  minDistance = DEFAULT_ROAMING_SETTINGS.roamingMinDistance,
  maxDistance = DEFAULT_ROAMING_SETTINGS.roamingMaxDistance,
} = {}) {
  if (!pumpkin || pumpkin.isAirborne || pumpkin.parentId || !context?.scene) return null;
  const groundY = Number.isFinite(context.scene.groundY)
    ? context.scene.groundY
    : context.scene.height - context.scene.padding;
  if (Math.abs(pumpkin.y - groundY) > 0.1) return null;
  const attempts = Math.max(0, Math.min(MAX_ATTEMPTS, Math.floor(maxAttempts)));
  const sceneWidth = Number(context.scene.width) || 1920;
  const minimumDistance = Math.max(MIN_DISTANCE, Math.min(sceneWidth, Number(minDistance) || MIN_DISTANCE));
  const maximumDistance = Math.max(minimumDistance, Math.min(sceneWidth, Number(maxDistance) || DEFAULT_ROAMING_SETTINGS.roamingMaxDistance));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const sample = Number(random());
    if (!Number.isFinite(sample)) continue;
    const fraction = Math.max(0, Math.min(1, sample));
    const x = pumpkin.x + (fraction * 2 - 1) * maximumDistance;
    if (Math.abs(x - pumpkin.x) < minimumDistance
      || !destinationIsAvailable(pumpkin, x, groundY, pumpkins, context)) continue;
    return { x, y: groundY };
  }

  const { width } = dimensionsFor(pumpkin, context);
  const minX = width / 2 + context.scene.padding;
  const maxX = context.scene.width - minX;
  const candidates = [];
  for (let x = minX; x <= maxX; x += MIN_DISTANCE) {
    if (Math.abs(x - pumpkin.x) >= minimumDistance
      && Math.abs(x - pumpkin.x) <= maximumDistance
      && destinationIsAvailable(pumpkin, x, groundY, pumpkins, context)) candidates.push(x);
  }
  if (!candidates.length) return null;
  const sample = Number(random());
  const fraction = Number.isFinite(sample) ? Math.max(0, Math.min(1, sample)) : 0;
  const x = candidates[Math.floor(fraction * candidates.length)] ?? candidates[0];
  return { x, y: groundY };
}

export function findJoinedStackRoamingTarget(stack, pumpkins, context, {
  random = Math.random,
  maxAttempts = MAX_ATTEMPTS,
  minDistance = DEFAULT_ROAMING_SETTINGS.roamingMinDistance,
  maxDistance = DEFAULT_ROAMING_SETTINGS.roamingMaxDistance,
} = {}) {
  const members = [...(stack?.members || [])].sort((a, b) => a.level - b.level);
  if (members.length < 2 || members.some((member, index) => member.level !== index) || !context?.scene) return null;
  const byId = new Map(pumpkins.map((pumpkin) => [pumpkin.id, pumpkin]));
  const memberIds = new Set(members.map((member) => member.id));
  const membersWithPumpkins = members.map((member) => {
    const pumpkin = byId.get(member.id);
    return pumpkin ? { member, pumpkin: { ...pumpkin, x: member.x, y: member.y } } : null;
  });
  if (membersWithPumpkins.some((item) => !item)) return null;
  const outsiders = pumpkins.filter((pumpkin) => !memberIds.has(pumpkin.id));
  const baseX = members[0].x;
  const sceneWidth = Number(context.scene.width) || 1920;
  const minimumDistance = Math.max(MIN_DISTANCE, Math.min(sceneWidth, Number(minDistance) || MIN_DISTANCE));
  const maximumDistance = Math.max(minimumDistance, Math.min(sceneWidth, Number(maxDistance) || DEFAULT_ROAMING_SETTINGS.roamingMaxDistance));
  const isAvailable = (deltaX) => membersWithPumpkins.every(({ member, pumpkin }) => {
    const x = member.x + deltaX;
    return isPositionValid(pumpkin, x, member.y, context)
      && outsiders.every((other) => Math.abs(x - other.x) >= MIN_DISTANCE);
  });

  const attempts = Math.max(0, Math.min(MAX_ATTEMPTS, Math.floor(maxAttempts)));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const sample = Number(random());
    if (!Number.isFinite(sample)) continue;
    const deltaX = (Math.max(0, Math.min(1, sample)) * 2 - 1) * maximumDistance;
    if (Math.abs(deltaX) >= minimumDistance && isAvailable(deltaX)) return { x: baseX + deltaX };
  }

  const candidates = [];
  for (let x = Math.max(0, baseX - maximumDistance); x <= Math.min(context.scene.width, baseX + maximumDistance); x += MIN_DISTANCE) {
    const deltaX = x - baseX;
    if (Math.abs(deltaX) >= minimumDistance && isAvailable(deltaX)) candidates.push(x);
  }
  if (!candidates.length) return null;
  const sample = Number(random());
  const fraction = Number.isFinite(sample) ? Math.max(0, Math.min(0.999999, sample)) : 0;
  return { x: candidates[Math.floor(fraction * candidates.length)] };
}

export function createPumpkinMovementScheduler({
  db,
  config,
  joinedStackService = null,
  broadcast = () => {},
  random = Math.random,
  intervalMs = null,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  onError = (error) => console.error('Pumpkin movement scheduler failed', error),
} = {}) {
  let timer = null;
  let cursor = 0;
  let paused = false;
  const pausedPumpkins = new Map();
  const configuredInterval = () => {
    const seconds = Number(db.getSettings(config).roamingIntervalSeconds);
    return intervalMs ?? (Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_INTERVAL_MS);
  };

  const schedule = () => {
    timer = setIntervalFn(() => {
      try { tick(); } catch (error) { onError(error); }
    }, configuredInterval());
    timer.unref?.();
  };

  const tick = () => {
    const settings = db.getSettings(config);
    const pumpkins = db.listPumpkins();
    if (!pumpkins.length || paused) return null;
    const context = { scene: config.scene, noGoZone: settings.noGoZone, growthMultipliers: settings.growthMultipliers };
    const stacks = db.listJoinedStacks();
    const stackByMember = new Map();
    for (const stack of stacks) {
      for (const member of stack.members || []) stackByMember.set(member.id, stack);
    }
    for (let offset = 0; offset < pumpkins.length; offset += 1) {
      const index = (cursor + offset) % pumpkins.length;
      const pumpkin = pumpkins[index];
      const stack = stackByMember.get(pumpkin.id);
      if (stack) {
        const members = [...(stack.members || [])].sort((a, b) => a.level - b.level);
        if (!joinedStackService || members[0]?.id !== pumpkin.id || members.some((member) => pausedPumpkins.has(member.id))) continue;
        const target = findJoinedStackRoamingTarget(stack, pumpkins, context, {
          random,
          minDistance: settings.roamingMinDistance ?? DEFAULT_ROAMING_SETTINGS.roamingMinDistance,
          maxDistance: settings.roamingMaxDistance ?? DEFAULT_ROAMING_SETTINGS.roamingMaxDistance,
        });
        if (!target) continue;
        const movement = joinedStackService.move(stack.stackId, target.x);
        if (!movement) continue;
        cursor = (index + 1) % pumpkins.length;
        const roamingSpeed = settings.roamingSpeed ?? DEFAULT_ROAMING_SETTINGS.roamingSpeed;
        broadcast('pumpkin:stack-move', { ...movement, movementType: 'roam', roamingSpeed });
        return movement;
      }
      if (pausedPumpkins.has(pumpkin.id) || pumpkin.isAirborne || pumpkin.parentId) continue;
      const target = findRoamingTarget(pumpkin, pumpkins, context, {
        random,
        minDistance: settings.roamingMinDistance ?? DEFAULT_ROAMING_SETTINGS.roamingMinDistance,
        maxDistance: settings.roamingMaxDistance ?? DEFAULT_ROAMING_SETTINGS.roamingMaxDistance,
      });
      if (!target) continue;
      const current = db.getPumpkin(pumpkin.id);
      if (!current || current.isAirborne || current.parentId
        || !destinationIsAvailable(current, target.x, target.y, db.listPumpkins(), context)) continue;
      const updated = db.updatePumpkin(current.id, { x: target.x, y: target.y });
      cursor = (index + 1) % pumpkins.length;
      const movement = { id: updated.id, x: updated.x, y: updated.y, isAirborne: false, sequence: -1, movementType: 'roam', roamingSpeed: settings.roamingSpeed ?? DEFAULT_ROAMING_SETTINGS.roamingSpeed, roamingJumpHeight: settings.roamingJumpHeight ?? DEFAULT_ROAMING_SETTINGS.roamingJumpHeight };
      broadcast('pumpkin:move', movement);
      return { id: updated.id, x: updated.x, y: updated.y };
    }
    cursor = (cursor + 1) % pumpkins.length;
    return null;
  };

  return {
    get running() { return timer !== null; },
    start() {
      if (timer !== null) return false;
      schedule();
      return true;
    },
    stop() {
      if (timer === null) return false;
      clearIntervalFn(timer);
      timer = null;
      return true;
    },
    settingsUpdated() {
      if (timer === null) return false;
      clearIntervalFn(timer);
      schedule();
      return true;
    },
    tick,
    pause(id, owner = 'default') {
      if (!pausedPumpkins.has(id)) pausedPumpkins.set(id, new Set());
      pausedPumpkins.get(id).add(owner);
    },
    resume(id, owner = 'default') {
      const owners = pausedPumpkins.get(id);
      owners?.delete(owner);
      if (owners?.size === 0) pausedPumpkins.delete(id);
    },
    remove(id) { pausedPumpkins.delete(id); },
    pauseAll() { paused = true; },
    resumeAll() { paused = false; },
    reset() { paused = false; pausedPumpkins.clear(); },
  };
}
