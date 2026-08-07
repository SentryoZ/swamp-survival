import * as THREE from "three";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";

const cache = new Map();

const ACTION_NAMES = {
  walk: ["walk", "sprint"],
  death: ["death"],
  idle: ["idle", "sleep"],
  fire: ["fire", "attack"],
};

const degToRad = THREE.MathUtils.degToRad;

export function modelState(url) {
  if (cache.has(url)) return cache.get(url) === null ? "failed" : "ready";
  return "loading";
}

async function loadTextures(bbmodel) {
  const textureLoader = new THREE.TextureLoader();
  textureLoader.minFilter = THREE.NearestFilter;
  textureLoader.magFilter = THREE.NearestFilter;
  const textures = [];
  for (const t of bbmodel.textures || []) {
    const url = t.source || t.relative_path;
    let tex;
    try {
      tex = await textureLoader.loadAsync(url);
    } catch (err) {
      console.warn("[models] texture load failed:", url?.slice?.(0, 40), err?.message || err);
      tex = new THREE.Texture();
    }
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.userData = {
      width: t.width || t.uv_width || bbmodel.resolution?.width || 16,
      height: t.height || t.uv_height || bbmodel.resolution?.height || 16,
      uvHeight: t.uv_height || t.height || bbmodel.resolution?.height || 16,
    };
    textures.push(tex);
  }
  return textures;
}

