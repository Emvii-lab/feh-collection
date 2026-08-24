// Couche B du positionnement : déplacement AVEC terrain (murs/forêts/eau) et
// portées d'attaque / zones de menace. Les murs sont lus du wiki ; forêts/eau se
// peignent à la main (le wiki ne les encode pas). NE MODÉLISE PAS l'IA ennemie.

export const COLS = ['a', 'b', 'c', 'd', 'e', 'f'];

export function parsePos(pos: string): { x: number; y: number } | null {
  const m = pos.toLowerCase().match(/^([a-f])([1-8])$/);
  return m ? { x: COLS.indexOf(m[1]), y: parseInt(m[2], 10) } : null;
}
export const toPos = (x: number, y: number) => COLS[x] + y;

// Terrain d'une case (absent = plaine).
export type Terrain = 'plain' | 'wall' | 'forest' | 'water' | 'trench';
export type TerrainMap = Record<string, Terrain>;

export type MoveClass = 'inf' | 'cav' | 'arm' | 'fly';
export function moveClass(moveType: string): MoveClass {
  const m = (moveType || '').toLowerCase();
  if (/caval/.test(m)) return 'cav';
  if (/armor|cuiras/.test(m)) return 'arm';
  if (/fly|vol/.test(m)) return 'fly';
  return 'inf';
}
// Budget de déplacement : Cavalier 3, Cuirassé 1, Fantassin/Volant 2.
export function moveAllowance(moveType: string): number {
  const c = moveClass(moveType);
  return c === 'cav' ? 3 : c === 'arm' ? 1 : 2;
}
// Portée d'arme (Arc/Dague/Tome/Bâton = 2, corps-à-corps = 1).
export function weaponRange(weaponType: string): number {
  return /bow|arc|dagger|dague|tome|staff|b[aâ]ton/i.test(weaponType || '') ? 2 : 1;
}

// Coût pour ENTRER sur une case selon le terrain et le type. Infinity = infranchissable.
function enterCost(terrain: Terrain, cls: MoveClass): number {
  if (terrain === 'wall') return Infinity; // mur : bloque tout, volants inclus
  if (cls === 'fly') return 1; // les volants ignorent forêt/eau/fossé
  if (terrain === 'water') return Infinity; // eau : seuls les volants passent
  if (terrain === 'forest') return cls === 'cav' ? Infinity : 2; // cavalerie : forêt infranchissable
  if (terrain === 'trench') return cls === 'cav' ? 3 : 1; // fossé : ralentit la cavalerie
  return 1;
}

export const manhattan = (a: string, b: string): number => {
  const pa = parsePos(a), pb = parsePos(b);
  return pa && pb ? Math.abs(pa.x - pb.x) + Math.abs(pa.y - pb.y) : 99;
};

// Cases atteignables (Dijkstra pondéré par le terrain). `blocked` = unités
// infranchissables (ennemis pour toi, alliés pour l'ennemi).
export function reachable(
  start: string, move: number, cls: MoveClass, terrain: TerrainMap, blocked: Set<string>,
): Set<string> {
  const out = new Set<string>();
  if (!parsePos(start)) return out;
  const dist = new Map<string, number>([[start, 0]]);
  out.add(start);
  const pq: [number, string][] = [[0, start]];
  while (pq.length) {
    pq.sort((a, b) => a[0] - b[0]);
    const [d, pos] = pq.shift()!;
    if (d > (dist.get(pos) ?? Infinity)) continue;
    const p = parsePos(pos)!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = p.x + dx, ny = p.y + dy;
      if (nx < 0 || nx > 5 || ny < 1 || ny > 8) continue;
      const np = toPos(nx, ny);
      if (blocked.has(np)) continue;
      const c = enterCost(terrain[np] ?? 'plain', cls);
      if (!isFinite(c)) continue;
      const nd = d + c;
      if (nd <= move && nd < (dist.get(np) ?? Infinity)) {
        dist.set(np, nd); out.add(np); pq.push([nd, np]);
      }
    }
  }
  return out;
}

// Parmi `reach`, les cases (libres) d'où l'on atteint `target` à `range`.
export function attackFrom(
  reach: Set<string>, target: string, range: number, occupied: Set<string>,
): Set<string> {
  const out = new Set<string>();
  for (const t of reach) {
    if (t !== target && !occupied.has(t) && manhattan(t, target) <= range) out.add(t);
  }
  return out;
}

// Zone menacée = toutes les cases à portée d'arme depuis une case atteignable
// (les attaques à distance ignorent les murs en FEH → simple portée de Manhattan).
export function threatZone(
  start: string, move: number, cls: MoveClass, range: number,
  terrain: TerrainMap, blocked: Set<string>,
): Set<string> {
  const reach = reachable(start, move, cls, terrain, blocked);
  const out = new Set<string>();
  for (const r of reach) {
    const p = parsePos(r)!;
    for (let dx = -range; dx <= range; dx++)
      for (let dy = -range; dy <= range; dy++) {
        if (Math.abs(dx) + Math.abs(dy) > range) continue;
        const nx = p.x + dx, ny = p.y + dy;
        if (nx < 0 || nx > 5 || ny < 1 || ny > 8) continue;
        out.add(toPos(nx, ny));
      }
  }
  return out;
}
