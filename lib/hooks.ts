"use client";
import { useEffect, useRef, useState } from "react";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { PresenceMeta } from "./types";

export function useSupabase(): SupabaseClient | null {
  const ref = useRef<SupabaseClient | null>(null);
  if (!ref.current) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (url && key) {
      ref.current = createClient(url, key, { realtime: { params: { eventsPerSecond: 20 } } });
    }
  }
  return ref.current;
}

export function useRoom() {
  const [room, setRoom] = useState("lobby");
  useEffect(() => {
    const u = new URL(window.location.href);
    const r = u.searchParams.get("room");
    setRoom(r && r.trim() ? r.trim() : "lobby");
  }, []);
  return room;
}

export function useKeys() {
  const [keys, set] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => set((s) => ({ ...s, [e.code]: true }));
    const onUp = (e: KeyboardEvent) => set((s) => ({ ...s, [e.code]: false }));
    const reset = () => set({});
    window.addEventListener("keydown", onDown, { passive: true });
    window.addEventListener("keyup", onUp, { passive: true });
    window.addEventListener("blur", reset);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState !== "visible") reset(); });
    document.addEventListener("pointerlockchange", () => { if (document.pointerLockElement == null) reset(); });
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", reset);
    };
  }, []);
  const forward = keys["KeyW"] || keys["ArrowUp"];
  const backward = keys["KeyS"] || keys["ArrowDown"];
  const left = keys["KeyA"] || keys["ArrowLeft"];
  const right = keys["KeyD"] || keys["ArrowRight"];
  const jump = keys["Space"];
  return { forward, backward, left, right, jump };
}

export function useRealtime(sb: SupabaseClient | null, name: string, room = "lobby") {
  const [peers, setPeers] = useState<Record<string, PresenceMeta>>({});
  const chanRef = useRef<ReturnType<SupabaseClient["channel"]> | null>(null);
  const selfIdRef = useRef<string>(typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2));
  const colorRef = useRef<string>(`hsl(${Math.floor(Math.random()*360)} 70% 55%)`);

  useEffect(() => {
    if (!sb) return;
    const ch = sb.channel(`game:${room}`, { config: { presence: { key: selfIdRef.current } } });
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
        const me = { id: selfIdRef.current, name, color: colorRef.current, x: 0, y: 1.6, z: 0 } as PresenceMeta;
        ch.track(me);
        setPeers((p) => ({ ...p, [me.id]: me }));
      }
    });

    return () => { ch.unsubscribe(); };
  }, [sb, room, name]);

  const lastSentRef = useRef(0);
  const updatePosition = (p: THREE.Vector3) => {
    const ch = chanRef.current; if (!ch) return;
    const t = performance.now();
    if (t - lastSentRef.current > 70) {
      lastSentRef.current = t;
      ch.track({ id: selfIdRef.current, name, color: colorRef.current, x: p.x, y: p.y, z: p.z } as PresenceMeta);
      setPeers((prev) => ({ ...prev, [selfIdRef.current]: { id: selfIdRef.current, name, color: colorRef.current, x: p.x, y: p.y, z: p.z } }));
    }
  };

  return { peers, selfId: selfIdRef.current, updatePosition };
}
