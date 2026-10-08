// Enemy spawning, movement, ranged attacks, and enemy projectiles.
import * as THREE from "three";
import { ENEMY_TYPES, GAME, PLAYER, WAVES } from "./config.js";
import {
  scene,
  playerGroup,
  state,
  enemies,
  enemyProjectiles,
  half,
} from "./runtime.js";
import { preloadModel, createEnemyModel, modelState } from "./models.js";
import { circleVsObstacles, moveWithObstacles, separateCircles } from "./collision.js";
import { removeFx, spawnParticles } from "./fx.js";
import { sphereGeo, basicMat, coneGeo, stdMat, sharedMesh } from "./runtime.js";
import { updateHud } from "./hud.js";
import { damagePlayer } from "./combat.js";
import { playSfx } from "./audio.js";

for (const t of Object.values(ENEMY_TYPES)) preloadModel(t.model);

export function spawnEnemy() {
  const t = state.time;
  let pool;
  if (t < 30) pool = [ENEMY_TYPES.grunt];
  else if (t < 60) pool = [ENEMY_TYPES.grunt, ENEMY_TYPES.grunt, ENEMY_TYPES.runner];
  else if (t < 90)
    pool = [ENEMY_TYPES.grunt, ENEMY_TYPES.runner, ENEMY_TYPES.knight];
  else if (t < 120)
    pool = [ENEMY_TYPES.grunt, ENEMY_TYPES.runner, ENEMY_TYPES.knight, ENEMY_TYPES.brute];
  else
    pool = [
      ENEMY_TYPES.grunt,
      ENEMY_TYPES.runner,
      ENEMY_TYPES.knight,
      ENEMY_TYPES.brute,
      ENEMY_TYPES.leader,
      ENEMY_TYPES.mage,
    ];

  const type = pool[Math.floor(Math.random() * pool.length)];
  createEnemy(type);
}

// Spawn a specific type, optionally scaled up (elites / bosses).
export function spawnEnemyOfType(type, opts = {}) {
  return createEnemy(type, opts);
}

function createEnemy(baseType, opts = {}) {
  if (!opts.force && enemies.length >= GAME.maxEnemies) return null;
  const stateOfModel = modelState(baseType.model);
  if (stateOfModel === "loading" && !opts.force) return null;

  const type = opts.sizeMul
    ? {
        ...baseType,
        radius: baseType.radius * opts.sizeMul,
        height: baseType.height * opts.sizeMul,
      }
    : baseType;

  const angle = Math.random() * Math.PI * 2;
  const dist = 28 + Math.random() * 8;
  const x = playerGroup.position.x + Math.cos(angle) * dist;
  const z = playerGroup.position.z + Math.sin(angle) * dist;
  const clampedX = THREE.MathUtils.clamp(x, -half + 3, half - 3);
  const clampedZ = THREE.MathUtils.clamp(z, -half + 3, half - 3);
  const freed = moveWithObstacles(clampedX, clampedZ, 0, 0, type.radius);

  const group = new THREE.Group();
  const model = createEnemyModel(type.model, { targetHeight: type.height });
  let modelInst = null;
  if (model) {
    model.group.position.y = 0;
    group.add(model.group);
    modelInst = model;
  } else {
    const body = sharedMesh(coneGeo("enemy"), stdMat(type.color, 0.7));
    body.position.y = type.height * 0.4;
    body.castShadow = true;
    group.add(body);
  }

  if (opts.boss || opts.elite) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(type.radius * 0.95, type.radius * 1.25, 28),
      new THREE.MeshBasicMaterial({
        color: opts.boss ? 0xd500f9 : 0xffd54f,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    group.add(ring);
  }

  group.position.set(freed.x, 0, freed.z);
  scene.add(group);

  const scale = Math.pow(GAME.enemyScalePerMinute, Math.floor(state.time / 60));
  const hp = type.hp * scale * (opts.hpMul || 1);
  const e = {
    group,
    type,
    hp,
    maxHp: hp,
    damage: type.damage * scale * (opts.dmgMul || 1),
    xp: Math.round(type.xp * (opts.xpMul || 1)),
    boss: !!opts.boss,
    elite: !!opts.elite,
    knockback: new THREE.Vector3(),
    steer: Math.random() < 0.5 ? 1 : -1,
    anim: "walk",
    fireCooldown: opts.boss ? WAVES.bossVolleyEvery * 0.5 : 0,
    model: modelInst,
    dying: 0,
  };
  enemies.push(e);
  return e;
}

function bossVolley(e, t) {
  const n = WAVES.bossVolleyCount;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const mesh = sharedMesh(sphereGeo(0.34), basicMat(0x9c27b0));
    mesh.position.set(e.group.position.x + dir.x * (e.type.radius + 0.6), 1.8, e.group.position.z + dir.z * (e.type.radius + 0.6));
    scene.add(mesh);
    enemyProjectiles.push({
      mesh,
      vel: dir.multiplyScalar(t.projectileSpeed || 14),
      damage: e.damage * 0.6,
      life: 3,
    });
  }
  if (e.model) e.model.play("fire", 1.5);
}

