// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the
// display's rate. This module owns the wiring — shooting, grenades, tracers,
// the charge, death and spectating, the buy phase — while each system owns
// its own numbers: weapons.js the guns, bots.js the AI, rounds.js the match,
// economy.js the money, hud.js the screen.
// ?shot=start|play|end with &seed=N sets up a deterministic frame for a
// capture, renders it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createAudio } from './audio.js';
import { createMover } from './physics.js';
import { createWorld, EMBER_SPAWNS, ASH_SPAWNS, SITES } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeaponRig, WEAPONS, HEAD_MULT, GRENADE_PRICE, ARMOUR_PRICE } from './weapons.js';
import { createBots } from './bots.js';
import { createEconomy, KILL_REWARD, PLANT_REWARD, DEFUSE_REWARD } from './economy.js';
import { createRounds, BUY_SECONDS } from './rounds.js';
import { createHud } from './hud.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 30, 70);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const audio = createAudio();
const world = createWorld(scene);
const mover = createMover(world.colliders);
const hud = createHud(Boolean(shot));
const economy = createEconomy();
const rounds = createRounds();
const weapon = createWeaponRig(camera);
const player = createPlayer(mover, EMBER_SPAWNS[0]);
const input = createInput(renderer.domElement, onLockChange);
const bots = createBots(scene, world, mover);

const raycaster = new THREE.Raycaster();
raycaster.far = 140;
const direction = new THREE.Vector3();
const tmpVec = new THREE.Vector3();
const tmpVec2 = new THREE.Vector3();

// Tracers: a pool of fading lines, one per shot, so gunfire reads in the air.
const tracers = [];
for (let i = 0; i < 16; i += 1) {
  const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xffc861, transparent: true, opacity: 0 }));
  line.visible = false;
  line.frustumCulled = false;
  scene.add(line);
  tracers.push({ line, life: 0 });
}
function fireTracer(from, to) {
  const tracer = tracers.find((t) => t.life <= 0) ?? tracers[0];
  tracer.line.geometry.setFromPoints([from, to]);
  tracer.line.material.opacity = 0.85;
  tracer.line.visible = true;
  tracer.life = 0.07;
}

// The planted charge: a small box with a blinking light at the site centre.
const bombMesh = new THREE.Group();
const bombBody = new THREE.Mesh(
  new THREE.BoxGeometry(0.4, 0.25, 0.3),
  new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.danger), roughness: 0.5 }),
);
const bombLight = new THREE.PointLight(new THREE.Color(PALETTE.danger), 0, 8);
bombLight.position.y = 0.4;
bombMesh.add(bombBody, bombLight);
bombMesh.visible = false;
scene.add(bombMesh);

// Grenades in flight and the blast flash that follows one.
const grenades = [];
const blastMesh = new THREE.Mesh(
  new THREE.SphereGeometry(1, 16, 12),
  new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0, depthWrite: false }),
);
blastMesh.visible = false;
scene.add(blastMesh);
let blastLife = 0;

const body = player.state;
let health = 100;
let playerAlive = true;
let spectateBot = null;
let elapsed = 0;
let roundEndAt = 0;
let started = false;
let frozen = false;
let accumulator = 0;
let lastTime = performance.now();
let lastBeepSecond = -1;
let buyOpen = false;
let lastSeenCheck = 0;

const shootables = world.shootables;
function botHitMeshes() {
  const meshes = [];
  for (const bot of bots.bots) {
    if (bot.alive) meshes.push(bot.torso, bot.head);
  }
  return meshes;
}

function botByMesh(mesh) {
  return mesh.userData.bot ?? null;
}

