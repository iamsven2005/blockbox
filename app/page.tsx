"use client";
// app/page.tsx
// Multiplayer POV building mini‑game
// - Uses Supabase Realtime presence (from local env: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY)
// - Player is a BOX (WASD + Space)
// - See other players as boxes (realtime)
// - Player↔player collision (spherical approximation)
// - Bottom toolbox (6 slots). Left‑click places a block of the selected slot near you (local only for now).

import React, { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { PointerLockControls, Html } from "@react-three/drei";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

// ===== Supabase (client-side) from local env =====
function useSupabase(): SupabaseClient | null {
  const ref = useRef<SupabaseClient | null>(null);
  if (!ref.current) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (url && key) ref.current = createClient(url, key);
  }
  return ref.current;
}

// ===== Types =====
interface PresenceMeta {
  id: string; // client id
  name: string; // nickname
  color: string; // css color
  x: number; y: number; z: number; // position
}
interface Block { id: string; x: number; y: number; z: number; type: number; }

// ===== Keyboard state =====
function useKeys() {
  const [keys, set] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => set((s) => ({ ...s, [e.code]: true }));
    const onUp = (e: KeyboardEvent) => set((s) => ({ ...s, [e.code]: false }));
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => { window.removeEventListener("keydown", onDown); window.removeEventListener("keyup", onUp); };
  }, []);
  const forward = keys["KeyW"] || keys["ArrowUp"]; const backward = keys["KeyS"] || keys["ArrowDown"]; const left = keys["KeyA"] || keys["ArrowLeft"]; const right = keys["KeyD"] || keys["ArrowRight"]; const jump = keys["Space"];
  const hotbar = ["Digit1","Digit2","Digit3","Digit4","Digit5","Digit6"].find((k)=>keys[k]);
  return { forward, backward, left, right, jump, hotbar };
}

// ===== AABB helpers =====
function aabb(min: THREE.Vector3, max: THREE.Vector3) { return { min, max }; }
const obstacles: { min: THREE.Vector3; max: THREE.Vector3 }[] = [
  aabb(new THREE.Vector3(-4, 0, -10), new THREE.Vector3(4, 1.2, -9)),
  aabb(new THREE.Vector3(-2, 0, -18), new THREE.Vector3(-1, 2, -17)),
  aabb(new THREE.Vector3(1, 0, -22), new THREE.Vector3(3, 0.6, -20)),
];

function resolveSphereAABB(pos: THREE.Vector3, vel: THREE.Vector3, r: number, box: { min: THREE.Vector3; max: THREE.Vector3 }) {
  const closest = new THREE.Vector3(
    THREE.MathUtils.clamp(pos.x, box.min.x, box.max.x),
    THREE.MathUtils.clamp(pos.y, box.min.y, box.max.y),
    THREE.MathUtils.clamp(pos.z, box.min.z, box.max.z)
  );
  const delta = pos.clone().sub(closest);
  const d2 = delta.lengthSq();
  const r2 = r * r;
  if (d2 < r2) {
    const d = Math.sqrt(d2) || 0.00001;
    const n = delta.multiplyScalar(1 / d);
    const overlap = (r - d) + 0.0001;
    pos.addScaledVector(n, overlap);
    const vn = vel.dot(n);
    if (vn < 0) vel.addScaledVector(n, -vn * 1.2);
  }
}

// ===== Sphere–sphere collision (players) =====
function resolveSphereSphere(selfPos: THREE.Vector3, selfVel: THREE.Vector3, rSelf: number, otherPos: THREE.Vector3, rOther: number) {
  const delta = selfPos.clone().sub(otherPos);
  const r = rSelf + rOther;
  const dist2 = delta.lengthSq();
  if (dist2 < r * r) {
    const d = Math.sqrt(dist2) || 0.00001;
    const n = delta.multiplyScalar(1 / d);
    const overlap = (r - d) + 0.0001;
    selfPos.addScaledVector(n, overlap); // push ourself away
    const vn = selfVel.dot(n);
    if (vn < 0) selfVel.addScaledVector(n, -vn * 1.2);
  }
}

