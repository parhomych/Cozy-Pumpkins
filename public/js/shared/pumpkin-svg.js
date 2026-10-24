const SVG_NS = 'http://www.w3.org/2000/svg';
const REFERENCE_URL = '/assets/pumpkin-reference.svg';
const STAGE_ONE_URL = '/assets/pumpkin-stage-1.svg';
const STAGE_TWO_URL = '/assets/pumpkin-stage-2.svg';
const STAGE_FOUR_URL = '/assets/pumpkin-stage-4.svg';
const COCOA_HANDS_URL = '/assets/cocoa-hands.svg';
const BLANKET_BACK_URL = '/assets/blanket-back.svg';
const BLANKET_FRONT_URL = '/assets/blanket-front.svg';

import {
  COCOA_HANDS_PATHS,
  COCOA_HANDS_STAGE_CONFIG,
  COCOA_HANDS_WIDTHS,
} from './cocoa-hands-paths.js?v=cocoa-hands-bend-20261024';

export { COCOA_HANDS_STAGE_CONFIG, COCOA_HANDS_WIDTHS };

export const BLANKET_WIDTHS = Object.freeze([116, 136, 196, 236]);

export const BLANKET_STAGE_CONFIG = Object.freeze({
  1: Object.freeze({ width: 116, height: 101.7, x: 50.39, y: 82 }),
  2: Object.freeze({ width: 160, height: 74, x: 24.0, y: 155 }),
  3: Object.freeze({ width: 196, height: 152, x: 12.0, y: 79 }),
  4: Object.freeze({ width: 258, height: 162, x: -20.0, y: 76 }),
});
const REFERENCE_VIEWBOX = 1095;
const STAGE_ONE_VIEWBOX = Object.freeze({ x: 850, y: 80, width: 1100, height: 1380 });
export const REFERENCE_DISPLAY_SIZE = 220;
export const STAGE_SCALES = Object.freeze([0.58, 0.82, 1, 1.12]);
export const DEFAULT_GROWTH_MULTIPLIERS = Object.freeze({ stage1: 0.58, stage2: 0.82, stage3: 1, stage4: 1.12 });
// The supplied reference paths end at approximately this y coordinate; the
// viewBox has transparent space below them. Anchor the visible artwork, not
// that transparent viewBox space, to the logical ground point.
const REFERENCE_ARTWORK_BOTTOM = 1041;
// The reference artwork is slightly left-heavy inside the source viewBox.
// Center the visible drawing in the logical square so the root box and the
// artwork share the same horizontal anchor at every growth stage.
const REFERENCE_ARTWORK_CENTER_X = 539.5;
// The interaction box is the complete logical square. Stage size is applied
// by the root SVG layout, not by a second transform on this rectangle.
const REFERENCE_INTERACTION_BOX = Object.freeze({ x: 0, y: 0, width: REFERENCE_VIEWBOX, height: REFERENCE_VIEWBOX });
const LEGACY_SCALE = REFERENCE_VIEWBOX / REFERENCE_DISPLAY_SIZE;
// The first thirteen subpaths of the supplied yellow reference path are the
// stray stem accent. They are intentionally omitted; the remaining yellow
// body decoration is still kept in the reference layer.
const REFERENCE_STEM_ACCENT_SEGMENTS_TO_OMIT = 13;

export const DEFAULT_CUSTOMIZATION = { skin: 'classic', eyes: 'cute', mouth: 'cat', hat: 'leaf', prop: 'none' };
export const CUSTOMIZATION_SLOTS = ['skin', 'eyes', 'mouth', 'hat', 'prop'];

let referenceMarkupPromise;
let stageOneMarkupPromise;
let stageTwoMarkupPromise;

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

function loadStageOneMarkup() {
  if (stageOneMarkupPromise) return stageOneMarkupPromise;
  if (typeof fetch !== 'function') return Promise.resolve(null);
  stageOneMarkupPromise = fetch(STAGE_ONE_URL, { credentials: 'same-origin' })
    .then((response) => response.ok ? response.text() : null)
    .catch(() => null);
  return stageOneMarkupPromise;
}

