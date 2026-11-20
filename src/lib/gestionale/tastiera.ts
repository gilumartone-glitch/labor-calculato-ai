/**
 * Uso da tastiera del Gestionale, come un gestionale classico:
 *   Invio            campo successivo (Maiusc+Invio: precedente); sull'ultimo campo va al pulsante di conferma
 *   F10              salva / conferma la schermata o la finestra aperta
 *   ↑ ↓              campo precedente / successivo; nelle righe del documento, stessa colonna della riga sopra / sotto
 *   ← →              campo precedente / successivo quando il cursore è all'inizio / alla fine
 *   Esc              chiude la finestra, oppure torna all'elenco
 *   F2               nuovo (documento, anagrafica…)      F4  nuova riga      Ctrl+Canc  toglie la riga
 *   F6               apre il menu «Trasforma in» del documento confermato
 *   Alt+1…9          cambia sezione
 * Tab e Maiusc+Tab restano quelli del browser.
 */

/** Campi tra cui ci si sposta con le frecce. */
const CAMPI = 'input:not([type="hidden"]):not([type="file"]), select, textarea, button[role="combobox"], button[role="switch"]';
/** Campi su cui si ferma Invio: quelli in cui si scrive, più le caselle di scelta che poi avanzano da sole. */
const CAMPI_INVIO = 'input:not([type="hidden"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]), select, button[data-invio]';
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

  // con Alt premuto alcune tastiere cambiano il carattere (sul Mac Alt+2 è «™»): si guarda il tasto fisico
  const cifra = /^[1-9]$/.test(e.key) ? e.key : /^(Digit|Numpad)[1-9]$/.test(e.code) ? e.code.slice(-1) : null;
  if (e.altKey && !e.ctrlKey && cifra && !inFinestra) {
    const schede = elenco(radice, '[role="tablist"] [role="tab"]');
    const scheda = schede[Number(cifra) - 1];
    if (!scheda) return false;
    scheda.focus();
    scheda.click();
    // Radix cambia scheda su mousedown: lo si simula per chi usa solo la tastiera
    scheda.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
    return fatto();
  }

  if (!inFinestra && (e.key === "F2" || (e.key === "Insert" && !target?.matches("input, textarea")))) {
    const nuovo = elenco(radice, "[data-nuovo]")[0];
    if (!nuovo) return false;
    nuovo.click();
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
  if (!inFinestra && e.key === "F4") { emetti({ azione: "nuova-riga", riga: rigaDi(target) }); return fatto(); }
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
      vai(righe[righe.indexOf(target) + (e.key === "ArrowDown" ? 1 : -1)] ?? null);
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

  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    // le tendine si aprono con le frecce, le date e le aree di testo le usano per conto loro
    if (!(eTesto || eNumero || target.matches("button[data-invio]"))) return false;
    const passo = e.key === "ArrowDown" ? 1 : -1;
    vai(stessaColonna(target, passo) ?? vicino(ambito, target, passo, CAMPI));
    return fatto();   // sui numeri evita anche che la freccia cambi il valore
  }

  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
    const passo = e.key === "ArrowRight" ? 1 : -1;
    if (eTesto) {
      const { selectionStart: da, selectionEnd: a, value } = target;
      if (da !== a) return false;
      if (passo === 1 ? a !== value.length : da !== 0) return false;
    } else if (!eScelta) return false;
    return vai(vicino(ambito, target, passo, CAMPI)) ? fatto() : false;
  }
  return false;
}

/** Porta il cursore sul campo che viene dopo un altro (dopo aver scelto da una casella di ricerca). */
export function campoDopo(da: HTMLElement): void {
  const ambito = da.closest<HTMLElement>('[role="dialog"], [data-gestionale]') ?? document.body;
  vai(vicino(ambito, da, 1, CAMPI_INVIO));
}
