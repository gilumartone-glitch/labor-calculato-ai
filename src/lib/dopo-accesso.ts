/**
 * Chi apre un indirizzo del Gestionale senza aver fatto l'accesso (per esempio inquadrando
 * l'etichetta di una pezza con il telefono) dopo l'accesso deve arrivare lì, non all'hub.
 * Vale solo per gli indirizzi interni del Gestionale.
 */
const CHIAVE = "dopo-accesso";
const ammesso = (percorso: string) => /^\/gestionale(\?|$)/.test(percorso);

export function ricordaDestinazione(percorso: string): void {
  if (!ammesso(percorso)) return;
  try { sessionStorage.setItem(CHIAVE, percorso); } catch { /* si finirà all'hub */ }
}

export function destinazioneDopoAccesso(): string {
  try {
    const percorso = sessionStorage.getItem(CHIAVE);
    sessionStorage.removeItem(CHIAVE);
    if (percorso && ammesso(percorso)) return percorso;
  } catch { /* si va all'hub */ }
  return "/hub";
}
