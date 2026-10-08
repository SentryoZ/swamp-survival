// Transient visual effects: particles, gems, bolts, ground flashes. Owns
// `transientFx` cleanup semantics (shared resources are never disposed).
import * as THREE from "three";
import {
  scene,
  fxGroup,
  particles,
  gems,
  transientFx,
  sphereGeo,
  coneGeo,
  basicMat,
  gemMat,
  sharedMesh,
} from "./runtime.js";

export function removeFx(mesh) {
  if (mesh.parent) mesh.parent.remove(mesh);
  if (mesh.userData && mesh.userData.shared) return;
  if (mesh.geometry) mesh.geometry.dispose();
  if (mesh.material) {
    if (Array.isArray(mesh.material)) mesh.material.forEach((m) => m.dispose());
    else mesh.material.dispose();
  }
}

export function spawnGems(pos, count) {
  for (let i = 0; i < count; i++) {
    const gem = sharedMesh(coneGeo("gem"), gemMat());
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

const coinGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.06, 12);
const coinMat = new THREE.MeshStandardMaterial({
  color: 0xffd54f,
  emissive: 0xffb300,
  emissiveIntensity: 0.5,
  roughness: 0.4,
});

// Gold coins reuse the gem pickup/magnet pipeline (see combat.updateGems).
export function spawnCoins(pos, count, valueEach) {
  for (let i = 0; i < count; i++) {
    const c = sharedMesh(coinGeo, coinMat);
    c.rotation.x = Math.PI / 2;
    const offset = new THREE.Vector3(
      (Math.random() - 0.5) * 2,
      0.6,
      (Math.random() - 0.5) * 2
    );
    c.position.copy(pos).add(offset);
    scene.add(c);
    gems.push({ mesh: c, vel: new THREE.Vector3(0, 3, 0), magnet: false, gold: valueEach });
  }
}

export function spawnParticles(pos, color, count = 10) {
  const geo = sphereGeo(0.08, 6);
  const mat = basicMat(color);
  for (let i = 0; i < count; i++) {
    const p = sharedMesh(geo, mat);
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

export function boltLine(from, to, color) {
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

export function groundFlash(x, z, color, radius) {
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

export function updateFx(dt) {
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
