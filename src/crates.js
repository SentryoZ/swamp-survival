// Breakable crates that spawn around the player and drop a power-up
// (magnet / bomb / freeze) when destroyed.
import * as THREE from "three";
import { CRATES } from "./config.js";
import { scene, playerGroup, state, enemies, gems, half } from "./runtime.js";
import { spawnParticles, groundFlash } from "./fx.js";
import { circleVsObstacles } from "./collision.js";
import { emit } from "./events.js";
import { playSfx } from "./audio.js";

const crateGeo = new THREE.BoxGeometry(1, 1, 1);
const bandGeo = new THREE.BoxGeometry(1.08, 0.16, 1.08);
const crateMat = new THREE.MeshStandardMaterial({ color: 0x8d6e63, roughness: 0.85 });
const bandMat = new THREE.MeshStandardMaterial({ color: 0x4e342e, roughness: 0.8 });

function makeCrate(x, z) {
  const group = new THREE.Group();
  const box = new THREE.Mesh(crateGeo, crateMat);
  box.position.y = 0.5;
  box.castShadow = true;
  box.receiveShadow = true;
  const band = new THREE.Mesh(bandGeo, bandMat);
  band.position.y = 0.5;
  group.add(box, band);
  group.position.set(x, 0, z);
  group.rotation.y = Math.random() * Math.PI;
  scene.add(group);
  state.crates.push({ group, hp: CRATES.hp, x, z, dead: false });
}

export function spawnCrate() {
  if (state.crates.length >= CRATES.max) return;
  const ang = Math.random() * Math.PI * 2;
  const dist = 8 + Math.random() * 14;
  const x = THREE.MathUtils.clamp(
    playerGroup.position.x + Math.cos(ang) * dist,
    -half + 2,
    half - 2
  );
  const z = THREE.MathUtils.clamp(
    playerGroup.position.z + Math.sin(ang) * dist,
    -half + 2,
    half - 2
  );
  if (circleVsObstacles(x, z, CRATES.radius + 0.4)) return; // don't spawn in a rock
  makeCrate(x, z);
}

// Guaranteed drop (boss rewards) — bypasses the crate cap.
export function spawnCrateAt(x, z) {
  makeCrate(
    THREE.MathUtils.clamp(x, -half + 2, half - 2),
    THREE.MathUtils.clamp(z, -half + 2, half - 2)
  );
}

export function updateCrates(dt) {
  for (const c of state.crates) {
    c.group.rotation.y += dt * 0.5;
  }
}

export function damageCrate(c, amount) {
  if (c.dead) return;
  c.hp -= amount;
  spawnParticles(new THREE.Vector3(c.x, 0.6, c.z), 0x8d6e63, 4);
  if (c.hp <= 0) breakCrate(c);
}

export function damageCratesInRadius(x, z, radius, amount) {
  for (let i = state.crates.length - 1; i >= 0; i--) {
    const c = state.crates[i];
    if (c.dead) continue;
    const dx = c.x - x;
    const dz = c.z - z;
    const r = radius + CRATES.radius;
    if (dx * dx + dz * dz < r * r) damageCrate(c, amount);
  }
}

function removeCrate(c) {
  scene.remove(c.group);
  const i = state.crates.indexOf(c);
  if (i >= 0) state.crates.splice(i, 1);
}

function breakCrate(c) {
  c.dead = true;
  removeCrate(c);
  spawnParticles(new THREE.Vector3(c.x, 0.7, c.z), 0xffe082, 16);

  const pick = ["magnet", "bomb", "freeze"][Math.floor(Math.random() * 3)];
  playSfx("crate");
  playSfx(pick);
  emit("powerup", pick);
  if (pick === "magnet") {
    groundFlash(c.x, c.z, "#69f0ae", 3.5);
    for (const g of gems) g.magnet = true;
  } else if (pick === "bomb") {
    groundFlash(c.x, c.z, "#ff7043", CRATES.bombRadius);
    emit("bomb", c.x, c.z, CRATES.bombRadius, CRATES.bombDamage);
  } else {
    groundFlash(c.x, c.z, "#81d4fa", CRATES.freezeRadius);
    const r2 = CRATES.freezeRadius * CRATES.freezeRadius;
    for (const e of enemies) {
      if (e.dying > 0) continue;
      const dx = e.group.position.x - c.x;
      const dz = e.group.position.z - c.z;
      if (dx * dx + dz * dz < r2) e.freeze = CRATES.freezeTime;
    }
  }
}

export function clearCrates() {
  for (const c of state.crates) scene.remove(c.group);
  state.crates.length = 0;
}
