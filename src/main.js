import * as THREE from "three";
import { createWorld } from "./world.js";
import { WORLD_SIZE, PLAYER, ENEMY_TYPES, GAME } from "./config.js";
import { preloadModel, createEnemyModel, modelState } from "./models.js";

for (const t of Object.values(ENEMY_TYPES)) preloadModel(t.model);

function showFatalError(msg) {
  document.getElementById("hud").style.display = "none";
  const el = document.createElement("div");
  el.style.cssText =
    "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;" +
    "background:#0a0f14;color:#fff;font-family:system-ui;text-align:center;padding:24px;z-index:99;flex-direction:column;gap:12px";
  el.innerHTML = `<div style="font-size:22px;font-weight:700">Could not start the game</div><div style="color:#aab6c0;max-width:480px;line-height:1.5">${msg}</div>`;
  document.body.appendChild(el);
}

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true });
} catch (err) {
  showFatalError(
    "Your browser blocked WebGL. Try enabling hardware acceleration " +
      "(chrome://settings/system) or using a different browser."
  );
  throw err;
}
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 60, 170);

const camera = new THREE.PerspectiveCamera(
  55,
  window.innerWidth / window.innerHeight,
  0.1,
  400
);

scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const sun = new THREE.DirectionalLight(0xfff2cc, 1.4);
sun.position.set(40, 60, 25);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -30;
sun.shadow.camera.right = 30;
sun.shadow.camera.top = 30;
sun.shadow.camera.bottom = -30;
sun.shadow.camera.far = 200;
scene.add(sun);

const world = createWorld();
scene.add(world.group);

const half = WORLD_SIZE / 2;

// ---------- Player ----------
const playerGroup = new THREE.Group();
const playerBody = new THREE.Mesh(
  new THREE.CylinderGeometry(0.5, 0.45, 1.0, 12),
  new THREE.MeshStandardMaterial({ color: 0x1e88e5, roughness: 0.4 })
);
playerBody.position.y = 0.5;
playerBody.castShadow = true;
const playerHead = new THREE.Mesh(
  new THREE.SphereGeometry(0.34, 12, 10),
  new THREE.MeshStandardMaterial({ color: 0xfbc02d, roughness: 0.3 })
);
playerHead.position.y = 1.25;
playerHead.castShadow = true;
playerGroup.add(playerBody, playerHead);

const muzzle = new THREE.Mesh(
  new THREE.ConeGeometry(0.14, 0.4, 8),
  new THREE.MeshStandardMaterial({ color: 0x222222 })
);
muzzle.rotation.x = -Math.PI / 2;
muzzle.position.set(0, 0.75, 0.75);
playerGroup.add(muzzle);
scene.add(playerGroup);

const camTarget = new THREE.Vector3();
function updateCamera(dt) {
  camTarget.lerp(playerGroup.position, 1 - Math.exp(-6 * dt));
  camera.position.lerp(
    new THREE.Vector3(camTarget.x, camTarget.y + 14, camTarget.z + 11),
    1 - Math.exp(-5 * dt)
  );
  camera.lookAt(camTarget.x, 0, camTarget.z);
}

// ---------- Input ----------
const keys = {};
window.addEventListener("keydown", (e) => (keys[e.code] = true));
window.addEventListener("keyup", (e) => (keys[e.code] = false));

const mouse = new THREE.Vector2();
let firing = false;
const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

window.addEventListener("mousemove", (e) => {
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
});
window.addEventListener("mousedown", () => (firing = true));
window.addEventListener("mouseup", () => (firing = false));

function getAimPoint() {
  raycaster.setFromCamera(mouse, camera);
  const point = new THREE.Vector3();
  raycaster.ray.intersectPlane(groundPlane, point);
  return point;
}

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- Game state ----------
const state = {
  running: false,
  hp: GAME.startHp,
  maxHp: GAME.startHp,
  level: 1,
  xp: 0,
  kills: 0,
  time: 0,
  fireRate: GAME.startFireRate,
  damage: GAME.baseDamage,
  fireCooldown: 0,
};

const enemies = [];
const projectiles = [];
const enemyProjectiles = [];
const gems = [];
const particles = [];

// ---------- HUD ----------
const hud = {
  hp: document.getElementById("hp-bar"),
  xp: document.getElementById("xp-bar"),
  level: document.getElementById("level"),
  kills: document.getElementById("kills"),
  timer: document.getElementById("timer"),
  overlay: document.getElementById("overlay"),
  title: document.getElementById("overlay-title"),
  sub: document.getElementById("overlay-sub"),
  startBtn: document.getElementById("start-btn"),
};

