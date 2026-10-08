import * as THREE from "three";
import { WORLD_SIZE } from "./config.js";

export function createWorld(biome) {
  const group = new THREE.Group();

  const groundGeo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE);
  const groundMat = new THREE.MeshStandardMaterial({
    color: biome.ground,
    roughness: 1,
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  const grid = new THREE.GridHelper(WORLD_SIZE, 40, biome.grid, biome.grid);
  grid.position.y = 0.02;
  group.add(grid);

  const borderMat = new THREE.MeshStandardMaterial({ color: biome.border });
  const borderGeo = new THREE.BoxGeometry(2, 3, WORLD_SIZE);
  const half = WORLD_SIZE / 2;
  const borders = [
    { pos: [-half, 1.5, 0], rot: [0, 0, 0] },
    { pos: [half, 1.5, 0], rot: [0, 0, 0] },
    { pos: [0, 1.5, -half], rot: [0, Math.PI / 2, 0] },
    { pos: [0, 1.5, half], rot: [0, Math.PI / 2, 0] },
  ];
  for (const b of borders) {
    const wall = new THREE.Mesh(borderGeo, borderMat);
    wall.position.set(...b.pos);
    wall.rotation.y = b.rot[1];
    wall.castShadow = true;
    wall.receiveShadow = true;
    group.add(wall);
  }

  const obstacles = [];
  const rockMat = new THREE.MeshStandardMaterial({
    color: biome.rock,
    roughness: 0.9,
    flatShading: true,
  });

  let seed = 1337;
  for (const ch of biome.id) seed = (seed * 31 + ch.charCodeAt(0)) | 0;
  const rand = mulberry32(seed);
  const count = biome.rocks;
  for (let i = 0; i < count; i++) {
    const radius = 0.6 + rand() * 1.6;
    const h = radius * (0.7 + rand() * 0.6);
    const rockGeo = new THREE.CylinderGeometry(radius * 0.6, radius, h, 6);
    const rock = new THREE.Mesh(rockGeo, rockMat);
    const margin = 6;
    const x = (rand() * 2 - 1) * (half - margin);
    const z = (rand() * 2 - 1) * (half - margin);
    if (Math.hypot(x, z) < 10) continue;
    rock.position.set(x, h / 2, z);
    rock.rotation.y = rand() * Math.PI;
    rock.castShadow = true;
    rock.receiveShadow = true;
    group.add(rock);
    obstacles.push({
      mesh: rock,
      radius: radius * 0.9,
    });
  }

  const treeMatTrunk = new THREE.MeshStandardMaterial({ color: biome.trunk });
  const treeMatLeaf = new THREE.MeshStandardMaterial({ color: biome.leaf });
  const treeCount = biome.trees;
  for (let i = 0; i < treeCount; i++) {
    const x = (rand() * 2 - 1) * (half - 4);
    const z = (rand() * 2 - 1) * (half - 4);
    if (Math.hypot(x, z) < 8) continue;
    const h = 1.2 + rand() * 0.8;
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.25, h, 6),
      treeMatTrunk
    );
    trunk.position.set(x, h / 2, z);
    trunk.castShadow = true;
    const leaf = new THREE.Mesh(
      new THREE.SphereGeometry(0.7 + rand() * 0.5, 8, 6),
      treeMatLeaf
    );
    leaf.position.set(x, h + 0.4, z);
    leaf.castShadow = true;
    group.add(trunk, leaf);
    obstacles.push({ mesh: trunk, radius: 0.5 });
  }

  return { group, obstacles };
}

// Free the geometries/materials of a scene group (called when swapping biomes).
export function disposeWorld(group) {
  const mats = new Set();
  group.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) mats.add(o.material);
  });
  for (const m of mats) m.dispose();
}

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
