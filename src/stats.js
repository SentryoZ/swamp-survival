// Derived stats: global modifiers from passives, per-weapon stat scaling, and
// card preview deltas. Pure data math over `state` + config.
import { WEAPONS, PASSIVES, GAME } from "./config.js";
import { state } from "./runtime.js";
import { metaBonuses } from "./meta.js";

export function computeMods() {
  const m = {
    damage: 1,
    haste: 1,
    area: 1,
    speed: 1,
    critChance: 0.05,
    critMult: 2,
    count: 0,
    pierce: 0,
    lifesteal: 0,
    magnet: 1,
    xp: 1,
    maxHpAdd: 0,
  };
  for (const [id, lv] of Object.entries(state.upgrades)) {
    const def = PASSIVES[id];
    if (def && lv > 0) def.mod(m, lv);
  }
  // Permanent meta bonuses stack on top of the in-run passives.
  const mb = metaBonuses();
  m.damage *= mb.damage;
  m.speed *= mb.speed;
  m.xp *= mb.xp;
  m.maxHpAdd += mb.maxHp;
  state.mods = m;
  state.maxHp = GAME.startHp + m.maxHpAdd + state.bonusMaxHp;
  if (state.hp > state.maxHp) state.hp = state.maxHp;
}

export function weaponBaseStats(id, level) {
  const def = WEAPONS[id];
  const b = def.base;
  const p = def.per || {};
  const s = {};
  for (const key of Object.keys(b)) {
    let v = b[key];
    if (key === "count" && p.countEvery) v += Math.floor((level - 1) / p.countEvery);
    else if (key === "strikes" && p.strikesEvery) v += Math.floor((level - 1) / p.strikesEvery);
    else if (key === "jumps" && p.jumpsEvery) v += Math.floor((level - 1) / p.jumpsEvery);
    else if (p[key] !== undefined) v += p[key] * (level - 1);
    s[key] = v;
  }
  return s;
}

export function computeWeapon(w) {
  const def = WEAPONS[w.id];
  const s = weaponBaseStats(w.id, w.level);
  const m = state.mods;
  if (s.damage !== undefined) s.damage *= m.damage;
  if (s.dps !== undefined) s.dps *= m.damage;
  if (s.wispDamage !== undefined) s.wispDamage *= m.damage;
  if (s.nova !== undefined) s.nova *= m.damage;
  if (s.cooldown !== undefined) s.cooldown = Math.max(0.3, s.cooldown) / m.haste;
  if (s.rate !== undefined) s.rate = Math.max(0.2, s.rate) / m.haste;
  if (s.fireRate !== undefined) s.fireRate *= m.haste;
  if (s.radius !== undefined) s.radius *= m.area;
  if (s.area !== undefined) s.area *= m.area;
  if (s.range !== undefined) s.range *= m.area;
  if (s.blast !== undefined) s.blast *= m.area;
  if (s.novaArea !== undefined) s.novaArea *= m.area;
  if (s.width !== undefined) s.width *= m.area;
  if (s.tick !== undefined) s.tick = Math.max(0.15, s.tick);
  if (def.tags.includes("count")) {
    if (s.count !== undefined) s.count += m.count;
    if (s.strikes !== undefined) s.strikes += m.count;
    if (s.jumps !== undefined) s.jumps += m.count;
  }
  if (def.tags.includes("pierce")) s.pierce = m.pierce;
  return s;
}

export const PREVIEW_LABELS = {
  damage: { label: "Damage", fmt: (v) => Math.round(v) },
  fireRate: { label: "Rate", fmt: (v) => `${v.toFixed(2)}/s` },
  range: { label: "Range", fmt: (v) => v.toFixed(1) },
  arcDeg: { label: "Arc", fmt: (v) => `${Math.round(v)}\u00b0` },
  wispDamage: { label: "Spirit dmg", fmt: (v) => Math.round(v) },
  nova: { label: "Nova dmg", fmt: (v) => Math.round(v) },
  novaArea: { label: "Nova area", fmt: (v) => v.toFixed(1) },
  dps: { label: "DoT/s", fmt: (v) => v.toFixed(1) },
  cooldown: { label: "Cooldown", fmt: (v) => `${v.toFixed(2)}s` },
  count: { label: "Count", fmt: (v) => Math.round(v) },
  strikes: { label: "Strikes", fmt: (v) => Math.round(v) },
  jumps: { label: "Jumps", fmt: (v) => Math.round(v) },
  jumpRange: { label: "Chain range", fmt: (v) => v.toFixed(1) },
  radius: { label: "Radius", fmt: (v) => v.toFixed(1) },
  area: { label: "Area", fmt: (v) => v.toFixed(1) },
  blast: { label: "Blast", fmt: (v) => v.toFixed(1) },
  speed: { label: "Speed", fmt: (v) => v.toFixed(1) },
  length: { label: "Length", fmt: (v) => v.toFixed(1) },
  width: { label: "Width", fmt: (v) => v.toFixed(1) },
  freeze: { label: "Freeze", fmt: (v) => `${v.toFixed(1)}s` },
  tick: { label: "Hit delay", fmt: (v) => `${v.toFixed(2)}s` },
  hold: { label: "Hold", fmt: (v) => `${v.toFixed(1)}s` },
  duration: { label: "Duration", fmt: (v) => `${v.toFixed(1)}s` },
  life: { label: "Life", fmt: (v) => `${v.toFixed(1)}s` },
  rate: { label: "Fire rate", fmt: (v) => `${v.toFixed(2)}s` },
  drain: { label: "Drain", fmt: (v) => v.toFixed(2) },
  slow: { label: "Slow", fmt: (v) => `${Math.round(v * 100)}%` },
};

// Stats that change between the current level and the next, for the card UI.
export function weaponPreview(w) {
  const from = weaponBaseStats(w.id, w.level);
  const to = weaponBaseStats(w.id, w.level + 1);
  const lines = [];
  for (const key of Object.keys(to)) {
    const meta = PREVIEW_LABELS[key];
    if (!meta || from[key] === undefined) continue;
    if (Math.abs(to[key] - from[key]) < 1e-6) continue;
    lines.push({ label: meta.label, from: meta.fmt(from[key]), to: meta.fmt(to[key]) });
  }
  return lines;
}

export function rollDamage(base) {
  return Math.random() < state.mods.critChance ? base * state.mods.critMult : base;
}
