// Player visual, camera follow, movement, aiming, and the starter weapons.
import * as THREE from "three";
import { GAME, PLAYER, WEAPONS, CRATES, DASH } from "./config.js";
import {
  scene,
  camera,
  fxGroup,
  playerGroup,
  weaponMount,
  camTarget,
  state,
  enemies,
  projectiles,
  transientFx,
  half,
  sphereGeo,
  basicMat,
  sharedMesh,
} from "./runtime.js";
import { keys, input, stick, getAimPoint, AUTO_RANGE } from "./input.js";
import { moveWithObstacles, separateCircles } from "./collision.js";
import { computeWeapon, rollDamage } from "./stats.js";
import { damageEnemy, nearestEnemy } from "./combat.js";
import { spawnHomingBurst } from "./weapons.js";
import { spawnParticles } from "./fx.js";
import { damageCrate } from "./crates.js";
import { playSfx } from "./audio.js";

export function setPlayerWeapon(id) {
  for (let i = weaponMount.children.length - 1; i >= 0; i--) {
    const c = weaponMount.children[i];
    weaponMount.remove(c);
    c.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
  const def = WEAPONS[id] || WEAPONS.main;
  const metal = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.6, metalness: 0.4 });
  const accent = new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.4 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x6d4c41, roughness: 0.85 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xcfd8dc, roughness: 0.3, metalness: 0.5 });

  if (id === "cleaver") {
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.5, 8), wood);
    handle.position.set(0.45, 0.95, 0.1);
    handle.rotation.x = 0.6;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.95, 0.34), steel);
    blade.position.set(0.45, 1.35, 0.6);
    blade.rotation.x = 0.6;
    weaponMount.add(handle, blade);
  } else if (id === "hex") {
    const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.5, 8), wood);
    staff.position.set(0.45, 1.0, 0.15);
    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(0.17, 12, 10),
      new THREE.MeshStandardMaterial({
        color: def.color,
        emissive: def.color,
        emissiveIntensity: 0.9,
        roughness: 0.3,
      })
    );
    orb.position.set(0.45, 1.8, 0.15);
    weaponMount.add(staff, orb);
  } else {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.5), metal);
    body.position.set(0.34, 0.8, 0.32);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.4, 8), metal);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0.34, 0.8, 0.7);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.22, 8), accent);
    tip.rotation.x = Math.PI / 2;
    tip.position.set(0.34, 0.8, 0.98);
    weaponMount.add(body, barrel, tip);
  }
  weaponMount.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
}

export function updateCamera(dt) {
  camTarget.lerp(playerGroup.position, 1 - Math.exp(-6 * dt));
  camera.position.lerp(
    new THREE.Vector3(camTarget.x, camTarget.y + 14, camTarget.z + 11),
    1 - Math.exp(-5 * dt)
  );
  camera.lookAt(camTarget.x, 0, camTarget.z);
}

function fire(s, dir) {
  playSfx("shoot");
  const def = WEAPONS[state.mainWeapon.id];
  if (def.style === "arc") fireArc(s, dir, def);
  else if (def.style === "seek") fireSeek(s, def);
  else fireShot(s, dir, def);
}

function fireShot(s, base, def) {
  const shots = Math.max(1, Math.round(s.count));
  const spread = 0.16;
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < shots; i++) {
    const offset = (i - (shots - 1) / 2) * spread;
    const dir = base.clone().applyAxisAngle(up, offset);
    const mesh = sharedMesh(sphereGeo(0.16), basicMat(def.color));
    mesh.position.set(
      playerGroup.position.x + dir.x * 1.1,
      0.75,
      playerGroup.position.z + dir.z * 1.1
    );
    scene.add(mesh);
    projectiles.push({
      mesh,
      vel: dir.clone().multiplyScalar(s.speed),
      damage: rollDamage(s.damage),
      pierce: s.pierce || 0,
      hit: new Set(),
      moved: 0,
      range: GAME.playerShotRange,
    });
  }
}

function fireSeek(s, def) {
  spawnHomingBurst(
    def.color,
    Math.max(1, Math.round(s.count)),
    s.damage,
    s.speed,
    0,
    0,
    false
  );
}

function arcFx(dir, range, arcDeg, color) {
  const arcRad = (arcDeg * Math.PI) / 180;
  const center = Math.atan2(-dir.z, dir.x);
  const geo = new THREE.RingGeometry(
    range * 0.35,
    range,
    32,
    1,
    center - arcRad / 2,
    arcRad
  );
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(playerGroup.position.x, 0.12, playerGroup.position.z);
  fxGroup.add(mesh);
  transientFx.push({ mesh, life: 0.2, maxLife: 0.2, baseOpacity: 0.55 });
}

