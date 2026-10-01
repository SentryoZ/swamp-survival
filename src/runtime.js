// Shared runtime hub: the Three.js scene, the mutable game state, the entity
// arrays, and the shared GPU resource caches. Feature modules import from here
// and never from each other's internals.
import * as THREE from "three";
import { createWorld } from "./world.js";
import { WORLD_SIZE, GAME } from "./config.js";

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

const weaponMount = new THREE.Group();
playerGroup.add(weaponMount);
scene.add(playerGroup);

const camTarget = new THREE.Vector3();

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
  fireCooldown: 0,
  mainWeapon: null,
  starterId: "main",
  autoFire: true,
  weapons: [],
  fused: new Set(),
  upgrades: {},
  mods: null,
  homings: [],
  gasClouds: [],
  crates: [],
  boss: null,
  bossKills: 0,
  revives: 0,
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

// ---------- Shared GPU resources ----------
// High-churn meshes (bullets, gems, particles) share geometry + material.
// Without this, every one leaked a geometry/material and the WebGL context
// died after a few minutes on mobile.
const _geoCache = new Map();
const _matCache = new Map();

function sphereGeo(r, seg = 8) {
  const k = `sph:${r}:${seg}`;
  if (!_geoCache.has(k)) _geoCache.set(k, new THREE.SphereGeometry(r, seg, seg));
  return _geoCache.get(k);
}

function coneGeo(k) {
  if (!_geoCache.has(k)) {
    if (k === "gem") _geoCache.set(k, new THREE.OctahedronGeometry(0.16, 0));
    else _geoCache.set(k, new THREE.ConeGeometry(0.8, 1.6, 8));
  }
  return _geoCache.get(k);
}

function basicMat(color) {
  const k = `basic:${color}`;
  if (!_matCache.has(k)) _matCache.set(k, new THREE.MeshBasicMaterial({ color }));
  return _matCache.get(k);
}

function stdMat(color, roughness) {
  const k = `std:${color}:${roughness}`;
  if (!_matCache.has(k)) {
    _matCache.set(k, new THREE.MeshStandardMaterial({ color, roughness }));
  }
  return _matCache.get(k);
}

function gemMat() {
  if (!_matCache.has("gem")) {
    _matCache.set(
      "gem",
      new THREE.MeshStandardMaterial({
        color: 0x69f0ae,
        emissive: 0x00c853,
        emissiveIntensity: 0.6,
      })
    );
  }
  return _matCache.get("gem");
}

function sharedMesh(geometry, material) {
  const m = new THREE.Mesh(geometry, material);
  m.userData.shared = true;
  return m;
}

// ---------- HUD ----------
const hud = {
  vignette: document.getElementById("vignette"),
  flash: document.getElementById("flash"),
  banner: document.getElementById("banner"),
  dmgLayer: document.getElementById("dmg-layer"),
  hp: document.getElementById("hp-bar"),
  bossWrap: document.getElementById("boss-bar-wrap"),
  bossBar: document.getElementById("boss-bar"),
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
  sound: document.getElementById("sound"),
  upgradeOverlay: document.getElementById("upgrade-overlay"),
  upgradeTitle: document.getElementById("upgrade-title"),
  upgradeCards: document.getElementById("upgrade-cards"),
  rerollBtn: document.getElementById("reroll-btn"),
  starterOverlay: document.getElementById("starter-overlay"),
  starterCards: document.getElementById("starter-cards"),
  metaOverlay: document.getElementById("meta-overlay"),
  metaTitle: document.getElementById("meta-title"),
  metaList: document.getElementById("meta-list"),
};

export {
  renderer,
  scene,
  camera,
  sun,
  world,
  fxGroup,
  half,
  playerGroup,
  weaponMount,
  camTarget,
  state,
  enemies,
  projectiles,
  enemyProjectiles,
  gems,
  particles,
  transientFx,
  sphereGeo,
  coneGeo,
  basicMat,
  stdMat,
  gemMat,
  sharedMesh,
  hud,
  showFatalError,
};
