// Sub-weapon runtime. Weapons are data (config.js); this module owns the
// per-kind update behaviors (KINDS) and per-trigger casts (TRIGGERS), so a new
// weapon is a config entry plus at most one function here.
import * as THREE from "three";
import { WEAPONS, CRATES } from "./config.js";
import {
  fxGroup,
  playerGroup,
  state,
  enemies,
  half,
  transientFx,
  sphereGeo,
  basicMat,
  sharedMesh,
} from "./runtime.js";
import { removeFx, boltLine, groundFlash, spawnParticles } from "./fx.js";
import { computeWeapon, rollDamage } from "./stats.js";
import { damageEnemy, healPlayer, nearestEnemy, nearestEnemyExcept } from "./combat.js";
import { on } from "./events.js";
import { damageCrate, damageCratesInRadius } from "./crates.js";

// ---------- Weapon instances ----------
export function addWeapon(id) {
  const def = WEAPONS[id];
  const w = {
    id,
    level: 1,
    timer: 0.3 + Math.random() * 0.4,
    discs: [],
    totems: [],
    spin: Math.random() * Math.PI * 2,
    hitAt: new WeakMap(),
  };
  if (def.kind === "aura") {
    const cloud = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({
        color: def.color,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
      })
    );
    cloud.position.y = 0.6;
    fxGroup.add(cloud);
    w.cloud = cloud;
  }
  state.weapons.push(w);
  return w;
}

export function removeWeapon(w) {
  if (w.discs) for (const d of w.discs) removeFx(d.mesh);
  if (w.cloud) removeFx(w.cloud);
  if (w.totems) for (const t of w.totems) removeFx(t.mesh);
  const idx = state.weapons.indexOf(w);
  if (idx >= 0) state.weapons.splice(idx, 1);
}

export function clearWeapons() {
  transientFx.length = 0;
  for (let i = fxGroup.children.length - 1; i >= 0; i--) {
    removeFx(fxGroup.children[i]);
  }
}

// ---------- Orbit ----------
function syncOrbit(w, s, def) {
  const want = Math.max(1, Math.round(s.count));
  while (w.discs.length < want) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.75, 0.16, 0.75),
      new THREE.MeshBasicMaterial({ color: def.color })
    );
    fxGroup.add(mesh);
    w.discs.push({ mesh });
  }
  while (w.discs.length > want) removeFx(w.discs.pop().mesh);
}

function updateOrbit(w, s, dt) {
  const def = WEAPONS[w.id];
  syncOrbit(w, s, def);
  w.spin += dt * s.speed;
  const px = playerGroup.position.x;
  const pz = playerGroup.position.z;
  const n = w.discs.length;
  const hitR = 0.6;
  for (let i = 0; i < n; i++) {
    const d = w.discs[i];
    const ang = w.spin + (i / n) * Math.PI * 2;
    const x = px + Math.cos(ang) * s.radius;
    const z = pz + Math.sin(ang) * s.radius;
    d.mesh.position.set(x, 0.9, z);
    d.mesh.rotation.y = ang;
    for (let j = enemies.length - 1; j >= 0; j--) {
      const e = enemies[j];
      if (e.dying > 0) continue;
      const dx = x - e.group.position.x;
      const dz = z - e.group.position.z;
      const rr = hitR + e.type.radius;
      if (dx * dx + dz * dz < rr * rr && (w.hitAt.get(e) || 0) <= state.time) {
        w.hitAt.set(e, state.time + s.tick);
        const knock = new THREE.Vector3(dx, 0, dz).normalize();
        damageEnemy(e, rollDamage(s.damage), knock);
        spawnParticles(new THREE.Vector3(x, 0.9, z), def.color, 3);
      }
    }
    for (let j = state.crates.length - 1; j >= 0; j--) {
      const c = state.crates[j];
      if (c.dead) continue;
      const dx = x - c.x;
      const dz = z - c.z;
      const rr = hitR + CRATES.radius;
      if (dx * dx + dz * dz < rr * rr && (w.hitAt.get(c) || 0) <= state.time) {
        w.hitAt.set(c, state.time + s.tick);
        damageCrate(c, rollDamage(s.damage));
      }
    }
  }
}

