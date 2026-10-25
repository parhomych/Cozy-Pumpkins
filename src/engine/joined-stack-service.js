import { randomUUID } from 'node:crypto';
import { findSpawnPosition, isPositionValid } from './spatial-rules.js';

function randomUnit(random) {
  const value = Number(random());
  return Number.isFinite(value) ? Math.max(0, Math.min(0.999999, value)) : 0.5;
}

function uniqueMembers(members) {
  return Array.isArray(members)
    && members.length >= 2
    && members.length <= 3
    && members.every((member, index) => member
      && typeof member.id === 'string'
      && Number.isInteger(member.level)
      && member.level === index
      && Number.isFinite(member.x)
      && Number.isFinite(member.y))
    && new Set(members.map((member) => member.id)).size === members.length;
}

function formationDurationMs(memberCount) {
  return 1240 + Math.max(0, memberCount - 1) * 240;
}

export class JoinedStackService {
  constructor({ db, config, broadcast = () => {}, logger = console, random = Math.random, setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout } = {}) {
    Object.assign(this, { db, config, broadcast, logger, random, setTimeoutImpl, clearTimeoutImpl });
    this.timers = new Map();
    this.stopped = false;
  }

  form({ members, animation, targetStackId = null }) {
    if (!uniqueMembers(members)) throw new Error('invalid_joined_stack_members');
    const allPumpkins = this.db.listPumpkins();
    const byId = new Map(allPumpkins.map((pumpkin) => [pumpkin.id, pumpkin]));
    if (members.some(({ id }) => !byId.has(id))) throw new Error('joined_stack_pumpkin_not_found');
    const activeStacks = this.db.listJoinedStacks();
    const targetStack = targetStackId ? activeStacks.find((stack) => stack.stackId === targetStackId) : null;
    if (targetStackId && !targetStack) throw new Error('joined_stack_not_found');
    const occupied = new Map(activeStacks.flatMap((stack) => stack.members.map((member) => [member.id, stack.stackId])));
    const memberIds = new Set(members.map((member) => member.id));
    if (members.some(({ id }) => occupied.has(id) && occupied.get(id) !== targetStackId)) {
      throw new Error('joined_stack_membership_conflict');
    }
    if (targetStack && (targetStack.members.length >= members.length
      || targetStack.members.some(({ id }, index) => members[index]?.id !== id))) {
      throw new Error('joined_stack_membership_conflict');
    }

    const now = new Date();
    const lifetimeSeconds = animation.lifetimeMinSeconds
      + (animation.lifetimeMaxSeconds - animation.lifetimeMinSeconds) * randomUnit(this.random);
    const formedAt = new Date(now.getTime() + formationDurationMs(members.length)).toISOString();
    const stack = {
      ...(targetStack || {}),
      stackId: targetStack?.stackId || randomUUID(),
      state: 'active',
      createdAt: targetStack?.createdAt || now.toISOString(),
      formedAt,
      expiresAt: new Date(Date.parse(formedAt) + lifetimeSeconds * 1000).toISOString(),
      lifetimeSeconds,
      animation: { ...animation },
      members: members.map((member) => ({ ...member })),
      finalPositions: this._planFinalPositions(members),
    };
    if (!stack.finalPositions) throw new Error('no_safe_joined_stack_collapse_layout');
    if (targetStack) this.db.updateJoinedStack(stack);
    else this.db.saveJoinedStack(stack);
    this._schedule(stack);
    return stack;
  }

  start() {
    this.stopped = false;
    for (const stack of this.db.listJoinedStacks()) {
      if (!this._isValidSnapshot(stack)) {
        this.logger.warn('Discarding invalid persisted joined pumpkin stack', { stackId: stack.stackId });
        this.db.deleteJoinedStack(stack.stackId);
      } else if (Date.parse(stack.expiresAt) <= Date.now()) {
        try {
          this.collapse(stack.stackId);
        } catch (error) {
          this.logger.error('Expired joined pumpkin stack recovery failed', { stackId: stack.stackId, reason: error?.message });
          this._scheduleRetry(stack);
        }
      } else {
        this._schedule(stack);
      }
    }
  }

  stop() {
    this.stopped = true;
    for (const timer of this.timers.values()) this.clearTimeoutImpl(timer);
    this.timers.clear();
  }

  activeSnapshots() {
    return this.db.listJoinedStacks().filter((stack) => Date.parse(stack.expiresAt) > Date.now());
  }

  clear() {
    for (const stack of this.db.listJoinedStacks()) this._cancel(stack.stackId);
    this.db.transaction(() => {
      for (const stack of this.db.listJoinedStacks()) this.db.deleteJoinedStack(stack.stackId);
    });
  }

  removePumpkin(pumpkinId) {
    const stack = this.db.listJoinedStacks().find((candidate) => candidate.members.some((member) => member.id === pumpkinId));
    if (!stack) return null;
    return this.collapse(stack.stackId, { excludingIds: [pumpkinId] });
  }

