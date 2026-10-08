// Biome hazards: telegraphed ground effects that damage / slow the player and
// enemies. Which one spawns depends on the current biome.
import * as THREE from "three";
import { HAZARDS } from "./config.js";
import { fxGroup, state, enemies, playerGroup } from "./runtime.js";
import { removeFx, groundFlash, spawnParticles } from "./fx.js";
import { damageEnemy, damagePlayer } from "./combat.js";
import { playSfx } from "./audio.js";

function makeMesh(color, radius) {
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 28),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.05;
  return mesh;
}

function spawnHazard() {
  const def = HAZARDS[state.biome];
  if (!def) return;
  const ang = Math.random() * Math.PI * 2;
  const dist = 3 + Math.random() * 10;
  const x = playerGroup.position.x + Math.cos(ang) * dist;
  const z = playerGroup.position.z + Math.sin(ang) * dist;
  const mesh = makeMesh(def.color, def.radius);
  mesh.position.set(x, 0.05, z);
  mesh.scale.setScalar(0.3);
  fxGroup.add(mesh);
  state.hazards.push({ def, mesh, x, z, phase: "tele", t: 0, fired: false });
}

function burst(h) {
  const def = h.def;
  groundFlash(h.x, h.z, def.color, def.radius);
  spawnParticles(new THREE.Vector3(h.x, 0.6, h.z), def.color, 18);
  playSfx("bomb");
  const r2 = def.radius * def.radius;
  const pdx = playerGroup.position.x - h.x;
  const pdz = playerGroup.position.z - h.z;
  if (pdx * pdx + pdz * pdz < r2) damagePlayer(def.damage);
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    if (e.dying > 0) continue;
    const dx = e.group.position.x - h.x;
    const dz = e.group.position.z - h.z;
    if (dx * dx + dz * dz < r2) damageEnemy(e, def.damage);
  }
}

function applyArea(h, dt) {
  const def = h.def;
  const r2 = def.radius * def.radius;
  const pdx = playerGroup.position.x - h.x;
  const pdz = playerGroup.position.z - h.z;
  if (pdx * pdx + pdz * pdz < r2) {
    if (def.dps) damagePlayer(def.dps * dt);
    if (def.slow) state.hazardSlow = Math.max(state.hazardSlow, def.slow);
  }
  if (def.dps) {
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      if (e.dying > 0) continue;
      const dx = e.group.position.x - h.x;
      const dz = e.group.position.z - h.z;
      if (dx * dx + dz * dz < r2) damageEnemy(e, def.dps * dt);
    }
  }
}

export function updateHazards(dt) {
  state.hazardSlow = 0;

  const def = HAZARDS[state.biome];
  if (def) {
    state.hazardTimer -= dt;
    if (state.hazardTimer <= 0) {
      state.hazardTimer = def.interval * (0.75 + Math.random() * 0.5);
      spawnHazard();
    }
  }

  for (let i = state.hazards.length - 1; i >= 0; i--) {
    const h = state.hazards[i];
    h.t += dt;

    if (h.phase === "tele") {
      const k = Math.min(1, h.t / h.def.telegraph);
      h.mesh.scale.setScalar(0.3 + 0.7 * k);
      h.mesh.material.opacity = 0.12 + 0.28 * k;
      if (h.t >= h.def.telegraph) {
        h.phase = "active";
        h.t = 0;
        h.mesh.scale.setScalar(1);
        h.mesh.material.opacity = 0.4;
        if (h.def.kind === "ember" && !h.fired) {
          h.fired = true;
          burst(h);
        }
      }
      continue;
    }

    if (h.def.kind === "ember") {
      h.mesh.material.opacity = Math.max(0, 0.6 - h.t * 2);
      h.mesh.scale.setScalar(1 + h.t * 1.6);
    } else {
      applyArea(h, dt);
    }

    if (h.t >= h.def.duration) {
      removeFx(h.mesh);
      state.hazards.splice(i, 1);
    }
  }
}

export function clearHazards() {
  for (const h of state.hazards) removeFx(h.mesh);
  state.hazards.length = 0;
  state.hazardTimer = 4;
  state.hazardSlow = 0;
}
