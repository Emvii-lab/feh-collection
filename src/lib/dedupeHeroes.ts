import type { Hero } from '../types';

function heroKey(hero: Hero): string {
  return `${hero.name.trim().toLowerCase()}\u0000${hero.title.trim().toLowerCase()}`;
}

function completenessScore(hero: Hero): number {
  return (
    (hero.releaseDate ? 10000 : 0) +
    (hero.stats ? 1000 : 0) +
    (hero.art ? 100 : 0) +
    (hero.rarity_url ? 50 : 0) +
    (hero.intId ?? 0)
  );
}

function preferHero(current: Hero, candidate: Hero): Hero {
  return completenessScore(candidate) > completenessScore(current)
    ? candidate
    : current;
}

export function dedupeHeroes(heroes: Hero[]): Hero[] {
  const byNameAndTitle = new Map<string, Hero>();

  for (const hero of heroes) {
    const key = heroKey(hero);
    const existing = byNameAndTitle.get(key);
    byNameAndTitle.set(key, existing ? preferHero(existing, hero) : hero);
  }

  return [...byNameAndTitle.values()].sort(
    (a, b) => (a.intId ?? Number.MAX_SAFE_INTEGER) - (b.intId ?? Number.MAX_SAFE_INTEGER),
  );
}
