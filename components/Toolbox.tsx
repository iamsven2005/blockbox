"use client";
import React, { useEffect } from "react";

export const SLOT_LABELS = ["Wood","Stone","Brick","Glass","Gold","Grass"] as const;

export function Toolbox({ selected, setSelected }: { selected: number; setSelected: (i:number)=>void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { const n = +e.key; if (n>=1 && n<=6) setSelected(n); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSelected]);

  return (
    <div style={{ position: "absolute", bottom: 12, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 8 }}>
      {Array.from({ length: 6 }, (_, i) => i + 1).map((i) => (
        <div key={i} style={{ width: 56, height: 56, borderRadius: 10, border: `2px solid ${i===selected?"#22c55e":"#334155"}`, background: "#0b1220", color: "#e5e7eb", display: "grid", placeItems: "center", boxShadow: i===selected?"0 0 12px #22c55e77":"none" }}>
          <div style={{ fontSize: 12, opacity: 0.9 }}>{i}</div>
          <div style={{ fontSize: 10, opacity: 0.8 }}>{SLOT_LABELS[i-1]}</div>
        </div>
      ))}
    </div>
  );
}
