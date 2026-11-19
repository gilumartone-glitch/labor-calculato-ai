import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Plus, Loader2, Trash2, Check, Ban, ArrowRight, ChevronsUpDown, Save, ArrowUp, ArrowDown, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { toast } from "@/hooks/use-toast";
import { eur } from "@/lib/format";
import { descriviVariante, type Articolo, type Variante } from "@/lib/gestionale/types";
import {
  TIPI_DOCUMENTO, TIPO_LABEL, TIPO_LABEL_PLURALE, TIPO_RIGA_LABEL, TRASFORMAZIONI, isPassivo,
  annullaDocumento, calcolaTotali, confermaDocumento, creaDocumento, documentiCollegati, elencoDocumenti,
  importoRiga, leggiDocumento, muoveMagazzino, rigaVuota, salvaBozza, sommaPezze, titoloDocumento, trasformaDocumento,
  type AliquotaIva, type Anagrafica, type Documento, type PezzaRiga, type RiepilogoIva, type RigaBozza, type Testata,
  type TipoDocumento, type TipoRiga,
} from "@/lib/gestionale/documenti";
import { elencoPezze } from "@/lib/gestionale/api";
import type { PezzaGiacenza } from "@/lib/gestionale/types";
import { AnagraficaDialog } from "./AnagraficheTab";

const messaggio = (e: unknown) => (e instanceof Error ? e.message : String(e));
const errore = (e: unknown) => toast({ title: "Errore", description: messaggio(e), variant: "destructive" });
const fmtData = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("it-IT") : "—");
const numero = (v: string): number => { const n = Number(v.replace(",", ".")); return Number.isFinite(n) ? n : 0; };
const interoOppureNull = (v: string): number | null => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
const testoOppureNull = (v: string): string | null => (v.trim() === "" ? null : v);

/** Colonne della griglia delle righe: n., tipo, da magazzino, descrizione, UM, q.tà, prezzo, sconto, IVA, importo, azioni. */
const COLONNE_RIGHE = "20px 88px 150px minmax(170px, 1fr) 52px 78px 92px 64px 100px 92px 90px";

const STATO_VARIANT: Record<Documento["stato"], "default" | "outline" | "destructive"> = {
  bozza: "outline", confermato: "default", annullato: "destructive",
};

const testataDa = (d: Documento): Testata => ({
  data: d.data, anagrafica_id: d.anagrafica_id, oggetto: d.oggetto, riferimento_esterno: d.riferimento_esterno,
  data_esterna: d.data_esterna, pagamento: d.pagamento, validita_giorni: d.validita_giorni,
  consegna_prevista: d.consegna_prevista, destinazione: d.destinazione, causale_trasporto: d.causale_trasporto,
  aspetto_beni: d.aspetto_beni, colli: d.colli, peso_kg: d.peso_kg, vettore: d.vettore, porto: d.porto,
  note: d.note, note_interne: d.note_interne,
});