// ---------- Aura ----------
function updateAura(w, s, dt) {
  const p = playerGroup.position;
  w.cloud.position.set(p.x, 0.6, p.z);
  w.cloud.scale.set(s.radius, s.radius * 0.6, s.radius);
  const r2 = s.radius * s.radius;
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    if (e.dying > 0) continue;
    const dx = e.group.position.x - p.x;
    const dz = e.group.position.z - p.z;
    if (dx * dx + dz * dz < r2) {
      damageEnemy(e, s.dps * dt);
      e.slow = Math.max(e.slow || 0, s.slow);
    }
  }
}

// ---------- Deploy (totem / hive) ----------
function totemMesh(color) {
  return new THREE.Mesh(
    new THREE.ConeGeometry(0.42, 1.4, 6),
    new THREE.MeshBasicMaterial({ color })
  );
}

function fireTotemBolt(t, target, s, def) {
  const mesh = sharedMesh(sphereGeo(0.12, 6), basicMat(def.color));
  mesh.position.set(t.x, 1.2, t.z);
  fxGroup.add(mesh);
  const leech = def.trigger === "hive";
  state.homings.push({
    mesh,
    speed: 16,
    damage: rollDamage(s.damage),
    blast: 0,
    drain: leech ? s.drain || 0 : 0,
    leech,
    color: def.color,
    life: 3,
    target,
  });
}

function updateTotem(w, s, dt) {
  const def = WEAPONS[w.id];
  if (w.timer <= 0) {
    const cap = Math.max(1, Math.round(s.count));
    if (w.totems.length < cap) {
      const ang = Math.random() * Math.PI * 2;
      const x = THREE.MathUtils.clamp(
        playerGroup.position.x + Math.cos(ang) * 1.8,
        -half + 1,
        half - 1
      );
      const z = THREE.MathUtils.clamp(
        playerGroup.position.z + Math.sin(ang) * 1.8,
        -half + 1,
        half - 1
      );
      const mesh = totemMesh(def.color);
      mesh.position.set(x, 0.7, z);
      fxGroup.add(mesh);
      w.totems.push({ mesh, x, z, life: s.life, fire: 0.35 });
    }
    w.timer = s.cooldown;
  }
  for (let i = w.totems.length - 1; i >= 0; i--) {
    const t = w.totems[i];
    t.life -= dt;
    t.mesh.rotation.y += dt * 0.8;
    t.fire -= dt;
    if (t.fire <= 0) {
      const target = nearestEnemy(t.x, t.z, s.radius);
      if (target) {
        fireTotemBolt(t, target, s, def);
        t.fire = s.rate;
      }
    }
    if (t.life <= 0) {
      removeFx(t.mesh);
      w.totems.splice(i, 1);
    }
  }
}

// ---------- Homing ----------
export function spawnHomingBurst(color, count, damage, speed, blast, drain, leech) {
  for (let i = 0; i < count; i++) {
    const mesh = sharedMesh(sphereGeo(0.14), basicMat(color));
    const a = Math.random() * Math.PI * 2;
    mesh.position.set(
      playerGroup.position.x + Math.cos(a) * 0.8,
      0.9,
      playerGroup.position.z + Math.sin(a) * 0.8
    );
    fxGroup.add(mesh);
    state.homings.push({
      mesh,
      speed,
      damage: rollDamage(damage),
      blast,
      drain,
      leech,
      color,
      life: 4,
      target: null,
    });
  }
}

function spawnHoming(w, def, s) {
  spawnHomingBurst(
    def.color,
    Math.max(1, Math.round(s.count)),
    s.damage,
    s.speed,
    s.blast || 0,
    s.drain || 0,
    def.trigger === "leech"
  );
}

