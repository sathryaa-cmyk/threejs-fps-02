// Rounds: one place owns the match state — phase, timer, score, the charge.
// A round has a 12 s buy phase (players buy, bots hold spawn), a live phase of
// up to 100 s, and an end. The charge takes 4 s to plant inside a site and
// 5 s to defuse; once planted it ticks 35 s to detonation. First to 5 rounds
// takes the match. main.js asks this module what happened each step and plays
// the consequences (rewards, banners, sounds); it never mutates the state.
import { SITES } from './world.js';

export const BUY_SECONDS = 12;
export const ROUND_SECONDS = 100;
export const BOMB_SECONDS = 35;
export const PLANT_SECONDS = 4;
export const DEFUSE_SECONDS = 5;
export const WIN_ROUNDS = 5;

export function createRounds() {
  const state = {
    phase: 'buy', // 'buy' | 'live' | 'over'
    round: 1,
    score: { ember: 0, ash: 0 },
    timer: BUY_SECONDS,
    matchOver: false,
    matchWinner: null,
    bomb: {
      planted: false, site: null, timeLeft: BOMB_SECONDS,
      planting: null, // { entity, progress }
      defusing: null, // { entity, progress }
    },
    lastEnd: null, // { winner, reason }
  };

  function startMatch() {
    state.round = 1;
    state.score = { ember: 0, ash: 0 };
    state.matchOver = false;
    state.matchWinner = null;
    state.lastEnd = null;
    startRound();
  }

  function startRound() {
    state.phase = 'buy';
    state.timer = BUY_SECONDS;
    state.bomb = { planted: false, site: null, timeLeft: BOMB_SECONDS, planting: null, defusing: null };
  }

  function goLive() {
    state.phase = 'live';
    state.timer = ROUND_SECONDS;
  }

  // Ends the round, banks the score, and either starts the next buy phase or
  // closes the match. Returns the end record for the caller to announce.
  function endRound(winner, reason) {
    if (state.phase === 'over') return state.lastEnd;
    state.score[winner] += 1;
    state.phase = 'over';
    state.lastEnd = { winner, reason, round: state.round };
    if (state.score[winner] >= WIN_ROUNDS) {
      state.matchOver = true;
      state.matchWinner = winner;
    }
    return state.lastEnd;
  }

  function nextRound() {
    if (state.matchOver) return false;
    state.round += 1;
    startRound();
    return true;
  }

  // One channel step for planting. `entity` is any object with a position;
  // `insideSite` is true while it stands in the site. Returns 'planted' when
  // the channel completes, 'interrupted' when it leaves the site.
  function plantStep(entity, site, dt) {
    const bomb = state.bomb;
    if (bomb.planted) return null;
    if (!site) {
      bomb.planting = null;
      return 'interrupted';
    }
    if (!bomb.planting || bomb.planting.entity !== entity) {
      bomb.planting = { entity, progress: 0 };
    }
    bomb.planting.progress += dt;
    if (bomb.planting.progress >= PLANT_SECONDS) {
      bomb.planted = true;
      bomb.site = site;
      bomb.timeLeft = BOMB_SECONDS;
      bomb.planting = null;
      return 'planted';
    }
    return 'planting';
  }

  function defuseStep(entity, dt) {
    const bomb = state.bomb;
    if (!bomb.planted) return null;
    if (!bomb.defusing || bomb.defusing.entity !== entity) {
      bomb.defusing = { entity, progress: 0 };
    }
    bomb.defusing.progress += dt;
    if (bomb.defusing.progress >= DEFUSE_SECONDS) {
      bomb.planted = false;
      bomb.defusing = null;
      return 'defused';
    }
    return 'defusing';
  }

  function cancelChannels(entity) {
    if (state.bomb.planting?.entity === entity) state.bomb.planting = null;
    if (state.bomb.defusing?.entity === entity) state.bomb.defusing = null;
  }

  // Tick the clock. Returns 'buyDone' | 'timeUp' | 'detonate' | null.
  function step(dt) {
    if (state.phase === 'buy') {
      state.timer -= dt;
      if (state.timer <= 0) {
        goLive();
        return 'buyDone';
      }
      return null;
    }
    if (state.phase !== 'live') return null;
    if (state.bomb.planted) {
      state.bomb.timeLeft -= dt;
      if (state.bomb.timeLeft <= 0) return 'detonate';
      return null;
    }
    state.timer -= dt;
    if (state.timer <= 0) return 'timeUp';
    return null;
  }

  return {
    state,
    startMatch,
    startRound,
    goLive,
    endRound,
    nextRound,
    plantStep,
    defuseStep,
    cancelChannels,
    step,
    siteList: SITES,
  };
}
