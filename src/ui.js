// Menus, HUD-driven flows: reset, pause/game-over, upgrade picker, starters.
import { WEAPONS, PASSIVES, TIERS, FUSIONS, GAME, META, BIOMES } from "./config.js";
import {
  hud,
  scene,
  state,
  enemies,
  projectiles,
  enemyProjectiles,
  gems,
  particles,
  playerGroup,
  camTarget,
  applyBiome,
} from "./runtime.js";
import { removeFx } from "./fx.js";
import { addWeapon, removeWeapon, clearWeapons } from "./weapons.js";
import { clearCrates } from "./crates.js";
import { resetWaves } from "./waves.js";
import { clearHazards } from "./hazards.js";
import { clearShop, closeShop } from "./shop.js";
import { computeMods, weaponBaseStats, weaponPreview } from "./stats.js";
import { healPlayer } from "./combat.js";
import { updateHud, updateBuildHud } from "./hud.js";
import { setPlayerWeapon } from "./player.js";
import { on, emit } from "./events.js";
import { isTouch } from "./input.js";
import { playSfx } from "./audio.js";
import {
  availableStarters,
  metaBonuses,
  getMeta,
  levelOf,
  costOf,
  buyUpgrade,
  unlockStarter,
  isStarterUnlocked,
  earnEssence,
  recordRun,
  resetMeta,
} from "./meta.js";

export function resetGame() {
  for (const e of enemies) {
    if (e.model?.mixer) e.model.mixer.stopAllAction();
    scene.remove(e.group);
  }
  enemies.length = 0;
  for (const p of projectiles) removeFx(p.mesh);
  for (const p of enemyProjectiles) removeFx(p.mesh);
  for (const g of gems) removeFx(g.mesh);
  for (const p of particles) removeFx(p.mesh);
  particles.length = 0;
  projectiles.length = 0;
  enemyProjectiles.length = 0;
  gems.length = 0;
  clearWeapons();
  clearCrates();
  clearHazards();
  clearShop();
  resetWaves();
  state.gold = 0;
  state.bonusMaxHp = 0;
  state.shopRerolls = 0;
  state.dashCooldown = 0;
  state.dashTime = 0;
  state.invuln = 0;
  state.weapons.length = 0;
  state.homings.length = 0;
  state.gasClouds.length = 0;
  state.fused = new Set();
  state.upgrades = {};
  state.pendingLevels = 0;
  state.upgrading = false;
  state.rerolls = 0;
  state.bossKills = 0;
  state.revives = 0;
  state.level = 1;
  state.xp = 0;
  state.kills = 0;
  state.time = 0;
  state.mainWeapon = { id: state.starterId, level: 1 };
  setPlayerWeapon(state.mainWeapon.id);
  state.fireCooldown = 0;
  computeMods();
  state.hp = state.maxHp;
  playerGroup.position.set(0, 0, 0);
  playerGroup.rotation.y = 0;
  camTarget.set(0, 0, 0);
  hud.upgradeOverlay.classList.add("hidden");
  hud.bossWrap.classList.add("hidden");
  updateHud();
  updateBuildHud();
}

export function pause() {
  state.running = false;
  state.phase = "paused";
  hud.overlay.classList.remove("hidden");
  hud.title.textContent = "PAUSED";
  hud.sub.textContent = isTouch ? "Tap to continue" : "Click to continue";
  hud.startBtn.textContent = "CONTINUE";
}

export function gameOver() {
  state.running = false;
  state.phase = "dead";
  playSfx("death");
  const gained =
    state.kills + Math.floor(state.time / 60) * 10 + state.bossKills * 25;
  earnEssence(gained);
  recordRun(state.time, state.kills);
  hud.overlay.classList.remove("hidden");
  hud.title.textContent = "YOU DIED";
  hud.sub.textContent = `Survived ${hud.timer.textContent} \u2014 ${state.kills} kills  \u00b7  +${gained} essence`;
  hud.startBtn.textContent = "RETRY";
}

// Guardian meta upgrade: consume a revive instead of dying.
function onDeath() {
  if (state.revives > 0) {
    state.revives--;
    state.hp = state.maxHp * 0.5;
    enemyProjectiles.length = 0;
    emit("bomb", playerGroup.position.x, playerGroup.position.z, 16, 140);
    playSfx("levelup");
    updateHud();
    return;
  }
  gameOver();
}

