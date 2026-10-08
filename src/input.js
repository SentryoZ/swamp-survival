// Keyboard, mouse, and touch input. Exposes `input` for the player module.
import * as THREE from "three";
import { renderer, camera, state } from "./runtime.js";
import { GAME } from "./config.js";
import { updateAutoHud, updateSoundHud } from "./hud.js";
import { toggleSound } from "./audio.js";

export const AUTO_RANGE = GAME.autoRange;
export const isTouch =
  window.matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;

export const keys = {};
const mouse = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

export const input = { firing: false, dashQueued: false };

export function getAimPoint() {
  raycaster.setFromCamera(mouse, camera);
  const point = new THREE.Vector3();
  raycaster.ray.intersectPlane(groundPlane, point);
  return point;
}

window.addEventListener("keydown", (e) => (keys[e.code] = true));
window.addEventListener("keyup", (e) => (keys[e.code] = false));
window.addEventListener("mousemove", (e) => {
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
});
window.addEventListener("mousedown", () => (input.firing = true));
window.addEventListener("mouseup", () => (input.firing = false));

window.addEventListener("keydown", (e) => {
  if (e.code === "KeyF") {
    state.autoFire = !state.autoFire;
    updateAutoHud();
  } else if (e.code === "KeyM") {
    updateSoundHud(toggleSound());
  } else if (e.code === "Space") {
    input.dashQueued = true;
    e.preventDefault();
  }
});

// On-screen dash button (mobile).
const dashBtn = document.getElementById("dash-btn");
if (dashBtn) {
  dashBtn.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    input.dashQueued = true;
  });
}

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- Touch joystick ----------
const JOY_MAX = 55;
const joystickEl = document.getElementById("joystick");
const joystickKnob = document.getElementById("joystick-knob");
export const stick = { active: false, id: null, ox: 0, oy: 0, dx: 0, dy: 0 };

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
    if (e.target.closest && e.target.closest("#upgrade-overlay, #overlay, #dash-btn")) return;
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
