import { useCallback, useEffect, useState } from 'react';
import {
  fetchCollection,
  setOwned as persistOwned,
  setResplendentObtained as persistResplendent,
  type CollStats,
} from './collection';

// Gère la collection de l'utilisateur connecté : héros possédés + leurs stats.
export function useCollection(userId: string | null) {
  const [owned, setOwnedSet] = useState<Set<string>>(new Set());
  const [stats, setStats] = useState<Map<string, CollStats>>(new Map());
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    if (!userId) {
      setOwnedSet(new Set());
      setStats(new Map());
      return Promise.resolve();
    }
    return fetchCollection().then((rows) => {
      setOwnedSet(new Set(rows.map((r) => r.hero_id)));
      const m = new Map<string, CollStats>();
      for (const r of rows) {
        m.set(r.hero_id, {
          LVL: r.LVL,
          PV: r.PV,
          ATQ: r.ATQ,
          VIT: r.VIT,
          DEF: r.DEF,
          RES: r.RES,
          rarity: r.rarity,
          resplendent: r.resplendent,
        });
      }
      setStats(m);
    });
  }, [userId]);

  // Recharge à chaque changement d'utilisateur (connexion/déconnexion).
  useEffect(() => {
    let active = true;
    setLoading(true);
    load().finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [load]);

  const refetch = useCallback(() => {
    void load();
  }, [load]);

  const toggle = useCallback(
    (heroId: string) => {
      setOwnedSet((prev) => {
        const next = new Set(prev);
        const willOwn = !next.has(heroId);
        if (willOwn) next.add(heroId);
        else next.delete(heroId);
        persistOwned(heroId, willOwn, userId).catch((e) =>
          console.warn('Persistance collection échouée', e),
        );
        return next;
      });
    },
    [userId],
  );

  // Bascule « tenue resplendissante obtenue » pour un héros (persisté Supabase).
  // Obtenir la tenue implique de posséder le héros → on l'ajoute à la collection.
  const toggleResplendent = useCallback(
    (heroId: string) => {
      let willHave = false;
      setStats((prev) => {
        const next = new Map(prev);
        const cur = next.get(heroId);
        willHave = !cur?.resplendent;
        next.set(heroId, {
          LVL: cur?.LVL ?? null,
          PV: cur?.PV ?? null,
          ATQ: cur?.ATQ ?? null,
          VIT: cur?.VIT ?? null,
          DEF: cur?.DEF ?? null,
          RES: cur?.RES ?? null,
          rarity: cur?.rarity ?? null,
          resplendent: willHave,
        });
        return next;
      });
      if (willHave) setOwnedSet((prev) => new Set(prev).add(heroId));
      persistResplendent(heroId, userId, willHave).catch((e) =>
        console.warn('Persistance tenue resplendissante échouée', e),
      );
    },
    [userId],
  );

  return { owned, stats, toggle, toggleResplendent, loading, refetch };
}
