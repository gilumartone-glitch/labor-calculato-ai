/**
 * Codice QR, scritto qui per non aggiungere una libreria al progetto.
 * Modalità a byte (UTF-8), correzione d'errore M (regge circa il 15% di danni: adatta a un'etichetta
 * di magazzino), versioni da 1 a 10: fino a 213 caratteri, molto più di quanto serve a un indirizzo.
 * Segue lo standard ISO/IEC 18004.
 */

const ECC_PER_BLOCCO = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];   // livello M, versioni 1-10
const BLOCCHI = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const VERSIONE_MAX = 10;

/** Moduli disponibili per i dati in una versione, tolti i disegni fissi. */
function moduliDati(ver: number): number {
  let n = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const allineamenti = Math.floor(ver / 7) + 2;
    n -= (25 * allineamenti - 10) * allineamenti - 55;
    if (ver >= 7) n -= 36;
  }
  return n;
}
const paroleDati = (ver: number) => Math.floor(moduliDati(ver) / 8) - ECC_PER_BLOCCO[ver] * BLOCCHI[ver];
/** Quanti byte di testo entrano in una versione. */
export const capienzaQr = (ver: number) => paroleDati(ver) - (ver < 10 ? 2 : 3);

/* ---- Reed-Solomon sul campo GF(256) ---- */
function moltiplica(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}
function divisore(grado: number): number[] {
  const r = new Array<number>(grado).fill(0);
  r[grado - 1] = 1;
  let radice = 1;
  for (let i = 0; i < grado; i++) {
    for (let j = 0; j < grado; j++) {
      r[j] = moltiplica(r[j], radice);
      if (j + 1 < grado) r[j] ^= r[j + 1];
    }
    radice = moltiplica(radice, 0x02);
  }
  return r;
}
function resto(dati: number[], div: number[]): number[] {
  const r = div.map(() => 0);
  for (const b of dati) {
    const fattore = b ^ (r.shift() as number);
    r.push(0);
    div.forEach((c, i) => { r[i] ^= moltiplica(c, fattore); });
  }
  return r;
}

/** Divide i dati in blocchi, aggiunge a ciascuno la correzione d'errore e li intreccia. */
function conCorrezione(dati: number[], ver: number): number[] {
  const blocchi = BLOCCHI[ver];
  const ecc = ECC_PER_BLOCCO[ver];
  const totale = Math.floor(moduliDati(ver) / 8);
  const corti = blocchi - (totale % blocchi);
  const lunghezzaCorto = Math.floor(totale / blocchi);
  const div = divisore(ecc);
  const pezzi: number[][] = [];
  for (let i = 0, k = 0; i < blocchi; i++) {
    const d = dati.slice(k, k + lunghezzaCorto - ecc + (i < corti ? 0 : 1));
    k += d.length;
    const e = resto(d, div);
    if (i < corti) d.push(0);   // segnaposto, saltato nell'intreccio
    pezzi.push(d.concat(e));
  }
  const esito: number[] = [];
  for (let i = 0; i < pezzi[0].length; i++) {
    pezzi.forEach((p, j) => { if (i !== lunghezzaCorto - ecc || j >= corti) esito.push(p[i]); });
  }
  return esito;
}

/**
 * Crea il codice QR di un testo. Restituisce la griglia di moduli: true = scuro.
 * Intorno va lasciato un margine chiaro di 4 moduli.
 */