function updateHud() {
  hud.hp.style.width = `${(state.hp / state.maxHp) * 100}%`;
  const need = GAME.xpToLevel(state.level);
  hud.xp.style.width = `${(state.xp / need) * 100}%`;
  hud.level.textContent = `LVL ${state.level}`;
  hud.kills.textContent = `${state.kills} KILLS`;
  const m = Math.floor(state.time / 60);
  const s = Math.floor(state.time % 60)
    .toString()
    .padStart(2, "0");
  hud.timer.textContent = `${m}:${s}`;
}

function resetGame() {
  for (const e of enemies) scene.remove(e.group);
  for (const p of projectiles) scene.remove(p.mesh);
  for (const p of enemyProjectiles) scene.remove(p.mesh);
  for (const g of gems) scene.remove(g.mesh);
  enemies.length = 0;
  projectiles.length = 0;
  enemyProjectiles.length = 0;
  gems.length = 0;
  state.hp = state.maxHp;
  state.level = 1;
  state.xp = 0;
  state.kills = 0;
  state.time = 0;
  state.fireRate = GAME.startFireRate;
  state.damage = GAME.baseDamage;
  state.fireCooldown = 0;
  playerGroup.position.set(0, 0, 0);
  playerGroup.rotation.y = 0;
  camTarget.set(0, 0, 0);
  updateHud();
}

hud.startBtn.addEventListener("click", () => {
  hud.overlay.classList.add("hidden");
  resetGame();
  state.running = true;
});

window.addEventListener("blur", () => {
  if (state.running) pause();
});

function pause() {
  state.running = false;
  hud.overlay.classList.remove("hidden");
  hud.title.textContent = "PAUSED";
  hud.sub.textContent = "Click to continue";
  hud.startBtn.textContent = "CONTINUE";
}

function gameOver() {
  state.running = false;
  hud.overlay.classList.remove("hidden");
  hud.title.textContent = "YOU DIED";
  hud.sub.textContent = `Survived ${hud.timer.textContent} — ${state.kills} kills`;
  hud.startBtn.textContent = "RETRY";
}

// ---------- Spawning ----------
function spawnEnemy() {
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
  if (enemies.length >= GAME.maxEnemies) return;
  const stateOfModel = modelState(type.model);
  if (stateOfModel === "loading") return;
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
    const mat = new THREE.MeshStandardMaterial({
      color: type.color,
      roughness: 0.7,
    });
    const body = new THREE.Mesh(
      new THREE.ConeGeometry(0.8, 1.6, 8),
      mat
    );
    body.position.y = 0.8;
    body.castShadow = true;
    group.add(body);
  }
  group.position.set(freed.x, 0, freed.z);
  scene.add(group);

  enemies.push({
    group,
    type,
    hp: type.hp,
    knockback: new THREE.Vector3(),
    steer: Math.random() < 0.5 ? 1 : -1,
    anim: "walk",
    fireCooldown: 0,
    model: modelInst,
    dying: 0,
  });
}

// ---------- Combat ----------
function fire() {
  const aim = getAimPoint();
  const dir = aim.sub(playerGroup.position);
  dir.y = 0;
  dir.normalize();

  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xffe082 })
  );
  mesh.position.set(
    playerGroup.position.x + dir.x * 1.1,
    0.75,
    playerGroup.position.z + dir.z * 1.1
  );
  scene.add(mesh);
  projectiles.push({
    mesh,
    vel: dir.clone().multiplyScalar(GAME.projectileSpeed),
    damage: state.damage,
    life: 1.6,
  });
}

function spawnGems(pos, count) {
  for (let i = 0; i < count; i++) {
    const gem = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.16, 0),
      new THREE.MeshStandardMaterial({
        color: 0x69f0ae,
        emissive: 0x00c853,
        emissiveIntensity: 0.6,
      })
    );
    const offset = new THREE.Vector3(
      (Math.random() - 0.5) * 2,
      0.5,
      (Math.random() - 0.5) * 2
    );
    gem.position.copy(pos).add(offset);
    scene.add(gem);
    gems.push({ mesh: gem, vel: new THREE.Vector3(0, 3, 0), magnet: false });
  }
}

function spawnParticles(pos, color, count = 10) {
  const mat = new THREE.MeshBasicMaterial({ color });
  for (let i = 0; i < count; i++) {
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 6), mat);
    p.position.copy(pos);
    scene.add(p);
    particles.push({
      mesh: p,
      vel: new THREE.Vector3(
        (Math.random() - 0.5) * 8,
        Math.random() * 6,
        (Math.random() - 0.5) * 8
      ),
      life: 0.5,
    });
  }
}

function levelUp() {
  state.level++;
  state.maxHp += 10;
  state.hp = state.maxHp;
  state.fireRate *= 1.12;
  state.damage *= 1.2;
  spawnParticles(playerGroup.position.clone().setY(1), 0xffe082, 20);
}