// ===== Scene bits =====
function Ground() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[100, 100]} />
      <meshStandardMaterial color="#8bc34a" />
    </mesh>
  );
}
function SkyDome() {
  return (
    <mesh>
      <sphereGeometry args={[60, 32, 32]} />
      <meshBasicMaterial color="#b3e5fc" side={THREE.BackSide} />
    </mesh>
  );
}
function GoalRing() {
  return (
    <mesh position={[0, 0.8, -30]}>
      <torusGeometry args={[1, 0.08, 16, 64]} />
      <meshStandardMaterial emissive="#ffd54f" emissiveIntensity={2} color="#fff8e1" />
    </mesh>
  );
}
function Obstacles() {
  return (
    <group>
      {obstacles.map((b, i) => (
        <mesh key={i} position={[ (b.min.x + b.max.x)/2, (b.min.y + b.max.y)/2, (b.min.z + b.max.z)/2 ]}>
          <boxGeometry args={[ b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z ]} />
          <meshStandardMaterial color="#90a4ae" metalness={0.2} roughness={0.8} />
        </mesh>
      ))}
    </group>
  );
}

// ===== Realtime presence =====
function useRealtime(sb: SupabaseClient | null, name: string, room = "lobby") {
  const [peers, setPeers] = useState<Record<string, PresenceMeta>>({});
  const chanRef = useRef<ReturnType<SupabaseClient["channel"]> | null>(null);
  const selfIdRef = useRef<string>(typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2));
  const colorRef = useRef<string>(`hsl(${Math.floor(Math.random()*360)} 70% 55%)`);

  useEffect(() => {
    if (!sb) return;
    const topic = `game:${room}`;
    const ch = sb.channel(topic, { config: { presence: { key: selfIdRef.current } } });
    chanRef.current = ch;

    const applyState = () => {
      const state = ch.presenceState() as Record<string, PresenceMeta[]>;
      const map: Record<string, PresenceMeta> = {};
      for (const key of Object.keys(state)) {
        const meta = state[key][0];
        if (meta) map[meta.id] = meta;
      }
      setPeers(map);
    };

    ch.on("presence", { event: "sync" }, applyState);
    ch.on("presence", { event: "join" }, applyState);
    ch.on("presence", { event: "leave" }, applyState);

    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        ch.track({ id: selfIdRef.current, name, color: colorRef.current, x: 0, y: 0.51, z: 0 } as PresenceMeta);
        // Ensure we show at least ourself immediately
        setPeers((p) => ({ ...p, [selfIdRef.current]: { id: selfIdRef.current, name, color: colorRef.current, x: 0, y: 0.51, z: 0 } }));
      }
    });

    return () => { ch.unsubscribe(); };
  }, [sb, room]);

  // Update metadata if name changes
  useEffect(() => {
    const ch = chanRef.current; if (!ch) return;
    try {
      ch.track({ id: selfIdRef.current, name, color: colorRef.current, x: 0, y: 0.51, z: 0 });
      setPeers((p) => ({ ...p, [selfIdRef.current]: { ...(p[selfIdRef.current] || { id: selfIdRef.current, color: colorRef.current, x: 0, y: 0.51, z: 0 }), name } }));
    } catch {}
  }, [name]);

  // Position updater (throttled)
  const lastSentRef = useRef(0);
  const updatePosition = (p: THREE.Vector3) => {
    const ch = chanRef.current; if (!ch) return;
    const t = performance.now();
    if (t - lastSentRef.current > 70) { // ~14 Hz
      lastSentRef.current = t;
      ch.track({ id: selfIdRef.current, name, color: colorRef.current, x: p.x, y: p.y, z: p.z } as PresenceMeta);
      setPeers((prev) => ({ ...prev, [selfIdRef.current]: { id: selfIdRef.current, name, color: colorRef.current, x: p.x, y: p.y, z: p.z } }));
    }
  };

  return { peers, selfId: selfIdRef.current, updatePosition };
}

