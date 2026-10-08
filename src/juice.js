// Feedback layer: floating damage numbers, event banners, and hit flashes.
// Purely presentational — driven by the event bus + a per-frame projection.
import * as THREE from "three";
import { camera, hud } from "./runtime.js";
import { on } from "./events.js";

const MAX_NUMBERS = 36;
const numbers = [];
const pool = [];
const proj = new THREE.Vector3();

export function showDamage(x, y, z, amount, crit) {
  if (numbers.length >= MAX_NUMBERS) return;
  const el = pool.pop() || document.createElement("div");
  el.className = crit ? "dmg crit" : "dmg";
  el.textContent = String(Math.round(amount));
  hud.dmgLayer.appendChild(el);
  numbers.push({ el, x, y, z, life: 0.7, max: 0.7 });
}

export function banner(text, color) {
  hud.banner.textContent = text;
  hud.banner.style.color = color || "#ffd54f";
  hud.banner.classList.remove("show");
  void hud.banner.offsetWidth; // force reflow so the animation restarts
  hud.banner.classList.add("show");
}

let lastFlash = 0;
function flash() {
  const now = performance.now();
  if (now - lastFlash < 220) return; // don't strobe while standing in a hazard
  lastFlash = now;
  hud.flash.classList.remove("show");
  void hud.flash.offsetWidth;
  hud.flash.classList.add("show");
}

export function updateJuice(dt) {
  for (let i = numbers.length - 1; i >= 0; i--) {
    const n = numbers[i];
    n.life -= dt;
    if (n.life <= 0) {
      hud.dmgLayer.removeChild(n.el);
      pool.push(n.el);
      numbers.splice(i, 1);
      continue;
    }
    const k = n.life / n.max;
    proj.set(n.x, n.y + (1 - k) * 1.8, n.z);
    proj.project(camera);
    if (proj.z > 1) {
      n.el.style.display = "none";
      continue;
    }
    const sx = (proj.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (-proj.y * 0.5 + 0.5) * window.innerHeight;
    n.el.style.display = "block";
    n.el.style.transform = `translate(-50%, -50%) translate(${sx}px, ${sy}px)`;
    n.el.style.opacity = String(Math.min(1, k * 1.6));
  }
}

const POWERUP = {
  magnet: { label: "MAGNET", color: "#69f0ae" },
  bomb: { label: "BOMB", color: "#ff7043" },
  freeze: { label: "FREEZE", color: "#81d4fa" },
};

on("hit", flash);
on("powerup", (pick) => {
  const p = POWERUP[pick] || { label: pick.toUpperCase(), color: "#ffd54f" };
  banner(p.label, p.color);
});
on("fuse", (name, color) => banner(`FUSED \u00b7 ${name}`, color));
on("boss", () => banner("BOSS", "#d500f9"));
on("biome", (name, accent) => banner(name, accent));
on("merchant", () => banner("MERCHANT", "#ffd54f"));