function damagePlayer(amount, fromBot) {
  // Staged captures never kill the player: the shot frames must keep the
  // first-person view, so damage is ignored while ?shot= is set.
  if (shot) return;
  if (!playerAlive) return;
  let dealt = amount;
  if (weapon.state.armour > 0) {
    const absorbed = Math.min(weapon.state.armour, dealt * 0.5);
    weapon.state.armour -= absorbed;
    dealt -= absorbed;
  }
  health -= dealt;
  hud.damage();
  audio.hurt();
  if (health <= 0) {
    health = 0;
    playerAlive = false;
    spectateBot = bots.bots.find((b) => b.team === 'ember' && b.alive) ?? null;
    hud.showOverlay('dead');
    if (document.pointerLockElement) document.exitPointerLock();
    if (fromBot) {
      hud.killfeed(fromBot.name, 'You', false, 'ash');
    }
    checkElimination();
  }
  refreshHud();
}

function damageBot(bot, amount, part, byPlayer) {
  const killed = bots.damageBot(bot, amount, part);
  if (killed) {
    hud.killfeed(byPlayer ? 'You' : bot.name, bot.name, part === 'head', byPlayer ? 'ember' : 'ash');
    if (byPlayer) {
      economy.earn(KILL_REWARD);
      hud.setMoney(economy.money);
    }
    rounds.cancelChannels(bot);
    if (bot.isCarrier && !rounds.state.bomb.planted) {
      // The charge drops to the nearest living Ember bot.
      const next = bots.bots.find((b) => b.team === 'ember' && b.alive);
      if (next) next.isCarrier = true;
    }
    checkElimination();
  }
  return killed;
}

function checkElimination() {
  if (rounds.state.phase !== 'live') return;
  const emberAlive = bots.aliveCount('ember') + (playerAlive ? 1 : 0);
  const ashAlive = bots.aliveCount('ash');
  if (ashAlive === 0) {
    finishRound('ember', 'Ash team eliminated');
  } else if (emberAlive === 0 && !rounds.state.bomb.planted) {
    finishRound('ash', 'Ember team eliminated');
  }
}

function finishRound(winner, reason) {
  if (rounds.state.phase !== 'live' && rounds.state.phase !== 'buy') return;
  const end = rounds.endRound(winner, reason);
  const weWon = winner === 'ember';
  economy.roundEnd(weWon);
  audio[weWon ? 'roundWin' : 'roundLose']();
  hud.banner(
    weWon ? 'ROUND WON' : 'ROUND LOST',
    `${reason} — ${end.winner === 'ember' ? 'Ember' : 'Ash'} ${rounds.state.score.ember} : ${rounds.state.score.ash}`,
    3800,
  );
  hud.setBomb('none');
  bombMesh.visible = false;
  roundEndAt = elapsed + 4.5;
  refreshHud();
}

function advanceRound() {
  if (rounds.state.matchOver) {
    hud.showOverlay('end', rounds.state.matchWinner === 'ember' ? 'Ember takes the match.' : 'Ash takes the match.');
    return;
  }
  rounds.nextRound();
  resetRound();
  hud.banner(`ROUND ${rounds.state.round}`, 'Buy phase — press B to open the buy menu', 2600);
}

function resetRound() {
  bots.reset(EMBER_SPAWNS, ASH_SPAWNS, SITES);
  player.respawn(EMBER_SPAWNS[0]);
  weapon.resetRound();
  health = 100;
  playerAlive = true;
  spectateBot = null;
  // The start overlay stays as it is: at boot it is the title screen, and
  // mid-match the pointer lock already hides it (see onLockChange).
  hud.setBomb('none');
  bombMesh.visible = false;
  refreshHud();
}

function refreshHud() {
  const ammo = weapon.state.ammo[weapon.state.current];
  hud.setAmmo(ammo.mag, ammo.reserve, weapon.def().name, weapon.state.grenades);
  hud.setHealth(health, weapon.state.armour);
  hud.setMoney(economy.money);
  hud.setScore(rounds.state.score.ember, rounds.state.score.ash, rounds.state.round);
  hud.setAlive(bots.aliveCount('ember') + (playerAlive ? 1 : 0), bots.aliveCount('ash'));
}

