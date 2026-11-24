/**
 * Uso da tastiera del Gestionale, come un gestionale classico:
 *   Invio            campo successivo (Maiusc+Invio: precedente); sull'ultimo campo va al pulsante di conferma
 *   F10              salva / conferma la schermata o la finestra aperta
 *   ↑ ↓ ← →          ci si sposta ovunque: tra i campi, sui pulsanti, nelle righe degli elenchi.
 *                    Nelle righe del documento ↑ ↓ restano nella stessa colonna. Dentro un testo ← → muovono
 *                    prima il cursore e passano al campo vicino quando è all'inizio o alla fine.
 *                    Le tendine si aprono con ↑ ↓ (o Invio) e si lasciano con ← →.
 *   Esc              chiude la finestra, oppure torna all'elenco
 *   F1 F2 F3 F4      le aree (Contabilità, Magazzino, Documenti, Impostazioni)
 *   Maiusc+F1…F9     le schede dell'area aperta, nell'ordine in cui si vedono
 *   F5               nuovo (documento, anagrafica…); anche Ins fuori dai campi
 *   F7               porta il cursore nella casella di ricerca della schermata
 *   Ctrl+Invio       nuova riga      Ctrl+Canc  toglie la riga
 *   F6               apre il menu «Trasforma in» del documento confermato      F9  stampa PDF      F8  invia per email
 *   (Alt+1…9 continua a funzionare: prima le aree, poi le schede.)
 * Tab e Maiusc+Tab restano quelli del browser.
 */

/** Campi tra cui ci si sposta con le frecce. */
const CAMPI = 'input:not([type="hidden"]):not([type="file"]), select, textarea, button[role="combobox"], button[role="switch"]';
/** Campi su cui si ferma Invio: quelli in cui si scrive, più le caselle di scelta che poi avanzano da sole. */
const CAMPI_INVIO = 'input:not([type="hidden"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]), select, button[data-invio]';
/** Tutto ciò su cui ci si può fermare: campi, pulsanti, righe degli elenchi. */
const TUTTI = `${CAMPI}, button, a[href], [tabindex="0"]`;
const TIPI_TESTO = new Set(["text", "search", "tel", "email", "url", "password", ""]);

export type AzioneTastiera = { azione: "nuova-riga" | "togli-riga"; riga: number | null };
export const EVENTO_TASTIERA = "gestionale:tastiera";

const usabile = (el: Element): el is HTMLElement => {
  const h = el as HTMLElement & { disabled?: boolean };
  return !h.disabled && h.tabIndex !== -1 && !h.closest('[hidden], [aria-hidden="true"], [inert]');
};

const elenco = (ambito: ParentNode, selettore: string): HTMLElement[] => Array.from(ambito.querySelectorAll(selettore)).filter(usabile);

/** La finestra aperta in primo piano, altrimenti la pagina del Gestionale. */
export function ambitoDi(target: Element | null, radice: HTMLElement): HTMLElement {
  const dentro = target?.closest<HTMLElement>('[role="dialog"], [role="alertdialog"]');
  if (dentro) return dentro;
  const aperte = document.querySelectorAll<HTMLElement>('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]');
  return aperte.length > 0 ? aperte[aperte.length - 1] : radice;
}

/** Il pulsante che F10 preme: quello marcato, oppure in una finestra l'ultimo pulsante (quello di conferma). */
export function pulsanteConferma(ambito: HTMLElement): HTMLButtonElement | null {
  const marcato = elenco(ambito, "[data-f10]")[0] as HTMLButtonElement | undefined;
  if (marcato) return marcato;
  if (!ambito.matches('[role="dialog"], [role="alertdialog"]')) return null;
  const pulsanti = elenco(ambito, "button").filter((b) => !b.querySelector(".sr-only") && !b.matches('[role="combobox"], [role="switch"], [role="tab"]'));
  return (pulsanti[pulsanti.length - 1] as HTMLButtonElement | undefined) ?? null;
}