function loadStageTwoMarkup() {
  if (stageTwoMarkupPromise) return stageTwoMarkupPromise;
  if (typeof fetch !== 'function') return Promise.resolve(null);
  stageTwoMarkupPromise = fetch(STAGE_TWO_URL, { credentials: 'same-origin' })
    .then((response) => response.ok ? response.text() : null)
    .catch(() => null);
  return stageTwoMarkupPromise;
}

function stageOneArtwork() {
  const artwork = node('svg', {
    class: 'stage-one-art', x: '0', y: '0', width: String(REFERENCE_VIEWBOX), height: String(REFERENCE_VIEWBOX),
    viewBox: '850 80 1100 1380', preserveAspectRatio: 'xMidYMid meet', 'aria-hidden': 'true',
  });
  artwork.append(node('image', {
    class: 'stage-one-art-fallback', href: STAGE_ONE_URL,
    x: '0', y: '0', width: String(REFERENCE_VIEWBOX), height: String(REFERENCE_VIEWBOX),
    preserveAspectRatio: 'xMidYMid meet', 'aria-hidden': 'true',
  }));
  void loadStageOneMarkup().then((markup) => { if (markup) appendStageOnePaths(markup, artwork); });
  return artwork;
}

function stageTwoArtwork() {
  const artwork = node('svg', {
    class: 'stage-two-art', x: '0', y: '0', width: String(REFERENCE_VIEWBOX), height: String(REFERENCE_VIEWBOX),
    viewBox: '0 0 1258 1258', preserveAspectRatio: 'xMidYMid meet', 'aria-hidden': 'true',
  });
  artwork.append(node('image', {
    class: 'stage-two-art-fallback', href: STAGE_TWO_URL,
    x: '0', y: '0', width: '1258', height: '1258',
    preserveAspectRatio: 'xMidYMid meet', 'aria-hidden': 'true',
  }));
  void loadStageTwoMarkup().then((markup) => { if (markup) appendStageTwoPaths(markup, artwork); });
  return artwork;
}

function stageFourArtwork() {
  const artwork = node('svg', {
    class: 'stage-four-art', x: '0', y: '0', width: String(REFERENCE_VIEWBOX), height: String(REFERENCE_VIEWBOX),
    viewBox: '0 0 961 960', preserveAspectRatio: 'xMidYMid meet', 'aria-hidden': 'true',
  });
  artwork.append(node('image', {
    class: 'stage-four-art-image', href: STAGE_FOUR_URL,
    x: '0', y: '0', width: '961', height: '960',
    preserveAspectRatio: 'xMidYMid meet', 'aria-hidden': 'true',
  }));
  return artwork;
}