function shoot(spread) {
  const def = weapon.def();
  if (!weapon.takeRound()) {
    audio.dryFire();
    return false;
  }
  camera.getWorldDirection(direction);
  const pellets = def.pellets ?? 1;
  let anyHit = false;
  for (let p = 0; p < pellets; p += 1) {
    tmpVec.copy(direction);
    tmpVec.x += (random() * 2 - 1) * spread;
    tmpVec.y += (random() * 2 - 1) * spread;
    tmpVec.z += (random() * 2 - 1) * spread;
    tmpVec.normalize();
    scene.updateMatrixWorld(true);
    raycaster.set(camera.position, tmpVec);
    raycaster.far = def.range;
    const targets = shootables.concat(botHitMeshes());
    const hit = raycaster.intersectObjects(targets, false)[0];
    const end = hit ? hit.point : tmpVec2.copy(camera.position).addScaledVector(tmpVec, def.range);
    fireTracer(camera.position, end);
    if (hit) {
      const bot = hit.object.userData.bot;
      if (bot) {
        const part = hit.object.userData.part;
        const killed = damageBot(bot, part === 'head' ? def.headDamage : def.damage, part, true);
        hud.hitMarker(killed, shot ? 4000 : 90);
        audio.hit(killed);
        anyHit = true;
      }
    }
  }
  weapon.pullTrigger();
  audio.shot(def.kind);
  bots.bots.forEach((b) => bots.hearShot(b, body.position));
  player.recoil(def.recoil * (0.9 + random() * 0.3), (random() * 2 - 1) * def.recoil * 0.4);
  refreshHud();
  return anyHit;
}

function botShoot(bot, target) {
  const def = WEAPONS[bot.weapon];
  if (bot.cooldown > 0 || bot.mag <= 0) {
    if (bot.mag <= 0) {
      bot.mag = def.mag;
      bot.cooldown = 1.8;
    }
    return;
  }
  bot.mag -= 1;
  bot.cooldown = def.gap + 0.03;
  const from = tmpVec.set(bot.position.x, bot.position.y + 1.45, bot.position.z);
  const to = tmpVec2.set(target.pos.x, target.pos.y + (target.kind === 'player' ? 1.2 : 1.1), target.pos.z);
  const dist = from.distanceTo(to);
  // Accuracy falls with distance and against a moving target; bots miss often
  // enough that a player who strafes and stops to aim wins the duel.
  let hitChance = Math.max(0.12, 0.52 - dist * 0.008);
  if (target.kind === 'player' && player.groundSpeed() > 2) hitChance *= 0.55;
  const headshot = random() < 0.12;
  const miss = new THREE.Vector3(
    to.x + (random() * 2 - 1) * 1.2,
    to.y + (random() * 2 - 1) * 0.8,
    to.z + (random() * 2 - 1) * 1.2,
  );
  fireTracer(from.clone(), random() < hitChance ? to.clone() : miss);
  const nearPlayer = body.position.distanceTo(from) < 30;
  audio.shot(def.kind, !nearPlayer);
  if (random() >= hitChance) return;
  const damage = headshot ? def.headDamage : def.damage;
  if (target.kind === 'player') {
    damagePlayer(damage, bot);
  } else {
    const victim = target.ref;
    const killed = bots.damageBot(victim, damage, headshot ? 'head' : 'torso');
    if (killed) {
      hud.killfeed(bot.name, victim.name, headshot, 'ash');
      checkElimination();
    }
  }
}

function throwGrenade() {
  if (weapon.state.grenades <= 0 || rounds.state.phase !== 'live') return;
  weapon.state.grenades -= 1;
  camera.getWorldDirection(direction);
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 10, 8),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.danger), roughness: 0.4 }),
  );
  mesh.position.copy(camera.position).addScaledVector(direction, 0.4);
  scene.add(mesh);
  grenades.push({
    mesh,
    velocity: direction.clone().multiplyScalar(15).add(new THREE.Vector3(0, 4.5, 0)),
    timer: 1.6,
  });
  audio.buy();
  refreshHud();
}