function vicino(ambito: HTMLElement, da: HTMLElement, passo: 1 | -1, selettore: string): HTMLElement | null {
  const campi = elenco(ambito, selettore);
  const i = campi.indexOf(da);
  if (i >= 0) return campi[i + passo] ?? null;
  // il campo di partenza non è nell'elenco (es. Invio da una casella esclusa): si cerca per posizione nel documento
  const dopo = campi.filter((c) => Boolean(da.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING));
  return passo === 1 ? dopo[0] ?? null : campi[campi.length - dopo.length - 1] ?? null;
}

function vai(el: HTMLElement | null): boolean {
  if (!el) return false;
  el.focus();
  if (el instanceof HTMLInputElement && TIPI_TESTO.has(el.type)) el.select();
  else if (el instanceof HTMLInputElement && el.type === "number") el.select();
  return true;
}

/** Nelle righe del documento: lo stesso campo della riga sopra o sotto. */
function stessaColonna(da: HTMLElement, passo: 1 | -1): HTMLElement | null {
  const riga = da.closest<HTMLElement>("[data-riga]");
  const colonna = da.getAttribute("aria-label");
  if (!riga || !colonna) return null;
  const righe = Array.from(riga.parentElement?.querySelectorAll<HTMLElement>(":scope > [data-riga]") ?? []);
  for (let i = righe.indexOf(riga) + passo; i >= 0 && i < righe.length; i += passo) {
    const stesso = elenco(righe[i], CAMPI).find((c) => c.getAttribute("aria-label") === colonna);
    if (stesso) return stesso;
    const descrizione = elenco(righe[i], CAMPI).find((c) => c.getAttribute("aria-label") === "Descrizione");
    if (descrizione) return descrizione;
  }
  return null;
}

const emetti = (dettaglio: AzioneTastiera) => window.dispatchEvent(new CustomEvent<AzioneTastiera>(EVENTO_TASTIERA, { detail: dettaglio }));
const rigaDi = (el: Element | null): number | null => {
  const v = el?.closest<HTMLElement>("[data-riga]")?.dataset.riga;
  return v == null ? null : Number(v);
};

/**
 * Gestisce un tasto premuto dentro il Gestionale. Restituisce true se lo ha usato
 * (in quel caso ha già fermato il comportamento del browser).
 */
