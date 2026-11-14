// Weapons: five original guns plus a frag grenade, each with its own numbers.
// Accuracy counts more than speed: every gun's spread grows with movement and
// with sustained fire (bloom), and its recoil kicks the aim up, so short,
// still bursts win fights. The view model is built from boxes in the palette;
// the muzzle flash is a lit quad plus a point light, both shown for one frame
// window after each shot.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// damage is per torso hit at close range; headshots multiply by HEAD_MULT.
export const HEAD_MULT = 2;
export const WEAPONS = {
  sidewinder: {
    id: 'sidewinder', name: 'Sidewinder', kind: 'pistol', price: 0, auto: false,
    damage: 26, headDamage: 52, mag: 12, reserve: 36, gap: 0.16, reload: 1.4,
    spreadStill: 0.004, spreadMove: 0.02, bloom: 0.004, recoil: 0.011, range: 55,
    length: 0.34, body: 'ink',
  },
  kestrel: {
    id: 'kestrel', name: 'Kestrel', kind: 'rifle', price: 2700, auto: true,
    damage: 34, headDamage: 68, mag: 30, reserve: 90, gap: 0.096, reload: 1.9,
    spreadStill: 0.0022, spreadMove: 0.028, bloom: 0.0035, recoil: 0.013, range: 80,
    length: 0.62, body: 'ink',
  },
  hornet: {
    id: 'hornet', name: 'Hornet', kind: 'smg', price: 1500, auto: true,
    damage: 22, headDamage: 44, mag: 32, reserve: 96, gap: 0.07, reload: 1.6,
    spreadStill: 0.004, spreadMove: 0.02, bloom: 0.003, recoil: 0.008, range: 45,
    length: 0.48, body: 'ash',
  },
  mauler: {
    id: 'mauler', name: 'Mauler', kind: 'shotgun', price: 1100, auto: false,
    damage: 13, headDamage: 22, mag: 6, reserve: 24, gap: 0.85, reload: 2.4,
    spreadStill: 0.03, spreadMove: 0.045, bloom: 0.01, recoil: 0.045, range: 22,
    pellets: 7, length: 0.58, body: 'hairline',
  },
  longbow: {
    id: 'longbow', name: 'Longbow', kind: 'sniper', price: 4750, auto: false,
    damage: 95, headDamage: 190, mag: 5, reserve: 15, gap: 1.15, reload: 2.8,
    spreadStill: 0.0006, spreadMove: 0.05, bloom: 0.02, recoil: 0.06, range: 120,
    length: 0.85, body: 'accent',
  },
};
export const GRENADE_PRICE = 300;
export const ARMOUR_PRICE = 650;

export function createWeaponRig(camera) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const accentMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.45, metalness: 0.3 });

  const model = new THREE.Group();
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.08, 0.3), bodyMat);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.36), grip);
  barrel.position.set(0, 0.02, -0.3);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.16), grip);
  stock.position.set(0, -0.015, 0.2);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.035, 0.05), accentMat);
  sight.position.set(0, 0.055, -0.06);
  model.add(receiver, barrel, stock, sight);
  model.position.set(0.3, -0.26, -0.7);
  model.rotation.y = -0.18;
  model.scale.setScalar(0.7);
  camera.add(model);

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.28, -0.22, -1.02);
  flash.visible = false;
  camera.add(flash);

  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.28, -0.2, -0.7);
  camera.add(flashLight);

  // One loadout: a primary slot and the Sidewinder sidearm. Ammo is per gun.
  const state = {
    primary: null, // weapon id or null
    current: 'sidewinder',
    ammo: {},
    grenades: 0,
    armour: 0,
    cooldown: 0,
    reloadLeft: 0,
    flash: 0,
    kick: 0,
    bloom: 0,
  };
  for (const def of Object.values(WEAPONS)) state.ammo[def.id] = { mag: def.mag, reserve: def.reserve };

  function def() {
    return WEAPONS[state.current];
  }

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.bloom = Math.max(0, state.bloom - dt * 0.03);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    model.position.z = -0.7 + state.kick;
    model.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      model.rotation.x = -0.55 * Math.min(1, (def().reload - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const ammo = state.ammo[state.current];
        const need = def().mag - ammo.mag;
        const take = Math.min(need, ammo.reserve);
        ammo.mag += take;
        ammo.reserve -= take;
      }
    }
  }

  return {
    state,
    def,
    step,
    ready() {
      const ammo = state.ammo[state.current];
      return ammo.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      state.cooldown = def().gap;
      state.flash = 0.06;
      state.kick = 0.055;
      state.bloom = Math.min(0.03, state.bloom + def().bloom);
    },
    takeRound() {
      const ammo = state.ammo[state.current];
      if (ammo.mag <= 0) return false;
      ammo.mag -= 1;
      return true;
    },
    reload() {
      const ammo = state.ammo[state.current];
      if (state.reloadLeft > 0 || ammo.mag === def().mag || ammo.reserve === 0) return;
      state.reloadLeft = def().reload;
    },
    // Spread in radians: still + movement + bloom, crouched halves movement.
    spread(speed, crouching) {
      const d = def();
      const move = Math.min(1, speed / 5.2) * d.spreadMove * (crouching ? 0.5 : 1);
      return d.spreadStill + move + state.bloom;
    },
    switchTo(id) {
      if (id === 'sidewinder' || state.primary === id) {
        if (state.current === id || state.reloadLeft > 0) return false;
        state.current = id;
        state.reloadLeft = 0;
        state.cooldown = Math.max(state.cooldown, 0.25);
        return true;
      }
      return false;
    },
    buyPrimary(id) {
      state.primary = id;
      state.current = id;
      state.ammo[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
      state.reloadLeft = 0;
      state.cooldown = 0;
    },
    resetRound() {
      // A fresh round keeps the guns bought, refills the sidearm only when the
      // player owns no primary, and tops up nothing else: ammo is bought with
      // money, not given away.
      if (!state.primary) {
        state.ammo.sidewinder = { mag: WEAPONS.sidewinder.mag, reserve: WEAPONS.sidewinder.reserve };
        state.current = 'sidewinder';
      }
      state.grenades = 0;
      state.armour = 0;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
      state.bloom = 0;
    },
    refillAll() {
      for (const weaponDef of Object.values(WEAPONS)) {
        state.ammo[weaponDef.id] = { mag: weaponDef.mag, reserve: weaponDef.reserve };
      }
    },
  };
}