function explodeGrenade(grenade) {
  const pos = grenade.mesh.position;
  scene.remove(grenade.mesh);
  blastMesh.position.copy(pos);
  blastMesh.visible = true;
  blastLife = 0.45;
  audio.grenade();
  const radius = 7;
  for (const bot of bots.bots) {
    if (!bot.alive) continue;
    const d = Math.hypot(bot.position.x - pos.x, bot.position.y + 1 - pos.y, bot.position.z - pos.z);
    if (d < radius) {
      const killed = bots.damageBot(bot, Math.round(120 - (d / radius) * 100), 'torso');
      if (killed) {
        hud.killfeed('You', bot.name, false, 'ember');
        economy.earn(KILL_REWARD);
        checkElimination();
      }
    }
  }
  const playerDist = Math.hypot(body.position.x - pos.x, body.position.y + 1.2 - pos.y, body.position.z - pos.z);
  if (playerAlive && playerDist < radius) {
    damagePlayer(Math.round((120 - (playerDist / radius) * 100) * 0.5), null);
  }
  refreshHud();
}

function tryPlayerPlantOrDefuse(dt) {
  const bomb = rounds.state.bomb;
  if (rounds.state.phase !== 'live' || !playerAlive) return;
  if (!bomb.planted) {
    const site = world.siteAt(body.position.x, body.position.z);
    if (site && input.state.keys.has('KeyE')) {
      const result = rounds.plantStep(body.position, site, dt);
      if (result === 'planted') {
        economy.earn(PLANT_REWARD);
        hud.setMoney(economy.money);
        hud.setBomb('planted', bomb.timeLeft);
        hud.banner('CHARGE PLANTED', `${site.name} — defend it for 35 seconds`, 3000);
        audio.plant();
        bombMesh.position.set(site.x, 0.15, site.z);
        bombMesh.visible = true;
        bots.bots.forEach((b) => {
          if (b.team === 'ash') bots.pickRoute(b, site);
        });
      } else if (result === 'planting') {
        hud.setBomb('planting');
      }
    } else {
      rounds.cancelChannels(body.position);
      if (hud.setBomb) hud.setBomb(bomb.planted ? 'planted' : 'none', bomb.timeLeft);
    }
    return;
  }
  // Bomb planted: hold E near the site centre to defuse.
  const site = bomb.site;
  const d = Math.hypot(body.position.x - site.x, body.position.z - site.z);
  if (d < 3 && input.state.keys.has('KeyE')) {
    const result = rounds.defuseStep(body.position, dt);
    if (result === 'defused') {
      economy.earn(DEFUSE_REWARD);
      hud.setMoney(economy.money);
      hud.setBomb('defused');
      bombMesh.visible = false;
      audio.roundWin();
      finishRound('ember', 'Charge defused');
    } else if (result === 'defusing') {
      hud.setBomb('defusing');
    }
  } else {
    rounds.cancelChannels(body.position);
    hud.setBomb('planted', bomb.timeLeft);
  }
}

// Bot channel callbacks, wired into the bot step context.
function tryPlant(bot, dt) {
  const site = bot.targetSite;
  const result = rounds.plantStep(bot.position, site, dt);
  if (result === 'planted') {
    hud.setBomb('planted', rounds.state.bomb.timeLeft);
    hud.banner('CHARGE PLANTED', `${site.name} — Ash must defuse`, 3000);
    audio.plant();
    bombMesh.position.set(site.x, 0.15, site.z);
    bombMesh.visible = true;
    return true;
  }
  if (result === 'planting') hud.setBomb('planting');
  return false;
}

function tryDefuse(bot, dt) {
  const result = rounds.defuseStep(bot.position, dt);
  if (result === 'defused') {
    hud.setBomb('defused');
    bombMesh.visible = false;
    audio.roundLose();
    finishRound('ash', 'Charge defused by Ash');
    return true;
  }
  if (result === 'defusing') hud.setBomb('defusing');
  return false;
}