export function gestisciTasto(e: KeyboardEvent, radice: HTMLElement): boolean {
  const target = e.target instanceof HTMLElement ? e.target : null;
  const fatto = () => { e.preventDefault(); e.stopPropagation(); return true; };
  // elenchi a tendina e ricerche aperte hanno le loro frecce e il loro Invio
  if (target?.closest('[cmdk-root], [role="listbox"], [role="menu"]')) return false;
  const ambito = ambitoDi(target, radice);
  if (target && !ambito.contains(target) && target !== document.body) return false;
  const inFinestra = ambito !== radice;

  if (e.key === "F10" && !e.shiftKey && !e.ctrlKey && !e.altKey) {
    const b = pulsanteConferma(ambito);
    if (!b) return fatto();
    (document.activeElement as HTMLElement | null)?.blur?.();   // chiude la scrittura nel campo corrente
    b.focus();
    b.click();
    return fatto();
  }

  /** Aree e schede visibili (le schede non attive hanno tabindex -1: contano lo stesso). */
  const visibili = (selettore: string) => Array.from(radice.querySelectorAll<HTMLElement>(selettore))
    .filter((el) => !(el as HTMLButtonElement).disabled && !el.closest('[hidden], [aria-hidden="true"], [inert]'));
  const apri = (scheda: HTMLElement | undefined) => {
    if (!scheda) return false;
    scheda.focus();
    scheda.click();
    // Radix cambia scheda su mousedown: lo si simula per chi usa solo la tastiera
    scheda.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
    return true;
  };

  // F1…F4 le aree, Maiusc+F1…F9 le schede dell'area aperta
  const funzione = /^F([1-9])$/.exec(e.key);
  if (funzione && !e.ctrlKey && !e.altKey && !e.metaKey) {
    const n = Number(funzione[1]);
    const aree = visibili("[data-macro]");
    if (e.shiftKey) {
      if (!inFinestra) apri(visibili('[role="tablist"] [role="tab"]')[n - 1]);
      return fatto();
    }
    if (n <= aree.length) {
      // con una finestra aperta non si cambia area, ma F1 non deve aprire la guida del browser
      if (!inFinestra) apri(aree[n - 1]);
      return fatto();
    }
  }

  // Alt+numero: prima le aree, poi le schede. Con Alt alcune tastiere cambiano il carattere (sul Mac Alt+2 è «™»): si guarda il tasto fisico
  const cifra = /^[1-9]$/.test(e.key) ? e.key : /^(Digit|Numpad)[1-9]$/.test(e.code) ? e.code.slice(-1) : null;
  if (e.altKey && !e.ctrlKey && cifra && !inFinestra) {
    return apri([...visibili("[data-macro]"), ...visibili('[role="tablist"] [role="tab"]')][Number(cifra) - 1]) ? fatto() : false;
  }

  // F5 e F7 si fermano sempre: nel browser ricaricherebbero la pagina o aprirebbero altro
  if (e.key === "F5" || (!inFinestra && e.key === "Insert" && !target?.matches("input, textarea"))) {
    const nuovo = inFinestra ? undefined : elenco(radice, "[data-nuovo]")[0];
    if (!nuovo) return e.key === "F5" ? fatto() : false;
    nuovo.click();
    return fatto();
  }
  if (e.key === "F7") {
    if (!inFinestra) vai(elenco(radice, "[data-cerca]")[0] ?? null);
    return fatto();
  }
  if (!inFinestra && e.key === "F8") {
    const posta = elenco(radice, "[data-email]")[0];
    if (!posta) return false;
    posta.click();
    return fatto();
  }
  if (!inFinestra && e.key === "F9") {
    const stampa = elenco(radice, "[data-stampa]")[0];
    if (!stampa) return false;
    stampa.click();
    return fatto();
  }
  if (!inFinestra && e.key === "F6") {
    const menu = elenco(radice, "[data-trasforma]")[0];
    if (!menu) return false;
    menu.focus();
    // il menu si apre con la freccia giù, come da tastiera
    menu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    return fatto();
  }
  if (!inFinestra && e.key === "Enter" && e.ctrlKey && radice.querySelector("[data-righe-modificabili]")) { emetti({ azione: "nuova-riga", riga: rigaDi(target) }); return fatto(); }
  if (!inFinestra && e.key === "Delete" && e.ctrlKey && rigaDi(target) != null) { emetti({ azione: "togli-riga", riga: rigaDi(target) }); return fatto(); }

  if (e.key === "Escape" && !inFinestra) {
    if (document.querySelector('[data-radix-popper-content-wrapper], [role="listbox"]')) return false;
    const indietro = elenco(radice, "[data-esc]")[0];
    if (!indietro) return false;
    indietro.click();
    return fatto();
  }

  if (!target) return false;

  // righe degli elenchi: frecce per scorrere, Invio per aprire
  if (target.matches("[data-elenco]")) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const righe = elenco(ambito, "[data-elenco]");
      const p = e.key === "ArrowDown" ? 1 : -1;
      // in cima all'elenco ↑ risale ai pulsanti sopra
      if (!vai(righe[righe.indexOf(target) + p] ?? null)) vai(vicino(ambito, target, p, TUTTI));
      return fatto();
    }
    if (e.key === "Enter") { target.click(); return fatto(); }
    return false;
  }

  const eInput = target instanceof HTMLInputElement;
  const eTesto = eInput && TIPI_TESTO.has(target.type);
  const eNumero = eInput && target.type === "number";
  const eScelta = target.matches('button[role="combobox"], button[role="switch"]');

  if (e.key === "Enter" && !e.ctrlKey && !e.altKey) {
    if (!(eInput && target.type !== "checkbox" && target.type !== "radio") && !(target instanceof HTMLSelectElement)) return false;
    if (e.shiftKey) { vai(vicino(ambito, target, -1, CAMPI_INVIO)); return fatto(); }
    const prossimo = vicino(ambito, target, 1, CAMPI_INVIO);
    // ultima riga del documento: Invio sull'ultimo campo ne apre una nuova
    const riga = target.closest("[data-riga]");
    if (riga && !riga.nextElementSibling?.matches("[data-riga]") && (!prossimo || !riga.contains(prossimo)) && riga.closest("[data-righe-modificabili]")) {
      emetti({ azione: "nuova-riga", riga: rigaDi(target) });
      return fatto();
    }
    if (!vai(prossimo)) pulsanteConferma(ambito)?.focus();
    return fatto();
  }

  if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return false;
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "ArrowRight" && e.key !== "ArrowLeft") return false;

  const verticale = e.key === "ArrowDown" || e.key === "ArrowUp";
  const passo = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1;
  /** Da un campo si va al campo vicino; finiti i campi (o partendo da un pulsante) si passa da tutto. */
  const sposta = (campi: boolean) => vai((campi ? vicino(ambito, target, passo, CAMPI) : null) ?? vicino(ambito, target, passo, TUTTI));

  if (eTesto || target instanceof HTMLTextAreaElement) {
    const { selectionStart: da, selectionEnd: a, value } = target as HTMLInputElement | HTMLTextAreaElement;
    const areaDiTesto = target instanceof HTMLTextAreaElement;
    // dentro il testo le frecce muovono il cursore; si esce solo dal bordo
    if (!verticale || areaDiTesto) {
      if (da !== a) return false;
      if (passo === 1 ? a !== value.length : da !== 0) return false;
    }
    if (!vai(verticale ? stessaColonna(target, passo) : null)) sposta(true);
    return fatto();
  }
  if (eNumero) {
    // sui numeri la freccia non cambia più il valore: sposta, come negli altri campi
    if (!vai(verticale ? stessaColonna(target, passo) : null)) sposta(true);
    return fatto();
  }
  if (eInput && ["date", "time", "datetime-local", "month"].includes(target.type)) {
    if (!verticale) return false;          // ← → passano da giorno a mese ad anno
    sposta(true);
    return fatto();
  }
  if (target instanceof HTMLSelectElement || (target.matches('button[role="combobox"]') && !target.matches("[data-invio]"))) {
    if (verticale) return false;           // ↑ ↓ aprono la tendina o cambiano la scelta
    sposta(true);
    return fatto();
  }
  if (target.matches('[role="tab"]')) {
    if (!verticale) return false;          // ← → scorrono le sezioni
    return sposta(false) ? fatto() : false;
  }
  if (target === document.body) {
    // niente di selezionato: la prima freccia porta sulla prima riga dell'elenco o sul primo campo
    const primo = elenco(ambito, "[data-elenco]")[0] ?? elenco(ambito, CAMPI)[0] ?? elenco(ambito, "[data-nuovo], [data-esc]")[0];
    return vai(primo ?? null) ? fatto() : false;
  }
  if (target.matches(`${CAMPI}, button, a[href], [tabindex="0"]`)) {
    if (target.matches("[data-elenco]") && !verticale) return false;
    return sposta(target.matches(CAMPI)) ? fatto() : false;
  }
  return false;
}

/** Porta il cursore sul campo che viene dopo un altro (dopo aver scelto da una casella di ricerca). */
export function campoDopo(da: HTMLElement): void {
  const ambito = da.closest<HTMLElement>('[role="dialog"], [data-gestionale]') ?? document.body;
  vai(vicino(ambito, da, 1, CAMPI_INVIO));
}