export function creaQr(testo: string): boolean[][] {
  const byte = Array.from(new TextEncoder().encode(testo));
  let ver = 1;
  while (ver <= VERSIONE_MAX && byte.length > capienzaQr(ver)) ver++;
  if (ver > VERSIONE_MAX) throw new Error(`Testo troppo lungo per il codice QR: ${byte.length} caratteri, massimo ${capienzaQr(VERSIONE_MAX)}.`);

  /* ---- flusso di bit: modalità, lunghezza, dati, riempimento ---- */
  const bit: number[] = [];
  const aggiungi = (valore: number, quanti: number) => { for (let i = quanti - 1; i >= 0; i--) bit.push((valore >>> i) & 1); };
  aggiungi(0x4, 4);
  aggiungi(byte.length, ver < 10 ? 8 : 16);
  byte.forEach((b) => aggiungi(b, 8));
  const capienzaBit = paroleDati(ver) * 8;
  aggiungi(0, Math.min(4, capienzaBit - bit.length));
  aggiungi(0, (8 - (bit.length % 8)) % 8);
  for (let riempimento = 0xec; bit.length < capienzaBit; riempimento ^= 0xec ^ 0x11) aggiungi(riempimento, 8);
  const parole: number[] = [];
  for (let i = 0; i < bit.length; i += 8) parole.push(bit.slice(i, i + 8).reduce((v, b) => (v << 1) | b, 0));
  const tutte = conCorrezione(parole, ver);

  /* ---- griglia e disegni fissi ---- */
  const lato = ver * 4 + 17;
  const moduli = Array.from({ length: lato }, () => new Array<boolean>(lato).fill(false));
  const fisso = Array.from({ length: lato }, () => new Array<boolean>(lato).fill(false));
  const metti = (x: number, y: number, scuro: boolean) => { moduli[y][x] = scuro; fisso[y][x] = true; };

  for (let i = 0; i < lato; i++) { metti(6, i, i % 2 === 0); metti(i, 6, i % 2 === 0); }
  const mirino = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy)); const x = cx + dx; const y = cy + dy;
      if (x >= 0 && x < lato && y >= 0 && y < lato) metti(x, y, d !== 2 && d !== 4);
    }
  };
  mirino(3, 3); mirino(lato - 4, 3); mirino(3, lato - 4);
  if (ver >= 2) {
    const quanti = Math.floor(ver / 7) + 2;
    const passo = Math.floor((ver * 8 + quanti * 3 + 5) / (quanti * 4 - 4)) * 2;
    const posizioni = [6];
    for (let p = lato - 7; posizioni.length < quanti; p -= passo) posizioni.splice(1, 0, p);
    posizioni.forEach((cy, i) => posizioni.forEach((cx, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === quanti - 1) || (i === quanti - 1 && j === 0)) return;   // lì ci sono i mirini
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) metti(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }));
  }
  const formato = (maschera: number) => {
    const dati = (0 << 3) | maschera;   // 0 = livello di correzione M
    let r = dati;
    for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    const b = ((dati << 10) | r) ^ 0x5412;
    const v = (i: number) => ((b >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) metti(8, i, v(i));
    metti(8, 7, v(6)); metti(8, 8, v(7)); metti(7, 8, v(8));
    for (let i = 9; i < 15; i++) metti(14 - i, 8, v(i));
    for (let i = 0; i < 8; i++) metti(lato - 1 - i, 8, v(i));
    for (let i = 8; i < 15; i++) metti(8, lato - 15 + i, v(i));
    metti(8, lato - 8, true);
  };
  formato(0);   // prenota le caselle; il valore vero si scrive dopo aver scelto la maschera
  if (ver >= 7) {
    let r = ver;
    for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
    const b = (ver << 12) | r;
    for (let i = 0; i < 18; i++) {
      const scuro = ((b >>> i) & 1) !== 0; const a = lato - 11 + (i % 3); const c = Math.floor(i / 3);
      metti(a, c, scuro); metti(c, a, scuro);
    }
  }

  /* ---- dati a zig-zag, dal basso a destra ---- */
  let k = 0;
  for (let destra = lato - 1; destra >= 1; destra -= 2) {
    if (destra === 6) destra = 5;
    for (let passo = 0; passo < lato; passo++) for (let j = 0; j < 2; j++) {
      const x = destra - j;
      const su = ((destra + 1) & 2) === 0;
      const y = su ? lato - 1 - passo : passo;
      if (!fisso[y][x] && k < tutte.length * 8) { moduli[y][x] = ((tutte[k >>> 3] >>> (7 - (k & 7))) & 1) !== 0; k++; }
    }
  }

  /* ---- maschera: si provano tutte e otto e si tiene la più leggibile ---- */
  const MASCHERE: ((x: number, y: number) => boolean)[] = [
    (x, y) => (x + y) % 2 === 0, (_x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];
  const applica = (m: number) => { for (let y = 0; y < lato; y++) for (let x = 0; x < lato; x++) if (!fisso[y][x] && MASCHERE[m](x, y)) moduli[y][x] = !moduli[y][x]; };
  const penalita = (): number => {
    let p = 0;
    const linea = (leggi: (i: number, j: number) => boolean) => {
      for (let i = 0; i < lato; i++) {
        let serie = 1; let storia = 0;
        for (let j = 0; j < lato; j++) {
          const v = leggi(i, j);
          if (j > 0 && v === leggi(i, j - 1)) { serie++; if (serie === 5) p += 3; else if (serie > 5) p++; } else serie = 1;
          // disegno che somiglia a un mirino: scuro-chiaro-scuro scuro scuro-chiaro-scuro con quattro chiari accanto
          storia = ((storia << 1) | (v ? 1 : 0)) & 0x7ff;
          if (j >= 10 && (storia === 0x5d0 || storia === 0x05d)) p += 40;
        }
      }
    };
    linea((i, j) => moduli[i][j]);
    linea((i, j) => moduli[j][i]);
    for (let y = 0; y < lato - 1; y++) for (let x = 0; x < lato - 1; x++) {
      const v = moduli[y][x];
      if (v === moduli[y][x + 1] && v === moduli[y + 1][x] && v === moduli[y + 1][x + 1]) p += 3;
    }
    const scuri = moduli.reduce((t, r) => t + r.filter(Boolean).length, 0);
    p += Math.floor(Math.abs((scuri * 20) / (lato * lato) - 10)) * 10;
    return p;
  };
  let migliore = 0; let minimo = Infinity;
  for (let m = 0; m < 8; m++) {
    applica(m); formato(m);
    const p = penalita();
    if (p < minimo) { minimo = p; migliore = m; }
    applica(m);   // la stessa operazione due volte la toglie
  }
  applica(migliore); formato(migliore);
  return moduli;
}
