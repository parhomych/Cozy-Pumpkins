const SVG_NS = 'http://www.w3.org/2000/svg';
const REFERENCE_URL = '/assets/pumpkin-reference.svg';
const REFERENCE_VIEWBOX = 1095;
const LEGACY_SCALE = REFERENCE_VIEWBOX / 220;
// The first thirteen subpaths of the supplied yellow reference path are the
// stray stem accent. They are intentionally omitted; the remaining yellow
// body decoration is still kept in the reference layer.
const REFERENCE_STEM_ACCENT_SEGMENTS_TO_OMIT = 13;

export const DEFAULT_CUSTOMIZATION = { skin: 'classic', eyes: 'cute', mouth: 'cat', hat: 'leaf', prop: 'none' };
export const CUSTOMIZATION_SLOTS = ['skin', 'eyes', 'mouth', 'hat', 'prop'];

let referenceMarkupPromise;

function node(name, attrs = {}, children = []) {
  const el = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  for (const child of children) el.append(child);
  return el;
}

function path(d, attrs = {}) { return node('path', { d, ...attrs }); }
function group(className, children = []) { return node('g', { class: className }, children); }
function mergeCustomization(value = {}) {
  const source = value || {};
  return { ...DEFAULT_CUSTOMIZATION, ...source, prop: source.prop || source.accessory || DEFAULT_CUSTOMIZATION.prop };
}

function loadReferenceMarkup() {
  if (referenceMarkupPromise) return referenceMarkupPromise;
  if (typeof fetch !== 'function') return Promise.resolve(null);
  referenceMarkupPromise = fetch(REFERENCE_URL, { credentials: 'same-origin' })
    .then((response) => response.ok ? response.text() : null)
    .catch(() => null);
  return referenceMarkupPromise;
}

function referenceFallback() {
  return node('image', {
    class: 'reference-pumpkin-fallback', href: REFERENCE_URL,
    x: '0', y: '0', width: String(REFERENCE_VIEWBOX), height: String(REFERENCE_VIEWBOX),
    preserveAspectRatio: 'xMidYMid meet', 'aria-hidden': 'true',
  });
}

function appendReferencePaths(markup, layers) {
  if (!markup || typeof DOMParser !== 'function') return false;
  const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml');
  if (parsed.querySelector('parsererror')) return false;
  const paths = [...parsed.documentElement.children].filter((element) => element.localName === 'path');
  if (paths.length < 9) return false;

  layers.fallback.remove();
  const buckets = [layers.body, layers.body, layers.body, layers.leaves, layers.leaves, layers.stem, layers.leavesFront, layers.leavesFront, layers.highlights];
  paths.forEach((source, index) => {
    const clone = document.importNode ? document.importNode(source, true) : source.cloneNode(true);
    clone.classList.add('reference-layer', `reference-layer-${index + 1}`);
    if (index === 3) {
      const remainder = removeReferenceStemAccent(clone, REFERENCE_STEM_ACCENT_SEGMENTS_TO_OMIT);
      if (remainder) {
        clone.setAttribute('d', remainder);
        clone.classList.add('reference-body-accent', `reference-layer-${index + 1}-body`);
      }
    }
    buckets[index].append(clone);
  });
  return true;
}

function hydrateReferencePaths(layers) {
  void loadReferenceMarkup().then((markup) => {
    if (markup) appendReferencePaths(markup, layers);
  });
}

function removeReferenceStemAccent(pathElement, stemSegments) {
  const d = pathElement.getAttribute('d') || '';
  const segments = d.split(/(?=M)/).filter(Boolean);
  if (segments.length <= stemSegments) return null;
  return segments.slice(stemSegments).join(' ');
}

function addFaceMask(mask) {
  // Path 3 in the supplied reference contains the original eyes and mouth.
  // This fixed mask sits above all reference paths and below the animated
  // overlays, so moving an overlay can never reveal those originals.
  mask.append(
    node('ellipse', { class: 'face-mask-eye face-mask-eye-left', cx: '386', cy: '552', rx: '53', ry: '58', fill: '#f5991a' }),
    node('ellipse', { class: 'face-mask-eye face-mask-eye-right', cx: '654', cy: '552', rx: '53', ry: '58', fill: '#f5991a' }),
    path('M452 610 Q530 704 610 610 L610 718 L452 718Z', { class: 'face-mask-mouth', fill: '#f5991a' }),
  );
}

