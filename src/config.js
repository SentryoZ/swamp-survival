export const WORLD_SIZE = 160;

export const PLAYER = {
  radius: 0.5,
  speed: 9,
  maxHp: 100,
};

export const ENEMY_TYPES = {
  grunt: {
    radius: 0.9,
    height: 2.0,
    speed: 3.2,
    hp: 25,
    damage: 8,
    xp: 3,
    color: 0xc0392b,
    model: "/models/goblin_mini1.bbmodel",
  },
  runner: {
    radius: 0.75,
    height: 1.6,
    speed: 5.6,
    hp: 12,
    damage: 6,
    xp: 2,
    color: 0xe67e22,
    model: "/models/goblin_mini2.bbmodel",
  },
  brute: {
    radius: 1.3,
    height: 2.8,
    speed: 1.8,
    hp: 120,
    damage: 20,
    xp: 12,
    color: 0x8e44ad,
    model: "/models/goblin_mini3.bbmodel",
  },
  knight: {
    radius: 1.2,
    height: 2.6,
    speed: 2.2,
    hp: 160,
    damage: 25,
    xp: 18,
    color: 0x4a4a6a,
    model: "/models/goblin_knight.bbmodel",
  },
  leader: {
    radius: 1.0,
    height: 2.2,
    speed: 3.8,
    hp: 60,
    damage: 12,
    xp: 10,
    color: 0xd4a017,
    model: "/models/goblin_leader.bbmodel",
  },
  mage: {
    radius: 1.0,
    height: 2.4,
    speed: 3.0,
    hp: 55,
    damage: 10,
    xp: 15,
    color: 0x26c6da,
    model: "/models/goblin_mage.bbmodel",
    ranged: true,
    range: 16,
    fireInterval: 2.2,
    projectileSpeed: 12,
  },
};

export const GAME = {
  startHp: 100,
  startFireRate: 3,
  baseDamage: 12,
  projectileSpeed: 34,
  maxEnemies: 120,
  xpToLevel: (level) => 5 + (level - 1) * 5 + Math.floor((level - 1) ** 1.4),
};