function updateHomings(dt) {
  const tmp = new THREE.Vector3();
  for (let i = state.homings.length - 1; i >= 0; i--) {
    const h = state.homings[i];
    h.life -= dt;
    if (!h.target || h.target.dying > 0 || enemies.indexOf(h.target) < 0) {
      h.target = nearestEnemy(h.mesh.position.x, h.mesh.position.z, 24);
    }
    if (h.target) {
      tmp.subVectors(h.target.group.position, h.mesh.position);
      tmp.y = 0;
      if (tmp.lengthSq() > 1e-4) h.mesh.position.addScaledVector(tmp.normalize(), h.speed * dt);
    }
    let hit = false;
    for (let j = enemies.length - 1; j >= 0; j--) {
      const e = enemies[j];
      if (e.dying > 0) continue;
      const dx = h.mesh.position.x - e.group.position.x;
      const dz = h.mesh.position.z - e.group.position.z;
      const rr = e.type.radius + 0.3;
      if (dx * dx + dz * dz < rr * rr) {
        damageEnemy(e, h.damage);
        if (h.leech && h.drain > 0) healPlayer(h.drain);
        if (h.blast > 0) {
          groundFlash(h.mesh.position.x, h.mesh.position.z, h.color, h.blast);
          for (let k = enemies.length - 1; k >= 0; k--) {
            const t = enemies[k];
            if (t.dying > 0) continue;
            const bx = t.group.position.x - h.mesh.position.x;
            const bz = t.group.position.z - h.mesh.position.z;
            if (bx * bx + bz * bz < h.blast * h.blast) damageEnemy(t, h.damage * 0.6);
          }
        }
        spawnParticles(h.mesh.position.clone(), h.color, 6);
        hit = true;
        break;
      }
    }
    if (!hit) {
      for (let k = state.crates.length - 1; k >= 0; k--) {
        const c = state.crates[k];
        if (c.dead) continue;
        const dx = h.mesh.position.x - c.x;
        const dz = h.mesh.position.z - c.z;
        const rr = CRATES.radius + 0.3;
        if (dx * dx + dz * dz < rr * rr) {
          damageCrate(c, h.damage);
          spawnParticles(h.mesh.position.clone(), h.color, 6);
          hit = true;
          break;
        }
      }
    }
    if (hit || h.life <= 0) {
      removeFx(h.mesh);
      state.homings.splice(i, 1);
    }
  }
}

// ---------- Gas clouds ----------
function spawnGasCloud(x, z, s, color) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(1, 14, 10),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    })
  );
  mesh.position.set(x, 0.55, z);
  fxGroup.add(mesh);
  state.gasClouds.push({
    mesh,
    x,
    z,
    radius: s.area,
    dps: s.damage / Math.max(0.1, s.duration),
    life: s.duration,
    maxLife: s.duration,
  });
}

function triggerGas(x, z) {
  const w = state.weapons.find((wp) => wp.id === "gas" || wp.id === "bog");
  if (!w) return;
  spawnGasCloud(x, z, computeWeapon(w), WEAPONS[w.id].color);
}

function updateGasClouds(dt) {
  for (let i = state.gasClouds.length - 1; i >= 0; i--) {
    const g = state.gasClouds[i];
    g.life -= dt;
    const k = Math.max(0, g.life / g.maxLife);
    g.mesh.material.opacity = 0.12 + 0.3 * k;
    g.mesh.scale.setScalar(g.radius * (0.7 + 0.3 * (1 - k)));
    const r2 = g.radius * g.radius;
    for (let j = enemies.length - 1; j >= 0; j--) {
      const e = enemies[j];
      if (e.dying > 0) continue;
      const dx = e.group.position.x - g.x;
      const dz = e.group.position.z - g.z;
      if (dx * dx + dz * dz < r2) damageEnemy(e, g.dps * dt);
    }
    if (g.life <= 0) {
      removeFx(g.mesh);
      state.gasClouds.splice(i, 1);
    }
  }
}

// ---------- Timer casts ----------
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function castThunder(s) {
  const color = WEAPONS.thunder.color;
  const alive = enemies.filter((e) => e.dying <= 0);
  if (alive.length === 0) return;
  const chosen = shuffle(alive).slice(0, Math.max(1, Math.round(s.strikes)));
  for (const e of chosen) {
    if (e.dying > 0) continue;
    const pos = e.group.position;
    boltLine(new THREE.Vector3(pos.x, 14, pos.z), new THREE.Vector3(pos.x, 0, pos.z), color);
    groundFlash(pos.x, pos.z, color, s.area);
    for (let j = enemies.length - 1; j >= 0; j--) {
      const t = enemies[j];
      if (t.dying > 0) continue;
      const dx = t.group.position.x - pos.x;
      const dz = t.group.position.z - pos.z;
      if (dx * dx + dz * dz < s.area * s.area) damageEnemy(t, rollDamage(s.damage));
    }
    damageCratesInRadius(pos.x, pos.z, s.area, rollDamage(s.damage));
    spawnParticles(new THREE.Vector3(pos.x, 0.6, pos.z), color, 12);
  }
}