function addFaceOverlay(face, customization) {
  const eyes = group(`eyes eyes-${customization.eyes}`);
  const leftEye = group('eye eye-left');
  const rightEye = group('eye eye-right');
  const variantEyes = customization.eyes !== 'cute';
  const coverOpacity = 0;
  const eyeCover = (cx) => node('ellipse', {
    class: 'eye-lid', cx, cy: '552', rx: '53', ry: '58', fill: '#f5991a', opacity: String(coverOpacity),
  });
  leftEye.append(eyeCover('386')); rightEye.append(eyeCover('654'));

  const eye = (cx) => node('ellipse', { class: 'eye-shape variant-eye-shape', cx, cy: '551', rx: '34', ry: '41', fill: '#150a06' });
  if (!variantEyes) {
    leftEye.append(eye('386'), node('circle', { class: 'eye-glint variant-eye-glint', cx: '374', cy: '538', r: '10', fill: '#fff8e4' }));
    rightEye.append(eye('654'), node('circle', { class: 'eye-glint variant-eye-glint', cx: '642', cy: '538', r: '10', fill: '#fff8e4' }));
  } else {
    if (customization.eyes === 'sleepy') {
      leftEye.append(path('M345 553 Q386 582 427 553', { class: 'variant-eye-shape', fill: 'none', stroke: '#150a06', 'stroke-width': '17', 'stroke-linecap': 'round' }));
      rightEye.append(path('M613 553 Q654 582 695 553', { class: 'variant-eye-shape', fill: 'none', stroke: '#150a06', 'stroke-width': '17', 'stroke-linecap': 'round' }));
    } else {
      leftEye.append(eye('386')); rightEye.append(eye('654'));
      if (customization.eyes === 'stars') {
        leftEye.append(path('M386 523 l8 20 21 2-16 13 5 21-18-11-18 11 5-21-16-13 21-2Z', { fill: '#fff8e4' }));
        rightEye.append(path('M654 523 l8 20 21 2-16 13 5 21-18-11-18 11 5-21-16-13 21-2Z', { fill: '#fff8e4' }));
      } else if (customization.eyes === 'sly') {
        leftEye.append(path('M348 535 L424 558', { stroke: '#fff8e4', 'stroke-width': '11', 'stroke-linecap': 'round' }));
        rightEye.append(path('M616 558 L692 535', { stroke: '#fff8e4', 'stroke-width': '11', 'stroke-linecap': 'round' }));
      } else if (customization.eyes === 'hypno') {
        leftEye.append(path('M360 551 q26 -29 52 0 t52 0', { fill: 'none', stroke: '#fff8e4', 'stroke-width': '6' }));
        rightEye.append(path('M628 551 q26 -29 52 0 t52 0', { fill: 'none', stroke: '#fff8e4', 'stroke-width': '6' }));
      } else {
        leftEye.append(node('circle', { class: 'eye-glint variant-eye-glint', cx: '374', cy: '538', r: '10', fill: '#fff8e4' }));
        rightEye.append(node('circle', { class: 'eye-glint variant-eye-glint', cx: '642', cy: '538', r: '10', fill: '#fff8e4' }));
      }
    }
  }
  eyes.append(leftEye, rightEye);

  const mouth = group(`mouth mouth-${customization.mouth}`);
  if (customization.mouth === 'fangs') {
    mouth.append(path('M468 635 Q530 688 592 635 L582 700 Q530 730 478 700Z', { class: 'mouth-shape', fill: '#150a06' }), path('M495 658 l16 34 17-31 M565 661 l-17 31-16-34', { fill: '#fff8e4', stroke: '#fff8e4', 'stroke-width': '8' }));
  } else if (customization.mouth === 'o') {
    mouth.append(node('ellipse', { class: 'mouth-shape', cx: '530', cy: '665', rx: '35', ry: '46', fill: '#150a06' }));
  } else if (customization.mouth === 'candy') {
    mouth.append(path('M476 638 Q530 690 584 638', { class: 'mouth-shape', fill: 'none', stroke: '#150a06', 'stroke-width': '12', 'stroke-linecap': 'round' }), node('circle', { class: 'mouth-candy', cx: '530', cy: '676', r: '22', fill: '#f19b3d', stroke: '#fff8e4', 'stroke-width': '8' }));
  } else if (customization.mouth === 'jack') {
    mouth.append(path('M466 638 Q530 690 594 638 L582 700 558 684 530 708 502 684 478 700Z', { class: 'mouth-shape', fill: '#150a06' }));
  } else {
    mouth.append(path('M474 636 Q530 690 588 636', { class: 'mouth-shape', fill: 'none', stroke: '#150a06', 'stroke-width': '12', 'stroke-linecap': 'round' }));
  }
  face.append(eyes, mouth);
}

