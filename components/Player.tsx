"use client";
import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { PresenceMeta } from "@/lib/types";
import { useKeys } from "@/lib/hooks";
import { resolveSphereAABB, resolveSphereSphere } from "@/lib/physics";

export function Player({
  running,
  peersRef,
  onPosUpdate,
  solidAt,
  grounded,
}: {
  running: boolean;
  peersRef: React.MutableRefObject<Record<string, PresenceMeta>>;
  onPosUpdate: (p: THREE.Vector3) => void;
  solidAt: (x:number,y:number,z:number) => boolean;
  grounded: (p: THREE.Vector3) => boolean;
}) {
  const radius = 0.5;
  const accel = 28;
  const maxSpeed = 8;
  const gravity = -24;
  const jumpVel = 7.5;
  const drag = 10;
const FLOOR_SNAP = 0.2;
  const MAX_FRAME = 0.05;    // 50ms clamp
  const SUBSTEP   = 1 / 180; // stable physics step
const groundFriction = 30; // strong friction on ground
const DEADZONE = 0.03;     // snap tiny speeds to 0

  const vel = useRef(new THREE.Vector3(0, 0, 0));
  const pos = useRef(new THREE.Vector3(0, 1.6, 0));
  const onGround = useRef(true);
  const { forward, backward, left, right, jump } = useKeys();
  const { camera } = useThree();

  const tmpDir = useRef(new THREE.Vector3());
  const tmpRight = useRef(new THREE.Vector3());

  useEffect(() => {
    pos.current.set(0, 1.6, 0);
    vel.current.set(0, 0, 0);
    onGround.current = true;
  }, []);
const trySnapToFloor = () => {
  if (vel.current.y > 0) return;            // only when falling/downward or resting
  const radius = 0.5;
  const footY = pos.current.y - radius;
  const yTop = Math.floor(footY + 1e-6);
  const cy = yTop - 0.5;

  const offsets: ReadonlyArray<readonly [number, number]> = [
    [0, 0],
    [ 0.35, 0], [-0.35, 0],
    [ 0, 0.35], [ 0, -0.35],
  ];

  let hasFloor = false;
  for (const [ox, oz] of offsets) {
    const gx = Math.round(pos.current.x + ox);
    const gz = Math.round(pos.current.z + oz);
    if (solidAt(gx, cy, gz)) { hasFloor = true; break; }
  }

  if (!hasFloor) return;

  const dist = footY - yTop; // negative/zero means penetrating/on surface
  if (dist <= FLOOR_SNAP && dist >= -0.3) {
    // Snap on top of the floor block and kill downward velocity
    pos.current.y = yTop + radius + 1e-4;
    vel.current.y = Math.max(vel.current.y, 0);
    onGround.current = true;
  }
};

  const stepPhysics = (dt: number) => {
    // Camera-aligned flat directions
    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    camDir.y = 0; if (camDir.lengthSq() < 1e-8) camDir.set(0, 0, -1); camDir.normalize();
    const rightDir = tmpRight.current.set(camDir.z, 0, -camDir.x).normalize();

    // Input accel
    const inDir = tmpDir.current.set(0, 0, 0);
    const inputActive = inDir.lengthSq() > 0;

    if (forward) inDir.add(camDir);
    if (backward) inDir.sub(camDir);
    if (right) inDir.add(rightDir);
    if (left) inDir.sub(rightDir);
    if (inDir.lengthSq() > 0) inDir.normalize();

    vel.current.x += inDir.x * accel * dt;
    vel.current.z += inDir.z * accel * dt;

    // Drag
    vel.current.x -= vel.current.x * drag * dt;
    vel.current.z -= vel.current.z * drag * dt;

    // Clamp horizontal
    const h2 = vel.current.x*vel.current.x + vel.current.z*vel.current.z;
    if (h2 > maxSpeed*maxSpeed) {
      const s = maxSpeed / Math.sqrt(h2);
      vel.current.x *= s; vel.current.z *= s;
    }

    // Gravity & jump
    if (!onGround.current) vel.current.y += gravity * dt;
    if (jump && onGround.current) { vel.current.y = jumpVel; onGround.current = false; }

    // Integrate
    pos.current.addScaledVector(vel.current, dt);

    // Collide with voxels
    const cx = Math.round(pos.current.x);
    const cz = Math.round(pos.current.z);
    const cy0 = Math.floor(pos.current.y) + 0.5;
    for (let dy = -3; dy <= 6; dy++) {
      const cy = cy0 + dy;
      for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) {
          const x = cx + dx, z = cz + dz;
          if (!solidAt(x, cy, z)) continue;
          const min = new THREE.Vector3(x-0.5, cy-0.5, z-0.5);
          const max = new THREE.Vector3(x+0.5, cy+0.5, z+0.5);
          resolveSphereAABB(pos.current, vel.current, radius, { min, max });
        }
      }
    }

    // Collide with other players
    for (const o of Object.values(peersRef.current)) {
      const otherPos = new THREE.Vector3(o.x, o.y, o.z);
      resolveSphereSphere(pos.current, vel.current, radius, otherPos, radius);
    }
      if (onGround.current && !inputActive) {
  vel.current.x -= vel.current.x * groundFriction * dt;
  vel.current.z -= vel.current.z * groundFriction * dt;
}
if (onGround.current && !inputActive) {
  if (Math.abs(vel.current.x) < DEADZONE) vel.current.x = 0;
  if (Math.abs(vel.current.z) < DEADZONE) vel.current.z = 0;
}
trySnapToFloor();

// Grounded check + kill tiny downward drift
onGround.current = grounded(pos.current);
if (onGround.current && vel.current.y < 0) vel.current.y = 0;
    // Camera follow
    camera.position.set(pos.current.x, pos.current.y + 0.6, pos.current.z);

    // Realtime
    onPosUpdate(pos.current);
  };

  useFrame((_, rawDt) => {
    if (!running) return;
    let dt = Math.min(rawDt, MAX_FRAME);
    vel.current.x -= vel.current.x * drag * dt;
vel.current.z -= vel.current.z * drag * dt;

    for (let t = 0; t < dt; t += SUBSTEP) {
      stepPhysics(Math.min(SUBSTEP, dt - t));
    }
    if (pos.current.y < -20) {
      pos.current.set(0, 1.6, 0);
      vel.current.set(0, 0, 0);
    }

  });

  return (
    <mesh position={pos.current.toArray()}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#3aa7ff" metalness={0.1} roughness={0.4} opacity={0.9} transparent />
    </mesh>
  );
}
