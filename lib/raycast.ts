import * as THREE from "three";

export function rayAABB(
  origin: THREE.Vector3, dir: THREE.Vector3,
  min: THREE.Vector3, max: THREE.Vector3
) {
  const inv = new THREE.Vector3(1/dir.x, 1/dir.y, 1/dir.z);
  const tx1 = (min.x - origin.x) * inv.x, tx2 = (max.x - origin.x) * inv.x;
  const ty1 = (min.y - origin.y) * inv.y, ty2 = (max.y - origin.y) * inv.y;
  const tz1 = (min.z - origin.z) * inv.z, tz2 = (max.z - origin.z) * inv.z;
  const tmin = Math.max(Math.min(tx1, tx2), Math.max(Math.min(ty1, ty2), Math.min(tz1, tz2)));
  const tmax = Math.min(Math.max(tx1, tx2), Math.min(Math.max(ty1, ty2), Math.max(tz1, tz2)));
  if (tmax < 0 || tmin > tmax) return null;
  const t = tmin >= 0 ? tmin : tmax;
  const hit = origin.clone().addScaledVector(dir, t);
  const eps = 1e-3;
  let normal: [number,number,number] = [0,0,0];
  if (Math.abs(hit.x - min.x) < eps) normal = [-1,0,0]; else if (Math.abs(hit.x - max.x) < eps) normal = [1,0,0];
  else if (Math.abs(hit.y - min.y) < eps) normal = [0,-1,0]; else if (Math.abs(hit.y - max.y) < eps) normal = [0,1,0];
  else if (Math.abs(hit.z - min.z) < eps) normal = [0,0,-1]; else if (Math.abs(hit.z - max.z) < eps) normal = [0,0,1];
  return { t, hit, normal };
}

export function createVoxelRaycaster(occupied: (x:number,y:number,z:number)=>boolean) {
  return function raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist = 8) {
    const u0 = origin.x + 0.5, v0 = origin.y, w0 = origin.z + 0.5;
    const du = dir.x, dv = dir.y, dw = dir.z;
    let i = Math.floor(u0), j = Math.floor(v0), k = Math.floor(w0);
    const stepU = du > 0 ? 1 : du < 0 ? -1 : 0;
    const stepV = dv > 0 ? 1 : dv < 0 ? -1 : 0;
    const stepW = dw > 0 ? 1 : dw < 0 ? -1 : 0;
    const tDeltaU = stepU !== 0 ? Math.abs(1 / du) : Infinity;
    const tDeltaV = stepV !== 0 ? Math.abs(1 / dv) : Infinity;
    const tDeltaW = stepW !== 0 ? Math.abs(1 / dw) : Infinity;
    const nextU = i + (stepU > 0 ? 1 : 0);
    const nextV = j + (stepV > 0 ? 1 : 0);
    const nextW = k + (stepW > 0 ? 1 : 0);
    let tMaxU = stepU !== 0 ? (nextU - u0) / du : Infinity;
    let tMaxV = stepV !== 0 ? (nextV - v0) / dv : Infinity;
    let tMaxW = stepW !== 0 ? (nextW - w0) / dw : Infinity;

    let t = 0;
    let hitNormal: [number,number,number] = [0,0,0];
    while (t <= maxDist) {
      const cx = i; const cy = j + 0.5; const cz = k;
      if (occupied(cx, cy, cz)) return { cell: { x: cx, y: cy, z: cz }, normal: hitNormal, t };
      if (tMaxU < tMaxV && tMaxU < tMaxW) { i += stepU; t = tMaxU; tMaxU += tDeltaU; hitNormal = [-stepU,0,0]; }
      else if (tMaxV < tMaxW)          { j += stepV; t = tMaxV; tMaxV += tDeltaV; hitNormal = [0,-stepV,0]; }
      else                              { k += stepW; t = tMaxW; tMaxW += tDeltaW; hitNormal = [0,0,-stepW]; }
    }
    return null;
  };
}
