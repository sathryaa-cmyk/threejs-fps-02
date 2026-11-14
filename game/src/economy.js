// The economy: money earned each round and spent in the buy menu between
// rounds. One place owns every number so the HUD, the buy menu and the round
// rewards can never disagree.
import { WEAPONS, GRENADE_PRICE, ARMOUR_PRICE } from './weapons.js';

export const START_MONEY = 800;
export const KILL_REWARD = 300;
export const WIN_REWARD = 3250;
export const LOSS_REWARD = 1900;
export const LOSS_STREAK_BONUS = 500; // extra per consecutive loss, capped at 2
export const PLANT_REWARD = 300;
export const DEFUSE_REWARD = 300;
export const MAX_MONEY = 16000;

export function createEconomy() {
  let money = START_MONEY;
  let losses = 0;

  function buyList(weaponRig) {
    const items = [];
    for (const def of Object.values(WEAPONS)) {
      if (def.id === 'sidewinder') continue;
      items.push({
        id: def.id, name: def.name, kind: def.kind, price: def.price,
        owned: weaponRig.state.primary === def.id,
        detail: `${def.damage} dmg · ${def.mag} rnd mag`,
      });
    }
    items.push({
      id: 'grenade', name: 'Frag Grenade', kind: 'grenade', price: GRENADE_PRICE,
      owned: weaponRig.state.grenades > 0, detail: 'Throw with G · blast damage',
    });
    items.push({
      id: 'armour', name: 'Kevlar Armour', kind: 'armour', price: ARMOUR_PRICE,
      owned: weaponRig.state.armour > 0, detail: 'Halves damage until broken',
    });
    return items;
  }

  return {
    get money() {
      return money;
    },
    buyList,
    canAfford(price) {
      return money >= price;
    },
    spend(price) {
      if (money < price) return false;
      money -= price;
      return true;
    },
    earn(amount) {
      money = Math.min(MAX_MONEY, money + amount);
    },
    roundEnd(won) {
      if (won) {
        money = Math.min(MAX_MONEY, money + WIN_REWARD);
        losses = 0;
      } else {
        money = Math.min(MAX_MONEY, money + LOSS_REWARD + Math.min(2, losses) * LOSS_STREAK_BONUS);
        losses += 1;
      }
    },
    reset() {
      money = START_MONEY;
      losses = 0;
    },
  };
}
