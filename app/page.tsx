"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useThree } from "@react-three/fiber";
import { PointerLockControls } from "@react-three/drei";

import { Blocks } from "@/components/Blocks";
import { GhostBlock } from "@/components/GhostBlock";
import { OtherPlayers } from "@/components/OtherPlayers";
import { Player } from "@/components/Player";
import { Toolbox } from "@/components/Toolbox";

import { useSupabase, useRoom, useRealtime } from "@/lib/hooks";
import { buildStaticWorld } from "@/lib/world";
import { createVoxelRaycaster, rayAABB } from "@/lib/raycast";
import { Block, PresenceMeta } from "@/lib/types";

export default function Page() {
  const [playing, setPlaying] = useState(false);
  const [name] = useState<string>(() => `Player-${Math.random().toString(36).slice(2,6)}`);
  const [selectedSlot, setSelectedSlot] = useState(1);
  const room = useRoom();

  // Static world
  const staticWorld = useMemo(() => buildStaticWorld(), []);
  const [staticBlocks, setStaticBlocks] = useState<Block[]>(staticWorld.blocks);
  const staticIndexRef = useRef<Set<string>>(staticWorld.index);

  // Dynamic blocks (persisted)
  const [dynBlocks, setDynBlocks] = useState<Block[]>([]);
  const dynIndexRef = useRef<Map<string, number>>(new Map());
  const keyOf = (x:number,y:number,z:number) => `${x}|${y}|${z}`;
  const dynId = (x:number,y:number,z:number) => `${room}:${keyOf(x,y,z)}`;
  const isOccupied = (x:number,y:number,z:number) => staticIndexRef.current.has(keyOf(x,y,z)) || dynIndexRef.current.has(keyOf(x,y,z));

  const sb = useSupabase();

  useEffect(() => {
    if (!sb) return;
    let mounted = true;
    (async () => {
      const { data, error } = await sb.from("blocks").select("id,room,x,y,z,type").eq("room", room);
      if (!mounted) return;
      if (!error && data) {
        setDynBlocks(() => {
          const arr: Block[] = [];
          dynIndexRef.current.clear();
          for (const r of data) {
            const k = keyOf(r.x, r.y, r.z); dynIndexRef.current.set(k, arr.length);
            arr.push({ id: r.id, room: r.room, x: r.x, y: r.y, z: r.z, type: r.type });
          }
          return arr;
        });
      }
    })();

    const ch = sb.channel(`db:blocks:${room}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "blocks", filter: `room=eq.${room}` }, (payload: any) => {
        const r = payload.new as Block; const k = keyOf(r.x, r.y, r.z);
        setDynBlocks((arr) => { if (dynIndexRef.current.has(k)) return arr; const i = arr.length; dynIndexRef.current.set(k, i); return [...arr, r]; });
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "blocks", filter: `room=eq.${room}` }, (payload: any) => {
        const r = payload.old as Block; const k = keyOf(r.x, r.y, r.z);
        setDynBlocks((arr) => {
          const idx = dynIndexRef.current.get(k); if (idx == null) return arr;
          const copy = arr.slice(); const last = copy.pop()!;
          if (idx < copy.length + 1) { copy[idx] = last; dynIndexRef.current.set(keyOf(last.x,last.y,last.z), idx); }
          dynIndexRef.current.delete(k);
          return copy;
        });
      })
      .subscribe();

    return () => { mounted = false; sb.removeChannel(ch); };
  }, [sb, room]);

  // Place / Break
  const placeAt = async (x:number,y:number,z:number, type:number) => {
    if (isOccupied(x,y,z)) return;
    const id = dynId(x,y,z);
    const rec: Block = { id, room, x, y, z, type };
    setDynBlocks((arr) => { const i = arr.length; dynIndexRef.current.set(keyOf(x,y,z), i); return [...arr, rec]; });
    if (sb) await sb.from("blocks").upsert({ id, room, x, y, z, type });
  };
  const breakAt = async (x:number,y:number,z:number) => {
    const k = keyOf(x,y,z);
    if (dynIndexRef.current.has(k)) {
      setDynBlocks((arr) => {
        const idx = dynIndexRef.current.get(k)!;
        const copy = arr.slice(); const last = copy.pop()!;
        if (idx < copy.length + 1) { copy[idx] = last; dynIndexRef.current.set(keyOf(last.x,last.y,last.z), idx); }
        dynIndexRef.current.delete(k);
        return copy;
      });
      if (sb) await sb.from("blocks").delete().eq("id", dynId(x,y,z));
      return;
    }
    if (staticIndexRef.current.has(k)) {
      setStaticBlocks((arr) => {
        const idx = arr.findIndex(b=>keyOf(b.x,b.y,b.z)===k);
        if (idx === -1) return arr;
        const copy = arr.slice(); copy.splice(idx,1);
        staticIndexRef.current.delete(k);
        return copy;
      });
    }
  };

  // Presence
  const { peers, selfId, updatePosition } = useRealtime(sb, name, room);

  // Pointer lock
  const plRef = useRef<any>(null);

  // Peers ref for physics
  const peersRef = useRef<Record<string, PresenceMeta>>({});
  useEffect(() => { peersRef.current = peers; }, [peers]);

  // Capture camera
  function FrameCamera() {
    const { camera } = useThree();
    useEffect(() => { (window as any).__r3fCamera = camera; }, [camera]);
    return null;
  }

  // Grounded check
// Grounded check: sample a small footprint under the player
const grounded = (p: THREE.Vector3) => {
  const radius = 0.5;
  const footY = p.y - radius;
  const yTop = Math.floor(footY + 1e-6);   // top surface level just below feet
  const cy = yTop - 0.5;                    // voxel center at that top

  // Offsets around the center so edges/corners count as ground
  const offsets: ReadonlyArray<readonly [number, number]> = [
    [0, 0],
    [ 0.35, 0], [-0.35, 0],
    [ 0, 0.35], [ 0, -0.35],
  ];

  let touching = false;
  for (const [ox, oz] of offsets) {
    const gx = Math.round(p.x + ox);
    const gz = Math.round(p.z + oz);
    if (isOccupied(gx, cy, gz)) { touching = true; break; }
  }

  const contact = footY - yTop; // 0 => exactly on top surface
  return touching && contact <= 0.12; // a bit forgiving
};


  // Raycaster
  const raycast = useMemo(() => createVoxelRaycaster((x,y,z) => isOccupied(x,y,z)), []);

  // Aim helpers
  const getBreakAndPlace = () => {
    const camera: THREE.PerspectiveCamera | undefined = (window as any).__r3fCamera;
    if (!camera) return { breakPos: null as any, placePos: null as any };
    const dir = new THREE.Vector3(); camera.getWorldDirection(dir).normalize();

    const vHit = raycast(camera.position, dir, 12);

    // Player-face hit
    let pHit: { t:number; normal:[number,number,number]; hit:THREE.Vector3 } | null = null;
    for (const o of Object.values(peersRef.current)) {
      if (o.id === selfId) continue;
      const min = new THREE.Vector3(o.x-0.5, o.y-0.5, o.z-0.5);
      const max = new THREE.Vector3(o.x+0.5, o.y+0.5, o.z+0.5);
      const r = rayAABB(camera.position, dir, min, max);
      if (r && r.t > 0 && r.t < 12 && (!pHit || r.t < pHit!.t)) pHit = { t: r.t, normal: r.normal as [number,number,number], hit: r.hit };
    }

    if (pHit && (!vHit || pHit.t < vHit.t)) {
      const placeTarget = pHit.hit.clone().add(new THREE.Vector3(...pHit.normal).multiplyScalar(0.51));
      const px = Math.round(placeTarget.x);
      const pz = Math.round(placeTarget.z);
      const py = Math.floor(placeTarget.y) + 0.5;
      return { breakPos: null as any, placePos: { x: px, y: py, z: pz } };
    }

    if (vHit) {
      const b = vHit.cell; const n = vHit.normal;
      return { breakPos: b, placePos: { x: b.x + n[0], y: b.y + n[1], z: b.z + n[2] } };
    }

    if (Math.abs(dir.y) > 1e-6) {
      const t = (0.5 - camera.position.y) / dir.y;
      if (t > 0 && t < 12) {
        const p = camera.position.clone().addScaledVector(dir, t);
        return { breakPos: null as any, placePos: { x: Math.round(p.x), y: 0.5, z: Math.round(p.z) } };
      }
    }
    return { breakPos: null as any, placePos: null as any };
  };

  const getPlacePreview = () => getBreakAndPlace().placePos;

  // Canvas handlers
  const handlePointerUp: React.PointerEventHandler<HTMLCanvasElement> = async (e) => {
    if (!playing) return;
    const { breakPos, placePos } = getBreakAndPlace();
    if (e.button === 2 || (e.button === 0 && (e as any).shiftKey)) {
      if (breakPos) await breakAt(breakPos.x, breakPos.y, breakPos.z);
    } else if (e.button === 0) {
      if (placePos && !isOccupied(placePos.x, placePos.y, placePos.z)) await placeAt(placePos.x, placePos.y, placePos.z, selectedSlot);
    }
  };
  const handleWheel: React.WheelEventHandler<HTMLCanvasElement> = (e) => {
    e.preventDefault();
    const dir = e.deltaY > 0 ? 1 : -1;
    setSelectedSlot((s) => (((s - 1 + dir) % 6 + 6) % 6) + 1);
  };

  const onlineCount = Math.max(1, Object.keys(peers).length);

  return (
    <div style={{ height: "100vh", width: "100vw", background: "#0b1020", position: "relative" }}>
      {playing && (
        <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", width: 18, height: 18, pointerEvents: "none", zIndex: 10 }}>
          <div style={{ position: "absolute", left: 8, top: 0, bottom: 0, width: 2, background: "#fff", opacity: 0.95 }} />
          <div style={{ position: "absolute", top: 8, left: 0, right: 0, height: 2, background: "#fff", opacity: 0.95 }} />
        </div>
      )}

      <Canvas camera={{ fov: 75, near: 0.1, far: 200 }} shadows
        onPointerDown={() => { if (!plRef.current?.isLocked) plRef.current?.lock?.(); }}
        onContextMenu={(e) => e.preventDefault()}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
      >
        <FrameCamera />
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 10, 5]} intensity={1.2} castShadow />
        <Blocks blocks={staticBlocks} />
        <Blocks blocks={dynBlocks} />
        <PointerLockControls ref={plRef} />
        <OtherPlayers peers={peers} selfId={selfId} />
        <Player running={playing} peersRef={peersRef} onPosUpdate={updatePosition} solidAt={(x,y,z)=>isOccupied(x,y,z)} grounded={grounded} />
        <GhostBlock getPlacePreview={getPlacePreview} occupied={(x,y,z)=>isOccupied(x,y,z)} />
      </Canvas>

      {/* HUD */}
      <div style={{ position: "absolute", top: 12, left: 12, display: "flex", gap: 12, flexWrap: "wrap", zIndex: 11 }}>
        <div style={{ background: "rgba(0,0,0,.55)", color: "#fff", padding: 12, borderRadius: 12, minWidth: 260 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <b>Players</b><span>{onlineCount}</span>
          </div>
          <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
            <button id="clickToPlay" onClick={() => { setPlaying(true); plRef.current?.lock?.(); }} style={{ padding: "10px 12px", borderRadius: 10, background: "#3b82f6", color: "#041007", fontWeight: 700, border: "none", cursor: "pointer" }}>
              {playing ? "Restart" : "Click to Play"}
            </button>
            <span style={{ fontSize: 12, opacity: 0.9 }}>Room: <code>{room}</code></span>
          </div>
          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.9 }}>Left-click place · Right-click/Shift+Left break · 1–6 or Scroll to select</div>
        </div>
      </div>

      <Toolbox selected={selectedSlot} setSelected={setSelectedSlot} />

      {!playing && (
        <div style={{ position: "absolute", inset: 0, display: "flex", justifyContent: "center", alignItems: "center", pointerEvents: "none", zIndex: 12 }}>
          <div style={{ pointerEvents: "auto", background: "#0b1220e6", color: "#fff", padding: 24, borderRadius: 16, textAlign: "center", width: 580 }}>
            <div style={{ fontSize: 20, marginBottom: 8 }}>POV Box Build — Multiplayer</div>
            <div style={{ opacity: 0.9, marginBottom: 12 }}>W/A/S/D move · Space jump · Crosshair is HUD · Raycast aim to place on block faces (and on players) · Scroll or 1–6 to change block</div>
            <button id="clickToPlay" style={{ padding: "10px 12px", borderRadius: 10, background: "#3b82f6", color: "#041007", fontWeight: 700, border: "none", cursor: "pointer" }} onClick={() => { setPlaying(true); }}>
              Click to Play
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
