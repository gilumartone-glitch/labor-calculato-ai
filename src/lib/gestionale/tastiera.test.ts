import { afterEach, describe, expect, it, vi } from "vitest";
import { EVENTO_TASTIERA, gestisciTasto, pulsanteConferma, type AzioneTastiera } from "./tastiera";

const monta = (html: string): HTMLElement => {
  document.body.innerHTML = `<div data-gestionale id="radice">${html}</div>`;
  return document.getElementById("radice") as HTMLElement;
};
const premi = (el: Element, key: string, opz: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opz });
  Object.defineProperty(e, "target", { value: el });
  const usato = gestisciTasto(e, document.getElementById("radice") as HTMLElement);
  return { usato, fermato: e.defaultPrevented };
};
const $ = (id: string) => document.getElementById(id) as HTMLInputElement;
const attivo = () => document.activeElement?.id;

afterEach(() => { document.body.innerHTML = ""; });

describe("Invio", () => {
  it("passa al campo successivo saltando disabilitati, aree di testo e tendine; alla fine va sul pulsante di conferma", () => {
    monta(`<input id="a"><input id="b" disabled><button role="combobox" id="t"></button><textarea id="x"></textarea><input id="c" type="number"><button id="salva" data-f10>Salva</button>`);
    $("a").focus();
    expect(premi($("a"), "Enter")).toEqual({ usato: true, fermato: true });
    expect(attivo()).toBe("c");
    premi($("c"), "Enter");
    expect(attivo()).toBe("salva");
    premi($("c"), "Enter", { shiftKey: true });
    expect(attivo()).toBe("a");
  });
  it("non tocca Invio nelle aree di testo e sui pulsanti", () => {
    monta(`<textarea id="x"></textarea><button id="p">Ok</button>`);
    expect(premi($("x"), "Enter").usato).toBe(false);
    expect(premi($("p"), "Enter").usato).toBe(false);
  });
  it("la casella di ricerca del cliente è una tappa di Invio", () => {
    monta(`<input id="a"><button role="combobox" data-invio id="cliente"></button><input id="b">`);
    premi($("a"), "Enter");
    expect(attivo()).toBe("cliente");
    expect(premi($("cliente"), "Enter").usato).toBe(false);   // si apre da sola
  });
});

describe("F10", () => {
  it("preme il primo pulsante di conferma attivo della pagina", () => {
    monta(`<input id="a"><button id="salva" data-f10 disabled>Salva</button><button id="conferma" data-f10>Conferma</button>`);
    const click = vi.fn();
    $("conferma").addEventListener("click", click);
    expect(premi($("a"), "F10")).toEqual({ usato: true, fermato: true });
    expect(click).toHaveBeenCalledTimes(1);
  });
  it("in una finestra aperta vale per la finestra: l'ultimo pulsante, non la X", () => {
    monta(`<button id="fuori" data-f10>Salva documento</button>
      <div role="dialog" data-state="open" id="dlg"><input id="n"><button id="annulla">Annulla</button><button id="ok">Registra</button><button id="x"><span class="sr-only">Close</span></button></div>`);
    expect(pulsanteConferma(document.getElementById("dlg") as HTMLElement)?.id).toBe("ok");
    const fuori = vi.fn(); const ok = vi.fn();
    $("fuori").addEventListener("click", fuori); $("ok").addEventListener("click", ok);
    premi(document.body, "F10");
    expect(ok).toHaveBeenCalledTimes(1);
    expect(fuori).not.toHaveBeenCalled();
  });
});

