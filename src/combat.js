// Shared damage resolution, player healing, projectiles, pickups.
import * as THREE from "three";
import { GAME, CRATES, WAVES } from "./config.js";
import {
  scene,
  playerGroup,
  state,
  enemies,
  projectiles,
  gems,
  particles,
} from "./runtime.js";
import { removeFx, spawnParticles, spawnGems, spawnCoins } from "./fx.js";
import { emit, on } from "./events.js";
import { damageCrate, spawnCrateAt } from "./crates.js";
import { playSfx } from "./audio.js";
import { showDamage } from "./juice.js";

// Bomb power-up from crates: heavy damage + knockback in a radius.
on("bomb", (x, z, radius, damage) => {
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    if (e.dying > 0) continue;
    const dx = e.group.position.x - x;
    const dz = e.group.position.z - z;
    if (dx * dx + dz * dz < radius * radius) {
      const dir = new THREE.Vector3(dx, 0, dz).normalize();
      damageEnemy(e, damage, dir);
    }
  }
  spawnParticles(new THREE.Vector3(x, 0.8, z), 0xff7043, 24);
});

export function healPlayer(amount) {
  if (amount <= 0) return;
  state.hp = Math.min(state.maxHp, state.hp + amount);
}

export function gainLifesteal(amount) {
  if (state.mods.lifesteal > 0) healPlayer(amount * state.mods.lifesteal);
}

// Player damage that routes through the same hit/death signals as enemies.
// Dash i-frames make the player briefly untouchable.
export function damagePlayer(amount) {
  if (amount <= 0 || state.hp <= 0 || state.invuln > 0) return;
  state.hp -= amount;
  emit("hit");
  if (state.hp <= 0) {
    state.hp = 0;
    emit("death");
  }
}

// One place that resolves damage and death for every weapon + the main gun.
export function damageEnemy(e, amount, knock = null) {
  if (e.dying > 0) return;
  e.hp -= amount;
  if (knock) e.knockback.addScaledVector(knock, 20);
  gainLifesteal(amount);
  // Floating numbers for discrete hits only (skips DoT ticks); throttled per enemy.
  if (amount >= 4 && (!e.dmgAt || state.time - e.dmgAt > 0.12)) {
    e.dmgAt = state.time;
    showDamage(e.group.position.x, (e.type.height || 1.4) * 0.55, e.group.position.z, amount);
  }
  if (e.hp <= 0) {
    spawnParticles(e.group.position.clone().setY(1), e.type.color, e.boss ? 34 : 14);
    spawnGems(e.group.position.clone().setY(0.5), e.xp ?? e.type.xp);
    const gold = e.boss ? 30 : e.elite ? 6 : Math.random() < 0.5 ? 1 : 0;
    if (gold > 0) {
      const coins = e.boss ? 6 : e.elite ? 3 : 1;
      spawnCoins(e.group.position.clone().setY(0.5), coins, Math.max(1, Math.round(gold / coins)));
    }
    state.kills++;
    playSfx("kill");
    emit("kill", e.group.position.x, e.group.position.z);
    if (e.boss) {
      state.bossKills++;
      for (let n = 0; n < WAVES.bossCrateDrops; n++) {
        spawnCrateAt(
          e.group.position.x + (Math.random() - 0.5) * 4,
          e.group.position.z + (Math.random() - 0.5) * 4
        );
      }
    }
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

export function nearestEnemy(x, z, maxDist = Infinity, exclude = null) {
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

export function nearestEnemyExcept(x, z, maxDist, excludeSet) {
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

export function levelUp() {
  state.level++;
  healPlayer(state.maxHp * 0.1);
  spawnParticles(playerGroup.position.clone().setY(1), 0xffe082, 20);
  playSfx("levelup");
  state.pendingLevels++;
}

export function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.moved += p.vel.length() * dt;
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
        playSfx("hit");
        if (p.pierce > 0) {
          p.pierce--;
        } else {
          spent = true;
          break;
        }
      }
    }

    if (!spent) {
      for (let k = state.crates.length - 1; k >= 0; k--) {
        const c = state.crates[k];
        if (c.dead) continue;
        const dx = p.mesh.position.x - c.x;
        const dz = p.mesh.position.z - c.z;
        const rr = CRATES.radius + 0.25;
        if (dx * dx + dz * dz < rr * rr) {
          damageCrate(c, p.damage);
          if (p.pierce > 0) p.pierce--;
          else spent = true;
          break;
        }
      }
    }

    if (spent || p.moved >= p.range) {
      removeFx(p.mesh);
      projectiles.splice(i, 1);
    }
  }
}

export function updateGems(dt) {
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
        if (g.gold) {
          state.gold += g.gold;
        } else {
          state.xp += state.mods.xp;
          const need = GAME.xpToLevel(state.level);
          if (state.xp >= need) {
            state.xp -= need;
            levelUp();
          }
        }
        removeFx(g.mesh);
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

export function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    p.mesh.position.addScaledVector(p.vel, dt);
    p.vel.y -= 12 * dt;
    const s = Math.max(0.02, p.life);
    p.mesh.scale.setScalar(s);
    if (p.life <= 0) {
      removeFx(p.mesh);
      particles.splice(i, 1);
    }
  }
}
