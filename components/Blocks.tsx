"use client";
import * as THREE from "three";
import React, { useMemo } from "react";
import { Block } from "@/lib/types";

const MAT = {
  wood: new THREE.MeshStandardMaterial({ color: "#8d6e63" }),
  stone: new THREE.MeshStandardMaterial({ color: "#9e9e9e" }),
  brick: new THREE.MeshStandardMaterial({ color: "#b71c1c" }),
  glass: new THREE.MeshStandardMaterial({ color: "#90caf9", opacity: 0.6, transparent: true }),
  gold: new THREE.MeshStandardMaterial({ color: "#ffd54f" }),
  grass: new THREE.MeshStandardMaterial({ color: "#43a047" })
};

export function Blocks({ blocks }: { blocks: Block[] }) {
  const mats = useMemo(() => ([MAT.wood, MAT.stone, MAT.brick, MAT.glass, MAT.gold, MAT.grass]), []);
  return (
    <group>
      {blocks.map((b) => (
        <mesh key={b.id} position={[b.x, b.y, b.z]}>
          <boxGeometry args={[1,1,1]} />
          <primitive object={mats[(b.type-1)%mats.length]} attach="material" />
        </mesh>
      ))}
    </group>
  );
}
