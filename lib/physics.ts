import * as THREE from "three";

export function resolveSphereAABB(
  pos: THREE.Vector3,
  vel: THREE.Vector3,
  r: number,
  box: { min: THREE.Vector3; max: THREE.Vector3 }
) {
  const closest = new THREE.Vector3(
    THREE.MathUtils.clamp(pos.x, box.min.x, box.max.x),
    THREE.MathUtils.clamp(pos.y, box.min.y, box.max.y),
    THREE.MathUtils.clamp(pos.z, box.min.z, box.max.z)
  );
  const delta = pos.clone().sub(closest);
  const d2 = delta.lengthSq();
  if (d2 <= r * r) {
    const d = Math.sqrt(Math.max(d2, 1e-8));
    const n = delta.multiplyScalar(1 / d);
    const overlap = (r - d) + 1e-3;
    pos.addScaledVector(n, overlap);
    const vn = vel.dot(n);
    if (vn < 0) vel.addScaledVector(n, -vn * 1.2);
  }
}

export function resolveSphereSphere(
  selfPos: THREE.Vector3,
  selfVel: THREE.Vector3,
  rSelf: number,
  otherPos: THREE.Vector3,
  rOther: number
) {
  const delta = selfPos.clone().sub(otherPos);
  const r = rSelf + rOther;
  const dist2 = delta.lengthSq();
  if (dist2 < r * r) {
    const d = Math.sqrt(Math.max(dist2, 1e-8));
    const n = delta.multiplyScalar(1 / d);
    const overlap = (r - d) + 1e-3;
    selfPos.addScaledVector(n, overlap);
    const vn = selfVel.dot(n);
    if (vn < 0) selfVel.addScaledVector(n, -vn * 1.2);
  }
}
