import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PumpkinCharacter } from '../public/js/shared/pumpkin-character.js';
import { PumpkinRenderer } from '../public/js/shared/pumpkin-renderer.js';

function createPhysicsCharacter({ x = 0, y = 0, stageSize = 20 } = {}) {
  const character = Object.create(PumpkinCharacter.prototype);
  character.x = x;
  character.y = y;
  character.stageSize = stageSize;
  character.velocity = { x: 0, y: 0 };
  character.supportY = y;
  character.physicsAccumulator = 0;
  character.physicsActive = false;
  character.isAirborne = false;
  character.destroyed = false;
  character.data = {};
  character.stopAction = () => {};
  character.root = {
    classList: {
      add() {},
      remove() {},
      toggle() {},
    },
  };
  character._setPosition = (nextX, nextY) => {
    character.x = nextX;
    character.y = nextY;
  };
  return character;
}

test('pumpkin physics falls to the configured ground', () => {
  const falling = createPhysicsCharacter();
  falling.startPhysics({ supportY: 100 });
  for (let frame = 0; frame < 20 && falling.physicsActive; frame += 1) {
    falling.stepPhysics(1 / 60, { groundY: 100 });
  }
  assert.equal(falling.y, 100);
  assert.equal(falling.isAirborne, false);
  assert.equal(falling.physicsActive, false);

  const delayed = createPhysicsCharacter();
  delayed.startPhysics({ supportY: 1000 });
  delayed.stepPhysics(1, { groundY: 1000 });
  assert.ok(delayed.y < 10, 'a delayed animation frame is capped to 50 ms');

  const fallingPastPumpkin = createPhysicsCharacter({ x: 50, y: 0 });
  fallingPastPumpkin.startPhysics({ supportY: 100 });
  for (let frame = 0; frame < 20 && fallingPastPumpkin.physicsActive; frame += 1) {
    fallingPastPumpkin.stepPhysics(1 / 60, { groundY: 100 });
  }
  assert.equal(fallingPastPumpkin.y, 100, 'the pumpkin reaches the floor instead of settling on another pumpkin');
  assert.equal(fallingPastPumpkin.isAirborne, false);
});

test('pumpkin released in the air settles at the bottom edge of the scene', () => {
  const falling = createPhysicsCharacter({ x: 400, y: 600 });
  falling.startPhysics({ supportY: 1080 });
  for (let frame = 0; frame < 120 && falling.physicsActive; frame += 1) {
    falling.stepPhysics(1 / 60, { groundY: 1080 });
  }
  assert.equal(falling.y, 1080);
  assert.equal(falling.isAirborne, false);
  assert.equal(falling.physicsActive, false);
});

test('pumpkin follows one parabolic jump, reaches its exact target, and cancels on direct movement', () => {
  const previousGsap = globalThis.gsap;
  const timelines = [];
  globalThis.gsap = {
    set() {},
    timeline(options) {
      const timeline = {
        options,
        tweens: [],
        killed: false,
        to(target, vars, position) {
          this.tweens.push({ target, vars, position });
          return this;
        },
        kill() { this.killed = true; },
      };
      timelines.push(timeline);
      return timeline;
    },
  };
  try {
    const character = createPhysicsCharacter({ x: 100, y: 500, stageSize: 120 });
    character.actor = {};
    character.tweens = new Set();
    character.actionTweens = new Set();
    character.stopAction = PumpkinCharacter.prototype.stopAction;
    character.hopTo(700, 500, { speed: 100, height: 90 });

    const [hop] = timelines;
    const jump = hop.tweens.find(({ target }) => target !== character.actor);
    const squashTweens = hop.tweens.filter(({ target }) => target === character.actor);
    assert.equal(squashTweens.length, 4, 'takeoff and landing each squash then return to normal');
    const takeoffRelease = squashTweens[1];
    const landingSquash = squashTweens[2];
    assert.equal(
      jump.position,
      takeoffRelease.position,
      'the parabolic jump starts with the takeoff squash release',
    );
    assert.equal(
      landingSquash.position,
      jump.position + jump.vars.duration,
      'landing compression starts when the flight reaches its target',
    );
    assert.equal(jump.vars.ease, 'none', 'linear progress keeps the trajectory parabolic');
    assert.equal(jump.vars.duration, 6, 'movement duration follows the configured pixels-per-second speed');
    jump.target.value = 0.5;
    jump.vars.onUpdate();
    assert.equal(character.y, 410, 'the configured parabola height sets the apex relative to the baseline');
    assert.deepEqual(
      squashTweens.map(({ vars }) => [vars.scaleX, vars.scaleY]),
      [[.82, 1.16], [1, 1], [1.18, .84], [1, 1]],
    );
    assert.ok(squashTweens[0].vars.duration >= .35, 'stronger takeoff compression remains gradual');
    assert.ok(squashTweens[1].vars.duration >= .5, 'takeoff release is slower and smooth');
    assert.ok(squashTweens[2].vars.duration >= .35, 'landing compression remains gradual');
    assert.ok(squashTweens[3].vars.duration >= .55, 'landing returns slowly to the original shape');
    assert.ok(squashTweens.every(({ vars }) => vars.ease === 'sine.inOut' || vars.ease === 'sine.out'));
    assert.equal(character.x, 400, 'the pumpkin moves horizontally through the arc midpoint');
    assert.ok(character.y < 500, 'the pumpkin reaches the apex halfway through the jump');
    hop.options.onComplete();
    assert.equal(character.x, 700);
    assert.equal(character.y, 500);
    assert.equal(character.data.x, 700);

    const otherCharacter = createPhysicsCharacter({ x: 200, y: 500, stageSize: 120 });
    otherCharacter.actor = {};
    otherCharacter.tweens = new Set();
    otherCharacter.actionTweens = new Set();
    otherCharacter.stopAction = PumpkinCharacter.prototype.stopAction;
    otherCharacter.hopTo(800, 500, { duration: 1.8, height: 90 });
    const independentHop = timelines[1];
    assert.notEqual(independentHop, hop);
    assert.equal(independentHop.killed, false, 'one character can hop while another is in motion');

    character.hopTo(900, 500, { duration: 1.8, height: 90 });
    const interruptedHop = timelines[2];
    character.moveTo(350, 480, { immediate: true, isAirborne: true });
    assert.equal(interruptedHop.killed, true);
    assert.equal(independentHop.killed, false, 'interrupting one character does not cancel another character');
    assert.equal(character.x, 350);
    assert.equal(character.y, 480);
    assert.equal(character.isAirborne, true);
    otherCharacter.stopAction();
  } finally {
    if (previousGsap === undefined) delete globalThis.gsap;
    else globalThis.gsap = previousGsap;
  }
});