describe("frecce", () => {
  it("su e giù tra i campi, date comprese; sui numeri non cambiano il valore; le tendine restano loro", () => {
    monta(`<input id="a"><input id="b" type="number" value="5"><input id="c" type="date"><select id="s"></select><input id="z">`);
    premi($("a"), "ArrowDown");
    expect(attivo()).toBe("b");
    expect(premi($("b"), "ArrowUp")).toEqual({ usato: true, fermato: true });
    expect(attivo()).toBe("a");
    premi($("b"), "ArrowRight");
    expect(attivo()).toBe("c");
    expect(premi($("c"), "ArrowRight").usato).toBe(false);   // giorno → mese → anno
    premi($("c"), "ArrowDown");
    expect(attivo()).toBe("s");
    expect(premi($("s"), "ArrowDown").usato).toBe(false);
    premi($("s"), "ArrowRight");
    expect(attivo()).toBe("z");
  });
  it("con le frecce si arriva anche ai pulsanti e si torna indietro", () => {
    monta(`<button id="elenco">Elenco</button><button id="trasforma">Trasforma</button><input id="a" value="x" disabled><input id="b" value=""><button id="salva">Salva</button>`);
    $("elenco").focus();
    premi($("elenco"), "ArrowRight");
    expect(attivo()).toBe("trasforma");
    premi($("trasforma"), "ArrowDown");
    expect(attivo()).toBe("b");               // il campo chiuso si salta
    premi($("b"), "ArrowDown");
    expect(attivo()).toBe("salva");           // finiti i campi si passa ai pulsanti
    premi($("salva"), "ArrowUp");
    expect(attivo()).toBe("b");
    premi($("b"), "ArrowUp");
    expect(attivo()).toBe("trasforma");
  });
  it("senza niente di selezionato la freccia porta sulla prima riga o sul primo campo", () => {
    monta(`<button id="p">x</button><table><tbody><tr id="r1" data-elenco tabindex="0"></tr></tbody></table>`);
    premi(document.body, "ArrowDown");
    expect(attivo()).toBe("r1");
    premi($("r1"), "ArrowUp");
    expect(attivo()).toBe("p");               // in cima all'elenco si risale ai pulsanti
  });
  it("nelle note a più righe si esce solo dall'inizio o dalla fine", () => {
    monta(`<input id="a"><textarea id="x">riga uno\nriga due</textarea><input id="b">`);
    const x = document.getElementById("x") as HTMLTextAreaElement;
    x.focus(); x.setSelectionRange(3, 3);
    expect(premi(x, "ArrowDown").usato).toBe(false);
    x.setSelectionRange(x.value.length, x.value.length);
    premi(x, "ArrowDown");
    expect(attivo()).toBe("b");
    x.focus(); x.setSelectionRange(0, 0);
    premi(x, "ArrowUp");
    expect(attivo()).toBe("a");
  });
  it("nelle righe del documento restano nella stessa colonna", () => {
    monta(`<div data-righe-modificabili><div>
      <div data-riga="0"><input id="d0" aria-label="Descrizione"><input id="q0" aria-label="Quantità" type="number"></div>
      <div data-riga="1"><input id="d1" aria-label="Descrizione"></div>
      <div data-riga="2"><input id="d2" aria-label="Descrizione"><input id="q2" aria-label="Quantità" type="number"></div>
    </div></div>`);
    premi($("q0"), "ArrowDown");
    expect(attivo()).toBe("d1");          // la nota non ha quantità: ci si ferma sulla sua descrizione
    premi($("q2"), "ArrowUp");
    expect(attivo()).toBe("d1");
    premi($("d1"), "ArrowDown");
    expect(attivo()).toBe("d2");
  });
  it("destra e sinistra solo quando il cursore è in fondo o all'inizio", () => {
    monta(`<input id="a" value="abc"><input id="b" value="xyz">`);
    $("a").focus(); $("a").setSelectionRange(1, 1);
    expect(premi($("a"), "ArrowRight").usato).toBe(false);
    $("a").setSelectionRange(3, 3);
    expect(premi($("a"), "ArrowRight").usato).toBe(true);
    expect(attivo()).toBe("b");
    $("b").setSelectionRange(0, 0);
    premi($("b"), "ArrowLeft");
    expect(attivo()).toBe("a");
  });
  it("le ricerche e le tendine aperte tengono i loro tasti", () => {
    monta(`<div cmdk-root><input id="cerca"></div>`);
    expect(premi($("cerca"), "ArrowDown").usato).toBe(false);
    expect(premi($("cerca"), "Enter").usato).toBe(false);
  });
});