function OtherPlayers({ peers, selfId }: { peers: Record<string, PresenceMeta>; selfId: string }) {
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

// ===== Blocks placed by the player (local only) =====
function Blocks({ blocks }: { blocks: Block[] }) {
  const mats = useMemo(() => ([
    new THREE.MeshStandardMaterial({ color: "#8d6e63" }), // 1 wood
    new THREE.MeshStandardMaterial({ color: "#9e9e9e" }), // 2 stone
    new THREE.MeshStandardMaterial({ color: "#b71c1c" }), // 3 brick
    new THREE.MeshStandardMaterial({ color: "#90caf9", opacity: 0.6, transparent: true }), // 4 glass
    new THREE.MeshStandardMaterial({ color: "#ffd54f" }), // 5 gold
    new THREE.MeshStandardMaterial({ color: "#43a047" }), // 6 grass
  ]), []);
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

// ===== Player (first-person BOX) =====
function Player({ running, setRunning, onReachGoal, peersRef, onPosUpdate }: {
  running: boolean;
  setRunning: (b: boolean) => void;
  onReachGoal: (t: number) => void;
  peersRef: React.MutableRefObject<Record<string, PresenceMeta>>;
  onPosUpdate: (p: THREE.Vector3) => void;
}) {
  const half = 0.5; // half extent of the box (collision as sphere with r=0.5)
  const radius = 0.5;
  const speed = 6;
  const jumpVel = 6;
  const gravity = -18;
  const friction = 0.92;

  const vel = useRef(new THREE.Vector3());
  const pos = useRef(new THREE.Vector3(0, half + 0.01, 0));
  const dir = useRef(new THREE.Vector3());
  const onGround = useRef(true);
  const startTimeRef = useRef<number | null>(null);
  const { forward, backward, left, right, jump } = useKeys();
  const { camera } = useThree();
  const goalPos = useMemo(() => new THREE.Vector3(0, half, -30), []);

  useFrame((_, dt) => {
    if (!running) return;
    if (startTimeRef.current == null) startTimeRef.current = performance.now();

    // Input → world space
    dir.current.set(0, 0, 0);
    const yaw = camera.rotation.y;
    const forwardVec = new THREE.Vector3(Math.sin(yaw), 0, -Math.cos(yaw));
    const rightVec = new THREE.Vector3(forwardVec.z, 0, -forwardVec.x);
    if (forward) dir.current.add(forwardVec);
    if (backward) dir.current.sub(forwardVec);
    if (right) dir.current.add(rightVec);
    if (left) dir.current.sub(rightVec);
    if (dir.current.lengthSq() > 0) dir.current.normalize();

    // Accel + gravity
    vel.current.x += dir.current.x * speed * dt;
    vel.current.z += dir.current.z * speed * dt;
    vel.current.y += gravity * dt;

    // Integrate
    pos.current.addScaledVector(vel.current, dt);

    // Ground plane
    if (pos.current.y < half) { pos.current.y = half; vel.current.y = 0; onGround.current = true; } else onGround.current = false;

    // Jump
    if (jump && onGround.current) { vel.current.y = jumpVel; onGround.current = false; }

    // Friction
    vel.current.x *= friction; vel.current.z *= friction;

    // Obstacles collision
    obstacles.forEach((b) => resolveSphereAABB(pos.current, vel.current, radius, b));

    // Player–player collisions
    const others = peersRef.current;
    for (const o of Object.values(others)) {
      const otherPos = new THREE.Vector3(o.x, o.y, o.z);
      resolveSphereSphere(pos.current, vel.current, radius, otherPos, radius);
    }

    // Camera
    camera.position.set(pos.current.x, pos.current.y + 0.2, pos.current.z);

    // Goal
    if (pos.current.distanceTo(goalPos) < 1.5) {
      const elapsed = (performance.now() - (startTimeRef.current || performance.now())) / 1000;
      setRunning(false);
      onReachGoal(parseFloat(elapsed.toFixed(2)));
    }

    // Realtime position update
    onPosUpdate(pos.current);
  });

  return (
    <mesh position={pos.current.toArray()}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#3aa7ff" metalness={0.1} roughness={0.4} opacity={0.8} transparent />
    </mesh>
  );
}

// ===== Toolbox UI =====
const slotNames = ["Wood","Stone","Brick","Glass","Gold","Grass"];
function Toolbox({ selected, setSelected }: { selected: number; setSelected: (i:number)=>void }) {
  // Keyboard 1–6 select
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const n = +e.key;
      if (n>=1 && n<=6) setSelected(n);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSelected]);

  return (
    <div style={{ position: "absolute", bottom: 12, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 8 }}>
      {Array.from({ length: 6 }, (_, i) => i + 1).map((i) => (
        <div key={i} style={{ width: 54, height: 54, borderRadius: 10, border: `2px solid ${i===selected?"#22c55e":"#334155"}`, background: "#0b1220", color: "#e5e7eb", display: "grid", placeItems: "center", boxShadow: i===selected?"0 0 12px #22c55e77":"none" }}>
          <div style={{ fontSize: 12, opacity: 0.9 }}>{i}</div>
          <div style={{ fontSize: 10, opacity: 0.8 }}>{slotNames[i-1]}</div>
        </div>
      ))}
    </div>
  );
}