function isGreenPath(source) {
  const fill = source.getAttribute('fill') || '';
  if (!/^#[0-9a-f]{6}$/iu.test(fill)) return false;
  const hex = fill.slice(1);
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  return green > red * 1.08 && green > blue * .95 && green > 70;
}

function stageOneTranslateX(source) {
  const match = source.getAttribute('transform')?.match(/translate\(([-0-9.]+),[-0-9.]+\)/u);
  return match ? Number(match[1]) : 1400;
}

function stageOneTranslateY(source) {
  const match = source.getAttribute('transform')?.match(/translate\([-0-9.]+,([-0-9.]+)\)/u);
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
}

function stageOnePathBounds(source, probe) {
  if (!probe) return null;
  const sample = source.cloneNode(true);
  probe.append(sample);
  let bounds = null;
  try { bounds = sample.getBBox(); } catch {}
  sample.remove();
  return bounds;
}

function isStageOneFacePath(source, bounds) {
  const fill = source.getAttribute('fill') || '';
  const color = /^#([0-9a-f]{6})$/iu.exec(fill)?.[1];
  if (!color || !bounds) return false;
  const red = Number.parseInt(color.slice(0, 2), 16);
  const green = Number.parseInt(color.slice(2, 4), 16);
  const blue = Number.parseInt(color.slice(4, 6), 16);
  const x = bounds.x + stageOneTranslateX(source);
  const y = bounds.y + stageOneTranslateY(source);
  const overlaps = (zone) => x < zone.x + zone.width && x + bounds.width > zone.x
    && y < zone.y + zone.height && y + bounds.height > zone.y;
  const eyeZone = overlaps({ x: 1235, y: 735, width: 85, height: 100 })
    || overlaps({ x: 1410, y: 735, width: 90, height: 100 });
  const mouthZone = overlaps({ x: 1325, y: 785, width: 85, height: 55 });
  const cheekZone = overlaps({ x: 1205, y: 795, width: 85, height: 55 })
    || overlaps({ x: 1440, y: 770, width: 65, height: 65 });
  const smallFaceDetail = bounds.width < 120 && bounds.height < 100;
  const darkFeature = Math.max(red, green, blue) < 115;
  const eyeGlint = Math.min(red, green, blue) > 225;
  const cheek = red > 215 && green > 70 && green < 170 && blue < 140;
  return smallFaceDetail && ((darkFeature && (eyeZone || mouthZone)) || (eyeGlint && eyeZone) || (cheek && cheekZone));
}

function isStageOneSproutPath(source, bounds) {
  if (!isGreenPath(source) || stageOneTranslateY(source) > 530) return false;
  if (!bounds) return (source.getAttribute('d') || '').length < 12000;
  return bounds.width < 400 && bounds.height < 400;
}

function appendStageOnePaths(markup, artwork) {
  if (!markup || typeof DOMParser !== 'function') return false;
  const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml');
  if (parsed.querySelector('parsererror')) return false;
  const paths = [...parsed.documentElement.children].filter((element) => element.localName === 'path');
  if (!paths.length) return false;

  artwork.querySelector('.stage-one-art-fallback')?.remove();
  const base = group('stage-one-base');
  const sprout = group('stage-one-sprout');
  const sproutStem = group('stage-one-sprout-stem');
  const leavesLeft = group('stage-one-leaves stage-one-leaves-left');
  const leavesRight = group('stage-one-leaves stage-one-leaves-right');
  const probe = document.body ? node('svg', { viewBox: '850 80 1100 1380', 'aria-hidden': 'true' }) : null;
  if (probe) {
    probe.style.cssText = 'position:absolute;left:-10000px;top:-10000px;width:1px;height:1px;visibility:hidden;pointer-events:none;';
    document.body.append(probe);
  }
  paths.forEach((source) => {
    const bounds = stageOnePathBounds(source, probe);
    if (isStageOneFacePath(source, bounds)) return;
    const green = isGreenPath(source);
    const sproutPath = isStageOneSproutPath(source, bounds);
    const clone = document.importNode ? document.importNode(source, true) : source.cloneNode(true);
    // The vectorizer includes a large green underpainting silhouette for the
    // whole character. It sits behind the orange pumpkin in the source SVG,
    // but would show through as a duplicate when the sprout is separated.
    if (green && !sproutPath && bounds && (bounds.width >= 400 || bounds.height >= 400)) return;
    if (!sproutPath) base.append(clone);
    else if (stageOneTranslateX(source) < 1400) leavesLeft.append(clone);
    else if (stageOneTranslateX(source) > 1450) leavesRight.append(clone);
    else sproutStem.append(clone);
  });
  probe?.remove();
  sprout.append(sproutStem, leavesLeft, leavesRight);
  artwork.append(base, sprout);
  artwork.dispatchEvent(new CustomEvent('stage-one-art-ready', { bubbles: true }));
  return true;
}

function appendStageTwoPaths(markup, artwork) {
  if (!markup || typeof DOMParser !== 'function') return false;
  const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml');
  if (parsed.querySelector('parsererror')) return false;
  const paths = [...parsed.documentElement.children].filter((element) => element.localName === 'path');
  if (!paths.length) return false;

  const plant = group('stage-two-plant');
  const body = group('stage-two-body-art');
  paths.forEach((source) => {
    const clone = document.importNode ? document.importNode(source, true) : source.cloneNode(true);
    (isGreenPath(source) ? plant : body).append(clone);
  });
  artwork.querySelector('.stage-two-art-fallback')?.remove();
  artwork.append(plant, body);
  artwork.dispatchEvent(new CustomEvent('stage-two-art-ready', { bubbles: true }));
  return true;
}

function appendReferencePaths(markup, layers) {
  if (!markup || typeof DOMParser !== 'function') return false;
  const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml');
  if (parsed.querySelector('parsererror')) return false;
  const paths = [...parsed.documentElement.children].filter((element) => element.localName === 'path');
  if (paths.length < 9) return false;

  layers.fallback.remove();
  const buckets = [layers.body, layers.body, layers.body, layers.bodyAccent, layers.leaves, layers.stem, layers.leavesFront, layers.leavesFront, layers.highlights];
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
  const faceScale = face.dataset.stage === '1' || face.dataset.stage === '3' || face.dataset.stage === '4' ? 1.45 : 1;
  const eyes = group(`eyes eyes-${customization.eyes}`);
  if (customization.eyes === 'neca_eyes') {
    const stageTwo = face.dataset.stage === '2';
    const eye = (className, x, viewBoxX, centerX) => {
      const artwork = group('neca-eye-artwork', [
        node('svg', {
          class: 'neca-eye-viewport', x, y: '478', width: '130', height: '154',
          viewBox: `${viewBoxX} 0 506 600`, preserveAspectRatio: 'none', 'aria-hidden': 'true',
        }, [
          node('image', {
            href: '/assets/neca_eyes.svg', x: '0', y: '0', width: '1012', height: '600',
            preserveAspectRatio: 'none',
          }),
        ]),
      ]);
      if (faceScale !== 1) artwork.setAttribute('transform', `translate(${centerX} 551) scale(${faceScale}) translate(${-centerX} -551)`);
      return group(`eye ${className}`, [artwork]);
    };
    eyes.append(
      eye('eye-neca-left', stageTwo ? '358' : '321', '0', stageTwo ? 420 : 386),
      eye('eye-neca-right', stageTwo ? '575' : '589', '506', stageTwo ? 640 : 654),
    );
  } else {
    const leftEye = group('eye eye-left');
    const rightEye = group('eye eye-right');
    const variantEyes = customization.eyes !== 'cute';
    const eyeCover = (cx) => node('ellipse', {
      class: 'eye-lid', cx, cy: '552', rx: '53', ry: '58', fill: '#f5991a', opacity: '0',
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
  }
  const eyesAnchor = group('eyes-anchor');
  if (face.dataset.stage === '1') {
    const scale = REFERENCE_VIEWBOX / STAGE_ONE_VIEWBOX.height;
    const offsetX = (REFERENCE_VIEWBOX - STAGE_ONE_VIEWBOX.width * scale) / 2;
    const artworkPoint = (x, y) => ({
      x: offsetX + (x - STAGE_ONE_VIEWBOX.x) * scale,
      y: (y - STAGE_ONE_VIEWBOX.y) * scale,
    });
    const leftEyeCenter = artworkPoint(1281, 780);
    const rightEyeCenter = artworkPoint(1455, 780);
    const eyeScale = (rightEyeCenter.x - leftEyeCenter.x) / (654 - 386);
    eyesAnchor.setAttribute('transform', `translate(${leftEyeCenter.x - 386 * eyeScale} ${leftEyeCenter.y - 552 * eyeScale}) scale(${eyeScale})`);
  }
  eyesAnchor.append(eyes);

  const mouth = group(`mouth mouth-${customization.mouth}`);
  if (customization.mouth === 'neca_mouth') {
    const artwork = group('neca-mouth-artwork', [
      node('image', {
        class: 'neca-mouth-art', href: '/assets/neca_mouth.svg',
        x: '450', y: '639', width: '160', height: '82',
        preserveAspectRatio: 'none', 'aria-hidden': 'true',
      }),
    ]);
    if (faceScale !== 1) artwork.setAttribute('transform', `translate(530 684) scale(${faceScale}) translate(-530 -684)`);
    mouth.append(artwork);
  } else if (customization.mouth === 'fangs') {
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
  const mouthAnchor = group('mouth-anchor');
  if (face.dataset.stage === '1') {
    const scale = REFERENCE_VIEWBOX / STAGE_ONE_VIEWBOX.height;
    const offsetX = (REFERENCE_VIEWBOX - STAGE_ONE_VIEWBOX.width * scale) / 2;
    const centerX = offsetX + (1365.5 - STAGE_ONE_VIEWBOX.x) * scale;
    const centerY = (807 - STAGE_ONE_VIEWBOX.y) * scale;
    const scaleX = (58 * scale) / 114;
    const scaleY = (27 * scale) / 72;
    const necaMouthOffset = customization.mouth === 'neca_mouth' ? 60 : 0;
    mouthAnchor.setAttribute('transform', `translate(${centerX - 530 * scaleX} ${centerY - 665 * scaleY + necaMouthOffset}) scale(${scaleX} ${scaleY})`);
  }
  mouthAnchor.append(mouth);
  face.append(eyesAnchor, mouthAnchor);
}

/** Build the supplied reference SVG inside the shared animation hierarchy. */
export function createPumpkinSvg(pumpkin = {}) {
  const customization = mergeCustomization(pumpkin.customization);
  const stage = Math.max(1, Math.min(4, Number(pumpkin.stage) || 1));
  const root = node('svg', {
    class: 'pumpkin-character', 'data-pumpkin-id': pumpkin.id || '', viewBox: '0 0 1095 1095',
    width: '1095', height: '1095', 'aria-label': pumpkin.displayName || 'Pumpkin', 'data-stage': stage,
    'data-stage-scale': STAGE_SCALES[stage - 1],
  });
  const defs = node('defs');
  const glow = node('filter', { id: `pumpkin-glow-${pumpkin.id || 'new'}`, x: '-30%', y: '-30%', width: '160%', height: '160%' });
  glow.append(node('feGaussianBlur', { stdDeviation: '12', result: 'blur' }), node('feMerge', {}, [node('feMergeNode', { in: 'blur' }), node('feMergeNode', { in: 'SourceGraphic' })]));
  defs.append(glow); root.append(defs);

  const mover = group('mover');
  const floater = group('floater');
  const artworkAnchor = group('artwork-ground-alignment');
  const actor = group('actor');
  const leafBed = group('leaf-bed-static');
  const bodyMotion = group('body-motion idle-body-motion');
  const bodyLook = group('body-look');
  const rocker = group('rocker idle-rocker');
  const blanketBack = group('blanket-back-group', []);
  blanketBack.setAttribute('transform', `scale(${LEGACY_SCALE})`);
  if (customization.prop === 'blanket') {
    const config = BLANKET_STAGE_CONFIG[stage] || BLANKET_STAGE_CONFIG[3];
    const { width, height, x, y } = config;
    const container = group('blanket-container blanket-back-container', []);
    const backArtwork = node('image', {
      class: 'blanket-artwork blanket-back-artwork',
      href: BLANKET_BACK_URL,
      x: String(x),
      y: String(y),
      width: String(width),
      height: String(height),
      preserveAspectRatio: 'none',
      'aria-hidden': 'true',
    });
    container.append(backArtwork);
    blanketBack.append(container);
  }
  const layers = {
    fallback: referenceFallback(),
    body: group(`body pumpkin-body skin-${customization.skin}`),
    bodyAccent: group('body-accent'),
    leaves: group('leaves leaf-bed'),
    leavesFront: group('leaves leaves-front leaf-bed'),
    stem: group('stem'),
    highlights: group('highlights highlight-group'),
  };
  if (stage === 1) layers.body.append(stageOneArtwork());
  else if (stage === 2) layers.body.append(stageTwoArtwork());
  else if (stage === 4) layers.body.append(stageFourArtwork());
  else layers.body.append(layers.fallback);
  const faceMask = group('face-mask face-mask-reference');
  addFaceMask(faceMask);
  // The leaves form a stationary support under the pumpkin. Keep both
  // reference leaf layers outside the animated body stack so idle motion
  // cannot make the pumpkin slide away from its base.
  if (stage !== 4) leafBed.append(layers.leaves, layers.leavesFront);
  if (customization.prop === 'blanket') rocker.append(blanketBack);
  rocker.append(layers.body, layers.bodyAccent, layers.stem, layers.highlights);
  if (stage !== 1 && stage !== 2) rocker.append(faceMask);
  if (stage !== 1 && stage !== 2 && stage !== 4) hydrateReferencePaths(layers);

  const face = group(`face face-${customization.mouth}`);
  face.dataset.stage = String(stage);
  addFaceOverlay(face, customization);
  const faceAnchor = group('face-anchor');
  if (stage === 2) {
    faceAnchor.setAttribute('transform', 'translate(0 253)');
    faceAnchor.append(face);
  }
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
  else if (customization.prop === 'cocoa_hands') {
    const config = COCOA_HANDS_STAGE_CONFIG[stage] || COCOA_HANDS_STAGE_CONFIG[3];
    const { width, height, x, y } = config;
    const container = group('cocoa-hands-container cocoa-hands-fixed-shoulders', []);
    const cocoaSvg = node('svg', {
      class: 'cocoa-hands-artwork cocoa-hands-moving-center',
      x: String(x),
      y: String(y),
      width: String(width),
      height: String(height),
      viewBox: '0 0 991 534',
      preserveAspectRatio: 'none',
      'aria-hidden': 'true',
      'data-shoulder-left': '140',
      'data-shoulder-right': '850',
    });
    for (let i = 0; i < COCOA_HANDS_PATHS.length; i++) {
      const p = COCOA_HANDS_PATHS[i];
      cocoaSvg.append(node('path', {
        class: `cocoa-hands-path cocoa-hands-path-${i}`,
        d: p.d,
        fill: p.fill,
        'fill-rule': p.fillRule || 'evenodd',
        stroke: p.stroke || p.fill,
        'stroke-width': p.strokeWidth || '0.25',
        'stroke-linejoin': p.strokeLinejoin || 'round',
      }));
    }
    container.append(cocoaSvg);
    accessory.append(container);
  } else if (customization.prop === 'blanket') {
    const config = BLANKET_STAGE_CONFIG[stage] || BLANKET_STAGE_CONFIG[3];
    const { width, height, x, y } = config;
    const container = group('blanket-container blanket-front-container', []);
    const frontArtwork = node('image', {
      class: 'blanket-artwork blanket-front-artwork',
      href: BLANKET_FRONT_URL,
      x: String(x),
      y: String(y),
      width: String(width),
      height: String(height),
      preserveAspectRatio: 'none',
      'aria-hidden': 'true',
    });
    container.append(frontArtwork);
    accessory.append(container);
  }

  if (stage === 2) rocker.append(faceAnchor, hat, accessory);
  else rocker.append(face, hat, accessory);
  bodyLook.append(rocker);
  bodyMotion.append(bodyLook);
  actor.append(bodyMotion);
  // Keep the visible artwork anchored inside the root square. Growth scaling
  // belongs to the root layout box. Keep this correction outside animated
  // layers so drag and jump transforms cannot replace it.
  const stageTransform = stage === 1
    ? 'translate(0 55)'
    : stage === 4
      ? 'translate(0 29)'
      : stage === 2
        ? 'translate(68 9)'
        : `translate(${REFERENCE_VIEWBOX / 2 - REFERENCE_ARTWORK_CENTER_X} ${REFERENCE_VIEWBOX - REFERENCE_ARTWORK_BOTTOM})`;
  artworkAnchor.setAttribute('transform', stageTransform);
  artworkAnchor.append(leafBed, actor);
  // The root SVG is the stage-sized logical square. Keep the hitbox in that
  // same untransformed square so it cannot drift away from the visual box.
  const interactionHitbox = node('rect', {
    class: 'interaction-hitbox',
    x: String(REFERENCE_INTERACTION_BOX.x), y: String(REFERENCE_INTERACTION_BOX.y),
    width: String(REFERENCE_INTERACTION_BOX.width), height: String(REFERENCE_INTERACTION_BOX.height),
    fill: 'transparent', 'pointer-events': 'all', 'aria-hidden': 'true',
  });
  floater.append(artworkAnchor); mover.append(floater, interactionHitbox); root.append(mover);
  return root;
}

export function normalizeCustomization(value = {}) { return mergeCustomization(value); }

export function normalizeGrowthMultipliers(value = {}) {
  const source = value || {};
  return Object.fromEntries(Object.keys(DEFAULT_GROWTH_MULTIPLIERS).map((key) => {
    const number = Number(source[key]);
    return [key, Number.isFinite(number) && number > 0 ? number : DEFAULT_GROWTH_MULTIPLIERS[key]];
  }));
}