function buildScene(bbmodel, textures) {
  const elementObjects = {};

  const sharedMaterial = new THREE.MeshLambertMaterial({
    map: textures[0] || null,
    transparent: true,
    alphaTest: 0.5,
  });

  (bbmodel.elements || []).forEach((element) => {
    const { from, to, faces, origin, rotation, uuid, visibility } = element;
    const w = to[0] - from[0];
    const h = to[1] - from[1];
    const d = to[2] - from[2];

    const geometry = new THREE.BoxGeometry(w, h, d);
    const srcIndex = geometry.getIndex();
    const indices = [];
    const faceOrder = ["east", "west", "up", "down", "south", "north"];

    faceOrder.forEach((faceName, fi) => {
      const face = faces?.[faceName];
      const vo = fi * 4;
      if (face) {
        const texIndex = face.texture !== undefined ? face.texture : 0;
        const texture = textures[texIndex] || textures[0] || null;
        const texWidth = texture ? texture.userData.width : 16;
        const texHeight = texture ? texture.userData.uvHeight : 16;

        const uvs = face.uv || [0, 0, 0, 0];
        const u0 = uvs[0] / texWidth;
        const v0 = 1 - uvs[1] / texHeight;
        const u1 = uvs[2] / texWidth;
        const v1 = 1 - uvs[3] / texHeight;

        let corners = [
          new THREE.Vector2(u0, v0),
          new THREE.Vector2(u1, v0),
          new THREE.Vector2(u0, v1),
          new THREE.Vector2(u1, v1),
        ];
        if (face.rotation) {
          const steps = face.rotation / 90;
          for (let i = 0; i < steps; i++) {
            const [c0, c1, c2, c3] = corners;
            corners = [c2, c0, c3, c1];
          }
        }

        geometry.attributes.uv.setXY(vo + 0, corners[0].x, corners[0].y);
        geometry.attributes.uv.setXY(vo + 1, corners[1].x, corners[1].y);
        geometry.attributes.uv.setXY(vo + 2, corners[2].x, corners[2].y);
        geometry.attributes.uv.setXY(vo + 3, corners[3].x, corners[3].y);
        if (srcIndex) {
          for (let o = 0; o < 6; o++) indices.push(srcIndex.getX(fi * 6 + o));
        }
      }
    });
    if (srcIndex) geometry.setIndex(indices);

    const texture = textures[0] || null;
    const mesh = new THREE.Mesh(geometry, sharedMaterial);
    if (visibility === false) mesh.visible = false;

    const center = new THREE.Vector3(from[0] + w / 2, from[1] + h / 2, from[2] + d / 2);

    let object;
    if (rotation) {
      const pivot = new THREE.Group();
      const pivotOrigin = new THREE.Vector3(origin[0], origin[1], origin[2]);
      pivot.userData.globalPosition = pivotOrigin.clone();
      mesh.position.copy(center).sub(pivotOrigin);
      pivot.rotation.set(
        degToRad(rotation[0] || 0),
        degToRad(rotation[1] || 0),
        degToRad(rotation[2] || 0)
      );
      pivot.add(mesh);
      object = pivot;
    } else {
      mesh.userData.globalPosition = center.clone();
      object = mesh;
    }
    if (uuid) object.uuid = uuid;
    elementObjects[uuid] = object;
  });

  const rootGroup = new THREE.Group();
  const bones = {};
  const boneRestPositions = {};
  const groupMap = {};
  (bbmodel.groups || []).forEach((g) => {
    groupMap[g.uuid] = g;
  });

  const processNode = (outlinerNode, parentGlobalOrigin, parentGroup) => {
    const groupData = groupMap[outlinerNode.uuid];
    if (!groupData || !groupData.origin) return;

    const bone = new THREE.Group();
    bone.name = groupData.name;
    bone.uuid = groupData.uuid;
    bones[groupData.uuid] = bone;

    const nodeOrigin = new THREE.Vector3(
      groupData.origin[0],
      groupData.origin[1],
      groupData.origin[2]
    );
    const localPos = nodeOrigin.clone().sub(parentGlobalOrigin);
    bone.position.copy(localPos);
    boneRestPositions[groupData.uuid] = localPos.clone();

    if (groupData.rotation) {
      bone.rotation.set(
        degToRad(groupData.rotation[0] || 0),
        degToRad(groupData.rotation[1] || 0),
        degToRad(groupData.rotation[2] || 0)
      );
    }

    parentGroup.add(bone);

    if (outlinerNode.children) {
      outlinerNode.children.forEach((child) => {
        if (typeof child === "string") {
          const elem = elementObjects[child];
          if (elem) {
            const elemLocalPos = elem.userData.globalPosition.clone().sub(nodeOrigin);
            elem.position.copy(elemLocalPos);
            bone.add(elem);
          }
        } else {
          processNode(child, nodeOrigin, bone);
        }
      });
    }
  };

  const worldOrigin = new THREE.Vector3(0, 0, 0);
  if (bbmodel.outliner) {
    bbmodel.outliner.forEach((node) => {
      if (typeof node === "string") {
        const elem = elementObjects[node];
        if (elem) {
          elem.position.copy(elem.userData.globalPosition.clone().sub(worldOrigin));
          rootGroup.add(elem);
        }
      } else {
        processNode(node, worldOrigin, rootGroup);
      }
    });
  } else {
    Object.values(elementObjects).forEach((elem) => {
      rootGroup.add(elem);
    });
  }

  const clips = [];
  (bbmodel.animations || []).forEach((animData) => {
    const tracks = [];
    Object.entries(animData.animators || {}).forEach(([targetUUID, animator]) => {
      const bone = bones[targetUUID] || elementObjects[targetUUID];
      if (!bone || !animator.keyframes) return;

      const rotTimes = [];
      const rotValues = [];
      const posTimes = [];
      const posValues = [];

      const keyframes = [...animator.keyframes].sort((a, b) => a.time - b.time);
      keyframes.forEach((kf) => {
        const dp = kf.data_points?.[0];
        if (!dp) return;
        if (kf.channel === "rotation") {
          rotTimes.push(kf.time);
          const q = new THREE.Quaternion().setFromEuler(
            new THREE.Euler(
              degToRad(parseFloat(dp.x)),
              degToRad(parseFloat(dp.y)),
              degToRad(parseFloat(dp.z)),
              "XYZ"
            )
          );
          rotValues.push(q.x, q.y, q.z, q.w);
        } else if (kf.channel === "position") {
          posTimes.push(kf.time);
          const rest = boneRestPositions[targetUUID] || new THREE.Vector3(0, 0, 0);
          posValues.push(
            rest.x + parseFloat(dp.x),
            rest.y + parseFloat(dp.y),
            rest.z + parseFloat(dp.z)
          );
        }
      });

      if (rotTimes.length > 0) {
        tracks.push(
          new THREE.QuaternionKeyframeTrack(`${bone.uuid}.quaternion`, rotTimes, rotValues)
        );
      }
      if (posTimes.length > 0) {
        tracks.push(
          new THREE.VectorKeyframeTrack(`${bone.uuid}.position`, posTimes, posValues)
        );
      }
    });

    if (tracks.length > 0) {
      clips.push(new THREE.AnimationClip(animData.name, animData.length, tracks));
    }
  });

  return { scene: rootGroup, clips };
}