// ---------- Upgrade picker ----------
export function buildCandidates() {
  const out = [];
  const owned = new Set(state.weapons.map((w) => w.id));
  const mainDef = state.mainWeapon ? WEAPONS[state.mainWeapon.id] : null;
  if (mainDef && state.mainWeapon.level < mainDef.maxLevel) {
    out.push({
      type: "weapon-up",
      id: state.mainWeapon.id,
      def: mainDef,
      level: state.mainWeapon.level,
      tier: "common",
      main: true,
    });
  }
  for (const w of state.weapons) {
    const def = WEAPONS[w.id];
    if (w.level < def.maxLevel) {
      out.push({ type: "weapon-up", id: w.id, def, level: w.level, tier: "common" });
    }
  }
  if (state.weapons.length < GAME.maxWeapons) {
    for (const id of Object.keys(WEAPONS)) {
      if (WEAPONS[id].fused || WEAPONS[id].main || owned.has(id)) continue;
      out.push({ type: "weapon-new", id, def: WEAPONS[id], level: 0, tier: WEAPONS[id].tier });
    }
  }
  for (const id of Object.keys(PASSIVES)) {
    const def = PASSIVES[id];
    const lv = state.upgrades[id] || 0;
    if (lv < def.maxLevel) out.push({ type: "passive", id, def, level: lv, tier: def.tier });
  }
  for (const f of FUSIONS) {
    if (state.fused.has(f.result)) continue;
    const a = state.weapons.find((w) => w.id === f.ingredients[0]);
    const b = state.weapons.find((w) => w.id === f.ingredients[1]);
    if (!a || !b) continue;
    if (a.level < WEAPONS[a.id].maxLevel || b.level < WEAPONS[b.id].maxLevel) continue;
    out.push({ type: "fusion", id: f.result, def: WEAPONS[f.result], fusion: f, tier: "fusion" });
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
    let lvl;
    if (card.type === "weapon-new") lvl = "NEW";
    else if (card.type === "fusion") lvl = "FUSE";
    else lvl = `Lv ${card.level} \u2192 ${card.level + 1}`;
    let statsHtml = "";
    if (card.type === "fusion") {
      const [a, b] = card.fusion.ingredients;
      statsHtml =
        `<span class="card-stat"><em>${WEAPONS[a].name}</em>+ ${WEAPONS[b].name}</span>`;
    } else if (card.type === "weapon-up") {
      const w = card.main ? state.mainWeapon : state.weapons.find((x) => x.id === card.id);
      const lines = w ? weaponPreview(w) : [];
      statsHtml = lines
        .map(
          (l) =>
            `<span class="card-stat"><em>${l.label}</em>${l.from} <b>${l.to}</b></span>`
        )
        .join("");
    }
    el.innerHTML =
      `<span class="card-icon" style="color:${card.def.color}">${card.def.icon}</span>` +
      `<span class="card-name">${card.def.name}</span>` +
      `<span class="card-desc">${card.def.desc}</span>` +
      (statsHtml ? `<span class="card-stats">${statsHtml}</span>` : "") +
      `<span class="card-lv">${lvl}</span>`;
    el.addEventListener("click", () => chooseCard(card));
    hud.upgradeCards.appendChild(el);
  }
  updateRerollButton();
}

