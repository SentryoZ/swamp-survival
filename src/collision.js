// Circle vs. obstacle / circle helpers, shared by player, enemies, projectiles.
import { world } from "./runtime.js";

export function circleVsObstacles(x, z, radius, ignore = null) {
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

export function moveWithObstacles(posX, posZ, vx, vz, radius, bias = 1) {
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

export function separateCircles(ax, az, ar, bx, bz, br) {
  const dx = ax - bx;
  const dz = az - bz;
  const d2 = dx * dx + dz * dz;
  const min = ar + br;
  if (d2 >= min * min) return null;
  const d = Math.max(Math.sqrt(d2), 0.0001);
  const overlap = min - d;
  return { nx: dx / d, nz: dz / d, overlap };
}