async function loadModel(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load model: ${url}`);
  const bbmodel = await response.json();

  const textures = await loadTextures(bbmodel);
  const { scene, clips } = buildScene(bbmodel, textures);

  const box = new THREE.Box3().setFromObject(scene);
  const nativeHeight = Math.max(box.max.y - box.min.y, 0.01);

  scene.position.y = -box.min.y;

  return { scene, clips, nativeHeight };
}

export async function preloadModel(url) {
  if (cache.has(url)) return cache.get(url);
  try {
    const model = await loadModel(url);
    cache.set(url, model);
    return model;
  } catch (err) {
    cache.set(url, null);
    console.warn(`[models] failed to load ${url}:`, err?.message || err);
    return null;
  }
}

function remapClips(model, scene) {
  const uuidMap = new Map();
  const stack = [[model.scene, scene]];
  while (stack.length) {
    const [a, b] = stack.pop();
    if (a && b) {
      uuidMap.set(a.uuid, b.uuid);
      for (let i = 0; i < a.children.length; i++) {
        stack.push([a.children[i], b.children[i]]);
      }
    }
  }
  return model.clips.map((clip) => {
    const tracks = clip.tracks.map((track) => {
      const dot = track.name.indexOf(".");
      const oldUuid = track.name.slice(0, dot);
      const suffix = track.name.slice(dot);
      const newUuid = uuidMap.get(oldUuid);
      if (!newUuid || newUuid === oldUuid) return track;
      const t = track.clone();
      t.name = newUuid + suffix;
      return t;
    });
    return new THREE.AnimationClip(clip.name, clip.duration, tracks);
  });
}

export function createEnemyModel(url, { targetHeight = 1, facing = Math.PI } = {}) {
  const model = cache.get(url);
  if (!model) return null;

  const scale = targetHeight / model.nativeHeight;
  const scene = cloneSkeleton(model.scene);
  scene.scale.setScalar(scale);
  scene.rotation.y = facing;
  scene.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });

  const mixer = new THREE.AnimationMixer(scene);
  const clips = remapClips(model, scene);
  const state = { current: null };

  const byName = (kind) => {
    const names = ACTION_NAMES[kind] || [];
    for (const n of names) {
      const clip = clips.find((c) => c.name.toLowerCase().includes(n));
      if (clip) return clip;
    }
    return clips[0];
  };

  const walkClip = byName("walk");
  if (walkClip) {
    const action = mixer.clipAction(walkClip);
    action.play();
    action.timeScale = 1.2;
    state.current = action;
  }

  return {
    group: scene,
    mixer,
    model,
    play(kind, timeScale = 1) {
      const clip = byName(kind);
      if (!clip) return null;
      if (state.current) state.current.stop();
      const action = mixer.clipAction(clip);
      action.reset();
      action.play();
      action.timeScale = timeScale;
      state.current = action;
      return action;
    },
  };
}