function castChain(s) {
  const color = WEAPONS.chain.color;
  let cur = nearestEnemy(playerGroup.position.x, playerGroup.position.z, 22);
  if (!cur) return;
  const hit = new Set([cur]);
  let from = playerGroup.position.clone().setY(0.9);
  const jumps = Math.round(s.jumps);
  for (let j = 0; j <= jumps; j++) {
    const to = cur.group.position.clone().setY(1.0);
    boltLine(from, to, color);
    damageEnemy(cur, rollDamage(s.damage));
    from = to;
    const next = nearestEnemyExcept(cur.group.position.x, cur.group.position.z, s.jumpRange, hit);
    if (!next) break;
    hit.add(next);
    cur = next;
  }
}

function rootBurst(x, z, area, color) {
  for (let i = 0; i < 5; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * area * 0.8;
    const spike = new THREE.Mesh(
      new THREE.ConeGeometry(0.14, 0.9, 5),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 })
    );
    spike.position.set(x + Math.cos(a) * r, 0.45, z + Math.sin(a) * r);
    spike.rotation.z = (Math.random() - 0.5) * 0.5;
    fxGroup.add(spike);
    transientFx.push({ mesh: spike, life: 0.7, maxLife: 0.7, baseOpacity: 0.95 });
  }
}

function castRoot(s) {
  const def = WEAPONS.root;
  const alive = enemies.filter((e) => e.dying <= 0);
  if (alive.length === 0) return;
  const targets = shuffle(alive).slice(0, Math.max(1, Math.round(s.count)));
  for (const e of targets) {
    if (e.dying > 0) continue;
    const pos = e.group.position;
    for (let j = enemies.length - 1; j >= 0; j--) {
      const t = enemies[j];
      if (t.dying > 0) continue;
      const dx = t.group.position.x - pos.x;
      const dz = t.group.position.z - pos.z;
      if (dx * dx + dz * dz < s.area * s.area) {
        t.root = Math.max(t.root || 0, s.hold);
        damageEnemy(t, rollDamage(s.damage));
      }
    }
    groundFlash(pos.x, pos.z, def.color, s.area);
    rootBurst(pos.x, pos.z, s.area, def.color);
    damageCratesInRadius(pos.x, pos.z, s.area, rollDamage(s.damage));
  }
}

function triggerThorn() {
  const w = state.weapons.find((wp) => wp.id === "thorn");
  if (!w || w.timer > 0) return;
  const s = computeWeapon(w);
  w.timer = s.cooldown;
  const px = playerGroup.position.x;
  const pz = playerGroup.position.z;
  groundFlash(px, pz, WEAPONS.thorn.color, s.area);
  damageCratesInRadius(px, pz, s.area, rollDamage(s.damage));
  for (let j = enemies.length - 1; j >= 0; j--) {
    const e = enemies[j];
    if (e.dying > 0) continue;
    const dx = e.group.position.x - px;
    const dz = e.group.position.z - pz;
    if (dx * dx + dz * dz < s.area * s.area) {
      const dir = new THREE.Vector3(dx, 0, dz).normalize();
      damageEnemy(e, rollDamage(s.damage), dir);
    }
  }
}