describe("righe, elenchi, sezioni", () => {
  it("Invio sull'ultimo campo dell'ultima riga, Ctrl+Invio e Ctrl+Canc avvisano l'editor", () => {
    monta(`<div data-righe-modificabili><div>
      <div data-riga="0"><input id="d0" aria-label="Descrizione"><input id="s0" aria-label="Sconto percentuale"></div>
      <div data-riga="1"><input id="d1" aria-label="Descrizione"><input id="s1" aria-label="Sconto percentuale"></div>
    </div></div><input id="note">`);
    const azioni: AzioneTastiera[] = [];
    const ascolta = (e: Event) => azioni.push((e as CustomEvent<AzioneTastiera>).detail);
    window.addEventListener(EVENTO_TASTIERA, ascolta);
    premi($("s0"), "Enter");
    expect(attivo()).toBe("d1");
    premi($("s1"), "Enter");
    premi($("d0"), "Enter", { ctrlKey: true });
    premi($("d1"), "Delete", { ctrlKey: true });
    window.removeEventListener(EVENTO_TASTIERA, ascolta);
    expect(azioni).toEqual([{ azione: "nuova-riga", riga: 1 }, { azione: "nuova-riga", riga: 0 }, { azione: "togli-riga", riga: 1 }]);
  });
  it("negli elenchi le frecce scorrono e Invio apre", () => {
    monta(`<table><tbody><tr id="r1" data-elenco tabindex="0"></tr><tr id="r2" data-elenco tabindex="0"></tr></tbody></table>`);
    const apri = vi.fn();
    $("r2").addEventListener("click", apri);
    premi($("r1"), "ArrowDown");
    expect(attivo()).toBe("r2");
    premi($("r2"), "Enter");
    expect(apri).toHaveBeenCalledTimes(1);
  });
  it("Alt+1 2 3 aprono le aree, da Alt+4 le schede dell'area, anche quelle non attive", () => {
    monta(`<button data-macro id="m1"></button><button data-macro id="m2"></button><button data-macro id="m3"></button>
      <div role="tablist"><button role="tab" id="s1" tabindex="0"></button><button role="tab" id="s2" tabindex="-1"></button></div><input id="a">`);
    const premuti: string[] = [];
    for (const id of ["m1", "m2", "m3", "s1", "s2"]) $(id).addEventListener("click", () => premuti.push(id));
    premi($("a"), "2", { altKey: true }); premi($("a"), "4", { altKey: true }); premi($("a"), "5", { altKey: true });
    expect(premuti).toEqual(["m2", "s1", "s2"]);
    expect(premi($("a"), "9", { altKey: true }).usato).toBe(false);
  });
  it("F5 nuovo, Esc indietro, Alt+numero cambia sezione; Esc non scavalca una finestra aperta", () => {
    monta(`<div role="tablist"><button role="tab" id="t1"></button><button role="tab" id="t2"></button></div><button id="nuovo" data-nuovo></button><button id="ind" data-esc></button><input id="a">`);
    const nuovo = vi.fn(); const ind = vi.fn(); const t2 = vi.fn();
    $("nuovo").addEventListener("click", nuovo); $("ind").addEventListener("click", ind); $("t2").addEventListener("click", t2);
    premi($("a"), "F5"); premi($("a"), "Escape"); premi($("a"), "2", { altKey: true });
    premi($("a"), "™", { altKey: true, code: "Digit2" });   // Alt+2 sul Mac
    expect([nuovo.mock.calls.length, ind.mock.calls.length, t2.mock.calls.length]).toEqual([1, 1, 2]);
    document.getElementById("radice")?.insertAdjacentHTML("beforeend", `<div role="dialog" data-state="open"><input id="dentro"></div>`);
    expect(premi($("dentro"), "Escape").usato).toBe(false);
    expect(ind).toHaveBeenCalledTimes(1);
  });
});
