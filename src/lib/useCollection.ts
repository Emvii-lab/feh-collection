import { useCallback, useEffect, useState } from 'react';
import {
  fetchCollection,
  setOwned as persistOwned,
  setResplendentObtained as persistResplendent,
  type CollStats,
} from './collection';

// Gère une collection : héros possédés + leurs stats.
// - `ownUserId` : le compte connecté (celui qui peut écrire).
// - `viewUserId` : le compte dont on AFFICHE la collection (défaut = soi-même).
//   S'il diffère de `ownUserId`, on est en lecture seule (consultation).
export function useCollection(
  ownUserId: string | null,
  viewUserId?: string | null,
) {
  const [owned, setOwnedSet] = useState<Set<string>>(new Set());
  const [stats, setStats] = useState<Map<string, CollStats>>(new Map());
  const [loading, setLoading] = useState(true);

  // Compte réellement affiché (par défaut : le mien).
  const shownUserId = viewUserId ?? ownUserId;
  // Lecture seule dès qu'on regarde la collection de quelqu'un d'autre.
  const readOnly = Boolean(
    shownUserId && ownUserId && shownUserId !== ownUserId,
  );

  const load = useCallback(() => {
    if (!shownUserId) {
      setOwnedSet(new Set());
      setStats(new Map());
      return Promise.resolve();
    }
    return fetchCollection(shownUserId).then((rows) => {
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
  }, [shownUserId]);

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
      if (readOnly) return; // consultation : pas d'écriture sur la collection d'autrui
      setOwnedSet((prev) => {
        const next = new Set(prev);
        const willOwn = !next.has(heroId);
        if (willOwn) next.add(heroId);
        else next.delete(heroId);
        persistOwned(heroId, willOwn, ownUserId).catch((e) =>
          console.warn('Persistance collection échouée', e),
        );
        return next;
      });
    },
    [ownUserId, readOnly],
  );

  // Bascule « tenue resplendissante obtenue » pour un héros (persisté Supabase).
  // Obtenir la tenue implique de posséder le héros → on l'ajoute à la collection.
  const toggleResplendent = useCallback(
    (heroId: string) => {
      if (readOnly) return; // consultation : lecture seule
      // Valeur cible calculée depuis l'état courant (pas dans l'updater setState,
      // qui s'exécute plus tard → on persisterait une valeur périmée).
      const willHave = !stats.get(heroId)?.resplendent;
      setStats((prev) => {
        const next = new Map(prev);
        const cur = next.get(heroId);
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
      persistResplendent(heroId, ownUserId, willHave).catch((e) =>
        console.warn('Persistance tenue resplendissante échouée', e),
      );
    },
    [stats, ownUserId, readOnly],
  );

  return { owned, stats, toggle, toggleResplendent, loading, refetch, readOnly };
}
