import { dimensionsFor, isPositionValid } from './spatial-rules.js';

export const NEIGHBOR_STACK_MAX_DISTANCE = 400;
export const NEIGHBOR_STACK_MAX_MEMBERS = 3;
export const NEIGHBOR_STACK_STEP_RATIO = 0.72;

function randomUnit(random) {
  const value = Number(random?.());
  return Number.isFinite(value) ? Math.max(0, Math.min(0.999999, value)) : 0.5;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function orderedStackMembers(stack, byId) {
  if (!Array.isArray(stack?.members) || stack.members.length < 2 || stack.members.length >= NEIGHBOR_STACK_MAX_MEMBERS) return null;
  const members = [...stack.members].sort((a, b) => a.level - b.level);
  if (members.some((member, index) => member.level !== index || !byId.has(member.id)
    || !Number.isFinite(member.x) || !Number.isFinite(member.y))) return null;
  return members;
}

function planCandidate(redeemer, targetMembers, pumpkins, context) {
  if (targetMembers.length >= NEIGHBOR_STACK_MAX_MEMBERS) return null;
  const byId = new Map(pumpkins.map((pumpkin) => [pumpkin.id, pumpkin]));
  const members = targetMembers.map((member, level) => ({
    id: member.id,
    level,
    fromX: byId.get(member.id).x,
    fromY: byId.get(member.id).y,
    x: member.x,
    y: member.y,
  }));
  const top = targetMembers.at(-1);
  const topPumpkin = byId.get(top.id);
  const position = {
    x: top.x,
    y: top.y - dimensionsFor(topPumpkin, context).height * NEIGHBOR_STACK_STEP_RATIO,
  };
  if (!isPositionValid(redeemer, position.x, position.y, context)) return null;
  if (targetMembers.some((member) => !isPositionValid(byId.get(member.id), member.x, member.y, context))) return null;
  members.push({
    id: redeemer.id,
    level: members.length,
    fromX: redeemer.x,
    fromY: redeemer.y,
    ...position,
  });
  return members;
}

export function planNeighborStack({ redeemer, pumpkins, joinedStacks = [], context, random = Math.random } = {}) {
  if (!redeemer || !Array.isArray(pumpkins) || !context?.scene) throw new Error('invalid_neighbor_stack_plan_input');
  const byId = new Map(pumpkins.map((pumpkin) => [pumpkin.id, pumpkin]));
  if (!byId.has(redeemer.id)) throw new Error('neighbor_stack_redeemer_not_in_scene');

  const membership = new Map();
  for (const stack of joinedStacks) {
    if (!Array.isArray(stack?.members)) continue;
    for (const member of stack.members) {
      if (membership.has(member.id)) throw new Error('joined_stack_membership_conflict');
      membership.set(member.id, stack);
    }
  }
  if (membership.has(redeemer.id)) return { status: 'no_eligible_neighbor', reason: 'redeemer_already_stacked' };

  const candidates = [];
  for (const stack of joinedStacks) {
    const members = orderedStackMembers(stack, byId);
    if (!members || members.some((member) => member.id === redeemer.id)) continue;
    if (members.some((member) => distance(redeemer, member) <= NEIGHBOR_STACK_MAX_DISTANCE)) {
      candidates.push({ members, stackId: stack.stackId });
    }
  }
  for (const pumpkin of pumpkins) {
    if (pumpkin.id === redeemer.id || pumpkin.parentId || membership.has(pumpkin.id)) continue;
    if (distance(redeemer, pumpkin) <= NEIGHBOR_STACK_MAX_DISTANCE) {
      candidates.push({
        members: [{ id: pumpkin.id, level: 0, x: pumpkin.x, y: pumpkin.y }],
        stackId: null,
      });
    }
  }
  if (!candidates.length) return { status: 'no_eligible_neighbor' };

  const plans = candidates.map((candidate) => ({
    ...candidate,
    members: planCandidate(redeemer, candidate.members, pumpkins, context),
  })).filter((candidate) => candidate.members);
  if (!plans.length) return { status: 'no_safe_stack_layout' };
  const selected = plans[Math.floor(randomUnit(random) * plans.length)];
  return { status: 'planned', members: selected.members, targetStackId: selected.stackId };
}