/** Build the supplied reference SVG inside the shared animation hierarchy. */
export function createPumpkinSvg(pumpkin = {}) {
  const customization = mergeCustomization(pumpkin.customization);
  const stage = Math.max(1, Math.min(4, Number(pumpkin.stage) || 1));
  const root = node('svg', {
    class: 'pumpkin-character', 'data-pumpkin-id': pumpkin.id || '', viewBox: '0 0 1095 1095',
    width: '1095', height: '1095', 'aria-label': pumpkin.displayName || 'Pumpkin', 'data-stage': stage,
  });
  const defs = node('defs');
  const glow = node('filter', { id: `pumpkin-glow-${pumpkin.id || 'new'}`, x: '-30%', y: '-30%', width: '160%', height: '160%' });
  glow.append(node('feGaussianBlur', { stdDeviation: '12', result: 'blur' }), node('feMerge', {}, [node('feMergeNode', { in: 'blur' }), node('feMergeNode', { in: 'SourceGraphic' })]));
  defs.append(glow); root.append(defs);

  const mover = group('mover');
  const floater = group('floater');
  const actor = group('actor');
  const rocker = group('rocker idle-rocker');
  const shadow = node('ellipse', { class: 'ground-shadow', cx: '548', cy: '1062', rx: '315', ry: '38', fill: '#24152d', opacity: '.28' });
  const layers = {
    fallback: referenceFallback(),
    body: group(`body pumpkin-body skin-${customization.skin}`),
    leaves: group('leaves leaf-bed'),
    leavesFront: group('leaves leaves-front leaf-bed'),
    stem: group('stem'),
    highlights: group('highlights highlight-group'),
  };
  layers.body.append(layers.fallback);
  const faceMask = group('face-mask face-mask-reference');
  addFaceMask(faceMask);
  rocker.append(layers.body, layers.leaves, layers.stem, layers.leavesFront, layers.highlights, faceMask);
  hydrateReferencePaths(layers);

  const face = group(`face face-${customization.mouth}`);
  addFaceOverlay(face, customization);
  const hat = group('hat hat-accessory', []); hat.setAttribute('transform', `scale(${LEGACY_SCALE})`);
  if (customization.hat === 'witch') hat.append(path('M66 88 Q110 73 154 88 L163 99 Q110 109 57 99Z', { fill: '#322548', stroke: '#24182a', 'stroke-width': '4' }), path('M77 85 L108 17 Q135 37 142 86Z', { fill: '#4a336f', stroke: '#24182a', 'stroke-width': '4' }));
  else if (customization.hat === 'halo') hat.append(node('ellipse', { cx: '110', cy: '47', rx: '38', ry: '11', fill: 'none', stroke: '#ffe19b', 'stroke-width': '7', filter: `url(#pumpkin-glow-${pumpkin.id || 'new'})` }));
  else if (customization.hat === 'horns') hat.append(path('M75 82 Q57 54 71 33 Q91 50 94 79 M145 82 Q163 54 149 33 Q129 50 126 79', { fill: '#bb526b', stroke: '#5c213c', 'stroke-width': '4' }));
  else if (customization.hat === 'cat_ears') hat.append(path('M70 91 L69 43 L100 73 M150 91 L151 43 L120 73', { fill: '#d58a9e', stroke: '#5c3148', 'stroke-width': '5', 'stroke-linejoin': 'round' }));
  else if (customization.hat === 'crown') hat.append(path('M76 86 L70 38 L94 58 L110 30 L126 58 L150 38 L144 86Z', { fill: '#f1c14d', stroke: '#7d4c29', 'stroke-width': '4' }));

  const accessory = group('accessory prop-accessory', []); accessory.setAttribute('transform', `scale(${LEGACY_SCALE})`);
  if (customization.prop === 'broom') accessory.append(path('M175 193 L205 104', { stroke: '#754c38', 'stroke-width': '6' }), path('M190 103 Q220 110 205 130 Q187 123 176 110Z', { fill: '#ba843d', stroke: '#4f352d', 'stroke-width': '4' }));
  else if (customization.prop === 'cape') accessory.append(path('M57 153 Q25 207 63 235 Q83 213 82 182Z', { fill: '#52386f', stroke: '#2c2145', 'stroke-width': '4' }));
  else if (customization.prop === 'lantern') accessory.append(node('path', { d: 'M41 199 h34 v34 H41Z', fill: '#e7a942', stroke: '#4f352d', 'stroke-width': '4' }));
  else if (customization.prop === 'spider') accessory.append(node('circle', { cx: '51', cy: '196', r: '10', fill: '#24182a' }), path('M43 190 l-17 -12 M43 197 l-20 2 M43 204 l-16 13 M59 190 l17 -12 M59 197 l20 2 M59 204 l16 13', { stroke: '#24182a', 'stroke-width': '3' }));
  else if (customization.prop === 'candle') accessory.append(node('rect', { x: '102', y: '42', width: '16', height: '33', rx: '5', fill: '#f1d49b', stroke: '#7d4c29', 'stroke-width': '3' }));

  rocker.append(face, hat, accessory);
  const airPlanter = group('air-planter');
  airPlanter.append(node('ellipse', { cx: '548', cy: '1035', rx: '235', ry: '35', fill: '#8d5a3a', opacity: '.38' }));
  actor.append(rocker);
  const stageScale = [0.58, 0.82, 1, 1.12][stage - 1];
  actor.setAttribute('transform', `translate(${548 * (1 - stageScale)} ${548 * (1 - stageScale)}) scale(${stageScale})`);
  floater.append(actor); mover.append(shadow, airPlanter, floater); root.append(mover);
  return root;
}

export function normalizeCustomization(value = {}) { return mergeCustomization(value); }