  collapse(stackId, { excludingIds = [] } = {}) {
    const stack = this.db.getJoinedStack(stackId);
    if (!stack) return null;
    const excluded = new Set(excludingIds);
    const members = stack.members.filter((member) => !excluded.has(member.id));
    if (!members.length) {
      this.db.deleteJoinedStack(stackId);
      this._cancel(stackId);
      return null;
    }
    const currentPumpkins = this.db.listPumpkins();
    const byId = new Map(currentPumpkins.map((pumpkin) => [pumpkin.id, pumpkin]));
    const participants = members.map((member) => byId.get(member.id)).filter(Boolean);
    if (participants.length !== members.length) {
      this.db.deleteJoinedStack(stackId);
      return null;
    }

    const finalPositions = this._planFinalPositions(members, currentPumpkins);
    if (!finalPositions) {
      this._scheduleRetry(stack);
      throw new Error('no_safe_joined_stack_collapse_layout');
    }

    this.db.transaction(() => {
      for (const position of finalPositions) {
        this.db.updatePumpkin(position.id, { ...position, isAirborne: false, parentId: null, stackOffsetY: null });
      }
      this.db.deleteJoinedStack(stackId);
    });
    this._cancel(stackId);
    const payload = {
      action: 'neighbor_stack',
      phase: 'collapse',
      stackId,
      participants: members,
      formedAt: stack.formedAt,
      expiresAt: stack.expiresAt,
      lifetimeSeconds: stack.lifetimeSeconds,
      animation: stack.animation,
      finalPositions,
    };
    this.broadcast('pumpkin:action', { id: null, ...payload });
    return payload;
  }

  move(stackId, targetX) {
    const stack = this.db.getJoinedStack(stackId);
    if (!stack || !uniqueMembers(stack.members) || Date.parse(stack.expiresAt) <= Date.now()) return null;
    const base = stack.members[0];
    const deltaX = Number(targetX) - base.x;
    if (!Number.isFinite(deltaX) || Math.abs(deltaX) < 1) return null;

    const settings = this.db.getSettings(this.config);
    const context = {
      scene: { ...this.config.scene, groundY: settings.groundY },
      noGoZone: settings.noGoZone,
      growthMultipliers: settings.growthMultipliers,
    };
    const pumpkins = this.db.listPumpkins();
    const byId = new Map(pumpkins.map((pumpkin) => [pumpkin.id, pumpkin]));
    const memberIds = new Set(stack.members.map((member) => member.id));
    const outsiders = pumpkins.filter((pumpkin) => !memberIds.has(pumpkin.id));
    const members = stack.members.map((member) => {
      const pumpkin = byId.get(member.id);
      if (!pumpkin) return null;
      const position = { ...member, x: member.x + deltaX };
      if (!isPositionValid(pumpkin, position.x, position.y, context)
        || outsiders.some((other) => Math.abs(position.x - other.x) < 30)) return null;
      return position;
    });
    if (members.some((member) => !member)) return null;

    const updatedStack = { ...stack, members };
    this.db.transaction(() => {
      for (const member of members) this.db.updatePumpkin(member.id, { x: member.x, y: member.y });
      this.db.updateJoinedStack(updatedStack);
    });
    return { stackId, members };
  }

  _isValidSnapshot(stack) {
    if (!stack || !uniqueMembers(stack.members) || !Number.isFinite(Date.parse(stack.expiresAt))) return false;
    const ids = new Set(this.db.listPumpkins().map((pumpkin) => pumpkin.id));
    return stack.members.every((member) => ids.has(member.id));
  }

  _planFinalPositions(members, currentPumpkins = this.db.listPumpkins()) {
    const settings = this.db.getSettings(this.config);
    const context = {
      scene: { ...this.config.scene, groundY: settings.groundY },
      noGoZone: settings.noGoZone,
      growthMultipliers: settings.growthMultipliers,
    };
    const byId = new Map(currentPumpkins.map((pumpkin) => [pumpkin.id, pumpkin]));
    const memberIds = new Set(members.map((member) => member.id));
    const occupied = currentPumpkins.filter((pumpkin) => !memberIds.has(pumpkin.id));
    const finalPositions = [];
    for (const member of members) {
      const pumpkin = byId.get(member.id);
      if (!pumpkin) return null;
      const preferred = { ...pumpkin, x: member.x, y: settings.groundY };
      const position = findSpawnPosition(preferred, occupied, context, this.random)
        || (isPositionValid(preferred, pumpkin.x, settings.groundY, context)
          ? { x: pumpkin.x, y: settings.groundY }
          : null);
      if (!position) return null;
      finalPositions.push({ id: pumpkin.id, x: position.x, y: position.y });
      occupied.push({ ...pumpkin, ...position });
    }
    return finalPositions;
  }

  _schedule(stack) {
    this._cancel(stack.stackId);
    if (this.stopped) return;
    const delay = Math.max(0, Date.parse(stack.expiresAt) - Date.now());
    const timer = this.setTimeoutImpl(() => {
      this.timers.delete(stack.stackId);
      try {
        this.collapse(stack.stackId);
      } catch (error) {
        this.logger.error('Joined pumpkin stack collapse failed', { stackId: stack.stackId, reason: error?.message });
      }
    }, delay);
    timer.unref?.();
    this.timers.set(stack.stackId, timer);
  }

  _scheduleRetry(stack) {
    this._schedule({ ...stack, expiresAt: new Date(Date.now() + 5000).toISOString() });
  }

  _cancel(stackId) {
    const timer = this.timers.get(stackId);
    if (timer) this.clearTimeoutImpl(timer);
    this.timers.delete(stackId);
  }
}