/* ------------------------------------------------------------------ */
/* Scelta del cliente / fornitore                                      */
/* ------------------------------------------------------------------ */
const AnagraficaPicker = ({ anagrafiche, valore, disabled, onSelect }: {
  anagrafiche: Anagrafica[]; valore: string | null; disabled?: boolean; onSelect: (id: string) => void;
}) => {
  const [open, setOpen] = useState(false);
  const scelta = anagrafiche.find((a) => a.id === valore);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" disabled={disabled} className="w-full justify-between font-normal">
          <span className="truncate">{scelta ? scelta.ragione_sociale : "Scegli…"}</span>
          <ChevronsUpDown className="w-4 h-4 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[360px]" align="start">
        <Command>
          <CommandInput placeholder="Cerca per nome o partita IVA…" />
          <CommandList>
            <CommandEmpty>Nessuna anagrafica trovata.</CommandEmpty>
            <CommandGroup>
              {anagrafiche.map((a) => (
                <CommandItem
                  key={a.id}
                  value={`${a.ragione_sociale} ${a.partita_iva ?? ""} ${a.codice}`}
                  onSelect={() => { onSelect(a.id); setOpen(false); }}
                >
                  <span className="truncate">{a.ragione_sociale}</span>
                  <span className="ml-auto pl-2 font-mono text-xs text-muted-foreground">{a.partita_iva ?? a.codice}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

/* ------------------------------------------------------------------ */
/* Dettaglio pezze di una riga di tessuto (bolla di carico e DDT)      */
/* ------------------------------------------------------------------ */
const fmtMetri = (n: number) => new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 }).format(n);

const PezzeRiga = ({ carico, pezze, disponibili, modificabile, onChange }: {
  /** true = bolla di carico (pezze in arrivo); false = DDT (pezze da cui tagliare). */
  carico: boolean;
  pezze: PezzaRiga[];
  /** Pezze a magazzino della variante: servono al DDT per scegliere da dove tagliare. */
  disponibili: PezzaGiacenza[] | undefined;
  modificabile: boolean;
  onChange: (pezze: PezzaRiga[]) => void;
}) => {
  const set = (i: number, patch: Partial<PezzaRiga>) => onChange(pezze.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const aggiungi = () => onChange([...pezze, { pezza_id: null, codice_bagno: pezze[pezze.length - 1]?.codice_bagno ?? null, posizione: pezze[pezze.length - 1]?.posizione ?? null, metri: 0 }]);
  const togli = (i: number) => onChange(pezze.filter((_, j) => j !== i));
  const usabili = (disponibili ?? []).filter((p) => p.stato === "disponibile" && p.residuo_m > 0);

  return (
    <div className="border border-ink/15 rounded-sm bg-background/60 p-2 grid gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {carico ? "Pezze in arrivo" : "Pezze da cui tagliare"} · totale {fmtMetri(sommaPezze(pezze))} m
        </span>
        {modificabile && <Button size="sm" variant="outline" className="h-7" onClick={aggiungi}><Plus className="w-3.5 h-3.5 mr-1" /> Pezza</Button>}
      </div>
      {pezze.length === 0 && (
        <p className="text-xs text-muted-foreground">
          {carico ? "Indica ogni pezza arrivata con il suo bagno e i metri." : "Scegli da quali pezze si taglia e quanti metri."}
        </p>
      )}
      {!carico && modificabile && disponibili !== undefined && usabili.length === 0 && (
        <p className="text-xs text-destructive">Nessuna pezza disponibile a magazzino per questo articolo.</p>
      )}
      {pezze.map((p, i) => {
        const scelta = usabili.find((x) => x.id === p.pezza_id);
        return (
          <div key={i} className="flex flex-wrap items-center gap-1.5">
            {carico ? (
              <>
                <Input className="w-40 h-8" value={p.codice_bagno ?? ""} disabled={!modificabile} placeholder="Bagno" aria-label="Bagno" onChange={(e) => set(i, { codice_bagno: testoOppureNull(e.target.value) })} />
                <Input className="w-24 h-8 text-right" type="number" step="any" min={0} value={p.metri || ""} disabled={!modificabile} placeholder="Metri" aria-label="Metri" onChange={(e) => set(i, { metri: numero(e.target.value) })} />
                <Input className="w-36 h-8" value={p.posizione ?? ""} disabled={!modificabile} placeholder="Posizione" aria-label="Posizione" onChange={(e) => set(i, { posizione: testoOppureNull(e.target.value) })} />
                {p.pezza_codice && <span className="font-mono text-xs text-muted-foreground">→ {p.pezza_codice}</span>}
              </>
            ) : modificabile ? (
              <>
                <div className="w-72">
                  <Select value={p.pezza_id ?? ""} onValueChange={(v) => set(i, { pezza_id: v })}>
                    <SelectTrigger className="h-8" aria-label="Pezza"><SelectValue placeholder={disponibili === undefined ? "Carico le pezze…" : "Scegli la pezza"} /></SelectTrigger>
                    <SelectContent>
                      {usabili.map((x) => (
                        <SelectItem key={x.id} value={x.id}>
                          {x.codice} · {x.codice_bagno ? `bagno ${x.codice_bagno}` : "senza bagno"} · {fmtMetri(x.residuo_m)} m{x.posizione ? ` · ${x.posizione}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Input className="w-24 h-8 text-right" type="number" step="any" min={0} value={p.metri || ""} placeholder="Metri" aria-label="Metri" onChange={(e) => set(i, { metri: numero(e.target.value) })} />
                {scelta && p.metri > scelta.residuo_m && <span className="text-xs text-destructive">Residuo: {fmtMetri(scelta.residuo_m)} m</span>}
              </>
            ) : (
              <span className="text-sm"><span className="font-mono">{p.pezza_codice ?? "—"}</span> · {fmtMetri(p.metri)} m</span>
            )}
            {modificabile && <Button size="icon" variant="ghost" className="h-7 w-7" title="Togli pezza" onClick={() => togli(i)}><Trash2 className="w-3.5 h-3.5" /></Button>}
          </div>
        );
      })}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Scheda di un documento                                              */
/* ------------------------------------------------------------------ */
type EditorProps = {
  documentoId: string;
  anagrafiche: Anagrafica[];
  aliquote: AliquotaIva[];
  articoli: Articolo[];
  varianti: Variante[];
  puoScrivere: boolean;
  onBack: () => void;
  onApri: (id: string, tipo: TipoDocumento) => void;
  onAnagraficheChanged: () => void;
};

const DocumentoEditor = ({ documentoId, anagrafiche, aliquote, articoli, varianti, puoScrivere, onBack, onApri, onAnagraficheChanged }: EditorProps) => {
  const [loading, setLoading] = useState(true);
  const [documento, setDocumento] = useState<Documento | null>(null);
  const [testata, setTestata] = useState<Testata | null>(null);
  const [righe, setRighe] = useState<RigaBozza[]>([]);
  const [idEsistenti, setIdEsistenti] = useState<string[]>([]);
  const [iva, setIva] = useState<RiepilogoIva[]>([]);
  const [collegati, setCollegati] = useState<Documento[]>([]);
  const [modificato, setModificato] = useState(false);
  const [occupato, setOccupato] = useState(false);
  const [nuovaAnagrafica, setNuovaAnagrafica] = useState(false);

  const carica = useCallback(async () => {
    setLoading(true);
    try {
      const [{ documento: d, righe: r, iva: i }, c] = await Promise.all([leggiDocumento(documentoId), documentiCollegati(documentoId)]);
      setDocumento(d);
      setTestata(testataDa(d));
      setRighe(r.map(({ documento_id: _d, posizione: _p, importo: _i, ...resto }) => (
        muoveMagazzino(d.tipo) && resto.tipo_riga === "articolo" && resto.variante_id ? { ...resto, pezze: resto.pezze ?? [] } : resto
      )));
      setIdEsistenti(r.map((x) => x.id));
      setIva(i);
      setCollegati(c);
      setModificato(false);
    } catch (e) { errore(e); } finally { setLoading(false); }
  }, [documentoId]);

  useEffect(() => { carica(); }, [carica]);

  const articoloById = useMemo(() => new Map(articoli.map((a) => [a.id, a])), [articoli]);
  const varianteById = useMemo(() => new Map(varianti.map((v) => [v.id, v])), [varianti]);
  /** Pezze a magazzino per variante, caricate quando servono (DDT). */
  const [pezzeMagazzino, setPezzeMagazzino] = useState<Record<string, PezzaGiacenza[]>>({});
  const tipoDoc = documento?.tipo;
  const variantiTessutoInRiga = useMemo(() => Array.from(new Set(
    righe.filter((r) => r.tipo_riga === "articolo" && r.variante_id).map((r) => r.variante_id as string)
      .filter((id) => { const v = varianteById.get(id); return v ? articoloById.get(v.articolo_id)?.categoria === "tessuto" : false; }),
  )), [righe, varianteById, articoloById]);
  const pezzeRichieste = useRef(new Set<string>());
  useEffect(() => {
    if (tipoDoc !== "ddt") return;
    for (const id of variantiTessutoInRiga) {
      if (pezzeRichieste.current.has(id)) continue;
      pezzeRichieste.current.add(id);
      elencoPezze(id)
        .then((p) => setPezzeMagazzino((prev) => ({ ...prev, [id]: p })))
        .catch((e) => { pezzeRichieste.current.delete(id); errore(e); });
    }
  }, [tipoDoc, variantiTessutoInRiga]);
  const aliquotaPredefinita = useMemo(() => aliquote.find((a) => a.codice === "22")?.id ?? aliquote[0]?.id ?? null, [aliquote]);
  const totali = useMemo(() => calcolaTotali(righe, aliquote), [righe, aliquote]);

  if (loading || !documento || !testata) {
    return <div className="grid place-items-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }

  const passivo = isPassivo(documento.tipo);
  const conMagazzino = muoveMagazzino(documento.tipo);
  /** Riga di tessuto su bolla di carico o DDT: la quantità è la somma delle sue pezze. */
  const rigaConPezze = (r: RigaBozza): boolean => {
    if (!conMagazzino || r.tipo_riga !== "articolo" || !r.variante_id) return false;
    const v = varianteById.get(r.variante_id);
    return v ? articoloById.get(v.articolo_id)?.categoria === "tessuto" : false;
  };
  const setPezze = (i: number, pezze: PezzaRiga[]) => {
    const somma = sommaPezze(pezze);
    setRiga(i, { pezze, ...(somma > 0 ? { quantita: somma } : {}) });
  };
  const bozza = documento.stato === "bozza";
  const modificabile = bozza && puoScrivere;
  const scelte = anagrafiche.filter((a) => (passivo ? a.is_fornitore : a.is_cliente) || a.id === testata.anagrafica_id);
  const anagrafica = anagrafiche.find((a) => a.id === testata.anagrafica_id) ?? null;
  const intestatario = documento.intestatario ?? anagrafica;

  const setT = <K extends keyof Testata>(k: K, v: Testata[K]) => { setTestata((p) => (p ? { ...p, [k]: v } : p)); setModificato(true); };
  const setRiga = (i: number, patch: Partial<RigaBozza>) => { setRighe((p) => p.map((r, j) => (j === i ? { ...r, ...patch } : r))); setModificato(true); };
  const aggiungiRiga = (tipo: TipoRiga) => { setRighe((p) => [...p, { ...rigaVuota(tipo === "nota" ? null : aliquotaPredefinita), tipo_riga: tipo }]); setModificato(true); };
  const togliRiga = (i: number) => { setRighe((p) => p.filter((_, j) => j !== i)); setModificato(true); };
  const spostaRiga = (i: number, delta: number) => {
    setRighe((p) => {
      const j = i + delta;
      if (j < 0 || j >= p.length) return p;
      const copia = [...p];
      [copia[i], copia[j]] = [copia[j], copia[i]];
      return copia;
    });
    setModificato(true);
  };

  const scegliAnagrafica = (id: string) => {
    const a = anagrafiche.find((x) => x.id === id);
    setTestata((p) => (p ? { ...p, anagrafica_id: id, pagamento: p.pagamento ?? a?.pagamento ?? null } : p));
    setModificato(true);
  };

  const scegliVariante = (i: number, varianteId: string) => {
    const v = varianti.find((x) => x.id === varianteId);
    if (!v) return;
    const a = articoloById.get(v.articolo_id);
    const prezzo = passivo ? v.costo_um : v.prezzo_um;
    setRiga(i, {
      variante_id: v.id,
      ...(conMagazzino ? { pezze: [] } : {}),
      codice: v.codice,
      descrizione: [a?.nome, descriviVariante(v)].filter(Boolean).join(" — "),
      um: a?.um ?? null,
      ...(prezzo != null ? { prezzo_unitario: prezzo } : {}),
    });
  };

  const salva = async (): Promise<boolean> => {
    const senzaDescrizione = righe.findIndex((r) => !r.descrizione.trim());
    if (senzaDescrizione >= 0) {
      toast({ title: "Riga incompleta", description: `La riga ${senzaDescrizione + 1} non ha descrizione.`, variant: "destructive" });
      return false;
    }
    setOccupato(true);
    try {
      await salvaBozza(documento.id, testata, righe, idEsistenti);
      await carica();
      return true;
    } catch (e) { errore(e); return false; } finally { setOccupato(false); }
  };

  const conferma = async () => {
    if (!(await salva())) return;
    if (!confirm(`Confermare il documento? Riceve il numero progressivo e non sarà più modificabile.`)) return;
    setOccupato(true);
    try {
      const d = await confermaDocumento(documento.id);
      toast({ title: "Documento confermato", description: titoloDocumento(d) });
      await carica();
    } catch (e) { errore(e); } finally { setOccupato(false); }
  };

  const annulla = async () => {
    let motivo: string | null = null;
    if (bozza) {
      if (!confirm("Scartare questa bozza? Esce dall'elenco ma resta nello storico.")) return;
    } else {
      motivo = prompt(`Annullare ${titoloDocumento(documento)}? Il documento resta in archivio come annullato.\n\nMotivo (facoltativo):`);
      if (motivo === null) return;
    }
    setOccupato(true);
    try {
      await annullaDocumento(documento.id, motivo?.trim() || null);
      toast({ title: bozza ? "Bozza scartata" : "Documento annullato" });
      if (bozza) onBack(); else await carica();
    } catch (e) { errore(e); } finally { setOccupato(false); }
  };

  const trasforma = async (tipo: TipoDocumento) => {
    setOccupato(true);
    try {
      const nuovoId = await trasformaDocumento(documento.id, tipo);
      toast({ title: `${TIPO_LABEL[tipo]} creato in bozza` });
      onApri(nuovoId, tipo);
    } catch (e) { errore(e); } finally { setOccupato(false); }
  };

  const indietro = () => {
    if (modificato && !confirm("Ci sono modifiche non salvate. Uscire senza salvare?")) return;
    onBack();
  };

  const campoTesto = (k: "oggetto" | "riferimento_esterno" | "pagamento" | "destinazione" | "causale_trasporto" | "aspetto_beni" | "vettore" | "porto", etichetta: string, placeholder?: string) => (
    <div>
      <Label>{etichetta}</Label>
      <Input value={testata[k] ?? ""} disabled={!modificabile} placeholder={placeholder} onChange={(e) => setT(k, testoOppureNull(e.target.value))} />
    </div>
  );
  const campoData = (k: "data_esterna" | "consegna_prevista", etichetta: string) => (
    <div>
      <Label>{etichetta}</Label>
      <Input type="date" value={testata[k] ?? ""} disabled={!modificabile} onChange={(e) => setT(k, e.target.value || null)} />
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Barra del documento */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Button size="sm" variant="ghost" onClick={indietro}><ArrowLeft className="w-4 h-4 mr-1" /> Elenco</Button>
          <h2 className="font-display text-xl font-semibold truncate">{titoloDocumento(documento)}</h2>
          <Badge variant={STATO_VARIANT[documento.stato]}>{documento.stato}</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {modificabile && (
            <>
              <Button size="sm" variant="outline" disabled={occupato || !modificato} onClick={() => salva()}>
                {occupato ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}Salva bozza
              </Button>
              <Button size="sm" disabled={occupato} onClick={conferma}><Check className="w-4 h-4 mr-1" /> Conferma</Button>
            </>
          )}
          {puoScrivere && documento.stato === "confermato" && TRASFORMAZIONI[documento.tipo].map((t) => (
            <Button key={t} size="sm" disabled={occupato} onClick={() => trasforma(t)}><ArrowRight className="w-4 h-4 mr-1" /> {TIPO_LABEL[t]}</Button>
          ))}
          {puoScrivere && documento.stato !== "annullato" && (
            <Button size="sm" variant="ghost" disabled={occupato} onClick={annulla}><Ban className="w-4 h-4 mr-1" /> {bozza ? "Scarta bozza" : "Annulla"}</Button>
          )}
        </div>
      </div>

      {documento.stato === "annullato" && (
        <p className="text-sm border-2 border-destructive/40 bg-destructive/5 rounded-sm px-3 py-2">
          Documento annullato{documento.motivo_annullamento ? `: ${documento.motivo_annullamento}` : "."}
        </p>
      )}
      {bozza && (documento.tipo === "fattura" || documento.tipo === "nota_credito") && (
        <p className="text-sm border-2 border-ink/20 bg-paper rounded-sm px-3 py-2 text-muted-foreground">
          Fatture e note di credito qui restano bozze fino all'attivazione dell'invio allo SDI: quelle valide partono ancora dal sistema precedente.
        </p>
      )}
      {bozza && conMagazzino && (
        <p className="text-sm border-2 border-ink/20 bg-paper rounded-sm px-3 py-2 text-muted-foreground">
          {documento.tipo === "bolla_carico"
            ? "Alla conferma le righe «Articolo» caricano il magazzino: per i tessuti nasce una pezza per ogni riga del dettaglio, con il suo bagno."
            : "Alla conferma le righe «Articolo» scaricano il magazzino: per i tessuti dalle pezze indicate nel dettaglio."}
          {" "}Le altre righe non muovono giacenze.
        </p>
      )}
      {(documento.origine_id || collegati.length > 0) && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Documenti collegati:</span>
          {collegati.map((c) => (
            <Button key={c.id} size="sm" variant="outline" onClick={() => onApri(c.id, c.tipo)}>{titoloDocumento(c)}</Button>
          ))}
          {documento.origine_id && collegati.length === 0 && <span className="text-muted-foreground">nasce da un documento precedente</span>}
        </div>
      )}

      {/* Testata */}
      <section className="border-2 border-ink/20 bg-paper rounded-sm p-4 grid gap-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <Label>Data</Label>
            <Input type="date" value={testata.data} disabled={!modificabile} onChange={(e) => e.target.value && setT("data", e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <Label>{passivo ? "Fornitore" : "Cliente"}</Label>
            {bozza ? (
              <div className="flex gap-2">
                <AnagraficaPicker anagrafiche={scelte} valore={testata.anagrafica_id} disabled={!modificabile} onSelect={scegliAnagrafica} />
                {modificabile && (
                  <Button variant="outline" size="icon" title={passivo ? "Nuovo fornitore" : "Nuovo cliente"} onClick={() => setNuovaAnagrafica(true)}>
                    <UserPlus className="w-4 h-4" />
                  </Button>
                )}
              </div>
            ) : (
              <Input value={intestatario?.ragione_sociale ?? ""} disabled />
            )}
          </div>
          {campoTesto("pagamento", "Pagamento")}
        </div>
        {intestatario && (
          <p className="text-xs text-muted-foreground">
            {[intestatario.indirizzo, [intestatario.cap, intestatario.citta, intestatario.provincia].filter(Boolean).join(" ")].filter(Boolean).join(", ")}
            {intestatario.partita_iva ? ` · P.IVA ${intestatario.partita_iva}` : ""}
            {intestatario.codice_sdi ? ` · SDI ${intestatario.codice_sdi}` : ""}
          </p>
        )}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="md:col-span-2">{campoTesto("oggetto", "Oggetto")}</div>
          {passivo ? (
            <>
              {campoTesto("riferimento_esterno", "Numero documento fornitore")}
              {campoData("data_esterna", "Data documento fornitore")}
            </>
          ) : (
            <>
              {campoTesto("riferimento_esterno", "Rif. ordine cliente")}
              {documento.tipo === "preventivo" && (
                <div>
                  <Label>Validità (giorni)</Label>
                  <Input type="number" min={0} value={testata.validita_giorni ?? ""} disabled={!modificabile} onChange={(e) => setT("validita_giorni", interoOppureNull(e.target.value))} />
                </div>
              )}
              {documento.tipo === "ordine" && campoData("consegna_prevista", "Consegna prevista")}
            </>
          )}
        </div>
        {documento.tipo === "ddt" && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="md:col-span-2">{campoTesto("destinazione", "Destinazione (se diversa dalla sede)")}</div>
              {campoTesto("causale_trasporto", "Causale del trasporto", "Vendita")}
              {campoTesto("aspetto_beni", "Aspetto dei beni", "Rotoli, colli…")}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <Label>Colli</Label>
                <Input type="number" min={0} value={testata.colli ?? ""} disabled={!modificabile} onChange={(e) => setT("colli", interoOppureNull(e.target.value))} />
              </div>
              <div>
                <Label>Peso (kg)</Label>
                <Input type="number" min={0} step="any" value={testata.peso_kg ?? ""} disabled={!modificabile} onChange={(e) => setT("peso_kg", e.target.value === "" ? null : numero(e.target.value))} />
              </div>
              {campoTesto("vettore", "Trasporto a cura di", "Mittente, destinatario, vettore…")}
              {campoTesto("porto", "Porto", "Franco, assegnato")}
            </div>
          </>
        )}
      </section>

      {/* Righe */}
      <section className="border-2 border-ink/20 bg-paper rounded-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-ink/10">
          <h3 className="font-display text-lg font-semibold">Righe</h3>
          {modificabile && (
            <div className="flex flex-wrap gap-1.5">
              {(["articolo", "lavorazione", "libera", "nota"] as TipoRiga[]).map((t) => (
                <Button key={t} size="sm" variant="outline" onClick={() => aggiungiRiga(t)}><Plus className="w-4 h-4 mr-1" /> {TIPO_RIGA_LABEL[t]}</Button>
              ))}
            </div>
          )}
        </div>
        {righe.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground text-center">Nessuna riga.</p>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[1090px]">
              <div className="grid items-center gap-1.5 px-4 py-2 border-b border-ink/10 text-[11px] uppercase tracking-wider text-muted-foreground" style={{ gridTemplateColumns: COLONNE_RIGHE }}>
                <span>N.</span>
                <span>Tipo</span>
                <span>Da magazzino</span>
                <span>Descrizione</span>
                <span>UM</span>
                <span className="text-right">Quantità</span>
                <span className="text-right">Prezzo unit.</span>
                <span className="text-right">Sconto %</span>
                <span>IVA</span>
                <span className="text-right">Importo</span>
                <span />
              </div>
              <div className="divide-y divide-ink/10">
                {righe.map((r, i) => {
                  const nota = r.tipo_riga === "nota";
                  const daMagazzino = r.tipo_riga === "articolo";
                  return (
                    <div key={r.id ?? `nuova-${i}`} className="px-4 py-2 grid gap-2">
                      <div className="grid items-center gap-1.5" style={{ gridTemplateColumns: COLONNE_RIGHE }}>
                        <span className="font-mono text-xs text-muted-foreground">{i + 1}</span>
                        <Badge variant="outline" className="justify-self-start">{TIPO_RIGA_LABEL[r.tipo_riga]}</Badge>
                        {daMagazzino && (
                          <Select value={r.variante_id ?? ""} disabled={!modificabile} onValueChange={(v) => scegliVariante(i, v)}>
                            <SelectTrigger aria-label="Articolo di magazzino"><SelectValue placeholder="Scegli…" /></SelectTrigger>
                            <SelectContent>
                              {varianti.length === 0 && <div className="px-2 py-1.5 text-sm text-muted-foreground">Nessun articolo in magazzino</div>}
                              {varianti.map((v) => <SelectItem key={v.id} value={v.id}>{v.codice} — {articoloById.get(v.articolo_id)?.nome}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        )}
                        <Input
                          value={r.descrizione} disabled={!modificabile} aria-label="Descrizione"
                          placeholder={nota ? "Testo della nota" : "Descrizione"}
                          style={{ gridColumn: nota ? "3 / span 8" : daMagazzino ? undefined : "3 / span 2" }}
                          onChange={(e) => setRiga(i, { descrizione: e.target.value })}
                        />
                        {!nota && (
                          <>
                            <Input value={r.um ?? ""} disabled={!modificabile} aria-label="Unità di misura" onChange={(e) => setRiga(i, { um: testoOppureNull(e.target.value) })} />
                            <Input type="number" step="any" value={r.quantita} disabled={!modificabile || rigaConPezze(r)} title={rigaConPezze(r) ? "Somma delle pezze indicate sotto" : undefined} aria-label="Quantità" className="text-right" onChange={(e) => setRiga(i, { quantita: numero(e.target.value) })} />
                            <Input type="number" step="any" value={r.prezzo_unitario} disabled={!modificabile} aria-label="Prezzo unitario" className="text-right" onChange={(e) => setRiga(i, { prezzo_unitario: numero(e.target.value) })} />
                            <Input type="number" step="any" min={0} max={100} value={r.sconto_pct} disabled={!modificabile} aria-label="Sconto percentuale" className="text-right" onChange={(e) => setRiga(i, { sconto_pct: Math.min(100, Math.max(0, numero(e.target.value))) })} />
                            <Select value={r.aliquota_id ?? ""} disabled={!modificabile} onValueChange={(v) => setRiga(i, { aliquota_id: v })}>
                              <SelectTrigger aria-label="Aliquota IVA"><SelectValue placeholder="—" /></SelectTrigger>
                              <SelectContent>
                                {aliquote.map((a) => <SelectItem key={a.id} value={a.id}>{a.descrizione}</SelectItem>)}
                              </SelectContent>
                            </Select>
                            <span className="text-right tabular-nums font-semibold">{eur(importoRiga(r))}</span>
                          </>
                        )}
                        <div className="flex justify-end" style={{ gridColumn: 11 }}>
                          {modificabile && (
                            <>
                              <Button size="icon" variant="ghost" className="h-7 w-7" title="Sposta su" disabled={i === 0} onClick={() => spostaRiga(i, -1)}><ArrowUp className="w-4 h-4" /></Button>
                              <Button size="icon" variant="ghost" className="h-7 w-7" title="Sposta giù" disabled={i === righe.length - 1} onClick={() => spostaRiga(i, 1)}><ArrowDown className="w-4 h-4" /></Button>
                              <Button size="icon" variant="ghost" className="h-7 w-7" title="Togli riga" onClick={() => togliRiga(i)}><Trash2 className="w-4 h-4" /></Button>
                            </>
                          )}
                        </div>
                      </div>
                      {rigaConPezze(r) && (
                        <div className="grid gap-1.5" style={{ gridTemplateColumns: COLONNE_RIGHE }}>
                          <div style={{ gridColumn: "3 / span 8" }}>
                            <PezzeRiga
                              carico={documento.tipo === "bolla_carico"}
                              pezze={r.pezze ?? []}
                              disponibili={r.variante_id ? pezzeMagazzino[r.variante_id] : undefined}
                              modificabile={modificabile}
                              onChange={(pezze) => setPezze(i, pezze)}
                            />
                          </div>
                        </div>
                      )}
                      {(r.tipo_riga === "lavorazione" || r.dettagli) && (
                        <div className="grid gap-1.5" style={{ gridTemplateColumns: COLONNE_RIGHE }}>
                          <Textarea
                            rows={2} value={r.dettagli ?? ""} disabled={!modificabile} aria-label="Specifiche della lavorazione"
                            style={{ gridColumn: "3 / span 8" }}
                            placeholder="Specifiche della lavorazione: misure finite, orli, occhielli, finiture…"
                            onChange={(e) => setRiga(i, { dettagli: testoOppureNull(e.target.value) })}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Note e totali */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <section className="md:col-span-2 border-2 border-ink/20 bg-paper rounded-sm p-4 grid gap-3">
          <div>
            <Label>Note (stampate sul documento)</Label>
            <Textarea rows={3} value={testata.note ?? ""} disabled={!modificabile} onChange={(e) => setT("note", testoOppureNull(e.target.value))} />
          </div>
          <div>
            <Label>Note interne (non stampate)</Label>
            <Textarea rows={2} value={testata.note_interne ?? ""} disabled={!modificabile} onChange={(e) => setT("note_interne", testoOppureNull(e.target.value))} />
          </div>
        </section>
        <section className="border-2 border-ink/20 bg-paper rounded-sm p-4 text-sm space-y-1.5 self-start">
          <div className="flex justify-between"><span>Imponibile</span><span className="tabular-nums">{eur(modificato ? totali.imponibile : documento.imponibile)}</span></div>
          {!modificato && iva.map((r) => (
            <div key={r.aliquota_id} className="flex justify-between text-muted-foreground">
              <span>{r.descrizione} su {eur(r.imponibile)}</span><span className="tabular-nums">{eur(r.imposta)}</span>
            </div>
          ))}
          <div className="flex justify-between"><span>IVA</span><span className="tabular-nums">{eur(modificato ? totali.imposta : documento.imposta)}</span></div>
          <div className="flex justify-between border-t border-ink/20 pt-2 font-display text-lg font-semibold">
            <span>Totale</span><span className="tabular-nums">{eur(modificato ? totali.totale : documento.totale)}</span>
          </div>
          {modificato && <p className="text-xs text-muted-foreground pt-1">Anteprima: i totali definitivi si aggiornano al salvataggio.</p>}
        </section>
      </div>

      <AnagraficaDialog
        open={nuovaAnagrafica} anagrafica={null} predefinito={passivo ? "fornitore" : "cliente"}
        onOpenChange={setNuovaAnagrafica}
        onSaved={(a) => { onAnagraficheChanged(); setTestata((p) => (p ? { ...p, anagrafica_id: a.id, pagamento: p.pagamento ?? a.pagamento } : p)); setModificato(true); }}
      />
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Elenco documenti                                                    */
/* ------------------------------------------------------------------ */
const DocumentiTab = ({ anagrafiche, aliquote, articoli, varianti, puoScrivere, onAnagraficheChanged, documentoIniziale }: {
  anagrafiche: Anagrafica[];
  aliquote: AliquotaIva[];
  articoli: Articolo[];
  varianti: Variante[];
  puoScrivere: boolean;
  onAnagraficheChanged: () => void;
  /** Documento da aprire subito (es. arrivando da Progettazione). */
  documentoIniziale?: string | null;
}) => {
  const [tipo, setTipo] = useState<TipoDocumento>("preventivo");
  const [documenti, setDocumenti] = useState<Documento[]>([]);
  const [loading, setLoading] = useState(true);
  const [aperto, setAperto] = useState<string | null>(documentoIniziale ?? null);
  const [creando, setCreando] = useState(false);

  const carica = useCallback(async (t: TipoDocumento) => {
    setLoading(true);
    try { setDocumenti(await elencoDocumenti(t)); } catch (e) { errore(e); } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (!aperto) carica(tipo); }, [tipo, aperto, carica]);

  const anagraficaById = useMemo(() => new Map(anagrafiche.map((a) => [a.id, a])), [anagrafiche]);

  const nuovo = async () => {
    setCreando(true);
    try { setAperto(await creaDocumento(tipo)); } catch (e) { errore(e); } finally { setCreando(false); }
  };

  if (aperto) {
    return (
      <DocumentoEditor
        key={aperto}
        documentoId={aperto}
        anagrafiche={anagrafiche} aliquote={aliquote} articoli={articoli} varianti={varianti}
        puoScrivere={puoScrivere}
        onBack={() => setAperto(null)}
        onApri={(id, t) => { setTipo(t); setAperto(id); }}
        onAnagraficheChanged={onAnagraficheChanged}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {TIPI_DOCUMENTO.map((t) => (
            <Button key={t} size="sm" variant={tipo === t ? "default" : "outline"} onClick={() => setTipo(t)}>{TIPO_LABEL_PLURALE[t]}</Button>
          ))}
        </div>
        {puoScrivere && (
          <Button size="sm" disabled={creando} onClick={nuovo}>
            {creando ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Plus className="w-4 h-4 mr-1" />}Nuovo: {TIPO_LABEL[tipo]}
          </Button>
        )}
      </div>

      {loading ? (
        <div className="grid place-items-center py-16"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : documenti.length === 0 ? (
        <div className="text-center border-2 border-ink/20 bg-paper p-10 rounded-sm text-sm text-muted-foreground">
          Nessun documento di tipo «{TIPO_LABEL[tipo]}».
        </div>
      ) : (
        <div className="border-2 border-ink/20 bg-paper rounded-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Numero</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>{isPassivo(tipo) ? "Fornitore" : "Cliente"}</TableHead>
                <TableHead>Oggetto</TableHead>
                <TableHead>Stato</TableHead>
                <TableHead className="text-right">Totale</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documenti.map((d) => (
                <TableRow key={d.id} className={`cursor-pointer ${d.stato === "annullato" ? "opacity-60" : ""}`} onClick={() => setAperto(d.id)}>
                  <TableCell className="font-mono text-xs">{d.numero != null ? `${d.numero}${d.serie ? `/${d.serie}` : ""}/${d.anno}` : "—"}</TableCell>
                  <TableCell className="whitespace-nowrap">{fmtData(d.data)}</TableCell>
                  <TableCell className="font-medium">{d.intestatario?.ragione_sociale ?? (d.anagrafica_id ? anagraficaById.get(d.anagrafica_id)?.ragione_sociale : null) ?? "—"}</TableCell>
                  <TableCell className="max-w-[280px] truncate">{d.oggetto ?? (isPassivo(tipo) ? d.riferimento_esterno : null) ?? "—"}</TableCell>
                  <TableCell><Badge variant={STATO_VARIANT[d.stato]}>{d.stato}</Badge></TableCell>
                  <TableCell className="text-right tabular-nums">{eur(d.totale)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
};

export default DocumentiTab;