test('renderer advances shared physics with requestAnimationFrame and cancels it on cleanup', () => {
  const previousRequest = globalThis.requestAnimationFrame;
  const previousCancel = globalThis.cancelAnimationFrame;
  const callbacks = new Map();
  let nextFrameId = 0;
  globalThis.requestAnimationFrame = (callback) => {
    const id = ++nextFrameId;
    callbacks.set(id, callback);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => callbacks.delete(id);
  try {
    const renderer = new PumpkinRenderer(null);
    const frames = [];
    const character = {
      physicsActive: true,
      startPhysics(options) { this.options = options; },
      stepPhysics(delta, options) { frames.push({ delta, options }); return this.physicsActive; },
      stopPhysics() { this.physicsActive = false; },
      stopAction() {},
      destroy() {},
    };
    renderer.characters.set('pumpkin-1', character);
    renderer.characters.set('support', {
      x: 70, y: 80, stageSize: 40, physicsActive: false, isAirborne: false,
      stopPhysics() {}, stopAction() {}, destroy() {},
    });
    renderer.startPhysics('pumpkin-1', { groundY: 100 });
    assert.equal(callbacks.size, 1);

    let [frameId, callback] = callbacks.entries().next().value;
    callbacks.delete(frameId);
    callback(1000);
    [frameId, callback] = callbacks.entries().next().value;
    callbacks.delete(frameId);
    callback(1016);
    assert.equal(frames.length, 2);
    assert.equal(frames[1].delta, 0.016);
    assert.deepEqual(frames[1].options, { groundY: 100 }, 'the renderer does not pass other pumpkins as physics supports');

    renderer.stopActions();
    assert.equal(character.physicsActive, false);
    assert.equal(callbacks.size, 0);
    character.physicsActive = true;
    renderer.startPhysics('pumpkin-1', { groundY: 100 });
    renderer.clear();
    assert.equal(callbacks.size, 0);
    assert.equal(renderer.characters.size, 0);
    renderer.destroy();
  } finally {
    if (previousRequest === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = previousRequest;
    if (previousCancel === undefined) delete globalThis.cancelAnimationFrame;
    else globalThis.cancelAnimationFrame = previousCancel;
  }
});

test('renderer restarts physics when an updated pumpkin remains airborne', () => {
  const previousRequest = globalThis.requestAnimationFrame;
  const previousCancel = globalThis.cancelAnimationFrame;
  const callbacks = new Map();
  globalThis.requestAnimationFrame = (callback) => {
    const id = callbacks.size + 1;
    callbacks.set(id, callback);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => callbacks.delete(id);
  try {
    const renderer = new PumpkinRenderer(null);
    const character = {
      data: { id: 'pumpkin-1', stage: 1 },
      x: 0,
      y: 0,
      physicsActive: false,
      setNameVisibility() {},
      moveTo(x, y) { this.x = x; this.y = y; },
      startPhysics() { this.physicsActive = true; },
      stopPhysics() { this.physicsActive = false; },
      stopAction() {},
      destroy() {},
    };
    renderer.characters.set(character.data.id, character);
    renderer.update({ id: character.data.id, stage: 1, x: 40, y: 500, isAirborne: true });
    assert.equal(character.physicsActive, true);
    assert.equal(callbacks.size, 1);
    renderer.clear();
    assert.equal(callbacks.size, 0);
  } finally {
    if (previousRequest === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = previousRequest;
    if (previousCancel === undefined) delete globalThis.cancelAnimationFrame;
    else globalThis.cancelAnimationFrame = previousCancel;
  }
});

test('renderer hops only for explicit roaming moves and starts physics after an airborne drag ends', () => {
  const previousRequest = globalThis.requestAnimationFrame;
  const previousCancel = globalThis.cancelAnimationFrame;
  const callbacks = new Map();
  let nextId = 0;
  globalThis.requestAnimationFrame = (callback) => {
    const id = ++nextId;
    callbacks.set(id, callback);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => callbacks.delete(id);
  try {
    const renderer = new PumpkinRenderer(null);
    const moves = [];
    const hops = [];
    const character = {
      x: 400,
      y: 900,
      physicsActive: false,
      moveTo(x, y, options) {
        this.x = x;
        this.y = y;
        moves.push({ x, y, options });
      },
      hopTo(x, y, options) { hops.push({ x, y, options }); },
      startPhysics(options) { this.physicsActive = true; this.physicsOptions = options; },
      stopPhysics() { this.physicsActive = false; },
      stopAction() {},
      destroy() {},
    };
    renderer.characters.set('roamer', character);
    renderer.applyMove({ id: 'roamer', x: 600, y: 980, sequence: -1, movementType: 'roam', roamingSpeed: 200, roamingJumpHeight: 95 });
    assert.deepEqual(hops, [{ x: 600, y: 980, options: { speed: 200, height: 95 } }]);
    assert.equal(moves.length, 0, 'autonomous roaming uses hops, not a smooth glide');
    renderer.applyMove({ id: 'roamer', x: 610, y: 980, sequence: -1 });
    assert.equal(hops.length, 1, 'manual moves without the roam marker do not start hop animation');
    assert.equal(moves.length, 1);

    renderer.finishMove({
      id: 'roamer', x: 620, y: 980, fromX: 620, fromY: 600,
      groundY: 980, isAirborne: true,
    });
    assert.deepEqual(moves.at(-1), {
      x: 620, y: 600, options: { immediate: true, isAirborne: true, duration: 0.16 },
    });
    assert.equal(character.physicsActive, true);
    assert.deepEqual(character.physicsOptions, { supportY: 980 });
    renderer.clear();
  } finally {
    if (previousRequest === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = previousRequest;
    if (previousCancel === undefined) delete globalThis.cancelAnimationFrame;
    else globalThis.cancelAnimationFrame = previousCancel;
  }
});

test('admin preview and overlay both use the shared pumpkin renderer', async () => {
  const admin = await readFile(new URL('../public/js/admin-app.js', import.meta.url), 'utf8');
  const overlay = await readFile(new URL('../public/js/overlay-app.js', import.meta.url), 'utf8');
  assert.match(admin, /import \{ PumpkinRenderer \} from '\.\/shared\/pumpkin-renderer\.js/);
  assert.match(overlay, /import \{ PumpkinRenderer \} from '\.\/shared\/pumpkin-renderer\.js/);
});

test('shared pumpkin artwork exposes independent reference layers and face parts', async () => {
  const source = await readFile(new URL('../public/js/shared/pumpkin-svg.js', import.meta.url), 'utf8');
  for (const fragment of ["group('mover')", "group('floater')", "group('actor')", "group('leaf-bed-static')", "group('body-motion idle-body-motion')", "group('body-look')", "group('stem')", 'group(`body pumpkin-body', "group('leaves leaf-bed')", "group('highlights highlight-group')", 'group(`eyes eyes-', "group('eye eye-left')", "group('eye eye-right')", 'group(`mouth mouth-', 'hat hat-accessory', 'prop-accessory']) {
    assert.ok(source.includes(fragment), `missing SVG layer fragment ${fragment}`);
  }
  assert.doesNotMatch(source, /ground-shadow|air-planter/);
  const asset = await readFile(new URL('../public/assets/pumpkin-reference.svg', import.meta.url), 'utf8');
  assert.match(asset, /viewBox="0 0 1095 1095"/);
  assert.equal((asset.match(/<path\b/g) || []).length, 9);
  const stageOne = await readFile(new URL('../public/assets/pumpkin-stage-1.svg', import.meta.url), 'utf8');
  assert.match(stageOne, /viewBox="850 80 1100 1380"/);
  assert.doesNotMatch(stageOne, /fill="#FEFEFE"/);
  assert.equal((stageOne.match(/<path\b/g) || []).length, 672);
  const stageFour = await readFile(new URL('../public/assets/pumpkin-stage-4.svg', import.meta.url), 'utf8');
  assert.match(stageFour, /<svg[^>]+width="961"[^>]+height="960"/);
  assert.equal((stageFour.match(/<path\b/g) || []).length, 1629);
  const stageTwo = await readFile(new URL('../public/assets/pumpkin-stage-2.svg', import.meta.url), 'utf8');
  assert.match(stageTwo, /width="1258"[^>]+height="1258"/);
  assert.equal((stageTwo.match(/<path\b/g) || []).length, 1478);
  assert.match(source, /STAGE_TWO_URL = '\/assets\/pumpkin-stage-2\.svg'/);
  assert.match(source, /appendStageTwoPaths\(markup, artwork\)/);
  assert.match(source, /stage-two-plant/);
  assert.match(source, /function isStageOneFacePath\(/);
  assert.match(source, /if \(isStageOneFacePath\(source, bounds\)\) return;/);
  assert.match(source, /const leftEyeCenter = artworkPoint\(1281, 780\)/);
  assert.match(source, /const centerX = offsetX \+ \(1365\.5 - STAGE_ONE_VIEWBOX\.x\) \* scale/);
  assert.match(source, /faceAnchor\.setAttribute\('transform', 'translate\(0 253\)'\)/);
  assert.match(source, /faceAnchor\.append\(face\)/);
  assert.match(source, /if \(stage === 2\) rocker\.append\(faceAnchor, hat, accessory\)/);
});

test('shared pumpkin artwork anchors every growth stage to its bottom edge', async () => {
  const source = await readFile(new URL('../public/js/shared/pumpkin-svg.js', import.meta.url), 'utf8');
  assert.match(source, /const REFERENCE_ARTWORK_BOTTOM = 1041;/);
  assert.match(source, /const REFERENCE_INTERACTION_BOX = Object\.freeze\(\{ x: 0, y: 0, width: REFERENCE_VIEWBOX, height: REFERENCE_VIEWBOX \}\);/);
  assert.match(source, /const stageTransform = stage === 1/);
  assert.match(source, /STAGE_ONE_URL = '\/assets\/pumpkin-stage-1\.svg'/);
  assert.match(source, /STAGE_FOUR_URL = '\/assets\/pumpkin-stage-4\.svg'/);
  assert.match(source, /stageOneArtwork\(\)/);
  assert.match(source, /stageFourArtwork\(\)/);
  assert.match(source, /if \(stage !== 4\) leafBed\.append/);
  assert.match(source, /if \(stage !== 1 && stage !== 2\) rocker\.append\(faceMask\)/);
  assert.match(source, /else rocker\.append\(face, hat, accessory\)/);
  assert.match(source, /stage === 1 \|\| stage === 4/);
  assert.match(source, /leafBed\.setAttribute\('transform', stageTransform\);/);
  assert.match(source, /actor\.setAttribute\('transform', stageTransform\);/);
  assert.match(source, /stage === 2\s*\?\s*'translate\(68 -45\)'/);
  assert.match(source, /stage !== 1 && stage !== 2 && stage !== 4\) hydrateReferencePaths/);
});

test('admin interaction uses the transformed artwork hitbox instead of the shifted root square', async () => {
  const svgSource = await readFile(new URL('../public/js/shared/pumpkin-svg.js', import.meta.url), 'utf8');
  const cssSource = await readFile(new URL('../public/css/admin.css', import.meta.url), 'utf8');
  const adminHtml = await readFile(new URL('../public/admin.html', import.meta.url), 'utf8');
  const overlayHtml = await readFile(new URL('../public/overlay.html', import.meta.url), 'utf8');
  assert.match(svgSource, /class: 'interaction-hitbox'/);
  assert.ok(svgSource.includes("interactionHitbox.setAttribute('transform', stageTransform)") || svgSource.includes("const interactionHitbox = node('rect'"));
  assert.match(svgSource, /mover\.append\(floater, interactionHitbox\)/);
  assert.match(cssSource, /\.scene-canvas \.pumpkin-character \{[\s\S]*pointer-events: none;/);
  assert.match(cssSource, /\.scene-canvas \.pumpkin-character \.interaction-hitbox \{[\s\S]*pointer-events: all;/);
  assert.match(adminHtml, /src="\/js\/admin-app\.js\?v=pumpkin-movement-distance-20261023"/);
  assert.match(overlayHtml, /src="\/js\/overlay-app\.js\?v=pumpkin-jump-height-setting-20261023"/);
});

test('shared character includes smooth idle, face, stem, and cleanup animation hooks', async () => {
  const source = await readFile(new URL('../public/js/shared/pumpkin-character.js', import.meta.url), 'utf8');
  for (const method of ['_scheduleFloat', '_scheduleBodyRock', '_scheduleStageOneCozy', '_scheduleStageTwoPlantSway', '_scheduleStemSway', 'blink', '_animateMouth', 'stopIdle', 'destroy']) {
    assert.match(source, new RegExp(`\\b${method}\\s*\\(`), `missing animation method ${method}`);
  }
  assert.doesNotMatch(source, /repeatRefresh:/);
  assert.match(source, /this\.idleTimers\.clear\(\)/);
  assert.match(source, /STAGE_TWO_PLANT_ORIGIN = '548 620'/);
  assert.match(source, /if \(this\.stageTwoPlant\) gsap\.set\(this\.stageTwoPlant/);

  const floatBlock = source.slice(source.indexOf('  _scheduleFloat('), source.indexOf('  _scheduleBodyRock('));
  assert.match(floatBlock, /rotation:/);
  assert.doesNotMatch(floatBlock, /\by:/);
  assert.match(floatBlock, /this\.bodyMotion/);
  assert.match(floatBlock, /duration: randomBetween\(4\.8, 6\.4\)/);

  const stageOneBlock = source.slice(source.indexOf('  _scheduleStageOneCozy('), source.indexOf('  _scheduleStemSway('));
  assert.match(stageOneBlock, /this\.stageOneSprout/);
  assert.match(stageOneBlock, /stageOneLeavesLeft/);
  assert.match(stageOneBlock, /stageOneLeavesRight/);
  assert.match(stageOneBlock, /sine\.inOut/);
  assert.match(stageOneBlock, /repeat: -1/);
  const stageTwoBlock = source.slice(source.indexOf('  _scheduleStageTwoPlantSway('), source.indexOf('  _scheduleStemSway('));
  assert.match(stageTwoBlock, /this\.stage !== 2/);
  assert.match(stageTwoBlock, /svgOrigin: STAGE_TWO_PLANT_ORIGIN/);
  assert.match(stageTwoBlock, /rotation: amplitude/);
  assert.doesNotMatch(stageTwoBlock, /\by:/);

  const svgSource = await readFile(new URL('../public/js/shared/pumpkin-svg.js', import.meta.url), 'utf8');
  assert.match(svgSource, /stage-one-sprout/);
  assert.match(svgSource, /stage-one-leaves-left/);
  assert.match(svgSource, /stage-one-leaves-right/);
  const rockerBlock = svgSource.slice(svgSource.indexOf('rocker.append('), svgSource.indexOf('hydrateReferencePaths('));
  assert.doesNotMatch(rockerBlock, /layers\.leaves/);

  const lookBlock = source.slice(source.indexOf('  lookAt('), source.indexOf('  _animateFaceVariant('));
  assert.match(lookBlock, /this\.bodyLook/);
  assert.match(lookBlock, /bodyRotation/);

  const mouthBlock = source.slice(source.indexOf('  _animateMouth('), source.indexOf('  waveArms('));
  assert.match(mouthBlock, /scaleX:/);
  assert.match(mouthBlock, /scaleY:/);
  assert.match(mouthBlock, /y:/);
  assert.match(mouthBlock, /transformOrigin:\s*'50% 50%'/);
  assert.doesNotMatch(mouthBlock, /svgOrigin/);
  assert.doesNotMatch(mouthBlock, /\bx:/);
  assert.match(source, /if \(normalizedStage !== this\.stage\) this\._rebuildArtwork\(\{ stage: normalizedStage \}\);/);
});

test('renderer applies global animation settings without replacing characters', async () => {
  const source = await readFile(new URL('../public/js/shared/pumpkin-renderer.js', import.meta.url), 'utf8');
  assert.match(source, /setSettings/);
  assert.match(source, /setAnimationSettings/);
  assert.match(source, /setGrowthMultipliers/);
  assert.match(source, /growthMultipliers/);
  assert.match(source, /character\.restartIdle\(\)/);
  const character = await readFile(new URL('../public/js/shared/pumpkin-character.js', import.meta.url), 'utf8');
  assert.match(character, /setGrowthMultipliers\(/);
  assert.match(character, /this\.growthMultipliers/);
  const stopIdle = character.slice(character.indexOf('  stopIdle() {'), character.indexOf('\n  blink(', character.indexOf('  stopIdle() {')));
  assert.match(stopIdle, /if \(this\.stageOneArt\)/);
  assert.match(stopIdle, /if \(this\.face\)/);
  assert.match(stopIdle, /if \(this\.eyes\)/);
  assert.match(stopIdle, /if \(this\.mouth\)/);
  assert.match(stopIdle, /eyeParts\.length/);
  assert.match(stopIdle, /eyeGlints\.length/);
  assert.match(stopIdle, /eyeLids\.length/);
});

test('global pumpkin tower actions dispatch, roll to server targets, and clean up', async () => {
  const renderer = await readFile(new URL('../public/js/shared/pumpkin-renderer.js', import.meta.url), 'utf8');
  const character = await readFile(new URL('../public/js/shared/pumpkin-character.js', import.meta.url), 'utf8');
  const admin = await readFile(new URL('../public/js/admin-app.js', import.meta.url), 'utf8');
  const overlay = await readFile(new URL('../public/js/overlay-app.js', import.meta.url), 'utf8');
  assert.match(admin, /pumpkin_tower/); assert.match(admin, /finalPumpkins/);
  assert.match(overlay, /if \(payload\.action\)/);
  for (const method of ['stopActions', 'stopTowerMotion', 'startTowerSway', 'stackPumpkins', 'rollPumpkins']) assert.match(renderer, new RegExp(`\\b${method}\\s*\\(`));
  assert.match(renderer, /participants/); assert.match(renderer, /finalPumpkins/); assert.match(renderer, /character\.stopAction/);
  assert.match(renderer, /setTowerPose/); assert.match(renderer, /bendFactor/); assert.match(renderer, /Math\.pow\(heightRatio/); assert.match(renderer, /repeat: -1/); assert.match(renderer, /sine\.inOut/);
  assert.match(renderer, /towerAnimation/); assert.match(renderer, /rotationMultiplier/); assert.match(renderer, /bendMultiplier/); assert.match(renderer, /previousCharacter\.stageSize/); assert.match(renderer, /chainX \+=/);
  assert.match(character, /stack\(/); assert.match(character, /setTowerPose\(/); assert.match(character, /rollTo\(/);
  assert.match(character, /power3\.in/); assert.match(character, /groundY/); assert.match(character, /elastic\.out/);
});

test('shared scene characters render safe, non-empty donor name labels', async () => {
  const character = await readFile(new URL('../public/js/shared/pumpkin-character.js', import.meta.url), 'utf8');
  const renderer = await readFile(new URL('../public/js/shared/pumpkin-renderer.js', import.meta.url), 'utf8');
  const overlay = await readFile(new URL('../public/js/overlay-app.js', import.meta.url), 'utf8');
  assert.match(character, /donor-name-label/);
  assert.match(character, /createElementNS/);
  assert.match(character, /textContent\s*=/);
  assert.doesNotMatch(character, /innerHTML/);
  assert.match(character, /displayName.*trim\(\)/s);
  assert.match(character, /this\.positioning === 'scene'/);
  assert.match(character, /this\.data\.showDisplayName !== false/);
  assert.match(character, /setNameVisibility/);
  assert.match(character, /font-family', 'Tahoma, sans-serif'/);
  assert.match(character, /fill', '#fff'/);
  assert.match(character, /stroke', '#000'/);
  assert.match(character, /setNameFontSize/);
  assert.match(character, /Math\.floor\(availableWidth \/ \(this\.pumpkinNameFontSize \* 0\.6\)\)/);
  assert.match(renderer, /showPumpkinNames/);
  assert.match(renderer, /showPumpkinNames: true/);
  assert.match(renderer, /pumpkinNameFontSize: DEFAULT_PUMPKIN_NAME_FONT_SIZE/);
  assert.match(renderer, /setNameVisibility/);
  assert.match(renderer, /setNameFontSize/);
  assert.match(overlay, /renderer\.setSettings\(scene\.settings\s*\|\|\s*\{\}\)/);
  assert.match(overlay, /settings:updated.*renderer\.setSettings/s);
});

test('tower lifetime starts after stacking and later activations still roll', () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const originalNow = Date.now;
  const originalGsap = globalThis.gsap;
  let now = 0;
  let nextTimerId = 0;
  const timers = new Map();
  const rolls = [];

  globalThis.setTimeout = (callback, delay = 0) => {
    const id = ++nextTimerId;
    timers.set(id, { callback, at: now + Math.max(0, Number(delay) || 0) });
    return id;
  };
  globalThis.clearTimeout = (id) => timers.delete(id);
  Date.now = () => now;
  globalThis.gsap = undefined;

  const advance = (duration) => {
    const target = now + duration;
    while (true) {
      const due = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      const [id, timer] = due;
      timers.delete(id);
      now = timer.at;
      timer.callback();
    }
    now = target;
  };

  try {
    const renderer = new PumpkinRenderer(null, { settings: { towerAnimation: { lifetimeMinSeconds: 2.5, lifetimeMaxSeconds: 20 } } });
    renderer.characters.set('pumpkin-1', {
      data: { id: 'pumpkin-1' },
      stack() {},
      stopAction() {},
      destroy() {},
      rollTo(x, y, pumpkin) { rolls.push({ x, y, id: pumpkin.id }); },
    });
    const payload = {
      direction: 'left',
      groundY: 980,
      lifetimeSeconds: 2.5,
      participants: [{ id: 'pumpkin-1', level: 0, towerX: 900, towerY: 980, rollDelayMs: 0 }],
      finalPumpkins: [{ id: 'pumpkin-1', x: 200, y: 980 }],
    };

    renderer.action(null, 'pumpkin_tower', payload);
    advance(1379);
    assert.equal(rolls.length, 0);
    advance(2500);
    assert.equal(rolls.length, 0, 'lifetime has not elapsed since the tower finished stacking');
    advance(1);
    assert.equal(rolls.length, 1);

    renderer.action(null, 'pumpkin_tower', payload);
    advance(1380 + 2500 - 1);
    assert.equal(rolls.length, 1);
    advance(1);
    assert.equal(rolls.length, 2, 'a second tower activation still completes');
    renderer.destroy();
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    Date.now = originalNow;
    if (originalGsap === undefined) delete globalThis.gsap;
    else globalThis.gsap = originalGsap;
  }
});

test('admin scene settings expose and save global animation frequencies', async () => {
  const html = await readFile(new URL('../public/admin.html', import.meta.url), 'utf8');
  assert.match(html, /id="eye-frequency"/);
  assert.match(html, /id="mouth-frequency"/);
  assert.match(html, /data-reward-action="inflate"/);
  assert.match(html, /data-reward-action="jump_on"/);
  assert.match(html, /id="save-reward-mapping"/);
  assert.match(html, /id="test-pumpkin-tower"/);
  assert.match(html, /id="pumpkin-name-font-size"/);
  assert.match(html, /id="pumpkin-name-font-size-value"/);
  for (const id of ['tower-sway-amplitude', 'tower-sway-duration', 'tower-rotation-multiplier', 'tower-bend-multiplier', 'tower-lifetime-min-seconds', 'tower-lifetime-max-seconds', 'tower-stack-order']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /Fall after \(s\), min/);
  assert.match(html, /Fall after \(s\), max/);
  assert.match(html, /id="refresh-twitch-rewards"/);
  assert.match(html, /data-reward-action="inflate"[^>]*>/);
  assert.doesNotMatch(html, /data-reward-action="inflate"[^>]*type="text"/);
  assert.match(html, /data-auth-status/);
  assert.match(html, /data-connection-status/);
  assert.match(html, /data-account/);
  assert.match(html, /data-provider-message/);
  for (const provider of ['donationalerts', 'donatex', 'memealerts']) {
    assert.match(html, new RegExp(`data-provider="${provider}"`));
  }
  const source = await readFile(new URL('../public/js/admin-app.js', import.meta.url), 'utf8');
  assert.match(source, /eyeFrequency/);
  assert.match(source, /mouthFrequency/);
  assert.match(source, /admin:settings:update/);
  assert.match(html, /id="roaming-interval-seconds"/);
  assert.match(html, /id="roaming-speed"/);
  assert.match(html, /id="roaming-jump-height"/);
  assert.match(html, /id="roaming-min-distance"/);
  assert.match(html, /id="roaming-max-distance"/);
  assert.match(source, /function saveRoamingSettings\(\)/);
  assert.match(source, /\$\$\('#roaming-interval-seconds, #roaming-speed, #roaming-jump-height, #roaming-min-distance, #roaming-max-distance'\)\.forEach\(\(input\) => input\.addEventListener\('change', saveRoamingSettings\)\)/);
  assert.match(source, /Movement settings saved\./);
  assert.match(source, /The server rejected the movement settings\. Check the entered values and distance range\./);
  assert.match(source, /setTowerAnimationSettings/); assert.match(source, /towerAnimation/); assert.match(source, /invalid_tower_animation/);
  assert.match(source, /rewardMapping/);
  assert.match(source, /saveRewardMapping/);
  assert.match(source, /testPumpkinTower/);
  assert.match(source, /api\/dev\/reward/);
  assert.match(source, /loadTwitchRewards/);
  assert.match(source, /twitch\/rewards/);
  assert.match(source, /Duplicate reward assignment/);
  assert.match(source, /isEnabled/);
  assert.match(source, /pumpkinNameFontSize/);
  assert.match(source, /value\.authStatus/);
  assert.match(source, /value\.connectionStatus/);
  assert.match(source, /value\.account \|\| '—'/);
  assert.match(source, /value\.message \|\| ''/);
  assert.match(source, /donatex: 'DonatEx'/);
  assert.match(source, /memealerts: 'Meme Alerts'/);
  assert.doesNotMatch(source, /Reconnect by disconnecting and connecting again/);
  assert.doesNotMatch(source, /providerLogin/);
  assert.doesNotMatch(source, /animation: \{ eyeFrequency: Number\(\$\('#eye-frequency'\)/);
  const overlay = await readFile(new URL('../public/js/overlay-app.js', import.meta.url), 'utf8');
  assert.match(overlay, /renderer\.sync\(Array\.isArray\(scene\.pumpkins\)/);
  assert.match(overlay, /settings:updated/);
  assert.match(overlay, /renderer\.update\(pumpkin\)/);
});

test('spawn rule controls and read-only keyword previews stay isolated from the live scene', async () => {
  const html = await readFile(new URL('../public/admin.html', import.meta.url), 'utf8');
  assert.match(html, /id="min-spawn-donation"/);
  assert.match(html, /id="spawn-command"/);
  assert.match(html, /id="save-spawn-settings"/);
  assert.match(html, /id="customization-catalog"/);
  const source = await readFile(new URL('../public/js/admin-app.js', import.meta.url), 'utf8');
  assert.match(source, /loadSpawnSettings/);
  assert.match(source, /customizationCatalog/);
  assert.match(source, /message: state\.settings\.spawnCommand/);
  assert.match(source, /Test donation ignored: \$\{reasons\[result\.reason\]/);
  assert.match(source, /if \(result\?\.pumpkin\) upsertPumpkin\(result\.pumpkin\)/);
  const start = source.indexOf('function renderCustomizationCatalog(');
  const end = source.indexOf('\nfunction ', start + 1);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const renderer = source.slice(start, end);
  assert.match(renderer, /new PumpkinCharacter/);
  assert.match(renderer, /keywords/);
  assert.match(renderer, /destroy\(\)/);
  assert.doesNotMatch(renderer, /state\.socket|renderer\.sync|renderer\.update/);
});

test('admin workspace groups existing workflows with accessible disclosures and a square 16:9 preview', async () => {
  const html = await readFile(new URL('../public/admin.html', import.meta.url), 'utf8');
  const css = await readFile(new URL('../public/css/admin.css', import.meta.url), 'utf8');
  assert.match(html, /<details\b/);
  assert.match(html, /<summary\b/);
  for (const selector of [
    'preview-frame', 'scene-canvas', 'clear-all', 'toggle-zone', 'zone-x', 'eye-frequency',
    'mouth-frequency', 'refresh-twitch-rewards', 'save-reward-mapping', 'min-spawn-donation',
    'spawn-command', 'customization-catalog', 'pumpkin-search', 'inspector-form',
    'inspector-empty', 'display-name', 'twitch-username',
  ]) assert.match(html, new RegExp(`id="${selector}"`), `missing existing workflow selector #${selector}`);
  for (const group of ['Integrations', 'Scene settings', 'Donation spawn and growth rules', 'Customization', 'Pumpkin inspector']) {
    assert.match(html, new RegExp(group, 'i'), `missing admin group ${group}`);
  }
  assert.match(css, /aspect-ratio:\s*16\s*\/\s*9/u);
  assert.doesNotMatch(css, /\.preview-frame\s*\{[^}]*min-height\s*:/su);
  const cornerRadii = [...css.matchAll(/border-radius:\s*([^;]+);/gu)].map((match) => match[1].trim());
  assert.ok(cornerRadii.every((radius) => /^0(?:px)?$/u.test(radius)));
  assert.doesNotMatch(css, /#c878ff|#302044|#ef7089/iu);
  assert.match(css, /--bg:\s*#f0eee5/u);
  assert.match(css, /--accent:\s*#8d4f24/u);
  assert.match(css, /:focus-visible/u);
  assert.match(css, /prefers-reduced-motion/u);
  assert.match(css, /@media\s*\(max-width:\s*620px\)/u);
  assert.match(css, /details:not\(\[open\]\)\s*>\s*:not\(summary\)\s*\{\s*display:\s*none;/u);
});

test('admin drag bounds allow the artwork to reach the bottom of the widget', async () => {
  const source = await readFile(new URL('../public/js/admin-app.js', import.meta.url), 'utf8');
  assert.match(source, /const minY = height \+ padding; const maxY = SCENE_HEIGHT;/);
});