// ===== Main Page =====
export default function Page() {
  const [playing, setPlaying] = useState(false);
  const [finished, setFinished] = useState<null | number>(null);
  const [nowSec, setNowSec] = useState(0);
  const [name] = useState<string>(() => {
    const base = "Player";
    const suffix = Math.random().toString(36).slice(2, 6);
    return `${base}-${suffix}`;
  });
  const [selectedSlot, setSelectedSlot] = useState(1);
  const [blocks, setBlocks] = useState<Block[]>([]);

  const sb = useSupabase();
  const { peers, selfId, updatePosition } = useRealtime(sb, name, "lobby");

  // Pointer lock controls ref for re-locking after ESC
  const plRef = useRef<any>(null);

  // Keep a ref of peers for physics
  const peersRef = useRef<Record<string, PresenceMeta>>({});
  useEffect(() => { peersRef.current = peers; }, [peers]);

  // Simple timer
  useEffect(() => {
    if (!playing) return;
    const start = performance.now();
    const id = setInterval(() => setNowSec((performance.now() - start) / 1000), 50);
    return () => clearInterval(id);
  }, [playing]);

  const startGame = () => { setFinished(null); setPlaying(true); plRef.current?.lock?.(); };
  const handleReachGoal = (secs: number) => { setFinished(secs); setPlaying(false); };

  // Place block on left click when playing
  useEffect(() => {
    const onClick = () => {
      if (!playing) return;
      const camera: THREE.PerspectiveCamera | undefined = (window as any).__r3fCamera;
      if (!camera) return;
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      dir.y = 0; // horizontal only
      if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
      dir.normalize();
      const target = camera.position.clone().addScaledVector(dir, 3);
      const gx = Math.round(target.x);
      const gz = Math.round(target.z);
      const gy = 0.5;
      setBlocks((b) => [...b, { id: Math.random().toString(36).slice(2), x: gx, y: gy, z: gz, type: selectedSlot }]);
    };
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, [playing, selectedSlot]);
  useEffect(() => {
    const onClick = () => {
      if (!playing) return;
      // Compute a point ~3m ahead on ground grid
      const cam = (document.querySelector("canvas") as any)?._threeCamera as THREE.PerspectiveCamera | undefined;
      // Fallback to the last known r3f camera by tapping into window.r3fCamera set in <FrameCamera/>
      const camera: any = cam || (window as any).__r3fCamera;
      if (!camera) return;
      const yaw = camera.rotation.y;
      const forwardVec = new THREE.Vector3(Math.sin(yaw), 0, -Math.cos(yaw));
      const target = new THREE.Vector3().copy(camera.position).addScaledVector(forwardVec, 3);
      const gx = Math.round(target.x);
      const gz = Math.round(target.z);
      const gy = 0.5; // sit on ground
      setBlocks((b) => [...b, { id: Math.random().toString(36).slice(2), x: gx, y: gy, z: gz, type: selectedSlot }]);
    };
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, [playing, selectedSlot]);

  // R3F camera handle so placeRef can find it if needed
  function FrameCamera() {
    const { camera } = useThree();
    useEffect(() => { (window as any).__r3fCamera = camera; }, [camera]);
    return null;
  }

  const onlineCount = Math.max(1, Object.keys(peers).length); // show at least self

  return (
    <div style={{ height: "100vh", width: "100vw", background: "#0b1020" }}>
      <Canvas camera={{ fov: 75, near: 0.1, far: 200 }} shadows onPointerDown={() => { if (!plRef.current?.isLocked) plRef.current?.lock?.(); }}>
        <FrameCamera />
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 10, 5]} intensity={1.2} castShadow />
        <SkyDome />
        <Ground />
        <Obstacles />
        <GoalRing />
        <PointerLockControls ref={plRef} />
        <OtherPlayers peers={peers} selfId={selfId} />
        <Blocks blocks={blocks} />
        <Player running={playing} setRunning={setPlaying} onReachGoal={handleReachGoal} peersRef={peersRef} onPosUpdate={updatePosition} />
        <Html center>
          {playing && (<div style={{ width: 10, height: 10, borderRadius: 999, background: "#ffffffaa", boxShadow: "0 0 8px #fff" }} />)}
        </Html>
      </Canvas>

      {/* HUD */}
      <div style={{ position: "absolute", top: 12, left: 12, display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={{ background: "rgba(0,0,0,.55)", color: "#fff", padding: 12, borderRadius: 12, minWidth: 240 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <b>⏱️ Time</b>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{(finished ?? nowSec).toFixed(2)}s</span>
          </div>
          <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
            <button id="clickToPlay" onClick={startGame} style={{ padding: "10px 12px", borderRadius: 10, background: "#3b82f6", color: "#041007", fontWeight: 700, border: "none", cursor: "pointer" }}>{playing ? "Restart" : "Click to Play"}</button>
          </div>
          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.9 }}>Players online: {onlineCount}</div>
        </div>
      </div>

      <Toolbox selected={selectedSlot} setSelected={setSelectedSlot} />

      {/* Finish overlay */}
      {finished != null && (
        <div style={{ position: "absolute", inset: 0, display: "flex", justifyContent: "center", alignItems: "center", pointerEvents: "none" }}>
          <div style={{ pointerEvents: "auto", background: "#0b1220e6", color: "#fff", padding: 24, borderRadius: 16, textAlign: "center", boxShadow: "0 10px 32px rgba(0,0,0,.45)" }}>
            <div style={{ fontSize: 22, marginBottom: 8 }}>🎉 You reached the goal!</div>
            <div style={{ fontSize: 48, fontVariantNumeric: "tabular-nums" }}><b>{finished.toFixed(2)}s</b></div>
            <div style={{ marginTop: 12 }}>
              <button style={{ padding: "10px 12px", borderRadius: 10, background: "#3b82f6", color: "#041007", fontWeight: 700, border: "none", cursor: "pointer" }} onClick={() => setPlaying(true)}>Play Again</button>
            </div>
          </div>
        </div>
      )}

      {/* Help overlay */}
      {!playing && finished == null && (
        <div style={{ position: "absolute", inset: 0, display: "flex", justifyContent: "center", alignItems: "center", pointerEvents: "none" }}>
          <div style={{ pointerEvents: "auto", background: "#0b1220e6", color: "#fff", padding: 24, borderRadius: 16, textAlign: "center", width: 520 }}>
            <div style={{ fontSize: 20, marginBottom: 8 }}>POV Box Build — Multiplayer</div>
            <div style={{ opacity: 0.9, marginBottom: 12 }}>W/A/S/D move · Space jump · Click to place block · 1–6 select block · Join with friends to see each other</div>
            <button id="clickToPlay" style={{ padding: "10px 12px", borderRadius: 10, background: "#3b82f6", color: "#041007", fontWeight: 700, border: "none", cursor: "pointer" }} onClick={() => setPlaying(true)}>Click to Play</button>
          </div>
        </div>
      )}
    </div>
  );
}
