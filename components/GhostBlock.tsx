"use client";
import * as THREE from "three";
import React from "react";
import { useFrame } from "@react-three/fiber";

export function GhostBlock({
  getPlacePreview,
  occupied,
}: {
  getPlacePreview: () => { x: number; y: number; z: number } | null;
  occupied: (x: number, y: number, z: number) => boolean;
}) {
  const meshRef = React.useRef<THREE.Mesh>(null);
  const matRef = React.useRef<THREE.MeshStandardMaterial>(null);

  useFrame(() => {
    const mesh = meshRef.current;
    const mat = matRef.current;
    if (!mesh || !mat) return;

    const p = getPlacePreview();
    if (!p) { mesh.visible = false; return; }

    mesh.visible = true;
    mesh.position.set(p.x, p.y, p.z);
    const blocked = occupied(p.x, p.y, p.z);
    mat.color.set(blocked ? "#ef4444" : "#22c55e");
  });

  return (
    <mesh ref={meshRef} visible={false}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial ref={matRef} transparent opacity={0.35} depthWrite={false} />
    </mesh>
  );
}
