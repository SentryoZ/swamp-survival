// Entry point: wires the modules together and runs the frame loop.
import { renderer, scene, camera, hud, state } from "./runtime.js";
import "./input.js"; // registers keyboard/mouse/touch listeners (side effects)
import "./weapons.js"; // registers kill/hit reactive hooks (side effects)
import { updatePlayer, updateCamera } from "./player.js";
import { spawnEnemy, updateEnemies, updateEnemyProjectiles } from "./enemies.js";
import { updateWeapons } from "./weapons.js";
import { updateProjectiles, updateGems, updateParticles } from "./combat.js";
import { updateFx } from "./fx.js";
import { updateJuice } from "./juice.js";
import { spawnCrate, updateCrates } from "./crates.js";
import { updateWaves } from "./waves.js";
import { updateHazards } from "./hazards.js";
import { updateShop } from "./shop.js";
import { CRATES } from "./config.js";
import { updateHud, updateAutoHud, updateSoundHud } from "./hud.js";
import { resetGame, pause, showUpgrades, showStarters } from "./ui.js";
import { initAudio } from "./audio.js";

let spawnTimer = 0;
let crateTimer = 0;
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
    updateJuice(dt);

    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnEnemy();
      spawnTimer = Math.max(0.12, 0.8 - state.time * 0.011);
    }

    crateTimer -= dt;
    if (crateTimer <= 0) {
      spawnCrate();
      crateTimer = CRATES.spawnEvery;
    }
    updateCrates(dt);
    updateWaves(dt);
    updateHazards(dt);
    updateShop(dt);

    if (state.time > 0) updateHud();

    if (state.pendingLevels > 0 && !state.upgrading) showUpgrades();
  } else {
    updateParticles(dt);
    updateFx(dt);
    updateJuice(dt);
  }

  updateCamera(dt);
  renderer.render(scene, camera);
}

window.addEventListener("blur", () => {
  if (state.running) pause();
});
window.addEventListener("error", (e) => {
  console.error("[uncaught]", e.message || e.error);
});
window.addEventListener("unhandledrejection", (e) => {
  console.error("[unhandled]", e.reason);
});

renderer.domElement.addEventListener("webglcontextlost", (e) => {
  e.preventDefault();
  state.running = false;
  state.phase = "dead";
  hud.overlay.classList.remove("hidden");
  hud.title.textContent = "GRAPHICS LOST";
  hud.sub.textContent = "The device ran low on graphics memory \u2014 reload to play";
  hud.startBtn.textContent = "RELOAD";
  hud.startBtn.addEventListener("click", () => location.reload(), { once: true });
});

hud.overlay.classList.add("hidden");
resetGame();
state.running = false;
state.phase = "menu";
updateHud();
updateAutoHud();
updateSoundHud(true);
initAudio();
showStarters();
requestAnimationFrame(animate);
