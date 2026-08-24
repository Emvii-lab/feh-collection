// Couche A du positionnement : portées de déplacement, cases d'attaque, zones de
// menace. Déterministe et vérifiable. NE MODÉLISE PAS le terrain (murs/forêts/eau)
// ni les déplacements spéciaux ni l'IA : c'est une aide visuelle, pas une garantie.

export const COLS = ['a', 'b', 'c', 'd', 'e', 'f'];

export function parsePos(pos: string): { x: number; y: number } | null {
  const m = pos.toLowerCase().match(/^([a-f])([1-8])$/);
  return m ? { x: COLS.indexOf(m[1]), y: parseInt(m[2], 10) } : null;
}
export const toPos = (x: number, y: number) => COLS[x] + y;

// Allocation de déplacement par type (FR ou EN). Cavalier 3, Cuirassé 1, sinon 2.
export function moveAllowance(moveType: string): number {
  const m = (moveType || '').toLowerCase();
  if (/caval/.test(m)) return 3;
  if (/armor|cuiras/.test(m)) return 1;
  return 2; // fantassin / volant
}
// Portée d'arme : distance (Arc/Dague/Tome/Bâton = 2, corps-à-corps = 1).
export function weaponRange(weaponType: string): number {
  return /bow|arc|dagger|dague|tome|staff|b[aâ]ton/i.test(weaponType || '') ? 2 : 1;
}

export const manhattan = (a: string, b: string): number => {
  const pa = parsePos(a), pb = parsePos(b);
  return pa && pb ? Math.abs(pa.x - pb.x) + Math.abs(pa.y - pb.y) : 99;
};

// Cases atteignables en `move` pas (parcours en largeur, 4 voisins). `blocked` =
// cases infranchissables (on ne peut pas les traverser).
export function reachable(start: string, move: number, blocked: Set<string>): Set<string> {
  const s = parsePos(start);
  const out = new Set<string>();
  if (!s) return out;
  out.add(start);
  const seen = new Set([start]);
  let frontier: [number, number, number][] = [[s.x, s.y, 0]];
  while (frontier.length) {
    const next: [number, number, number][] = [];
    for (const [x, y, d] of frontier) {
      if (d >= move) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx > 5 || ny < 1 || ny > 8) continue;
        const np = toPos(nx, ny);
        if (seen.has(np) || blocked.has(np)) continue;
        seen.add(np); out.add(np); next.push([nx, ny, d + 1]);
      }
    }
    frontier = next;
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

// Zone menacée = toutes les cases à portée d'arme depuis une case atteignable.
export function threatZone(
  start: string, move: number, range: number, blocked: Set<string>,
): Set<string> {
  const reach = reachable(start, move, blocked);
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