function buyItem(item) {
  let bought = false;
  if (item.kind === 'grenade') {
    bought = economy.spend(GRENADE_PRICE);
    if (bought) weapon.state.grenades += 1;
  } else if (item.kind === 'armour') {
    bought = economy.spend(ARMOUR_PRICE);
    if (bought) weapon.state.armour = 50;
  } else {
    bought = economy.spend(item.price);
    if (bought) weapon.buyPrimary(item.id);
  }
  if (bought) audio.buy();
  else audio.denied();
  refreshHud();
  if (buyOpen) hud.showBuy(economy.buyList(weapon), economy.money, buyItem);
}

function openBuy() {
  if (rounds.state.phase !== 'buy') {
    audio.denied();
    return;
  }
  buyOpen = true;
  if (document.pointerLockElement) document.exitPointerLock();
  hud.showBuy(economy.buyList(weapon), economy.money, buyItem);
}

function closeBuy() {
  buyOpen = false;
  hud.hideBuy();
  if (started && playerAlive && !shot) input.requestLock();
}

function onLockChange(locked) {
  if (shot) return;
  audio.unlock();
  if (locked) {
    started = true;
    hud.hideOverlay();
    if (buyOpen) closeBuy();
  } else if (!playerAlive) {
    hud.showOverlay('dead');
  } else if (rounds.state.matchOver) {
    hud.showOverlay('end', rounds.state.matchWinner === 'ember' ? 'Ember takes the match.' : 'Ash takes the match.');
  } else if (!buyOpen) {
    hud.showOverlay(started ? 'paused' : 'start');
  }
}

hud.onPlay(() => {
  if (shot) return;
  audio.unlock();
  if (rounds.state.matchOver) {
    economy.reset();
    rounds.startMatch();
    resetRound();
  }
  if (!playerAlive) {
    hud.hideOverlay();
    return;
  }
  input.requestLock();
});

function syncCamera() {
  if (!playerAlive && spectateBot) {
    const bot = spectateBot;
    camera.position.set(bot.position.x, bot.position.y + 1.7, bot.position.z);
    camera.rotation.set(0, bot.yaw, 0, 'YXZ');
    return;
  }
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
}