// ---------- Collision helpers ----------
function circleVsObstacles(x, z, radius, ignore = null) {
  for (const o of world.obstacles) {
    if (o.mesh === ignore) continue;
    const dx = x - o.mesh.position.x;
    const dz = z - o.mesh.position.z;
    const minDist = radius + o.radius;
    if (dx * dx + dz * dz < minDist * minDist) {
      const d = Math.max(Math.hypot(dx, dz), 0.001);
      return { nx: dx / d, nz: dz / d, depth: minDist - Math.hypot(dx, dz) };
    }
  }
  return null;
}

function moveWithObstacles(posX, posZ, vx, vz, radius, bias = 1) {
  const total = Math.hypot(vx, vz);
  if (total < 1e-5) {
    let x = posX;
    let z = posZ;
    for (let i = 0; i < 5; i++) {
      const c = circleVsObstacles(x, z, radius);
      if (!c) break;
      x += c.nx * (c.depth + 0.01);
      z += c.nz * (c.depth + 0.01);
    }
    return { x, z };
  }
  const sub = Math.max(3, Math.ceil(total / 0.05));
  const sx = vx / sub;
  const sz = vz / sub;
  let x = posX;
  let z = posZ;
  for (let s = 0; s < sub; s++) {
    let mx = sx;
    let mz = sz;
    x += mx;
    z += mz;
    const c = circleVsObstacles(x, z, radius);
    if (c) {
      x += c.nx * (c.depth + 0.01);
      z += c.nz * (c.depth + 0.01);
      const vn = mx * c.nx + mz * c.nz;
      if (vn < 0) {
        mx -= c.nx * vn;
        mz -= c.nz * vn;
        if (Math.hypot(mx, mz) < 1e-5) {
          const step = Math.hypot(sx, sz);
          const t1x = -c.nz;
          const t1z = c.nx;
          mx = (bias >= 0 ? t1x : -t1x) * step;
          mz = (bias >= 0 ? t1z : -t1z) * step;
        }
      }
      x += mx;
      z += mz;
    }
  }
  return { x, z };
}

function separateCircles(ax, az, ar, bx, bz, br) {
  const dx = ax - bx;
  const dz = az - bz;
  const d2 = dx * dx + dz * dz;
  const min = ar + br;
  if (d2 >= min * min) return null;
  const d = Math.max(Math.sqrt(d2), 0.0001);
  const overlap = min - d;
  return { nx: dx / d, nz: dz / d, overlap };
}

// ---------- Update ----------
function updatePlayer(dt) {
  const move = new THREE.Vector3();
  if (keys["KeyW"]) move.z -= 1;
  if (keys["KeyS"]) move.z += 1;
  if (keys["KeyA"]) move.x -= 1;
  if (keys["KeyD"]) move.x += 1;

  if (move.lengthSq() > 0) {
    move.normalize().multiplyScalar(PLAYER.speed * dt);
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

  const aim = getAimPoint();
  const targetRot = Math.atan2(aim.x - playerGroup.position.x, aim.z - playerGroup.position.z);
  let diff = targetRot - playerGroup.rotation.y;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  playerGroup.rotation.y += diff;

  state.fireCooldown -= dt;
  if (firing && state.fireCooldown <= 0) {
    fire();
    state.fireCooldown = 1 / state.fireRate;
  }
}

function updateEnemies(dt) {
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

    const toPlayer = new THREE.Vector3()
      .subVectors(playerGroup.position, e.group.position);
    toPlayer.y = 0;
    const dist = toPlayer.length();
    toPlayer.normalize();

    const approaching = !t.ranged || dist > t.range;

    e.knockback.multiplyScalar(Math.max(0, 1 - 8 * dt));
    const move = new THREE.Vector3();
    if (approaching) {
      move.addScaledVector(toPlayer, t.speed * dt);
    }
    move.addScaledVector(e.knockback, dt);

    if (e.model && !e.dying) {
      const want = approaching ? "walk" : "idle";
      if (e.anim !== want) {
        e.model.play(want, 1.2);
        e.anim = want;
      }
    }

    if (t.ranged && !approaching) {
      if ((e.fireCooldown ?? 0) <= 0) {
        enemyFire(e, t);
        e.fireCooldown = t.fireInterval;
      }
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
    e.group.rotation.y +=
      (targetYaw - e.group.rotation.y) * Math.min(1, 10 * dt);

    if (dist < t.radius + PLAYER.radius + 0.4) {
      state.hp -= t.damage * dt;
      if (state.hp <= 0) {
        state.hp = 0;
        gameOver();
        return;
      }
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

function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.life -= dt;
    p.mesh.position.addScaledVector(p.vel, dt);

    let hit = false;
    for (let j = enemies.length - 1; j >= 0; j--) {
      const e = enemies[j];
      if (e.dying > 0) continue;
      const dx = p.mesh.position.x - e.group.position.x;
      const dz = p.mesh.position.z - e.group.position.z;
      if (dx * dx + dz * dz < (e.type.radius + 0.2) ** 2) {
        e.hp -= p.damage;
        const knock = new THREE.Vector3(p.vel.x, 0, p.vel.z).normalize();
        e.knockback.addScaledVector(knock, 20);
        spawnParticles(p.mesh.position.clone(), 0xffab40, 4);
        if (e.hp <= 0) {
          spawnParticles(e.group.position.clone().setY(1), e.type.color, 14);
          spawnGems(e.group.position.clone().setY(0.5), e.type.xp);
          state.kills++;
          if (e.model) {
            e.dying = 0.55;
            e.model.play("death", 1.4);
          } else {
            scene.remove(e.group);
            enemies.splice(j, 1);
          }
        }
        hit = true;
        break;
      }
    }

    if (hit || p.life <= 0) {
      scene.remove(p.mesh);
      projectiles.splice(i, 1);
    }
  }
}

function enemyFire(e, t) {
  const dir = new THREE.Vector3().subVectors(playerGroup.position, e.group.position);
  dir.y = 0;
  dir.normalize();
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 8, 8),
    new THREE.MeshBasicMaterial({ color: t.color })
  );
  mesh.position.set(
    e.group.position.x + dir.x * 1.6,
    1.8,
    e.group.position.z + dir.z * 1.6
  );
  scene.add(mesh);
  enemyProjectiles.push({
    mesh,
    vel: dir.clone().multiplyScalar(t.projectileSpeed),
    damage: t.damage,
    life: 3,
  });
  if (e.model && e.anim !== "fire") {
    e.model.play("fire", 1.5);
    e.anim = "fire";
  }
}

