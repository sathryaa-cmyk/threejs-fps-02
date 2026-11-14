// Shared body physics: one AABB mover used by the player and by every bot, so
// both collide with the map the same way. A body is a position (feet), a
// velocity, a height and a radius; movement resolves one axis at a time against
// the world's Box3 colliders, and the floor is y = 0. No allocations in the
// hot path: the probe box is reused.
import * as THREE from 'three';

const RADIUS = 0.34;
export const GRAVITY = 20;

export function createMover(colliders) {
  const probe = new THREE.Box3();

  function overlaps(x, y, z, height, lift) {
    probe.min.set(x - RADIUS, y + lift, z - RADIUS);
    probe.max.set(x + RADIUS, y + height - lift, z + RADIUS);
    for (const collider of colliders) {
      if (probe.intersectsBox(collider)) return collider;
    }
    return null;
  }

  // Move a body by its velocity for dt. Returns whether it stands on something.
  function move(body, dt) {
    const nextX = body.position.x + body.velocity.x * dt;
    if (!overlaps(nextX, body.position.y, body.position.z, body.height, 0.04)) {
      body.position.x = nextX;
    } else {
      body.velocity.x = 0;
    }
    const nextZ = body.position.z + body.velocity.z * dt;
    if (!overlaps(body.position.x, body.position.y, nextZ, body.height, 0.04)) {
      body.position.z = nextZ;
    } else {
      body.velocity.z = 0;
    }
    body.position.y += body.velocity.y * dt;
    let onGround = false;
    const hit = overlaps(body.position.x, body.position.y, body.position.z, body.height, 0);
    if (hit && body.velocity.y <= 0) {
      body.position.y = hit.max.y;
      body.velocity.y = 0;
      onGround = true;
    } else if (hit) {
      body.position.y = hit.min.y - body.height;
      body.velocity.y = 0;
    }
    if (body.position.y < 0) {
      body.position.y = 0;
      body.velocity.y = 0;
      onGround = true;
    }
    return onGround;
  }

  // Line of sight: true when no world box stands between `from` and `to`.
  // `raycaster` and `scratch` are caller-owned temporaries, reused every call.
  function hasLineOfSight(from, to, shootables, raycaster, direction, maxDistance) {
    direction.copy(to).sub(from);
    const distance = direction.length();
    if (distance > maxDistance) return false;
    direction.normalize();
    raycaster.set(from, direction);
    raycaster.far = distance;
    return raycaster.intersectObjects(shootables, false).length === 0;
  }

  return { move, overlaps, hasLineOfSight };
}
