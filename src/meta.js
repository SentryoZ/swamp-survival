// Meta-progression: banked Essence, permanent upgrades, and unlocked starters,
// persisted to localStorage. Nothing here touches the live run's Three.js state.
import { META, WEAPONS } from "./config.js";

const KEY = "swamp.meta.v1";
const BASE_STARTERS = ["main", "cleaver", "hex"];

function fresh() {
  return {
    essence: 0,
    upgrades: {},
    unlocked: [],
    best: { time: 0, kills: 0, runs: 0 },
  };
}

function load() {
  const base = fresh();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) || {};
    return {
      essence: parsed.essence || 0,
      upgrades: { ...(parsed.upgrades || {}) },
      unlocked: Array.isArray(parsed.unlocked) ? parsed.unlocked : [],
      best: { ...base.best, ...(parsed.best || {}) },
    };
  } catch {
    return base;
  }
}

let save = load();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    /* storage unavailable — runs still work, just nothing saved */
  }
}

export function getMeta() {
  return save;
}

export function resetMeta() {
  save = fresh();
  persist();
}

export function levelOf(id) {
  return save.upgrades[id] || 0;
}

// Sum of all purchased permanent bonuses.
export function metaBonuses() {
  const b = { maxHp: 0, damage: 1, speed: 1, xp: 1, rerolls: 0, startLevel: 0, revives: 0 };
  for (const [id, def] of Object.entries(META)) {
    const lv = levelOf(id);
    if (lv <= 0) continue;
    const v = def.per * lv;
    if (def.stat === "maxHp") b.maxHp += v;
    else if (def.stat === "damage") b.damage += v;
    else if (def.stat === "speed") b.speed += v;
    else if (def.stat === "xp") b.xp += v;
    else if (def.stat === "rerolls") b.rerolls += v;
    else if (def.stat === "startLevel") b.startLevel += v;
    else if (def.stat === "revives") b.revives += v;
  }
  return b;
}

// Cost to buy the next level, or null when maxed.
export function costOf(id) {
  const def = META[id];
  const lv = levelOf(id);
  if (!def || lv >= def.maxLevel) return null;
  return def.cost(lv);
}

export function buyUpgrade(id) {
  const c = costOf(id);
  if (c === null || save.essence < c) return false;
  save.essence -= c;
  save.upgrades[id] = levelOf(id) + 1;
  persist();
  return true;
}

// ---------- Starter unlocks ----------
export function availableStarters() {
  return [...BASE_STARTERS, ...save.unlocked];
}

export function isStarterUnlocked(id) {
  return BASE_STARTERS.includes(id) || save.unlocked.includes(id);
}

export function unlockStarter(id) {
  const def = WEAPONS[id];
  if (!def || isStarterUnlocked(id)) return false;
  if (save.essence < def.unlockCost) return false;
  save.essence -= def.unlockCost;
  save.unlocked.push(id);
  persist();
  return true;
}

// ---------- Rewards ----------
export function earnEssence(amount) {
  if (amount > 0) {
    save.essence += amount;
    persist();
  }
}

export function recordRun(time, kills) {
  save.best.runs += 1;
  save.best.time = Math.max(save.best.time, time);
  save.best.kills = Math.max(save.best.kills, kills);
  persist();
}
