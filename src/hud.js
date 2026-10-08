// HUD text/bars and the compact build list.
import { GAME, WEAPONS, PASSIVES } from "./config.js";
import { hud, state } from "./runtime.js";

export function updateHud() {
  hud.hp.style.width = `${(state.hp / state.maxHp) * 100}%`;
  const need = GAME.xpToLevel(state.level);
  hud.xp.style.width = `${(state.xp / need) * 100}%`;
  hud.level.textContent = `LVL ${state.level}`;
  hud.kills.textContent = `${state.kills} KILLS`;
  hud.gold.textContent = `${state.gold} G`;
  const m = Math.floor(state.time / 60);
  const s = Math.floor(state.time % 60)
    .toString()
    .padStart(2, "0");
  hud.timer.textContent = `${m}:${s}`;

  if (hud.dashBtn) hud.dashBtn.classList.toggle("cooling", state.dashCooldown > 0);

  const frac = state.hp / state.maxHp;
  hud.vignette.style.opacity =
    frac < 0.4 ? String(((0.4 - frac) / 0.4) * 0.85) : "0";

  const boss = state.boss;
  if (boss && boss.dying <= 0) {
    hud.bossWrap.classList.remove("hidden");
    hud.bossBar.style.width = `${Math.max(0, (boss.hp / boss.maxHp) * 100)}%`;
  } else if (!hud.bossWrap.classList.contains("hidden")) {
    hud.bossWrap.classList.add("hidden");
  }
}

export function updateAutoHud() {
  hud.auto.textContent = `AUTO: ${state.autoFire ? "ON" : "OFF"}`;
  hud.auto.classList.toggle("off", !state.autoFire);
}

export function updateSoundHud(on) {
  hud.sound.textContent = `SFX: ${on ? "ON" : "OFF"}`;
  hud.sound.classList.toggle("off", !on);
}

export function updateBuildHud() {
  const parts = [];
  if (state.mainWeapon) {
    const def = WEAPONS[state.mainWeapon.id];
    parts.push(
      `<span class="build-item" style="--c:${def.color}"><b>${def.icon}</b><i>${state.mainWeapon.level}</i></span>`
    );
  }
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