function chooseCard(card) {
  playSfx("ui");
  if (card.type === "weapon-new") addWeapon(card.id);
  else if (card.type === "fusion") {
    for (const ing of card.fusion.ingredients) {
      const w = state.weapons.find((x) => x.id === ing);
      if (w) removeWeapon(w);
    }
    addWeapon(card.id);
    state.fused.add(card.id);
    emit("fuse", card.def.name, card.def.color);
  } else if (card.type === "weapon-up") {
    if (card.main) {
      state.mainWeapon.level++;
    } else {
      const w = state.weapons.find((x) => x.id === card.id);
      if (w) w.level++;
    }
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

export function showUpgrades() {
  if (buildCandidates().length === 0) {
    state.pendingLevels = 0;
    return;
  }
  state.upgrading = true;
  state.running = false;
  state.rerolls = GAME.rerollsPerLevel + metaBonuses().rerolls + state.shopRerolls;
  state.shopRerolls = 0;
  hud.upgradeTitle.textContent = `LEVEL ${state.level}`;
  renderUpgradeCards();
  hud.upgradeOverlay.classList.remove("hidden");
}

// ---------- Starter select ----------
function starterSummary(id) {
  const s = weaponBaseStats(id, 1);
  const bits = [`${Math.round(s.damage)} dmg`, `${s.fireRate.toFixed(1)}/s`];
  if (s.speed !== undefined) bits.push(`${Math.round(s.speed)} spd`);
  if (s.range !== undefined) bits.push(`${s.range.toFixed(1)} range`);
  if (s.arcDeg !== undefined) bits.push(`${Math.round(s.arcDeg)}\u00b0 arc`);
  if (id === "hex") bits.push("seeking");
  return bits.join(" \u00b7 ");
}

export function showStarters() {
  hud.starterCards.innerHTML = "";
  for (const id of availableStarters()) {
    const def = WEAPONS[id];
    const el = document.createElement("button");
    el.className = "upgrade-card";
    el.style.setProperty("--c", def.color);
    el.innerHTML =
      `<span class="card-icon" style="color:${def.color}">${def.icon}</span>` +
      `<span class="card-name">${def.name}</span>` +
      `<span class="card-desc">${def.desc}</span>` +
      `<span class="card-stats"><span class="card-stat">${starterSummary(id)}</span></span>` +
      `<span class="card-lv">SELECT</span>`;
    el.addEventListener("click", () => startRun(id));
    hud.starterCards.appendChild(el);
  }
  hud.starterOverlay.classList.remove("hidden");
}

// Pick a biome different from the last one, then rebuild the arena.
function pickBiome() {
  const options = BIOMES.filter((b) => b.id !== state.biome);
  const pool = options.length ? options : BIOMES;
  return pool[Math.floor(Math.random() * pool.length)];
}

function beginRun() {
  resetGame();
  const mb = metaBonuses();
  state.pendingLevels += mb.startLevel;
  state.revives = mb.revives;
  const biome = applyBiome(pickBiome().id);
  hud.starterOverlay.classList.add("hidden");
  hud.overlay.classList.add("hidden");
  state.phase = "playing";
  state.running = true;
  emit("biome", biome.name, biome.accent);
}

function startRun(id) {
  playSfx("ui");
  state.starterId = id;
  beginRun();
}

// ---------- Meta upgrade shop ----------
function metaRow(icon, color, titleHtml) {
  const row = document.createElement("div");
  row.className = "meta-row";
  row.style.setProperty("--c", color);
  row.innerHTML = `<span class="mi">${icon}</span><span class="mtxt"></span>`;
  row.querySelector(".mtxt").innerHTML = titleHtml;
  return row;
}

function renderMeta() {
  const meta = getMeta();
  hud.metaTitle.textContent = `ESSENCE: ${meta.essence}`;
  hud.metaList.innerHTML = "";

  const upHeader = document.createElement("div");
  upHeader.className = "meta-section";
  upHeader.textContent = "UPGRADES";
  hud.metaList.appendChild(upHeader);

  for (const [id, def] of Object.entries(META)) {
    const lv = levelOf(id);
    const cost = costOf(id);
    const row = metaRow(
      def.icon,
      "#4fa3ff",
      `<span class="mname">${def.name} <span class="mlv">Lv ${lv}/${def.maxLevel}</span></span>` +
        `<span class="mdesc">${def.desc}</span>`
    );
    const btn = document.createElement("button");
    if (cost === null) {
      btn.textContent = "MAX";
      btn.disabled = true;
    } else {
      btn.textContent = String(cost);
      btn.disabled = meta.essence < cost;
      btn.addEventListener("click", () => {
        if (buyUpgrade(id)) {
          playSfx("ui");
          renderMeta();
        }
      });
    }
    row.appendChild(btn);
    hud.metaList.appendChild(row);
  }

  const locked = Object.keys(WEAPONS).filter(
    (id) => WEAPONS[id].locked && !isStarterUnlocked(id)
  );
  if (locked.length) {
    const sHeader = document.createElement("div");
    sHeader.className = "meta-section";
    sHeader.textContent = "UNLOCK STARTERS";
    hud.metaList.appendChild(sHeader);
    for (const id of locked) {
      const def = WEAPONS[id];
      const row = metaRow(
        def.icon,
        def.color,
        `<span class="mname">${def.name}</span><span class="mdesc">${def.desc}</span>`
      );
      const btn = document.createElement("button");
      btn.textContent = String(def.unlockCost);
      btn.disabled = meta.essence < def.unlockCost;
      btn.addEventListener("click", () => {
        if (unlockStarter(id)) {
          playSfx("ui");
          renderMeta();
          showStarters();
        }
      });
      row.appendChild(btn);
      hud.metaList.appendChild(row);
    }
  }
}

function openMeta() {
  playSfx("ui");
  renderMeta();
  hud.metaOverlay.classList.remove("hidden");
}

function closeMeta() {
  hud.metaOverlay.classList.add("hidden");
}

// ---------- Wiring owned by the UI ----------
hud.startBtn.addEventListener("click", () => {
  playSfx("ui");
  if (state.phase === "paused") {
    hud.overlay.classList.add("hidden");
    state.phase = "playing";
    state.running = true;
    return;
  }
  beginRun();
});

hud.rerollBtn.addEventListener("click", () => {
  if (state.rerolls <= 0) return;
  playSfx("ui");
  state.rerolls--;
  renderUpgradeCards();
});

document.getElementById("shop-close").addEventListener("click", () => {
  playSfx("ui");
  closeShop();
});
document.getElementById("meta-btn").addEventListener("click", openMeta);
document.getElementById("starter-meta-btn").addEventListener("click", openMeta);
document.getElementById("meta-close").addEventListener("click", closeMeta);
document.getElementById("meta-reset").addEventListener("click", () => {
  resetMeta();
  playSfx("ui");
  renderMeta();
  showStarters();
});

on("death", onDeath);