function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function step(dt) {
  elapsed += dt;
  const clockEvent = rounds.step(dt);
  if (clockEvent === 'buyDone') {
    hud.banner(`ROUND ${rounds.state.round} — GO`, 'Eliminate Ash or plant the charge', 2000);
    hud.hideBuy();
    buyOpen = false;
  } else if (clockEvent === 'timeUp') {
    finishRound('ash', 'Time expired — charge never planted');
  } else if (clockEvent === 'detonate') {
    bombMesh.visible = false;
    audio.grenade();
    finishRound('ember', 'Charge detonated at ' + (rounds.state.bomb.site?.name ?? 'the site'));
  }
  if (rounds.state.phase === 'over' && elapsed >= roundEndAt && roundEndAt > 0) {
    roundEndAt = 0;
    advanceRound();
  }

  // Player.
  if (playerAlive) {
    player.step(dt, input.state.keys);
    weapon.step(dt);
    if (input.takePressed('KeyR')) weapon.reload();
    if (input.takePressed('KeyG')) throwGrenade();
    if (input.takePressed('KeyB')) {
      if (buyOpen) closeBuy();
      else openBuy();
    }
    if (input.takePressed('Digit1') && weapon.state.primary && !buyOpen) weapon.switchTo(weapon.state.primary);
    if (input.takePressed('Digit2') && !buyOpen) weapon.switchTo('sidewinder');
    if (buyOpen) {
      const items = economy.buyList(weapon);
      for (let i = 0; i < items.length; i += 1) {
        if (input.takePressed(`Digit${i + 1}`)) buyItem(items[i]);
      }
    }
    // Automatic guns fire while held; the rest fire once per trigger pull,
    // gated by each gun's cooldown, so fire rate is capped by the weapon.
    const def = weapon.def();
    if (def.auto ? input.state.firing : input.state.firing && weapon.state.cooldown === 0) {
      if (weapon.ready()) shoot(shot ? 0 : weapon.spread(player.groundSpeed(), body.crouching));
      else if (weapon.state.ammo[weapon.state.current].mag === 0) weapon.reload();
    }
    tryPlayerPlantOrDefuse(dt);
  }

  // Bots fight only while the round is live: during the buy phase they hold
  // at spawn, and once the round ends the shooting stops.
  if (rounds.state.phase === 'live') {
    bots.step(dt, {
      time: elapsed,
      player: body,
      playerAlive,
      sites: SITES,
      bombPlanted: rounds.state.bomb.planted,
      bombSite: rounds.state.bomb.site,
      botShoot,
      tryPlant,
      tryDefuse,
    });
  }

  // Grenades.
  for (let i = grenades.length - 1; i >= 0; i -= 1) {
    const grenade = grenades[i];
    grenade.timer -= dt;
    grenade.velocity.y -= 12 * dt;
    const next = grenade.mesh.position.clone().addScaledVector(grenade.velocity, dt);
    if (mover.overlaps(next.x, next.y, next.z, 0.2, 0)) {
      // Bounce: dampen and reverse the axis that hit.
      if (!mover.overlaps(grenade.mesh.position.x, next.y, next.z, 0.2, 0)) grenade.velocity.x *= -0.4;
      else if (!mover.overlaps(next.x, next.y, grenade.mesh.position.z, 0.2, 0)) grenade.velocity.z *= -0.4;
      else grenade.velocity.y = Math.abs(grenade.velocity.y) * 0.4;
      grenade.velocity.multiplyScalar(0.6);
    } else {
      grenade.mesh.position.copy(next);
    }
    if (grenade.timer <= 0) {
      explodeGrenade(grenade);
      grenades.splice(i, 1);
    }
  }
  if (blastLife > 0) {
    blastLife -= dt;
    const t = Math.max(0, blastLife / 0.45);
    blastMesh.scale.setScalar(1 + (1 - t) * 6);
    blastMesh.material.opacity = t * 0.7;
    if (blastLife <= 0) blastMesh.visible = false;
  }

  // Tracers fade.
  for (const tracer of tracers) {
    if (tracer.life > 0) {
      tracer.life -= dt;
      tracer.line.material.opacity = Math.max(0, tracer.life / 0.07) * 0.85;
      if (tracer.life <= 0) tracer.line.visible = false;
    }
  }

  // Planted bomb beeps, faster as the timer runs down.
  if (rounds.state.bomb.planted) {
    const seconds = Math.ceil(rounds.state.bomb.timeLeft);
    if (seconds !== lastBeepSecond) {
      lastBeepSecond = seconds;
      audio.beep(seconds <= 5);
      bombLight.intensity = 6;
    } else {
      bombLight.intensity = Math.max(0, bombLight.intensity - dt * 20);
    }
    hud.setBombTime(rounds.state.bomb.timeLeft);
  }

  // HUD: timer, crosshair gap, minimap (enemies only while recently seen).
  const bomb = rounds.state.bomb;
  if (bomb.planted) hud.setTimer(bomb.timeLeft, true);
  else hud.setTimer(rounds.state.timer, false, rounds.state.phase !== 'buy');
  if (playerAlive) {
    const spreadPx = 4 + weapon.spread(player.groundSpeed(), body.crouching) * 900 + weapon.state.bloom * 200;
    hud.setSpread(Math.min(34, spreadPx));
  }
  if (elapsed - lastSeenCheck > 0.25) {
    lastSeenCheck = elapsed;
    for (const bot of bots.bots) {
      if (bot.team !== 'ash' || !bot.alive) {
        bot.seenRecently = false;
        continue;
      }
      eye.set(body.position.x, body.position.y + body.eye, body.position.z);
      targetEye.set(bot.position.x, bot.position.y + 1.4, bot.position.z);
      bot.seenRecently = mover.hasLineOfSight(eye, targetEye, shootables, raycaster, direction, 42);
    }
  }
  hud.drawMinimap(
    playerAlive ? { x: body.position.x, z: body.position.z, yaw: body.yaw } : null,
    bots.bots.filter((b) => b.team === 'ember'),
    bots.bots.filter((b) => b.team === 'ash'),
    SITES,
  );
  refreshHud();
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    if (playerAlive) player.look(look.x, look.y);
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function runShot(name) {
  hud.hideOverlay();
  rounds.startMatch();
  resetRound();
  // Play and end are live rounds; start and buy stay in the buy phase, with
  // both teams holding at spawn.
  if (name === 'play' || name === 'end') rounds.goLive();
  body.pitch = 0;
  body.yaw = 0;
  if (name === 'start') {
    body.position.set(2, 0, 14);
    body.yaw = 0;
    settle(30);
    aimAt(new THREE.Vector3(0, 1.5, -8));
    hud.showOverlay('start');
    hud.banner('EMBER YARD', 'First to 5 rounds — plant or eliminate', 4000);
  } else if (name === 'buy') {
    // Buy phase: the buy menu open, money banked from a won round.
    economy.earn(3250);
    body.position.set(-2, 0, 14);
    body.yaw = 0;
    settle(20);
    aimAt(new THREE.Vector3(0, 1.6, -2));
    buyOpen = true;
    hud.showBuy(economy.buyList(weapon), economy.money, buyItem);
    hud.banner('BUY PHASE', 'Spend your winnings — the round starts soon', 4000);
  } else if (name === 'play') {
    // Mid-round firefight: player on mid lane, an Ash bot ahead, one already down.
    // Staged off the mid axis so the central pillar never blocks the shot.
    body.position.set(4, 0, 8);
    const enemy = bots.bots.find((b) => b.team === 'ash');
    enemy.position.set(0.5, 0, -4);
    enemy.group.position.set(0.5, 0, -4);
    enemy.yaw = Math.PI;
    enemy.state = 'hold';
    enemy.holdUntil = 9999;
    enemy.route = [];
    const downed = bots.bots.filter((b) => b.team === 'ash')[1];
    downed.alive = false;
    downed.group.rotation.x = -Math.PI / 2 + 0.15;
    downed.group.position.y = 0.25;
    const ally = bots.bots.find((b) => b.team === 'ember');
    ally.position.set(-3.5, 0, 4);
    ally.group.position.set(-3.5, 0, 4);
    ally.yaw = 0.4;
    ally.state = 'hold';
    ally.holdUntil = 9999;
    ally.route = [];
    settle(20);
    weapon.buyPrimary('kestrel');
    economy.earn(1200);
    aimAt(new THREE.Vector3(enemy.position.x, 1.4, enemy.position.z));
    for (let round = 0; round < 3; round += 1) {
      shoot(0);
      if (round < 2) settle(8);
    }
    hud.killfeed('You', 'Vex', true, 'ember');
    settle(12);
  } else {
    // Round won: score 1-0, charge planted and defended, buy money banked.
    rounds.state.score.ember = 1;
    economy.earn(3250);
    body.position.set(-12, 0, -6);
    const enemy = bots.bots.find((b) => b.team === 'ash');
    enemy.alive = false;
    enemy.group.rotation.x = -Math.PI / 2 + 0.15;
    enemy.group.position.y = 0.25;
    settle(20);
    aimAt(new THREE.Vector3(-15, 1.2, -11));
    bombMesh.position.set(-15, 0.15, -11);
    bombMesh.visible = true;
    hud.setBomb('planted', 24);
    hud.banner('ROUND WON', 'Charge detonated at Site A — Ember 1 : 0 Ash', 4000);
  }
  refreshHud();
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Eye vector reused by the minimap visibility check.
const eye = new THREE.Vector3();
const targetEye = new THREE.Vector3();

rounds.startMatch();
resetRound();
syncCamera();
refreshHud();
if (shot) runShot(shot);
else requestAnimationFrame(frame);