export function enemyFire(e, t) {
  const dir = new THREE.Vector3().subVectors(playerGroup.position, e.group.position);
  dir.y = 0;
  dir.normalize();
  const mesh = sharedMesh(sphereGeo(0.28), basicMat(t.color));
  mesh.position.set(
    e.group.position.x + dir.x * 1.6,
    1.8,
    e.group.position.z + dir.z * 1.6
  );
  scene.add(mesh);
  enemyProjectiles.push({
    mesh,
    vel: dir.clone().multiplyScalar(t.projectileSpeed),
    damage: e.damage ?? t.damage,
    life: 2.2,
  });
  if (e.model && e.anim !== "fire") {
    e.model.play("fire", 1.5);
    e.anim = "fire";
  }
}

export function updateEnemies(dt) {
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    const t = e.type;

    if (e.model?.mixer) e.model.mixer.update(dt);

    if (e.dying > 0) {
      e.dying -= dt;
      if (e.dying <= 0) {
        scene.remove(e.group);
        enemies.splice(i, 1);
      }
      continue;
    }

    const toPlayer = new THREE.Vector3().subVectors(
      playerGroup.position,
      e.group.position
    );
    toPlayer.y = 0;
    const dist = toPlayer.length();
    toPlayer.normalize();

    const approaching = !t.ranged || dist > t.range;

    e.slow = Math.max(0, (e.slow || 0) - dt * 1.5);
    e.root = Math.max(0, (e.root || 0) - dt);
    e.freeze = Math.max(0, (e.freeze || 0) - dt);
    e.knockback.multiplyScalar(Math.max(0, 1 - 8 * dt));
    const moveMul = e.root > 0 || e.freeze > 0 ? 0 : Math.max(0, 1 - e.slow);
    const move = new THREE.Vector3();
    if (approaching) {
      move.addScaledVector(toPlayer, t.speed * moveMul * dt);
    }
    move.addScaledVector(e.knockback, dt);

    if (e.model && !e.dying) {
      const want = approaching ? "walk" : "idle";
      if (e.anim !== want) {
        e.model.play(want, 1.2);
        e.anim = want;
      }
    }

    if (t.ranged && !approaching && e.freeze <= 0) {
      if ((e.fireCooldown ?? 0) <= 0) {
        enemyFire(e, t);
        e.fireCooldown = t.fireInterval;
      }
    }
    if (e.boss && (e.fireCooldown ?? 0) <= 0 && e.freeze <= 0) {
      bossVolley(e, t);
      e.fireCooldown = WAVES.bossVolleyEvery;
    }
    e.fireCooldown = (e.fireCooldown ?? 0) - dt;

    const moved = moveWithObstacles(
      e.group.position.x,
      e.group.position.z,
      move.x,
      move.z,
      t.radius,
      e.steer
    );
    e.group.position.x = THREE.MathUtils.clamp(moved.x, -half + t.radius, half - t.radius);
    e.group.position.z = THREE.MathUtils.clamp(moved.z, -half + t.radius, half - t.radius);

    const sepPlayer = separateCircles(
      e.group.position.x,
      e.group.position.z,
      t.radius,
      playerGroup.position.x,
      playerGroup.position.z,
      PLAYER.radius
    );
    if (sepPlayer) {
      e.group.position.x += sepPlayer.nx * sepPlayer.overlap;
      e.group.position.z += sepPlayer.nz * sepPlayer.overlap;
    }

    const targetYaw = Math.atan2(
      playerGroup.position.x - e.group.position.x,
      playerGroup.position.z - e.group.position.z
    );
    e.group.rotation.y += (targetYaw - e.group.rotation.y) * Math.min(1, 10 * dt);

    if (dist < t.radius + PLAYER.radius + 0.4) {
      damagePlayer(e.damage * dt);
      if (state.invuln <= 0) playSfx("hurt");
      if (state.hp <= 0) return;
      updateHud();
    }
  }

  for (let i = 0; i < enemies.length; i++) {
    const a = enemies[i];
    if (a.dying > 0) continue;
    for (let j = i + 1; j < enemies.length; j++) {
      const b = enemies[j];
      if (b.dying > 0) continue;
      const sep = separateCircles(
        a.group.position.x,
        a.group.position.z,
        a.type.radius,
        b.group.position.x,
        b.group.position.z,
        b.type.radius
      );
      if (sep) {
        const push = sep.overlap / 2;
        a.group.position.x += sep.nx * push;
        a.group.position.z += sep.nz * push;
        b.group.position.x -= sep.nx * push;
        b.group.position.z -= sep.nz * push;
      }
    }
  }
}

export function updateEnemyProjectiles(dt) {
  for (let i = enemyProjectiles.length - 1; i >= 0; i--) {
    const p = enemyProjectiles[i];
    p.life -= dt;
    p.mesh.position.addScaledVector(p.vel, dt);

    let hit = false;
    const dx = p.mesh.position.x - playerGroup.position.x;
    const dz = p.mesh.position.z - playerGroup.position.z;
    if (dx * dx + dz * dz < (PLAYER.radius + 0.3) ** 2) {
      damagePlayer(p.damage);
      if (state.invuln <= 0) playSfx("hurt");
      spawnParticles(p.mesh.position.clone(), 0x00bcd4, 8);
      if (state.hp <= 0) return;
      updateHud();
      hit = true;
    } else if (circleVsObstacles(p.mesh.position.x, p.mesh.position.z, 0.15)) {
      hit = true;
    }

    if (hit || p.life <= 0) {
      removeFx(p.mesh);
      enemyProjectiles.splice(i, 1);
    }
  }
}