function castStorm(s) {
  const def = WEAPONS.storm;
  const alive = enemies.filter((e) => e.dying <= 0);
  if (alive.length === 0) return;
  const chosen = shuffle(alive).slice(0, Math.max(1, Math.round(s.strikes)));
  for (const e of chosen) {
    if (e.dying > 0) continue;
    const pos = e.group.position;
    boltLine(new THREE.Vector3(pos.x, 14, pos.z), new THREE.Vector3(pos.x, 0, pos.z), def.color);
    groundFlash(pos.x, pos.z, def.color, s.area);
    for (let j = enemies.length - 1; j >= 0; j--) {
      const t = enemies[j];
      if (t.dying > 0) continue;
      const dx = t.group.position.x - pos.x;
      const dz = t.group.position.z - pos.z;
      if (dx * dx + dz * dz < s.area * s.area) damageEnemy(t, rollDamage(s.damage));
    }
    damageCratesInRadius(pos.x, pos.z, s.area, rollDamage(s.damage));
    const hit = new Set([e]);
    let from = new THREE.Vector3(pos.x, 1.0, pos.z);
    for (let k = 0; k < Math.round(s.jumps); k++) {
      const next = nearestEnemyExcept(from.x, from.z, s.jumpRange, hit);
      if (!next) break;
      const to = next.group.position.clone().setY(1.0);
      boltLine(from, to, def.color);
      damageEnemy(next, rollDamage(s.damage * 0.7));
      hit.add(next);
      from = to;
    }
    spawnParticles(new THREE.Vector3(pos.x, 0.6, pos.z), def.color, 10);
  }
}

function castBramble(s) {
  const def = WEAPONS.bramble;
  const alive = enemies.filter((e) => e.dying <= 0);
  if (alive.length === 0) return;
  const targets = shuffle(alive).slice(0, Math.max(1, Math.round(s.count)));
  for (const e of targets) {
    if (e.dying > 0) continue;
    const pos = e.group.position;
    for (let j = enemies.length - 1; j >= 0; j--) {
      const t = enemies[j];
      if (t.dying > 0) continue;
      const dx = t.group.position.x - pos.x;
      const dz = t.group.position.z - pos.z;
      if (dx * dx + dz * dz < s.area * s.area) {
        t.root = Math.max(t.root || 0, s.hold);
        damageEnemy(t, rollDamage(s.damage));
      }
    }
    groundFlash(pos.x, pos.z, def.color, s.area);
    rootBurst(pos.x, pos.z, s.area, def.color);
    damageCratesInRadius(pos.x, pos.z, s.area, rollDamage(s.damage));
    for (let j = enemies.length - 1; j >= 0; j--) {
      const t = enemies[j];
      if (t.dying > 0) continue;
      const dx = t.group.position.x - pos.x;
      const dz = t.group.position.z - pos.z;
      if (dx * dx + dz * dz < s.novaArea * s.novaArea) {
        const dir = new THREE.Vector3(dx, 0, dz).normalize();
        damageEnemy(t, rollDamage(s.nova), dir);
      }
    }
    groundFlash(pos.x, pos.z, "#d9c7ff", s.novaArea);
  }
}

// ---------- Shared / new casts ----------
function castNova(s, def) {
  const color = (def && def.color) || "#ffb300";
  const px = playerGroup.position.x;
  const pz = playerGroup.position.z;
  groundFlash(px, pz, color, s.area);
  const r2 = s.area * s.area;
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    if (e.dying > 0) continue;
    const dx = e.group.position.x - px;
    const dz = e.group.position.z - pz;
    if (dx * dx + dz * dz < r2) {
      const dir = new THREE.Vector3(dx, 0, dz).normalize();
      damageEnemy(e, rollDamage(s.damage), dir);
      if (s.freeze) e.freeze = Math.max(e.freeze || 0, s.freeze);
    }
  }
  damageCratesInRadius(px, pz, s.area, rollDamage(s.damage));
  spawnParticles(new THREE.Vector3(px, 0.7, pz), color, 16);
}

function beamFx(px, pz, dx, dz, length, color) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(length, 0.2, 0.6),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false })
  );
  mesh.position.set(px + (dx * length) / 2, 0.8, pz + (dz * length) / 2);
  mesh.rotation.y = Math.atan2(-dz, dx);
  fxGroup.add(mesh);
  transientFx.push({ mesh, life: 0.18, maxLife: 0.18, baseOpacity: 0.7 });
}

