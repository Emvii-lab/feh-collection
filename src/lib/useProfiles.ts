import { useEffect, useState } from 'react';
import { fetchProfiles, type Profile } from './collection';

// Liste des comptes consultables (vue feh.profiles). Vide si indisponible.
export function useProfiles() {
  const [profiles, setProfiles] = useState<Profile[]>([]);

  useEffect(() => {
    let active = true;
    fetchProfiles().then((rows) => {
      if (active) setProfiles(rows);
    });
    return () => {
      active = false;
    };
  }, []);

  return profiles;
}
