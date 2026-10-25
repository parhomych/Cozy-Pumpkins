function finiteNumber(value, { min = -Infinity, max = Infinity } = {}) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

export const DEFAULT_LANDING_PARTICLES = Object.freeze({
  enabled: true,
  count: 16,
  size: 1,
  spread: 1,
  duration: 1.5,
});

export const LANDING_PARTICLE_LIMITS = Object.freeze({
  count: { min: 1, max: 60 },
  size: { min: 0.2, max: 3 },
  spread: { min: 0.2, max: 3 },
  duration: { min: 0.3, max: 5 },
});

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

const AUTUMN_LEAF_COLORS = Object.freeze([
  '#c0392b', // Crimson red
  '#d35400', // Deep pumpkin orange
  '#e67e22', // Vivid orange
  '#f39c12', // Golden amber
  '#f1c40f', // Warm golden yellow
  '#a04000', // Russet / terracotta
  '#b95c28', // Cinnamon
  '#873600', // Auburn brown
  '#808b29', // Golden olive
]);

// 4 distinct autumn leaf SVG silhouettes (viewBox="0 0 32 32")
const LEAF_TEMPLATES = Object.freeze([
  // 1. Maple leaf
  `<path d="M16 2 C15 6 12 7 9 6 C10 9 7 11 4 11 C6 13 4 16 2 17 C6 18 8 20 8 24 C11 23 13 24 15 26 L15 31 L17 31 L17 26 C19 24 21 23 24 24 C24 20 26 18 30 17 C28 16 26 13 28 11 C25 11 22 9 23 6 C20 7 17 6 16 2 Z" fill="currentColor"/><path d="M16 8 L16 26 M16 16 L10 12 M16 16 L22 12 M16 21 L11 19 M16 21 L21 19" stroke="rgba(0,0,0,0.24)" stroke-width="1.1" stroke-linecap="round"/>`,
  // 2. Oak leaf
  `<path d="M16 2 C13 4 11 7 13 10 C10 11 9 14 11 17 C8 19 8 22 12 24 C11 26 13 27 15 28 L15 31 L17 31 L17 28 C19 27 21 26 20 24 C24 22 24 19 21 17 C23 14 22 11 19 10 C21 7 19 4 16 2 Z" fill="currentColor"/><path d="M16 5 L16 28 M16 12 C13 11 12 11 12 11 M16 12 C19 11 20 11 20 11 M16 18 C13 17 11 18 11 18 M16 18 C19 17 21 18 21 18 M16 23 C14 23 13 24 13 24 M16 23 C18 23 19 24 19 24" stroke="rgba(0,0,0,0.24)" stroke-width="1.1" stroke-linecap="round"/>`,
  // 3. Birch / Beech leaf (pointed serrated teardrop)
  `<path d="M16 2 C13 7 7 14 8 22 C9 26 12 28 15 28 L15 31 L17 31 L17 28 C20 28 23 26 24 22 C25 14 19 7 16 2 Z" fill="currentColor"/><path d="M16 6 L16 28 M16 13 L11 10 M16 13 L21 10 M16 18 L10 16 M16 18 L22 16 M16 23 L12 22 M16 23 L20 22" stroke="rgba(0,0,0,0.24)" stroke-width="1.1" stroke-linecap="round"/>`,
  // 4. Aspen / Elm leaf (rounded heart)
  `<path d="M16 3 C12 3 7 7 7 14 C7 21 12 26 15 27 L15 31 L17 31 L17 27 C20 26 25 21 25 14 C25 7 20 3 16 3 Z" fill="currentColor"/><path d="M16 7 L16 27 M16 14 C12 13 10 14 10 14 M16 14 C20 13 22 14 22 14 M16 20 C13 20 11 21 11 21 M16 20 C19 20 21 21 21 21" stroke="rgba(0,0,0,0.24)" stroke-width="1.1" stroke-linecap="round"/>`,
]);

export class LeafParticleSystem {
  constructor(container) {
    this.container = container;
    this.tweens = new Set();
    this.leaves = new Set();
    this.layer = null;

    if (typeof document !== 'undefined' && container && typeof container.append === 'function') {
      let layer = container.querySelector('.leaf-particles-layer');
      if (!layer) {
        layer = document.createElement('div');
        layer.className = 'leaf-particles-layer';
        layer.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:hidden;z-index:9000;';
        container.append(layer);
      }
      this.layer = layer;
    }
  }

  _gsap() {
    return globalThis.gsap || globalThis.window?.gsap || null;
  }

