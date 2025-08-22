import { Block } from "./types";

export function buildStaticWorld() {
  const blocks: Block[] = [] as any;
  const index = new Set<string>();
  const keyOf = (x:number,y:number,z:number) => `${x}|${y}|${z}`;
  const push = (x:number,y:number,z:number,type:number) => {
    const k = keyOf(x,y,z); if (index.has(k)) return;
    blocks.push({ id: `s_${k}`, room: "_static", x, y, z, type } as any);
    index.add(k);
  };

  // Ground at y=0.5
  const minX=-12, maxX=12, minZ=-32, maxZ=6;
  for (let x=minX; x<=maxX; x++) for (let z=minZ; z<=maxZ; z++) push(x, 0.5, z, 6);

  // A few obstacles
  for (let x=-5; x<=5; x++) { push(x, 0.5, -8, 2); push(x, 1.5, -8, 2); }
  push(-2, 0.5, -16, 2); push(-2, 1.5, -16, 2);
  for (let x=1; x<=3; x++) for (let z=-22; z<=-20; z++) push(x, 0.5, z, 2);

  // Perimeter
  for (let x=minX; x<=maxX; x++) { push(x, 0.5, minZ, 2); push(x, 0.5, maxZ, 2); }
  for (let z=minZ; z<=maxZ; z++) { push(minX, 0.5, z, 2); push(maxX, 0.5, z, 2); }

  return { blocks, index, keyOf };
}