function updateEnemyProjectiles(dt) {
  for (let i = enemyProjectiles.length - 1; i >= 0; i--) {
    const p = enemyProjectiles[i];
    p.life -= dt;
    p.mesh.position.addScaledVector(p.vel, dt);

    let hit = false;
    const dx = p.mesh.position.x - playerGroup.position.x;
    const dz = p.mesh.position.z - playerGroup.position.z;
    if (dx * dx + dz * dz < (PLAYER.radius + 0.3) ** 2) {
      state.hp -= p.damage;
      spawnParticles(p.mesh.position.clone(), 0x00bcd4, 8);
      if (state.hp <= 0) {
        state.hp = 0;
        gameOver();
        return;
      }
      updateHud();
      hit = true;
    } else if (circleVsObstacles(p.mesh.position.x, p.mesh.position.z, 0.15)) {
      hit = true;
    }

    if (hit || p.life <= 0) {
      scene.remove(p.mesh);
      enemyProjectiles.splice(i, 1);
    }
  }
}

function updateGems(dt) {
  for (let i = gems.length - 1; i >= 0; i--) {
    const g = gems[i];
    const toPlayer = new THREE.Vector3().subVectors(
      playerGroup.position.clone().setY(0.5),
      g.mesh.position
    );
    const dist = toPlayer.length();

    if (dist < 4.5) g.magnet = true;
    if (g.magnet) {
      const pull = Math.min(1, 12 * dt);
      g.mesh.position.lerp(playerGroup.position.clone().setY(0.5), pull);
      if (dist < 0.6) {
        state.xp += 1;
        const need = GAME.xpToLevel(state.level);
        if (state.xp >= need) {
          state.xp -= need;
          levelUp();
        }
        scene.remove(g.mesh);
        gems.splice(i, 1);
        continue;
      }
    } else {
      g.vel.y -= 12 * dt;
      g.mesh.position.addScaledVector(g.vel, dt);
      if (g.mesh.position.y < 0.5) {
        g.mesh.position.y = 0.5;
        g.vel.y = Math.abs(g.vel.y) * 0.3;
      }
    }
    g.mesh.rotation.y += dt * 3;
  }
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    p.mesh.position.addScaledVector(p.vel, dt);
    p.vel.y -= 12 * dt;
    const s = Math.max(0.02, p.life);
    p.mesh.scale.setScalar(s);
    if (p.life <= 0) {
      scene.remove(p.mesh);
      particles.splice(i, 1);
    }
  }
}

// ---------- Main loop ----------
let spawnTimer = 0;
let lastTime = performance.now();

function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;

  if (state.running) {
    state.time += dt;
    updatePlayer(dt);
    updateEnemies(dt);
    updateProjectiles(dt);
    updateEnemyProjectiles(dt);
    updateGems(dt);
    updateParticles(dt);

    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnEnemy();
      spawnTimer = Math.max(0.15, 0.9 - state.time * 0.01);
    }

    if (state.time > 0) updateHud();
  } else {
    updateParticles(dt);
  }

  updateCamera(dt);
  renderer.render(scene, camera);
}

hud.overlay.classList.add("hidden");
state.running = true;
resetGame();
updateHud();
requestAnimationFrame(animate);
