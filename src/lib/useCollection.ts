import { useCallback, useEffect, useState } from 'react';
import { fetchOwned, setOwned as persistOwned } from './collection';

// Gère l'ensemble des héros possédés (de l'utilisateur connecté) avec MAJ optimiste.
export function useCollection(userId: string | null) {
  const [owned, setOwnedSet] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(() => {
    if (!userId) {
      setOwnedSet(new Set());
      return;
    }
    fetchOwned().then(setOwnedSet);
  }, [userId]);

  // Recharge la collection à chaque changement d'utilisateur (connexion/déconnexion).
  useEffect(() => {
    let active = true;
    setLoading(true);
    if (!userId) {
      setOwnedSet(new Set());
      setLoading(false);
      return;
    }
    fetchOwned().then((set) => {
      if (active) {
        setOwnedSet(set);
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [userId]);

  const toggle = useCallback(
    (heroId: string) => {
      setOwnedSet((prev) => {
        const next = new Set(prev);
        const willOwn = !next.has(heroId);
        if (willOwn) next.add(heroId);
        else next.delete(heroId);
        // Persistance en arrière-plan (optimiste), avec l'utilisateur courant.
        persistOwned(heroId, willOwn, userId).catch((e) =>
          console.warn('Persistance collection échouée', e),
        );
        return next;
      });
    },
    [userId],
  );

  return { owned, toggle, loading, refetch };
}
