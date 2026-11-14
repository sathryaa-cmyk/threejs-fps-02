// Bots: 3 allies and 4 enemies, each a visible body with a head and a torso
// that take different damage. A bot is a small state machine — route, hold,
// engage, plant, defuse, rotate — driven by what it can see and hear:
// line of sight through the world, a reaction delay before its first shot,
// burst fire with spread that grows as it moves, and a callout when the bomb
// goes down that pulls defenders to the site. Bots pick a lane, follow the
// waypoint graph, and hold positions with a view down a lane when they arrive.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { WEAPONS, HEAD_MULT } from './weapons.js';
import { GRAVITY } from './physics.js';

const BOT_NAMES_EMBER = ['Rook', 'Sable', 'Wren'];
const BOT_NAMES_ASH = ['Vex', 'Hale', 'Moss', 'Pike'];
const HEALTH = 100;
const REACTION_MIN = 0.35;
const REACTION_MAX = 0.8;
const SEE_DISTANCE = 42;
const HEAR_DISTANCE = 26;
const BOT_SPEED = 4.4;

const torsoGeometry = new THREE.BoxGeometry(0.52, 0.78, 0.3);
const headGeometry = new THREE.SphereGeometry(0.155, 16, 12);
const legGeometry = new THREE.BoxGeometry(0.2, 0.55, 0.2);
const gunGeometry = new THREE.BoxGeometry(0.08, 0.09, 0.55);

function makeMaterials(team) {
  const teamColor = team === 'ember' ? PALETTE.ember : PALETTE.ash;
  return {
    body: new THREE.MeshStandardMaterial({ color: new THREE.Color(teamColor), roughness: 0.6, metalness: 0.1 }),
    head: new THREE.MeshStandardMaterial({ color: new THREE.Color('#d8c9a8'), roughness: 0.7, metalness: 0.02 }),
    dark: new THREE.MeshStandardMaterial({ color: new THREE.Color('#22262c'), roughness: 0.85 }),
  };
}

