import { finiteNumber } from '../utils/normalize.js';

export const LANDING_PARTICLE_LIMITS = Object.freeze({
  count: { min: 1, max: 60 },
  size: { min: 0.2, max: 3 },
  spread: { min: 0.2, max: 3 },
  duration: { min: 0.3, max: 5 },
});

export const DEFAULT_LANDING_PARTICLES = Object.freeze({
  enabled: true,
  count: 16,
  size: 1,
  spread: 1,
  duration: 1.5,
});

const PARTICLE_KEYS = Object.freeze(['enabled', 'count', 'size', 'spread', 'duration']);

export function sanitizeLandingParticles(value, fallback = DEFAULT_LANDING_PARTICLES) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const safeFallback = {
    enabled: typeof fallback?.enabled === 'boolean' ? fallback.enabled : DEFAULT_LANDING_PARTICLES.enabled,
    count: Math.round(finiteNumber(fallback?.count, LANDING_PARTICLE_LIMITS.count) ?? DEFAULT_LANDING_PARTICLES.count),
    size: finiteNumber(fallback?.size, LANDING_PARTICLE_LIMITS.size) ?? DEFAULT_LANDING_PARTICLES.size,
    spread: finiteNumber(fallback?.spread, LANDING_PARTICLE_LIMITS.spread) ?? DEFAULT_LANDING_PARTICLES.spread,
    duration: finiteNumber(fallback?.duration, LANDING_PARTICLE_LIMITS.duration) ?? DEFAULT_LANDING_PARTICLES.duration,
  };

  const enabled = source.enabled !== undefined ? Boolean(source.enabled) : safeFallback.enabled;
  const countRaw = finiteNumber(source.count, LANDING_PARTICLE_LIMITS.count);
  const count = countRaw !== null ? Math.round(countRaw) : safeFallback.count;
  const size = finiteNumber(source.size, LANDING_PARTICLE_LIMITS.size) ?? safeFallback.size;
  const spread = finiteNumber(source.spread, LANDING_PARTICLE_LIMITS.spread) ?? safeFallback.spread;
  const duration = finiteNumber(source.duration, LANDING_PARTICLE_LIMITS.duration) ?? safeFallback.duration;

  return { enabled, count, size, spread, duration };
}

export function isValidLandingParticles(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') return false;
  if (value.count !== undefined && finiteNumber(value.count, LANDING_PARTICLE_LIMITS.count) === null) return false;
  if (value.size !== undefined && finiteNumber(value.size, LANDING_PARTICLE_LIMITS.size) === null) return false;
  if (value.spread !== undefined && finiteNumber(value.spread, LANDING_PARTICLE_LIMITS.spread) === null) return false;
  if (value.duration !== undefined && finiteNumber(value.duration, LANDING_PARTICLE_LIMITS.duration) === null) return false;
  return true;
}

export function landingParticlesPatch(value, current = DEFAULT_LANDING_PARTICLES) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!PARTICLE_KEYS.some((key) => value[key] !== undefined)) return null;
  if (!isValidLandingParticles(value)) return null;
  return sanitizeLandingParticles(value, current);
}