function castBeam(s, def) {
  const color = (def && def.color) || "#f48fb1";
  const px = playerGroup.position.x;
  const pz = playerGroup.position.z;
  const target = nearestEnemy(px, pz, s.length);
  if (!target) return;
  let dx = target.group.position.x - px;
  let dz = target.group.position.z - pz;
  const d = Math.hypot(dx, dz) || 1;
  dx /= d;
  dz /= d;
  beamFx(px, pz, dx, dz, s.length, color);
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    if (e.dying > 0) continue;
    const ex = e.group.position.x - px;
    const ez = e.group.position.z - pz;
    const t = ex * dx + ez * dz;
    if (t < 0 || t > s.length) continue;
    if (Math.abs(ex * -dz + ez * dx) > s.width + e.type.radius) continue;
    damageEnemy(e, rollDamage(s.damage));
  }
  for (let i = state.crates.length - 1; i >= 0; i--) {
    const c = state.crates[i];
    if (c.dead) continue;
    const ex = c.x - px;
    const ez = c.z - pz;
    const t = ex * dx + ez * dz;
    if (t < 0 || t > s.length) continue;
    if (Math.abs(ex * -dz + ez * dx) > s.width + CRATES.radius) continue;
    damageCrate(c, rollDamage(s.damage));
  }
  spawnParticles(new THREE.Vector3(px + dx * 2, 1, pz + dz * 2), color, 6);
}

function castQuake(s, def) {
  const color = (def && def.color) || "#bcaaa4";
  const alive = enemies.filter((e) => e.dying <= 0);
  const targets = alive.length
    ? shuffle(alive).slice(0, Math.max(1, Math.round(s.count)))
    : [];
  for (const e of targets) {
    if (e.dying > 0) continue;
    const pos = e.group.position;
    for (let j = enemies.length - 1; j >= 0; j--) {
      const t = enemies[j];
      if (t.dying > 0) continue;
      const dx = t.group.position.x - pos.x;
      const dz = t.group.position.z - pos.z;
      if (dx * dx + dz * dz < s.area * s.area) {
        t.root = Math.max(t.root || 0, s.hold);
        damageEnemy(t, rollDamage(s.damage));
      }
    }
    groundFlash(pos.x, pos.z, color, s.area);
    rootBurst(pos.x, pos.z, s.area, color);
    damageCratesInRadius(pos.x, pos.z, s.area, rollDamage(s.damage));
  }
  const px = playerGroup.position.x;
  const pz = playerGroup.position.z;
  groundFlash(px, pz, color, s.novaArea);
  const r2 = s.novaArea * s.novaArea;
  for (let i = enemies.length - 1; i >= 0; i--) {
    const t = enemies[i];
    if (t.dying > 0) continue;
    const dx = t.group.position.x - px;
    const dz = t.group.position.z - pz;
    if (dx * dx + dz * dz < r2) {
      const dir = new THREE.Vector3(dx, 0, dz).normalize();
      damageEnemy(t, rollDamage(s.nova), dir);
    }
  }
  damageCratesInRadius(px, pz, s.novaArea, rollDamage(s.nova));
}

// ---------- Behavior registry ----------
const TRIGGERS = {
  thunder: castThunder,
  chain: castChain,
  root: castRoot,
  storm: castStorm,
  bramble: castBramble,
  nova: castNova,
  beam: castBeam,
  quake: castQuake,
};

const KINDS = {
  orbit: (w, s, dt) => updateOrbit(w, s, dt),
  spirit: (w, s, dt, def) => {
    updateOrbit(w, s, dt);
    if (w.timer <= 0) {
      spawnHomingBurst(def.color, 1, s.wispDamage, 15, 1.0, 0, false);
      w.timer = s.cooldown;
    }
  },
  aura: (w, s, dt) => updateAura(w, s, dt),
  deploy: (w, s, dt) => updateTotem(w, s, dt),
  hive: (w, s, dt) => updateTotem(w, s, dt),
  homing: (w, s, dt, def) => {
    if (w.timer <= 0) {
      spawnHoming(w, def, s);
      w.timer = s.cooldown;
    }
  },
  timer: (w, s, dt, def) => {
    if (w.timer <= 0) {
      const cast = TRIGGERS[def.trigger];
      if (cast) cast(s, def);
      w.timer = s.cooldown;
    }
  },
  reactive: () => {},
};

export function updateWeapons(dt) {
  for (const w of state.weapons) {
    const def = WEAPONS[w.id];
    const s = computeWeapon(w);
    w.timer -= dt;
    const fn = KINDS[def.kind];
    if (fn) fn(w, s, dt, def);
  }
  updateHomings(dt);
  updateGasClouds(dt);
}

// Reactive hooks: decoupled from combat/enemies via the event bus.
on("kill", triggerGas);
on("hit", triggerThorn);
