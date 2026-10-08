// In-run merchant: spawns periodically, opens a spend-Gold shop when the player
// walks up to it. Gold is run-scoped; the stock is services + purchasable weapons.
import * as THREE from "three";
import { SHOP, WEAPONS, GAME } from "./config.js";
import { scene, state, playerGroup, half, hud } from "./runtime.js";
import { circleVsObstacles } from "./collision.js";
import { addWeapon } from "./weapons.js";
import { healPlayer } from "./combat.js";
import { computeMods } from "./stats.js";
import { updateHud, updateBuildHud } from "./hud.js";
import { emit } from "./events.js";
import { playSfx } from "./audio.js";

function merchantMesh() {
  const g = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.6, 0),
    new THREE.MeshStandardMaterial({
      color: 0xffd54f,
      emissive: 0xffb300,
      emissiveIntensity: 0.6,
      roughness: 0.3,
    })
  );
  core.position.y = 1.3;
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.85, 0.08, 8, 22),
    new THREE.MeshBasicMaterial({ color: 0xfff176 })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.35;
  g.add(core, ring);
  return g;
}

function disposeMerchant(mesh) {
  mesh.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
}

// Roll the 3 weapon offers (unowned sub-weapons) for this merchant.
function pickStock() {
  const owned = new Set(state.weapons.map((w) => w.id));
  const pool = Object.keys(WEAPONS).filter(
    (id) => !WEAPONS[id].main && !WEAPONS[id].fused && !owned.has(id)
  );
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, 3);
}

function spawnMerchant() {
  for (let tries = 0; tries < 8; tries++) {
    const ang = Math.random() * Math.PI * 2;
    const dist = 9 + Math.random() * 6;
    const x = THREE.MathUtils.clamp(playerGroup.position.x + Math.cos(ang) * dist, -half + 3, half - 3);
    const z = THREE.MathUtils.clamp(playerGroup.position.z + Math.sin(ang) * dist, -half + 3, half - 3);
    if (circleVsObstacles(x, z, 1.4)) continue;
    const mesh = merchantMesh();
    mesh.position.set(x, 0, z);
    scene.add(mesh);
    state.shop = { mesh, x, z, t: SHOP.stay };
    state.shopStock = pickStock();
    playSfx("levelup");
    emit("merchant");
    return;
  }
}

function despawnMerchant() {
  if (!state.shop) return;
  disposeMerchant(state.shop.mesh);
  scene.remove(state.shop.mesh);
  state.shop = null;
}

function buy(cost) {
  if (state.gold < cost) return false;
  state.gold -= cost;
  return true;
}

function buyService(id) {
  const def = SHOP.services.find((s) => s.id === id);
  if (!def || !buy(def.cost)) return false;
  if (id === "potion") healPlayer(30);
  else if (id === "reroll") state.shopRerolls += 1;
  else if (id === "anvil") {
    state.bonusMaxHp += 15;
    computeMods();
    healPlayer(15);
  } else if (id === "bomb") {
    emit("bomb", playerGroup.position.x, playerGroup.position.z, 18, 120);
  }
  playSfx("ui");
  return true;
}

function buyWeapon(id) {
  const def = WEAPONS[id];
  const cost = SHOP.weaponCost[def.tier] || 30;
  if (state.weapons.length >= GAME.maxWeapons) return false;
  if (!buy(cost)) return false;
  addWeapon(id);
  updateBuildHud();
  playSfx("ui");
  return true;
}

function row(icon, color, html, btn, enabled) {
  const el = document.createElement("div");
  el.className = "meta-row";
  el.style.setProperty("--c", color);
  el.innerHTML = `<span class="mi">${icon}</span><span class="mtxt">${html}</span>`;
  if (btn) {
    const b = document.createElement("button");
    b.textContent = btn;
    b.disabled = !enabled;
    el.appendChild(b);
    return { el, b };
  }
  return { el, b: null };
}

function renderShop() {
  hud.shopTitle.textContent = `MERCHANT \u00b7 ${state.gold} G`;
  const list = hud.shopList;
  list.innerHTML = "";

  const svc = document.createElement("div");
  svc.className = "meta-section";
  svc.textContent = "SERVICES";
  list.appendChild(svc);

  for (const def of SHOP.services) {
    const { el, b } = row(
      def.icon,
      "#ffd54f",
      `<span class="mname">${def.name}</span><span class="mdesc">${def.desc}</span>`,
      String(def.cost),
      state.gold >= def.cost
    );
    b.addEventListener("click", () => {
      if (buyService(def.id)) renderShop();
    });
    list.appendChild(el);
  }

  const owned = new Set(state.weapons.map((w) => w.id));
  const stock = state.shopStock.filter((id) => !owned.has(id));
  if (stock.length) {
    const hdr = document.createElement("div");
    hdr.className = "meta-section";
    hdr.textContent =
      state.weapons.length >= GAME.maxWeapons ? "WEAPONS (SLOTS FULL)" : "WEAPON OFFERS";
    list.appendChild(hdr);

    for (const id of stock) {
      const def = WEAPONS[id];
      const cost = SHOP.weaponCost[def.tier] || 30;
      const { el, b } = row(
        def.icon,
        def.color,
        `<span class="mname">${def.name}</span><span class="mdesc">${def.desc}</span>`,
        String(cost),
        state.weapons.length < GAME.maxWeapons && state.gold >= cost
      );
      b.addEventListener("click", () => {
        if (buyWeapon(id)) renderShop();
      });
      list.appendChild(el);
    }
  }
}

export function openShop() {
  if (state.upgrading || state.shopping || !state.shop) return;
  state.shopping = true;
  state.running = false;
  renderShop();
  hud.shopOverlay.classList.remove("hidden");
}

export function closeShop() {
  if (!state.shopping) return;
  state.shopping = false;
  hud.shopOverlay.classList.add("hidden");
  state.shopCooldown = 1.4;
  if (!state.upgrading) {
    state.phase = "playing";
    state.running = true;
  }
  updateHud();
}

export function updateShop(dt) {
  if (state.shopCooldown > 0) state.shopCooldown -= dt;

  if (state.shop) {
    const m = state.shop;
    m.t -= dt;
    m.mesh.rotation.y += dt * 1.1;
    m.mesh.children[0].rotation.y += dt * 2.2;
    const dx = playerGroup.position.x - m.x;
    const dz = playerGroup.position.z - m.z;
    if (state.shopCooldown <= 0 && dx * dx + dz * dz < SHOP.reach * SHOP.reach) {
      openShop();
    }
    if (m.t <= 0) despawnMerchant();
    return;
  }

  state.shopTimer -= dt;
  if (state.shopTimer <= 0) {
    state.shopTimer = SHOP.every;
    spawnMerchant();
  }
}

export function clearShop() {
  despawnMerchant();
  state.shopStock.length = 0;
  state.shopTimer = SHOP.every * 0.5;
  state.shopCooldown = 0;
  state.shopping = false;
  hud.shopOverlay.classList.add("hidden");
}