  spawnBurst(x, y, options = {}) {
    if (typeof document === 'undefined' || !this.layer) return;
    const gsap = this._gsap();

    const count = Math.max(1, Math.min(60, Number(options.count) || DEFAULT_LANDING_PARTICLES.count));
    const sizeMultiplier = Math.max(0.2, Math.min(3, Number(options.size) || DEFAULT_LANDING_PARTICLES.size));
    const spreadMultiplier = Math.max(0.2, Math.min(3, Number(options.spread) || DEFAULT_LANDING_PARTICLES.spread));
    const duration = Math.max(0.3, Math.min(5, Number(options.duration) || DEFAULT_LANDING_PARTICLES.duration));
    const stageScale = Number(options.stageScale) || 1;

    const containerWidth = this.container?.clientWidth || 1920;
    const scale = Math.max(0.2, containerWidth / 1920);
    const baseSize = Math.max(12, Math.round(26 * sizeMultiplier * Math.sqrt(stageScale) * scale));

    const originX = Number(x) || 960;
    const originY = Number(y) || 1080;

    for (let i = 0; i < count; i += 1) {
      const templateIndex = Math.floor(Math.random() * LEAF_TEMPLATES.length);
      const color = AUTUMN_LEAF_COLORS[Math.floor(Math.random() * AUTUMN_LEAF_COLORS.length)];
      const leafSize = Math.round(baseSize * (0.8 + Math.random() * 0.45));

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 32 32');
      svg.setAttribute('class', 'autumn-leaf-particle');
      svg.style.position = 'absolute';
      svg.style.width = `${leafSize}px`;
      svg.style.height = `${leafSize}px`;
      svg.style.left = `${(originX / 1920) * 100}%`;
      svg.style.top = `${(originY / 1080) * 100}%`;
      svg.style.color = color;
      svg.style.pointerEvents = 'none';
      svg.style.overflow = 'visible';
      svg.style.transformOrigin = '50% 50%';
      svg.style.willChange = 'transform, opacity';
      svg.innerHTML = LEAF_TEMPLATES[templateIndex];

      this.layer.append(svg);
      this.leaves.add(svg);

      if (!gsap) {
        // Fallback if GSAP is unavailable
        setTimeout(() => {
          svg.remove();
          this.leaves.delete(svg);
        }, 1000);
        continue;
      }

      // Physics trajectory
      const side = Math.random() < 0.5 ? -1 : 1;
      const horizontalDist = side * (Math.random() * 140 + 45) * spreadMultiplier * scale;
      const burstPeak = -(Math.random() * 85 + 50) * spreadMultiplier * scale;
      const settleY = burstPeak + (Math.random() * 115 + 60) * scale;
      const leafDuration = duration * (0.8 + Math.random() * 0.45);
      const rotationAmount = (Math.random() - 0.5) * 640;
      const flipScale = Math.random() < 0.5 ? -1 : 1;

      // Set initial slight offset
      const initOffsetX = (Math.random() - 0.5) * 30 * scale;
      const initOffsetY = (Math.random() - 0.5) * 12 * scale;
      gsap.set(svg, {
        x: initOffsetX,
        y: initOffsetY,
        scale: 0.5,
        rotation: (Math.random() - 0.5) * 90,
        opacity: 0.95,
      });

      const timeline = gsap.timeline({
        onComplete: () => {
          svg.remove();
          this.leaves.delete(svg);
          this.tweens.delete(timeline);
        },
      });

      // Phase 1: Burst upward & outward, scale up
      timeline.to(svg, {
        x: initOffsetX + horizontalDist * 0.45,
        y: burstPeak,
        scale: 1,
        duration: leafDuration * 0.32,
        ease: 'power2.out',
      });

      // Phase 2: Drift down with fluttering
      timeline.to(svg, {
        x: initOffsetX + horizontalDist,
        y: settleY,
        duration: leafDuration * 0.68,
        ease: 'sine.inOut',
      });

      // Simultaneous tumble, spin and fade
      timeline.to(svg, {
        rotation: rotationAmount,
        scaleX: flipScale,
        duration: leafDuration,
        ease: 'none',
      }, 0);

      timeline.to(svg, {
        opacity: 0,
        duration: leafDuration * 0.35,
        ease: 'power1.in',
      }, leafDuration * 0.65);

      this.tweens.add(timeline);
    }
  }

