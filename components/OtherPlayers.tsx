"use client";
import React from "react";
import { PresenceMeta } from "@/lib/types";

export function OtherPlayers({ peers, selfId }: { peers: Record<string, PresenceMeta>; selfId: string }) {
  return (
    <group>
      {Object.values(peers).filter(o => o.id !== selfId).map((o) => (
        <mesh key={o.id} position={[o.x, o.y, o.z]}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color={o.color} metalness={0.1} roughness={0.4} opacity={0.9} transparent />
        </mesh>
      ))}
    </group>
  );
}
