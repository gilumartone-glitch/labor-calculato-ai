import { ProdDept } from "./types";

/** Template di checklist per reparto. Vengono creati al primo apertura del sub se è vuota. */
export const CHECKLIST_TEMPLATES: Record<ProdDept, string[]> = {
  progettazione: [
    "Verifica brief e misure ricevute",
    "Conferma file sorgente del cliente",
    "Disegno tecnico / esecutivo",
    "Imposta colori (CMYK / RAL / Pantone)",
    "Esporta esecutivo e nesting",
    "Salva file pronto produzione nella commessa",
  ],
  stampa: [
    "Controlla nesting e disposizione",
    "Verifica materiale e profilo colore",
    "Test stampa di prova",
    "Avvia stampa definitiva",
    "Controllo qualità post-stampa",
  ],
  taglio: [
    "Verifica nesting e DXF",
    "Controllo lastra e spessore",
    "Imposta utensile / lama",
    "Esegui taglio",
    "Verifica misure pezzi tagliati",
    "Sbavatura / pulizia bordi",
  ],
  tappezzeria: [
    "Verifica tessuto / pelle (codice e quantità)",
    "Taglio tessuto su misura",
    "Cucitura / preparazione",
    "Rivestimento struttura",
    "Controllo qualità finale",
  ],
  stampa_3d: [
    "Verifica file STL / 3MF",
    "Slicing e parametri stampa",
    "Caricamento filamento / resina",
    "Avvio stampa",
    "Post-processing (rimozione supporti, lavaggio)",
  ],
  falegnameria: [
    "Verifica disegno tecnico",
    "Selezione legno / pannello",
    "Taglio e fresatura",
    "Assemblaggio",
    "Finitura (carteggio, verniciatura)",
  ],
  assemblaggio: [
    "Raccolta componenti dalla commessa",
    "Verifica integrità pezzi",
    "Montaggio secondo disegno",
    "Controllo funzionale",
    "Imballo per consegna",
  ],
  laboratorio: [
    "Lettura ordine e istruzioni",
    "Verifica materiale disponibile",
    "Preparazione macchinari/utensili",
    "Esecuzione lavorazione",
    "Controllo qualità",
    "Imballo / pronto per consegna",
  ],
  magazzino: [
    "Verifica disponibilità materiale",
    "Prelievo articoli da magazzino",
    "Controllo quantità e integrità",
    "Imballo / preparazione per consegna",
    "Pronto per ritiro o spedizione",
  ],
  acquisti: [
    "Richiesta preventivo fornitore",
    "Conferma ordine al fornitore",
    "Attesa consegna materiale",
    "Ricezione e controllo merce",
    "Carico a magazzino",
  ],
  vendite: [
    "Conferma ordine cliente",
    "Verifica condizioni commerciali",
    "Coordinamento con produzione",
    "Comunicazione con il cliente",
  ],
  altro: [
    "Verifica istruzioni",
    "Esecuzione lavorazione",
    "Controllo finale",
  ],
};
