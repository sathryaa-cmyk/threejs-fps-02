// Ember Yard: an original dusk industrial yard, 44 x 36 m, built from boxes.
// Three lanes run north from the Ember spawn (south) to the Ash spawn (north):
// west lane to Site A (the fuel depot), mid lane past the crane gantry, east
// lane to Site B (the container stacks). Every box is a collider for bodies
// and a surface bullets stop on. The floor is a procedural canvas texture —
// asphalt, painted lane lines and hazard stripes at the sites — so the map
// needs no image asset.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const SITES = [
  { id: 'A', name: 'Site A — Fuel Depot', x: -15, z: -11, radius: 4.2 },
  { id: 'B', name: 'Site B — Container Stacks', x: 15, z: -11, radius: 4.2 },
];
export const EMBER_SPAWNS = [
  { x: -6, z: 14, yaw: 0 }, { x: -2, z: 15, yaw: 0 },
  { x: 2, z: 15, yaw: 0 }, { x: 6, z: 14, yaw: 0 },
];
export const ASH_SPAWNS = [
  { x: -6, z: -14, yaw: Math.PI }, { x: -2, z: -15, yaw: Math.PI },
  { x: 2, z: -15, yaw: Math.PI }, { x: 6, z: -14, yaw: Math.PI },
];

// Waypoint graph bots route through: spawns, lane junctions, site entries.
const WAYPOINTS = [
  { id: 0, x: 0, z: 15, links: [1, 2, 3] },
  { id: 1, x: -11, z: 12, links: [0, 4, 5] },
  { id: 2, x: 0, z: 8, links: [0, 5, 6] },
  { id: 3, x: 11, z: 12, links: [0, 6, 7] },
  { id: 4, x: -16, z: 4, links: [1, 8, 9] },
  { id: 5, x: -6, z: 2, links: [1, 2, 4, 9, 10] },
  { id: 6, x: 6, z: 2, links: [2, 3, 7, 10, 11] },
  { id: 7, x: 16, z: 4, links: [3, 6, 11] },
  { id: 8, x: -17, z: -6, links: [4, 12] },
  { id: 9, x: -8, z: -6, links: [4, 5, 10, 12, 13] },
  { id: 10, x: 0, z: -4, links: [5, 6, 9, 11, 13] },
  { id: 11, x: 8, z: -6, links: [6, 7, 10, 13, 14] },
  { id: 12, x: -15, z: -11, links: [8, 9] },
  { id: 13, x: 0, z: -12, links: [9, 10, 11] },
  { id: 14, x: 15, z: -11, links: [11, 13] },
  { id: 15, x: 0, z: -15, links: [13] },
];

function floorTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#2e333b';
  ctx.fillRect(0, 0, 512, 512);
  // Asphalt speckle.
  for (let i = 0; i < 2600; i += 1) {
    const v = 28 + Math.floor(Math.random() * 22);
    ctx.fillStyle = `rgb(${v},${v + 3},${v + 6})`;
    ctx.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
  }
  // Painted lane lines.
  ctx.strokeStyle = 'rgba(240,168,48,0.55)';
  ctx.lineWidth = 4;
  ctx.setLineDash([26, 18]);
  ctx.beginPath(); ctx.moveTo(256, 20); ctx.lineTo(256, 492); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(20, 256); ctx.lineTo(492, 256); ctx.stroke();
  ctx.setLineDash([]);
  // Hazard stripes at the two sites.
  for (const [cx, cy] of [[64, 64], [448, 64]]) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.PI / 4);
    for (let i = -6; i < 6; i += 1) {
      ctx.fillStyle = i % 2 === 0 ? '#f0a830' : '#161a20';
      ctx.fillRect(i * 14, -46, 14, 92);
    }
    ctx.restore();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const colliders = [];
  const shootables = [];

  const mats = {};
  for (const name of Object.keys(PALETTE)) {
    mats[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.55 : 0.92,
      metalness: 0.03,
    });
  }
  // Container paint: rust red and teal, two extra materials for the yard's
  // stacked boxes so the map reads at a glance.
  const rust = new THREE.MeshStandardMaterial({ color: 0x8a4a32, roughness: 0.8, metalness: 0.15 });
  const teal = new THREE.MeshStandardMaterial({ color: 0x2f6f6a, roughness: 0.75, metalness: 0.2 });

  function box(width, height, depth, x, y, z, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  // Floor with the procedural texture (not a collider box: the floor is y=0).
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(44, 36),
    new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.95, metalness: 0.02 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);
  shootables.push(floor);

  // Perimeter walls, 5 m high, open to the dusk sky.
  box(44.8, 5, 0.6, 0, 2.5, -18.3, mats.surface);
  box(44.8, 5, 0.6, 0, 2.5, 18.3, mats.surface);
  box(0.6, 5, 36.6, -22.3, 2.5, 0, mats.surface);
  box(0.6, 5, 36.6, 22.3, 2.5, 0, mats.surface);

  // Site A — fuel depot (west): tanks, a low platform, a pillar.
  box(3.2, 2.6, 3.2, -19, 1.3, -13, rust);
  box(2.2, 2.2, 2.2, -14.5, 1.1, -14.5, teal);
  box(5, 0.5, 3.4, -15, 0.25, -9.5, mats.surface);
  box(1.2, 3.4, 1.2, -11, 1.7, -13.5, mats.hairline);
  box(1.6, 0.8, 1.6, -18.5, 0.4, -7, mats.hairline);

  // Site B — container stacks (east): two stacked containers, crates.
  box(6, 2.6, 2.6, 18.5, 1.3, -13, teal);
  box(6, 2.6, 2.6, 18.5, 3.9, -13, rust);
  box(2.4, 1.2, 2.4, 13.5, 0.6, -14, mats.hairline);
  box(1.6, 0.8, 1.6, 12, 0.4, -8, mats.hairline);
  box(1.2, 3.4, 1.2, 11, 1.7, -13.5, mats.hairline);

  // Mid: crane gantry legs and a central pillar split the lane in two.
  box(1.2, 4.4, 1.2, -3.4, 2.2, -2, mats.hairline);
  box(1.2, 4.4, 1.2, 3.4, 2.2, -2, mats.hairline);
  box(8, 0.7, 1.2, 0, 4.4, -2, mats.accent);
  box(1.4, 3.2, 1.4, 0, 1.6, 6, mats.hairline);

  // Lane cover: crates to crouch behind, low walls to peek over.
  box(3.6, 1.1, 1.2, -8, 0.55, 6, mats.hairline);
  box(1.2, 1.1, 3.6, 8, 0.55, 6, mats.hairline);
  box(1.6, 0.7, 1.6, -12, 0.35, -2, mats.hairline);
  box(1.6, 0.7, 1.6, 12, 0.35, -2, mats.hairline);
  box(2.4, 0.9, 1.2, -5, 0.45, 11, mats.hairline);
  box(2.4, 0.9, 1.2, 5, 0.45, 11, mats.hairline);
  box(2, 1.6, 2, -19.5, 0.8, 6, rust);
  box(2, 1.6, 2, 19.5, 0.8, 6, teal);

  // Site markers: flat glowing rings on the floor so a site reads at a glance.
  for (const site of SITES) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(site.radius - 0.25, site.radius, 40),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(site.x, 0.02, site.z);
    group.add(ring);
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 0.55),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
    );
    label.position.set(site.x, 3.6, site.z);
    label.rotation.y = Math.PI;
    group.add(label);
  }

  // Light: low dusk sun from the west, cool fill from the east, sky gradient.
  const sky = new THREE.HemisphereLight(new THREE.Color('#4a5f74'), new THREE.Color(PALETTE.canvas), 1.6);
  scene.add(sky);
  const key = new THREE.DirectionalLight(new THREE.Color('#ffb35c'), 3.2);
  key.position.set(-18, 16, 10);
  key.target.position.set(0, 0, -4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -26;
  key.shadow.camera.right = 26;
  key.shadow.camera.top = 26;
  key.shadow.camera.bottom = -26;
  key.shadow.camera.far = 70;
  key.shadow.bias = -0.0006;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#6f9aa8'), 1.0);
  fill.position.set(14, 10, 12);
  scene.add(fill);

  // Breadth-first route between waypoints; returns an array of waypoint ids.
  function route(fromId, toId) {
    if (fromId === toId) return [toId];
    const prev = new Map([[fromId, -1]]);
    const queue = [fromId];
    while (queue.length > 0) {
      const current = queue.shift();
      for (const next of WAYPOINTS[current].links) {
        if (prev.has(next)) continue;
        prev.set(next, current);
        if (next === toId) {
          const path = [toId];
          let step = toId;
          while (prev.get(step) !== -1) {
            step = prev.get(step);
            path.unshift(step);
          }
          return path;
        }
        queue.push(next);
      }
    }
    return [toId];
  }

  function nearestWaypoint(x, z) {
    let best = 0;
    let bestDist = Infinity;
    for (const point of WAYPOINTS) {
      const d = (point.x - x) ** 2 + (point.z - z) ** 2;
      if (d < bestDist) {
        bestDist = d;
        best = point.id;
      }
    }
    return best;
  }

  return {
    colliders, shootables, group, route, nearestWaypoint,
    waypoints: WAYPOINTS,
    siteAt(x, z) {
      for (const site of SITES) {
        const dx = x - site.x;
        const dz = z - site.z;
        if (dx * dx + dz * dz <= site.radius * site.radius) return site;
      }
      return null;
    },
  };
}
