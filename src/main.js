import * as THREE from "three";
import { createWorld } from "./world.js";
import {
  WORLD_SIZE,
  PLAYER,
  ENEMY_TYPES,
  GAME,
  WEAPONS,
  PASSIVES,
  TIERS,
} from "./config.js";
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

// All sub-weapon visuals live here so a reset can wipe them in one place.
const fxGroup = new THREE.Group();
scene.add(fxGroup);

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

const isTouch =
  window.matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;
const AUTO_RANGE = 40;

// ---------- Touch joystick ----------
const JOY_MAX = 55;
const joystickEl = document.getElementById("joystick");
const joystickKnob = document.getElementById("joystick-knob");
const stick = { active: false, id: null, ox: 0, oy: 0, dx: 0, dy: 0 };

function stickStart(t) {
  stick.active = true;
  stick.id = t.identifier;
  stick.ox = t.clientX;
  stick.oy = t.clientY;
  stick.dx = 0;
  stick.dy = 0;
  joystickEl.style.left = `${t.clientX}px`;
  joystickEl.style.top = `${t.clientY}px`;
  joystickKnob.style.transform = "translate(-50%, -50%)";
  joystickEl.classList.remove("hidden");
}

function stickMove(t) {
  let dx = t.clientX - stick.ox;
  let dy = t.clientY - stick.oy;
  const d = Math.hypot(dx, dy);
  if (d > JOY_MAX) {
    dx = (dx / d) * JOY_MAX;
    dy = (dy / d) * JOY_MAX;
  }
  stick.dx = dx / JOY_MAX;
  stick.dy = dy / JOY_MAX;
  joystickKnob.style.transform =
    `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
}

function stickEnd() {
  stick.active = false;
  stick.id = null;
  stick.dx = 0;
  stick.dy = 0;
  joystickEl.classList.add("hidden");
}

window.addEventListener(
  "touchstart",
  (e) => {
    if (!state.running) return;
    if (e.target.closest && e.target.closest("#upgrade-overlay, #overlay")) return;
    if (!stick.active) stickStart(e.changedTouches[0]);
    e.preventDefault();
  },
  { passive: false }
);

window.addEventListener(
  "touchmove",
  (e) => {
    if (!stick.active) return;
    for (const t of e.changedTouches) {
      if (t.identifier === stick.id) stickMove(t);
    }
    e.preventDefault();
  },
  { passive: false }
);

window.addEventListener("touchend", (e) => {
  for (const t of e.changedTouches) {
    if (t.identifier === stick.id) stickEnd();
  }
});
window.addEventListener("touchcancel", stickEnd);

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
  phase: "playing",
  hp: GAME.startHp,
  maxHp: GAME.startHp,
  level: 1,
  xp: 0,
  kills: 0,
  time: 0,
  fireRate: GAME.startFireRate,
  damage: GAME.baseDamage,
  fireCooldown: 0,
  autoFire: true,
  weapons: [],
  upgrades: {},
  mods: null,
  homings: [],
  gasClouds: [],
  pendingLevels: 0,
  upgrading: false,
  rerolls: 0,
};

const enemies = [];
const projectiles = [];
const enemyProjectiles = [];
const gems = [];
const particles = [];
const transientFx = [];

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
  build: document.getElementById("build"),
  auto: document.getElementById("auto"),
  upgradeOverlay: document.getElementById("upgrade-overlay"),
  upgradeTitle: document.getElementById("upgrade-title"),
  upgradeCards: document.getElementById("upgrade-cards"),
  rerollBtn: document.getElementById("reroll-btn"),
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

function updateAutoHud() {
  hud.auto.textContent = `AUTO: ${state.autoFire ? "ON" : "OFF"}`;
  hud.auto.classList.toggle("off", !state.autoFire);
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
  clearWeapons();
  state.weapons.length = 0;
  state.homings.length = 0;
  state.gasClouds.length = 0;
  state.upgrades = {};
  state.pendingLevels = 0;
  state.upgrading = false;
  state.rerolls = 0;
  state.level = 1;
  state.xp = 0;
  state.kills = 0;
  state.time = 0;
  state.fireRate = GAME.startFireRate;
  state.damage = GAME.baseDamage;
  state.fireCooldown = 0;
  computeMods();
  state.hp = state.maxHp;
  playerGroup.position.set(0, 0, 0);
  playerGroup.rotation.y = 0;
  camTarget.set(0, 0, 0);
  hud.upgradeOverlay.classList.add("hidden");
  updateHud();
  updateBuildHud();
}

hud.startBtn.addEventListener("click", () => {
  hud.overlay.classList.add("hidden");
  if (state.phase === "paused") {
    state.phase = "playing";
    state.running = true;
    return;
  }
  resetGame();
  state.phase = "playing";
  state.running = true;
});

window.addEventListener("keydown", (e) => {
  if (e.code === "KeyF") {
    state.autoFire = !state.autoFire;
    updateAutoHud();
  }
});

window.addEventListener("blur", () => {
  if (state.running) pause();
});

function pause() {
  state.running = false;
  state.phase = "paused";
  hud.overlay.classList.remove("hidden");
  hud.title.textContent = "PAUSED";
  hud.sub.textContent = isTouch ? "Tap to continue" : "Click to continue";
  hud.startBtn.textContent = "CONTINUE";
}

function gameOver() {
  state.running = false;
  state.phase = "dead";
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

  const scale = Math.pow(GAME.enemyScalePerMinute, Math.floor(state.time / 60));
  enemies.push({
    group,
    type,
    hp: type.hp * scale,
    damage: type.damage * scale,
    knockback: new THREE.Vector3(),
    steer: Math.random() < 0.5 ? 1 : -1,
    anim: "walk",
    fireCooldown: 0,
    model: modelInst,
    dying: 0,
  });
}

// ---------- Combat ----------
function fire(base) {
  const shots = 1 + state.mods.count;
  const spread = 0.16;
  const damage = state.damage * state.mods.damage;
  const up = new THREE.Vector3(0, 1, 0);

  for (let i = 0; i < shots; i++) {
    const offset = (i - (shots - 1) / 2) * spread;
    const dir = base.clone().applyAxisAngle(up, offset);
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
      damage: rollDamage(damage),
      pierce: state.mods.pierce,
      hit: new Set(),
      life: 1.6,
    });
  }
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

// ---------- Stats & shared combat ----------
function computeMods() {
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
    maxHpAdd: 0,
  };
  for (const [id, lv] of Object.entries(state.upgrades)) {
    const def = PASSIVES[id];
    if (def && lv > 0) def.mod(m, lv);
  }
  state.mods = m;
  state.maxHp = GAME.startHp + m.maxHpAdd;
  if (state.hp > state.maxHp) state.hp = state.maxHp;
}

function computeWeapon(w) {
  const def = WEAPONS[w.id];
  const L = w.level;
  const b = def.base;
  const p = def.per || {};
  const s = {};
  for (const key of Object.keys(b)) {
    let v = b[key];
    if (key === "count" && p.countEvery) v += Math.floor((L - 1) / p.countEvery);
    else if (key === "strikes" && p.strikesEvery) v += Math.floor((L - 1) / p.strikesEvery);
    else if (key === "jumps" && p.jumpsEvery) v += Math.floor((L - 1) / p.jumpsEvery);
    else if (p[key] !== undefined) v += p[key] * (L - 1);
    s[key] = v;
  }
  const m = state.mods;
  if (s.damage !== undefined) s.damage *= m.damage;
  if (s.dps !== undefined) s.dps *= m.damage;
  if (s.cooldown !== undefined) s.cooldown = Math.max(0.3, s.cooldown) / m.haste;
  if (s.rate !== undefined) s.rate = Math.max(0.2, s.rate) / m.haste;
  if (s.radius !== undefined) s.radius *= m.area;
  if (s.area !== undefined) s.area *= m.area;
  if (s.blast !== undefined) s.blast *= m.area;
  if (s.tick !== undefined) s.tick = Math.max(0.15, s.tick);
  if (def.tags.includes("count")) {
    if (s.count !== undefined) s.count += m.count;
    if (s.strikes !== undefined) s.strikes += m.count;
    if (s.jumps !== undefined) s.jumps += m.count;
  }
  if (def.tags.includes("pierce")) s.pierce = m.pierce;
  return s;
}

function rollDamage(base) {
  return Math.random() < state.mods.critChance ? base * state.mods.critMult : base;
}

function healPlayer(amount) {
  if (amount <= 0) return;
  state.hp = Math.min(state.maxHp, state.hp + amount);
}

function gainLifesteal(amount) {
  if (state.mods.lifesteal > 0) healPlayer(amount * state.mods.lifesteal);
}

// One place that resolves damage and death for every weapon + the main gun.
function damageEnemy(e, amount, knock = null) {
  if (e.dying > 0) return;
  e.hp -= amount;
  if (knock) e.knockback.addScaledVector(knock, 20);
  gainLifesteal(amount);
  if (e.hp <= 0) {
    spawnParticles(e.group.position.clone().setY(1), e.type.color, 14);
    spawnGems(e.group.position.clone().setY(0.5), e.type.xp);
    state.kills++;
    triggerGas(e.group.position.x, e.group.position.z);
    if (e.model) {
      e.dying = 0.55;
      e.model.play("death", 1.4);
    } else {
      scene.remove(e.group);
      const idx = enemies.indexOf(e);
      if (idx >= 0) enemies.splice(idx, 1);
    }
  }
}

function nearestEnemy(x, z, maxDist = Infinity, exclude = null) {
  let best = null;
  let bestD = maxDist * maxDist;
  for (const e of enemies) {
    if (e.dying > 0 || e === exclude) continue;
    const dx = e.group.position.x - x;
    const dz = e.group.position.z - z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD) {
      bestD = d2;
      best = e;
    }
  }
  return best;
}

function levelUp() {
  state.level++;
  healPlayer(state.maxHp * 0.1);
  spawnParticles(playerGroup.position.clone().setY(1), 0xffe082, 20);
  state.pendingLevels++;
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
  if (stick.active) {
    move.x += stick.dx;
    move.z += stick.dy;
  }

  if (move.lengthSq() > 0) {
    move.normalize().multiplyScalar(PLAYER.speed * state.mods.speed * dt);
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
    !firing && state.autoFire
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
  if ((firing || autoTarget) && dir.lengthSq() > 1e-6 && state.fireCooldown <= 0) {
    fire(dir);
    state.fireCooldown = 1 / (state.fireRate * state.mods.haste);
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

    e.slow = Math.max(0, (e.slow || 0) - dt * 1.5);
    e.root = Math.max(0, (e.root || 0) - dt);
    e.knockback.multiplyScalar(Math.max(0, 1 - 8 * dt));
    const moveMul = e.root > 0 ? 0 : 1 - e.slow;
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
      state.hp -= e.damage * dt;
      triggerThorn();
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

    let spent = false;
    for (let j = enemies.length - 1; j >= 0; j--) {
      const e = enemies[j];
      if (e.dying > 0 || p.hit.has(e)) continue;
      const dx = p.mesh.position.x - e.group.position.x;
      const dz = p.mesh.position.z - e.group.position.z;
      if (dx * dx + dz * dz < (e.type.radius + 0.2) ** 2) {
        p.hit.add(e);
        const knock = new THREE.Vector3(p.vel.x, 0, p.vel.z).normalize();
        damageEnemy(e, p.damage, knock);
        spawnParticles(p.mesh.position.clone(), 0xffab40, 4);
        if (p.pierce > 0) {
          p.pierce--;
        } else {
          spent = true;
          break;
        }
      }
    }

    if (spent || p.life <= 0) {
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
    damage: e.damage ?? t.damage,
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
      triggerThorn();
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

    if (dist < 4.5 * state.mods.magnet) g.magnet = true;
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

// ---------- Sub-weapon FX helpers ----------
function removeFx(mesh) {
  fxGroup.remove(mesh);
  if (mesh.geometry) mesh.geometry.dispose();
  if (mesh.material) {
    if (Array.isArray(mesh.material)) mesh.material.forEach((m) => m.dispose());
    else mesh.material.dispose();
  }
}

function boltLine(from, to, color) {
  const pts = [];
  const seg = 4;
  for (let i = 0; i <= seg; i++) {
    const p = from.clone().lerp(to, i / seg);
    if (i > 0 && i < seg) {
      p.x += (Math.random() - 0.5) * 0.6;
      p.y += (Math.random() - 0.5) * 0.6;
      p.z += (Math.random() - 0.5) * 0.6;
    }
    pts.push(p);
  }
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1 })
  );
  fxGroup.add(line);
  transientFx.push({ mesh: line, life: 0.16, maxLife: 0.16, baseOpacity: 1 });
}

function groundFlash(x, z, color, radius) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius * 0.55, radius, 24),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, 0.06, z);
  fxGroup.add(ring);
  transientFx.push({ mesh: ring, life: 0.3, maxLife: 0.3, baseOpacity: 0.85 });
}

function updateFx(dt) {
  for (let i = transientFx.length - 1; i >= 0; i--) {
    const f = transientFx[i];
    f.life -= dt;
    const k = Math.max(0, f.life / f.maxLife);
    if (f.mesh.material) f.mesh.material.opacity = k * f.baseOpacity;
    if (f.life <= 0) {
      removeFx(f.mesh);
      transientFx.splice(i, 1);
    }
  }
}

// ---------- Sub-weapons ----------
function clearWeapons() {
  transientFx.length = 0;
  for (let i = fxGroup.children.length - 1; i >= 0; i--) {
    const c = fxGroup.children[i];
    fxGroup.remove(c);
    if (c.geometry) c.geometry.dispose();
    if (c.material) {
      if (Array.isArray(c.material)) c.material.forEach((m) => m.dispose());
      else c.material.dispose();
    }
  }
}

function updateBuildHud() {
  const parts = [];
  for (const w of state.weapons) {
    const def = WEAPONS[w.id];
    parts.push(
      `<span class="build-item" style="--c:${def.color}"><b>${def.icon}</b><i>${w.level}</i></span>`
    );
  }
  for (const [id, lv] of Object.entries(state.upgrades)) {
    const def = PASSIVES[id];
    if (!def || lv <= 0) continue;
    parts.push(
      `<span class="build-item" style="--c:${def.color}"><b>${def.icon}</b><i>${lv}</i></span>`
    );
  }
  hud.build.innerHTML = parts.join("");
}

function addWeapon(id) {
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
  updateBuildHud();
  return w;
}

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
  }
}

function updateAura(w, s, dt) {
  const def = WEAPONS[w.id];
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
    spawnParticles(new THREE.Vector3(pos.x, 0.6, pos.z), color, 12);
  }
}

function nearestEnemyExcept(x, z, maxDist, excludeSet) {
  let best = null;
  let bestD = maxDist * maxDist;
  for (const e of enemies) {
    if (e.dying > 0 || excludeSet.has(e)) continue;
    const dx = e.group.position.x - x;
    const dz = e.group.position.z - z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD) {
      bestD = d2;
      best = e;
    }
  }
  return best;
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

function spawnHoming(w, def, s) {
  const count = Math.max(1, Math.round(s.count));
  for (let i = 0; i < count; i++) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 8, 8),
      new THREE.MeshBasicMaterial({ color: def.color })
    );
    const a = Math.random() * Math.PI * 2;
    mesh.position.set(
      playerGroup.position.x + Math.cos(a) * 0.8,
      0.9,
      playerGroup.position.z + Math.sin(a) * 0.8
    );
    fxGroup.add(mesh);
    state.homings.push({
      mesh,
      speed: s.speed,
      damage: rollDamage(s.damage),
      blast: s.blast || 0,
      drain: s.drain || 0,
      leech: def.trigger === "leech",
      color: def.color,
      life: 4,
      target: null,
    });
  }
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
    if (hit || h.life <= 0) {
      removeFx(h.mesh);
      state.homings.splice(i, 1);
    }
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
  }
}

function totemMesh(color) {
  return new THREE.Mesh(
    new THREE.ConeGeometry(0.42, 1.4, 6),
    new THREE.MeshBasicMaterial({ color })
  );
}

function fireTotemBolt(t, target, s, color) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 6, 6),
    new THREE.MeshBasicMaterial({ color })
  );
  mesh.position.set(t.x, 1.2, t.z);
  fxGroup.add(mesh);
  state.homings.push({
    mesh,
    speed: 16,
    damage: rollDamage(s.damage),
    blast: 0,
    drain: 0,
    leech: false,
    color,
    life: 3,
    target,
  });
}

function updateTotem(w, s, dt) {
  const def = WEAPONS.totem;
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
        fireTotemBolt(t, target, s, def.color);
        t.fire = s.rate;
      }
    }
    if (t.life <= 0) {
      removeFx(t.mesh);
      w.totems.splice(i, 1);
    }
  }
}

function spawnGasCloud(x, z, s) {
  const def = WEAPONS.gas;
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(1, 14, 10),
    new THREE.MeshBasicMaterial({
      color: def.color,
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
  const w = state.weapons.find((wp) => wp.id === "gas");
  if (!w) return;
  spawnGasCloud(x, z, computeWeapon(w));
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

function triggerThorn() {
  const w = state.weapons.find((wp) => wp.id === "thorn");
  if (!w || w.timer > 0) return;
  const s = computeWeapon(w);
  w.timer = s.cooldown;
  const px = playerGroup.position.x;
  const pz = playerGroup.position.z;
  groundFlash(px, pz, WEAPONS.thorn.color, s.area);
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

function updateWeapons(dt) {
  for (const w of state.weapons) {
    const def = WEAPONS[w.id];
    const s = computeWeapon(w);
    w.timer -= dt;
    if (def.kind === "orbit") updateOrbit(w, s, dt);
    else if (def.kind === "aura") updateAura(w, s, dt);
    else if (def.kind === "deploy") updateTotem(w, s, dt);
    else if (def.kind === "homing") {
      if (w.timer <= 0) {
        spawnHoming(w, def, s);
        w.timer = s.cooldown;
      }
    } else if (def.kind === "timer" && w.timer <= 0) {
      if (def.trigger === "thunder") castThunder(s);
      else if (def.trigger === "chain") castChain(s);
      else if (def.trigger === "root") castRoot(s);
      w.timer = s.cooldown;
    }
  }
  updateHomings(dt);
  updateGasClouds(dt);
}

// ---------- Upgrade picker ----------
function buildCandidates() {
  const out = [];
  const owned = new Set(state.weapons.map((w) => w.id));
  for (const w of state.weapons) {
    const def = WEAPONS[w.id];
    if (w.level < def.maxLevel) {
      out.push({ type: "weapon-up", id: w.id, def, level: w.level, tier: "common" });
    }
  }
  if (state.weapons.length < GAME.maxWeapons) {
    for (const id of Object.keys(WEAPONS)) {
      if (!owned.has(id)) out.push({ type: "weapon-new", id, def: WEAPONS[id], level: 0, tier: WEAPONS[id].tier });
    }
  }
  for (const id of Object.keys(PASSIVES)) {
    const def = PASSIVES[id];
    const lv = state.upgrades[id] || 0;
    if (lv < def.maxLevel) out.push({ type: "passive", id, def, level: lv, tier: def.tier });
  }
  return out;
}

function pickCards(n) {
  const pool = buildCandidates();
  const picked = [];
  while (picked.length < n && pool.length) {
    let total = 0;
    for (const c of pool) total += TIERS[c.tier].weight;
    let roll = Math.random() * total;
    let idx = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      roll -= TIERS[pool[i].tier].weight;
      if (roll <= 0) {
        idx = i;
        break;
      }
    }
    picked.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return picked;
}

function updateRerollButton() {
  hud.rerollBtn.textContent = `REROLL (${state.rerolls})`;
  hud.rerollBtn.disabled = state.rerolls <= 0;
}

function renderUpgradeCards() {
  const cards = pickCards(3);
  hud.upgradeCards.innerHTML = "";
  for (const card of cards) {
    const el = document.createElement("button");
    el.className = "upgrade-card";
    el.style.setProperty("--c", TIERS[card.tier].color);
    const lvl =
      card.type === "weapon-new" ? "NEW" : `Lv ${card.level} \u2192 ${card.level + 1}`;
    el.innerHTML =
      `<span class="card-icon" style="color:${card.def.color}">${card.def.icon}</span>` +
      `<span class="card-name">${card.def.name}</span>` +
      `<span class="card-desc">${card.def.desc}</span>` +
      `<span class="card-lv">${lvl}</span>`;
    el.addEventListener("click", () => chooseCard(card));
    hud.upgradeCards.appendChild(el);
  }
  updateRerollButton();
}

function chooseCard(card) {
  if (card.type === "weapon-new") addWeapon(card.id);
  else if (card.type === "weapon-up") {
    const w = state.weapons.find((x) => x.id === card.id);
    if (w) w.level++;
  } else {
    state.upgrades[card.id] = (state.upgrades[card.id] || 0) + 1;
    computeMods();
    if (card.id === "vitality") healPlayer(25);
  }
  updateBuildHud();
  state.pendingLevels = Math.max(0, state.pendingLevels - 1);
  if (state.pendingLevels > 0 && buildCandidates().length > 0) {
    renderUpgradeCards();
  } else {
    state.pendingLevels = 0;
    closeUpgrades();
  }
}

function closeUpgrades() {
  state.upgrading = false;
  hud.upgradeOverlay.classList.add("hidden");
  state.phase = "playing";
  state.running = true;
}

function showUpgrades() {
  if (buildCandidates().length === 0) {
    state.pendingLevels = 0;
    return;
  }
  state.upgrading = true;
  state.running = false;
  state.rerolls = GAME.rerollsPerLevel;
  hud.upgradeTitle.textContent = `LEVEL ${state.level}`;
  renderUpgradeCards();
  hud.upgradeOverlay.classList.remove("hidden");
}

hud.rerollBtn.addEventListener("click", () => {
  if (state.rerolls <= 0) return;
  state.rerolls--;
  renderUpgradeCards();
});

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
    updateWeapons(dt);
    updateProjectiles(dt);
    updateEnemyProjectiles(dt);
    updateGems(dt);
    updateParticles(dt);
    updateFx(dt);

    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnEnemy();
      spawnTimer = Math.max(0.15, 0.9 - state.time * 0.01);
    }

    if (state.time > 0) updateHud();

    if (state.pendingLevels > 0 && !state.upgrading) showUpgrades();
  } else {
    updateParticles(dt);
    updateFx(dt);
  }

  updateCamera(dt);
  renderer.render(scene, camera);
}

hud.overlay.classList.add("hidden");
state.running = true;
resetGame();
updateHud();
updateAutoHud();
requestAnimationFrame(animate);
