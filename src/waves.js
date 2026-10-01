// Timed elite and boss waves.
import { ENEMY_TYPES, WAVES } from "./config.js";
import { state } from "./runtime.js";
import { spawnEnemyOfType } from "./enemies.js";
import { emit } from "./events.js";

const ELITE_POOL = [
  ENEMY_TYPES.runner,
  ENEMY_TYPES.knight,
  ENEMY_TYPES.brute,
  ENEMY_TYPES.leader,
];

let eliteTimer = WAVES.eliteFirst;
let bossTimer = WAVES.bossFirst;

export function resetWaves() {
  eliteTimer = WAVES.eliteFirst;
  bossTimer = WAVES.bossFirst;
  state.boss = null;
}

export function updateWaves(dt) {
  if (state.boss && state.boss.dying > 0) state.boss = null;

  eliteTimer -= dt;
  if (eliteTimer <= 0) {
    eliteTimer = WAVES.eliteEvery;
    const type = ELITE_POOL[Math.floor(Math.random() * ELITE_POOL.length)];
    spawnEnemyOfType(type, {
      elite: true,
      force: true,
      hpMul: WAVES.eliteHpMul,
      dmgMul: WAVES.eliteDmgMul,
      sizeMul: WAVES.eliteSizeMul,
      xpMul: WAVES.eliteXpMul,
    });
  }

  bossTimer -= dt;
  if (bossTimer <= 0) {
    bossTimer = WAVES.bossEvery;
    const boss = spawnEnemyOfType(ENEMY_TYPES.boss, {
      boss: true,
      force: true,
      hpMul: WAVES.bossHpMul,
      sizeMul: WAVES.bossSizeMul,
      xpMul: WAVES.bossXpMul,
    });
    if (boss) {
      state.boss = boss;
      emit("boss", boss);
    }
  }
}