export function createBots(scene, world, mover) {
  const bots = [];
  const raycaster = new THREE.Raycaster();
  const eye = new THREE.Vector3();
  const targetEye = new THREE.Vector3();
  const direction = new THREE.Vector3();
  let now = 0;

  function buildBot(team, name, spawn, isCarrier) {
    const mats = makeMaterials(team);
    const group = new THREE.Group();
    const torso = new THREE.Mesh(torsoGeometry, mats.body);
    torso.position.y = 1.0;
    torso.userData.part = 'torso';
    const head = new THREE.Mesh(headGeometry, mats.head);
    head.position.y = 1.53;
    head.userData.part = 'head';
    const legL = new THREE.Mesh(legGeometry, mats.dark);
    legL.position.set(-0.13, 0.28, 0);
    const legR = new THREE.Mesh(legGeometry, mats.dark);
    legR.position.set(0.13, 0.28, 0);
    const gun = new THREE.Mesh(gunGeometry, mats.dark);
    gun.position.set(0.2, 1.05, -0.3);
    group.add(torso, head, legL, legR, gun);
    group.traverse((mesh) => {
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    group.position.set(spawn.x, 0, spawn.z);
    group.rotation.y = spawn.yaw ?? 0;
    scene.add(group);

    const bot = {
      team, name, group, torso, head, gun, legL, legR,
      isCarrier,
      position: group.position,
      velocity: new THREE.Vector3(),
      yaw: spawn.yaw ?? 0,
      pitch: 0,
      height: 1.72,
      health: HEALTH,
      armour: 0,
      alive: true,
      weapon: 'kestrel',
      mag: WEAPONS.kestrel.mag,
      cooldown: 0,
      reloadLeft: 0,
      state: 'route',
      route: [],
      routeIndex: 0,
      holdUntil: 0,
      targetSite: null,
      seen: null, // { kind: 'player'|'bot', ref, lastSeen, position }
      reactAt: 0,
      burstLeft: 0,
      burstPause: 0,
      aimError: 0,
      planting: 0,
      defusing: 0,
      heardAt: 0,
      heardPos: null,
      walkPhase: 0,
      onGround: true,
    };
    torso.userData.bot = bot;
    head.userData.bot = bot;
    bots.push(bot);
    return bot;
  }

  function spawnTeams(emberSpawns, ashSpawns) {
    for (const bot of bots) scene.remove(bot.group);
    bots.length = 0;
    emberSpawns.forEach((spawn, i) => buildBot('ember', BOT_NAMES_EMBER[i], spawn, false));
    ashSpawns.forEach((spawn, i) => buildBot('ash', BOT_NAMES_ASH[i], spawn, i === 0));
    return bots;
  }

  function visibleEnemy(bot, player, playerAlive) {
    // Returns the nearest visible enemy: the player or a bot of the other team.
    let best = null;
    let bestDist = Infinity;
    const candidates = [];
    if (playerAlive) candidates.push({ kind: 'player', ref: player, pos: player.position, eyeY: 1.6 });
    for (const other of bots) {
      if (other.alive && other.team !== bot.team) {
        candidates.push({ kind: 'bot', ref: other, pos: other.position, eyeY: 1.5 });
      }
    }
    eye.set(bot.position.x, bot.position.y + 1.5, bot.position.z);
    for (const cand of candidates) {
      targetEye.set(cand.pos.x, cand.pos.y + cand.eyeY, cand.pos.z);
      const dist = eye.distanceTo(targetEye);
      if (dist > SEE_DISTANCE || dist >= bestDist) continue;
      // Field of view: only what is roughly in front of the bot.
      direction.copy(targetEye).sub(eye).normalize();
      const forward = new THREE.Vector3(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw));
      if (direction.dot(forward) < 0.15 && dist > 3) continue;
      if (!mover.hasLineOfSight(eye, targetEye, world.shootables, raycaster, direction, SEE_DISTANCE)) continue;
      best = cand;
      bestDist = dist;
    }
    return best ? { ...best, dist: bestDist } : null;
  }

  function hearShot(bot, position) {
    if (!bot.alive) return;
    const d = Math.hypot(position.x - bot.position.x, position.z - bot.position.z);
    if (d < HEAR_DISTANCE) {
      bot.heardAt = now;
      bot.heardPos = { x: position.x, z: position.z };
    }
  }

  function damageBot(bot, amount, part) {
    if (!bot.alive) return false;
    let dealt = part === 'head' ? amount * HEAD_MULT : amount;
    if (bot.armour > 0) {
      const absorbed = Math.min(bot.armour, dealt * 0.5);
      bot.armour -= absorbed;
      dealt -= absorbed;
    }
    bot.health -= dealt;
    if (bot.health <= 0) {
      bot.health = 0;
      bot.alive = false;
      bot.group.rotation.x = -Math.PI / 2 + 0.15;
      bot.group.position.y = 0.25;
      return true;
    }
    return false;
  }

  function pickRoute(bot, site) {
    const from = world.nearestWaypoint(bot.position.x, bot.position.z);
    const sitePoint = site.id === 'A' ? 12 : 14;
    bot.route = world.route(from, sitePoint);
    bot.routeIndex = 0;
    bot.targetSite = site;
    bot.state = 'route';
  }

  function stepBot(bot, dt, ctx) {
    if (!bot.alive) return;
    bot.cooldown = Math.max(0, bot.cooldown - dt);
    bot.burstPause = Math.max(0, bot.burstPause - dt);
    bot.walkPhase += dt * 8;

    // Scan for a visible enemy; a fresh sighting starts a reaction delay.
    const seen = visibleEnemy(bot, ctx.player, ctx.playerAlive);
    if (seen) {
      if (!bot.seen || bot.seen.ref !== seen.ref) {
        bot.reactAt = now + REACTION_MIN + Math.random() * (REACTION_MAX - REACTION_MIN);
      }
      bot.seen = { ...seen, lastSeen: now };
    } else if (bot.seen && now - bot.seen.lastSeen > 1.2) {
      bot.seen = null;
    }

    // Plant / defuse take over everything else while channelled.
    if (bot.planting > 0 || bot.defusing > 0) {
      bot.velocity.x = 0;
      bot.velocity.z = 0;
      return;
    }

    // Engage: face the enemy, stand still to shoot tight, fire in bursts.
    if (bot.seen && now >= bot.reactAt) {
      const target = bot.seen;
      const dx = target.pos.x - bot.position.x;
      const dz = target.pos.z - bot.position.z;
      const wantYaw = Math.atan2(-dx, -dz);
      let dyaw = wantYaw - bot.yaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      bot.yaw += dyaw * Math.min(1, dt * 10);
      bot.velocity.x *= Math.max(0, 1 - dt * 8);
      bot.velocity.z *= Math.max(0, 1 - dt * 8);
      if (bot.burstLeft <= 0 && bot.burstPause <= 0) {
        bot.burstLeft = 3 + Math.floor(Math.random() * 3);
        bot.burstPause = 0;
      }
      if (bot.burstLeft > 0 && bot.cooldown <= 0) {
        ctx.botShoot(bot, target);
        bot.burstLeft -= 1;
        if (bot.burstLeft === 0) bot.burstPause = 0.5 + Math.random() * 0.7;
      }
      bot.group.rotation.y = bot.yaw;
      return;
    }

    // Rotate to a planted bomb: defenders converge on the site.
    if (ctx.bombPlanted && bot.team === 'ash') {
      const site = ctx.bombSite;
      if (world.siteAt(bot.position.x, bot.position.z) === site) {
        bot.state = 'defuse';
        if (ctx.tryDefuse(bot, dt)) return;
      } else if (bot.state !== 'route' || !bot.targetSite || bot.targetSite !== site) {
        pickRoute(bot, site);
      }
    }

    // Plant: the carrier walks to its site and plants when it arrives clear.
    if (bot.isCarrier && bot.team === 'ember' && !ctx.bombPlanted && bot.targetSite) {
      if (world.siteAt(bot.position.x, bot.position.z) === bot.targetSite && !bot.seen) {
        bot.state = 'plant';
        if (ctx.tryPlant(bot, dt)) return;
      }
    }

    // Route: follow waypoints; hold at the destination for a few seconds,
    // watching down the lane, then pick a new spot.
    if (bot.state === 'route' && bot.route.length > 0) {
      const next = world.waypoints[bot.route[bot.routeIndex]];
      const dx = next.x - bot.position.x;
      const dz = next.z - bot.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.8) {
        bot.routeIndex += 1;
        if (bot.routeIndex >= bot.route.length) {
          bot.state = 'hold';
          bot.holdUntil = now + 3 + Math.random() * 4;
          bot.yaw = Math.random() * Math.PI * 2;
        }
      } else {
        const speed = BOT_SPEED * (bot.seen ? 0.6 : 1);
        bot.velocity.x = (dx / dist) * speed;
        bot.velocity.z = (dz / dist) * speed;
        bot.yaw = Math.atan2(-dx, -dz);
      }
    } else if (bot.state === 'hold') {
      bot.velocity.x *= Math.max(0, 1 - dt * 8);
      bot.velocity.z *= Math.max(0, 1 - dt * 8);
      if (now >= bot.holdUntil) {
        // Re-pick: attackers push the other site or mid, defenders shuffle.
        const site = bot.team === 'ember'
          ? ctx.sites[Math.floor(Math.random() * ctx.sites.length)]
          : ctx.sites[Math.floor(Math.random() * ctx.sites.length)];
        pickRoute(bot, site);
      }
    } else if (bot.state === 'route') {
      const site = ctx.sites[Math.floor(Math.random() * ctx.sites.length)];
      pickRoute(bot, site);
    }

    // Heard a shot recently with no visual: drift toward the sound.
    if (!bot.seen && bot.heardPos && now - bot.heardAt < 2.5 && bot.state === 'hold') {
      const dx = bot.heardPos.x - bot.position.x;
      const dz = bot.heardPos.z - bot.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 2) {
        bot.velocity.x = (dx / dist) * BOT_SPEED * 0.7;
        bot.velocity.z = (dz / dist) * BOT_SPEED * 0.7;
        bot.yaw = Math.atan2(-dx, -dz);
      }
    }

    bot.velocity.y -= GRAVITY * dt;
    bot.onGround = mover.move(bot, dt);
    bot.group.rotation.y = bot.yaw;
    // Walk cycle: legs swing while moving, still otherwise.
    const speed = Math.hypot(bot.velocity.x, bot.velocity.z);
    const swing = speed > 0.5 ? Math.sin(bot.walkPhase) * 0.5 : 0;
    bot.legL.rotation.x = swing;
    bot.legR.rotation.x = -swing;
    bot.gun.rotation.x = speed > 0.5 ? Math.sin(bot.walkPhase) * 0.08 : 0;
  }

  function step(dt, ctx) {
    now = ctx.time;
    for (const bot of bots) stepBot(bot, dt, ctx);
  }

  function reset(emberSpawns, ashSpawns, sites) {
    spawnTeams(emberSpawns, ashSpawns);
    for (const bot of bots) {
      bot.health = HEALTH;
      bot.armour = bot.team === 'ash' && Math.random() < 0.4 ? 50 : 0;
      bot.alive = true;
      bot.group.rotation.set(0, bot.yaw, 0);
      bot.group.position.y = 0;
      bot.mag = WEAPONS.kestrel.mag;
      bot.cooldown = 0;
      bot.reloadLeft = 0;
      bot.seen = null;
      bot.planting = 0;
      bot.defusing = 0;
      bot.heardPos = null;
      const site = sites[Math.floor(Math.random() * sites.length)];
      pickRoute(bot, site);
      // Defenders start closer to their sites: hold near them at first.
      if (bot.team === 'ash') {
        bot.route = world.route(world.nearestWaypoint(bot.position.x, bot.position.z), site.id === 'A' ? 9 : 11);
        bot.routeIndex = 0;
      }
    }
  }

  return {
    bots,
    step,
    reset,
    spawnTeams,
    damageBot,
    hearShot,
    pickRoute,
    aliveCount(team) {
      return bots.filter((b) => b.team === team && b.alive).length;
    },
    carrier() {
      return bots.find((b) => b.isCarrier) ?? null;
    },
  };
}