  spawnDrift(x, y, options = {}) {
    if (typeof document === 'undefined' || !this.layer) return;
    const gsap = this._gsap();

    const baseCount = Number(options.count) || DEFAULT_LANDING_PARTICLES.count;
    // Voluminous drift of leaves matching the full size of the pumpkin
    const count = Math.max(50, Math.min(120, Math.round(baseCount * 4.2)));
    const sizeMultiplier = Math.max(0.2, Math.min(3, Number(options.size) || DEFAULT_LANDING_PARTICLES.size));
    const spreadMultiplier = Math.max(0.2, Math.min(3, Number(options.spread) || DEFAULT_LANDING_PARTICLES.spread));
    const duration = Math.max(0.8, Math.min(6, (Number(options.duration) || DEFAULT_LANDING_PARTICLES.duration) * 1.5));
    const stageScale = Number(options.stageScale) || 1;
    const stageSize = Number(options.stageSize) || (220 * stageScale);

    const containerWidth = this.container?.clientWidth || 1920;
    const scale = Math.max(0.2, containerWidth / 1920);
    const baseSize = Math.max(14, Math.round(28 * sizeMultiplier * Math.sqrt(stageScale) * scale));

    const originX = Number(x) || 960;
    const originY = Number(y) || 1040;

    // Dimensions of the pumpkin being created:
    // A pumpkin sits on originY, extending upward by pumpkinH and horizontally by pumpkinW
    const pumpkinW = Math.max(90, stageSize * scale);
    const pumpkinH = Math.max(80, stageSize * 0.95 * scale);
    const moundHalfWidth = (pumpkinW * 0.65) * spreadMultiplier;
    const moundMaxHeight = (pumpkinH * 1.05) * spreadMultiplier;

    for (let i = 0; i < count; i += 1) {
      const templateIndex = Math.floor(Math.random() * LEAF_TEMPLATES.length);
      const color = AUTUMN_LEAF_COLORS[Math.floor(Math.random() * AUTUMN_LEAF_COLORS.length)];

      // Triangular horizontal distribution: denser near center body, tapering to sides
      const u = (Math.random() + Math.random() - 1);
      const moundSpreadX = u * moundHalfWidth;

      // Rounded dome silhouette matching the pumpkin's height and curve
      const domeTopAtU = moundMaxHeight * Math.max(0.12, 1 - Math.pow(Math.abs(u), 1.45));
      const heightFraction = Math.pow(Math.random(), 0.82);
      const moundHeightY = -Math.max(4 * scale, heightFraction * domeTopAtU);

      // Vary leaf sizes: fuller leaves in the core, accent leaves near the rim
      const sizeVariation = (0.75 + Math.random() * 0.55) * (1 - Math.abs(u) * 0.15);
      const leafSize = Math.round(baseSize * sizeVariation);

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 32 32');
      svg.setAttribute('class', 'autumn-leaf-particle autumn-leaf-drift');
      svg.style.position = 'absolute';
      svg.style.width = `${leafSize}px`;
      svg.style.height = `${leafSize}px`;
      svg.style.left = `${(originX / 1920) * 100}%`;
      svg.style.top = `${(originY / 1080) * 100}%`;
      svg.style.color = color;
      svg.style.pointerEvents = 'none';
      svg.style.overflow = 'visible';
      svg.style.transformOrigin = '50% 50%';
      svg.style.willChange = 'transform, opacity';
      svg.innerHTML = LEAF_TEMPLATES[templateIndex];

      this.layer.append(svg);
      this.leaves.add(svg);

      if (!gsap) {
        setTimeout(() => {
          svg.remove();
          this.leaves.delete(svg);
        }, 1500);
        continue;
      }

      // Initial state before swirling into pile
      const initialRotation = (Math.random() - 0.5) * 140;
      const appearDelay = (i * 0.006) + (Math.random() * 0.03);

      gsap.set(svg, {
        x: moundSpreadX * 0.2,
        y: moundHeightY * 0.3 + 15 * scale,
        scale: 0,
        rotation: initialRotation - 45,
        opacity: 0,
      });

      const timeline = gsap.timeline({
        onComplete: () => {
          svg.remove();
          this.leaves.delete(svg);
          this.tweens.delete(timeline);
        },
      });

      // 1. Swirl into the pile (forming a full pumpkin-sized mound of autumn leaves)
      timeline.to(svg, {
        x: moundSpreadX,
        y: moundHeightY,
        scale: 1,
        rotation: initialRotation,
        opacity: 0.95,
        duration: 0.32 + Math.random() * 0.12,
        delay: appearDelay,
        ease: 'back.out(1.4)',
      });

      // 2. Pumpkin emerges from inside the pile!
      const side = u < 0 ? -1 : 1;
      const isUpper = -moundHeightY > moundMaxHeight * 0.45;
      const scatterX = moundSpreadX + side * (Math.random() * (isUpper ? 65 : 45) + 25) * spreadMultiplier * scale;
      const liftY = moundHeightY - (Math.random() * (isUpper ? 55 : 25) + 15) * spreadMultiplier * scale;

      timeline.to(svg, {
        x: scatterX,
        y: liftY,
        rotation: initialRotation + side * (50 + Math.random() * 90),
        duration: 0.28,
        ease: 'power2.out',
      }, `+=${0.10 + Math.random() * 0.08}`);

      // 3. Leaves flutter and drift down to ground level across a wider area, settle and fade out
      const settleY = (Math.random() * 18 - 6) * scale;
      const fallDuration = duration * (0.65 + Math.random() * 0.35);
      const flutterX = scatterX + (Math.random() - 0.5) * 50 * scale;
      const flipScale = Math.random() < 0.5 ? -1 : 1;

      timeline.to(svg, {
        x: flutterX,
        y: settleY,
        duration: fallDuration,
        ease: 'sine.inOut',
      });

      timeline.to(svg, {
        rotation: (Math.random() - 0.5) * 640,
        scaleX: flipScale,
        duration: fallDuration,
        ease: 'none',
      }, '<');

      timeline.to(svg, {
        opacity: 0,
        duration: fallDuration * 0.45,
        ease: 'power1.in',
      }, `-=${fallDuration * 0.45}`);

      this.tweens.add(timeline);
    }
  }

  clear() {
    for (const tween of this.tweens) tween.kill?.();
    this.tweens.clear();
    for (const leaf of this.leaves) leaf.remove?.();
    this.leaves.clear();
  }

  destroy() {
    this.clear();
    this.layer?.remove?.();
    this.layer = null;
  }
}