function fireArc(s, dir, def) {
  const cosLimit = Math.cos((s.arcDeg * Math.PI) / 180 / 2);
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    if (e.dying > 0) continue;
    const dx = e.group.position.x - playerGroup.position.x;
    const dz = e.group.position.z - playerGroup.position.z;
    const d = Math.hypot(dx, dz);
    if (d > s.range + e.type.radius) continue;
    const nx = d > 1e-4 ? dx / d : dir.x;
    const nz = d > 1e-4 ? dz / d : dir.z;
    if (nx * dir.x + nz * dir.z < cosLimit) continue;
    damageEnemy(e, rollDamage(s.damage), new THREE.Vector3(nx, 0, nz));
  }
  for (let i = state.crates.length - 1; i >= 0; i--) {
    const c = state.crates[i];
    if (c.dead) continue;
    const dx = c.x - playerGroup.position.x;
    const dz = c.z - playerGroup.position.z;
    const d = Math.hypot(dx, dz);
    if (d > s.range + CRATES.radius) continue;
    const nx = d > 1e-4 ? dx / d : dir.x;
    const nz = d > 1e-4 ? dz / d : dir.z;
    if (nx * dir.x + nz * dir.z < cosLimit) continue;
    damageCrate(c, rollDamage(s.damage));
  }
  arcFx(dir, s.range, s.arcDeg, def.color);
  spawnParticles(
    new THREE.Vector3(
      playerGroup.position.x + dir.x * 1.6,
      0.9,
      playerGroup.position.z + dir.z * 1.6
    ),
    def.color,
    5
  );
}

export function updatePlayer(dt) {
  state.dashCooldown = Math.max(0, state.dashCooldown - dt);
  state.invuln = Math.max(0, state.invuln - dt);

  const move = new THREE.Vector3();
  if (keys["KeyW"]) move.z -= 1;
  if (keys["KeyS"]) move.z += 1;
  if (keys["KeyA"]) move.x -= 1;
  if (keys["KeyD"]) move.x += 1;
  if (stick.active) {
    move.x += stick.dx;
    move.z += stick.dy;
  }
  const hasInput = move.lengthSq() > 0;

  // Dash in the input direction (or facing, if standing still).
  if (input.dashQueued) {
    input.dashQueued = false;
    if (state.dashCooldown <= 0 && state.dashTime <= 0) {
      if (hasInput) {
        move.normalize();
        state.dashDir = { x: move.x, z: move.z };
      } else {
        state.dashDir = {
          x: Math.sin(playerGroup.rotation.y),
          z: Math.cos(playerGroup.rotation.y),
        };
      }
      state.dashTime = DASH.duration;
      state.invuln = DASH.invuln;
      state.dashCooldown = DASH.cooldown;
      playSfx("dash");
    }
  }

  const speedMul = state.mods.speed * (1 - state.hazardSlow);
  if (state.dashTime > 0) {
    state.dashTime -= dt;
    const step = DASH.speed * dt;
    const moved = moveWithObstacles(
      playerGroup.position.x,
      playerGroup.position.z,
      state.dashDir.x * step,
      state.dashDir.z * step,
      PLAYER.radius,
      1
    );
    playerGroup.position.x = THREE.MathUtils.clamp(
      moved.x,
      -half + PLAYER.radius,
      half - PLAYER.radius
    );
    playerGroup.position.z = THREE.MathUtils.clamp(
      moved.z,
      -half + PLAYER.radius,
      half - PLAYER.radius
    );
    spawnParticles(playerGroup.position.clone().setY(0.6), 0x9be7ff, 2);
  } else if (hasInput) {
    move.normalize().multiplyScalar(PLAYER.speed * speedMul * dt);
    const moved = moveWithObstacles(
      playerGroup.position.x,
      playerGroup.position.z,
      move.x,
      move.z,
      PLAYER.radius,
      1
    );
    playerGroup.position.x = THREE.MathUtils.clamp(
      moved.x,
      -half + PLAYER.radius,
      half - PLAYER.radius
    );
    playerGroup.position.z = THREE.MathUtils.clamp(
      moved.z,
      -half + PLAYER.radius,
      half - PLAYER.radius
    );
  }

  for (const e of enemies) {
    if (e.dying > 0) continue;
    const sep = separateCircles(
      playerGroup.position.x,
      playerGroup.position.z,
      PLAYER.radius,
      e.group.position.x,
      e.group.position.z,
      e.type.radius
    );
    if (sep) {
      e.group.position.x += sep.nx * sep.overlap;
      e.group.position.z += sep.nz * sep.overlap;
      e.group.position.x = THREE.MathUtils.clamp(
        e.group.position.x,
        -half + e.type.radius,
        half - e.type.radius
      );
      e.group.position.z = THREE.MathUtils.clamp(
        e.group.position.z,
        -half + e.type.radius,
        half - e.type.radius
      );
    }
  }

  const autoTarget =
    !input.firing && state.autoFire
      ? nearestEnemy(playerGroup.position.x, playerGroup.position.z, AUTO_RANGE)
      : null;

  const dir = new THREE.Vector3();
  if (autoTarget) {
    dir.subVectors(autoTarget.group.position, playerGroup.position);
    dir.y = 0;
  } else {
    const aim = getAimPoint();
    dir.set(aim.x - playerGroup.position.x, 0, aim.z - playerGroup.position.z);
  }

  if (dir.lengthSq() > 1e-6) {
    dir.normalize();
    const targetRot = Math.atan2(dir.x, dir.z);
    let diff = targetRot - playerGroup.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    playerGroup.rotation.y += diff;
  }

  state.fireCooldown -= dt;
  if ((input.firing || autoTarget) && dir.lengthSq() > 1e-6 && state.fireCooldown <= 0) {
    const gun = computeWeapon(state.mainWeapon);
    fire(gun, dir);
    state.fireCooldown = 1 / gun.fireRate;
  }
}
