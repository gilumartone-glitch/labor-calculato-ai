import { useCallback, useEffect, useMemo, useState } from "react";
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
  importoRiga, leggiDocumento, rigaVuota, salvaBozza, titoloDocumento, trasformaDocumento,
  type AliquotaIva, type Anagrafica, type Documento, type RiepilogoIva, type RigaBozza, type Testata,
  type TipoDocumento, type TipoRiga,
} from "@/lib/gestionale/documenti";
import { AnagraficaDialog } from "./AnagraficheTab";

const messaggio = (e: unknown) => (e instanceof Error ? e.message : String(e));
const errore = (e: unknown) => toast({ title: "Errore", description: messaggio(e), variant: "destructive" });
const fmtData = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("it-IT") : "—");
const numero = (v: string): number => { const n = Number(v.replace(",", ".")); return Number.isFinite(n) ? n : 0; };
const interoOppureNull = (v: string): number | null => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
const testoOppureNull = (v: string): string | null => (v.trim() === "" ? null : v);

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
      setRighe(r.map(({ documento_id: _d, posizione: _p, importo: _i, ...resto }) => resto));
      setIdEsistenti(r.map((x) => x.id));
      setIva(i);
      setCollegati(c);
      setModificato(false);
    } catch (e) { errore(e); } finally { setLoading(false); }
  }, [documentoId]);

  useEffect(() => { carica(); }, [carica]);

  const articoloById = useMemo(() => new Map(articoli.map((a) => [a.id, a])), [articoli]);
  const aliquotaPredefinita = useMemo(() => aliquote.find((a) => a.codice === "22")?.id ?? aliquote[0]?.id ?? null, [aliquote]);
  const totali = useMemo(() => calcolaTotali(righe, aliquote), [righe, aliquote]);

  if (loading || !documento || !testata) {
    return <div className="grid place-items-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }

  const passivo = isPassivo(documento.tipo);
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
          <div className="divide-y divide-ink/10">
            {righe.map((r, i) => {
              const nota = r.tipo_riga === "nota";
              return (
                <div key={r.id ?? `nuova-${i}`} className="px-4 py-3 grid gap-2">
                  <div className="flex flex-wrap items-end gap-2">
                    <span className="font-mono text-xs text-muted-foreground w-6 pb-2.5">{i + 1}</span>
                    <Badge variant="outline" className="mb-2">{TIPO_RIGA_LABEL[r.tipo_riga]}</Badge>
                    {r.tipo_riga === "articolo" && modificabile && (
                      <div className="w-56">
                        <Select value={r.variante_id ?? ""} onValueChange={(v) => scegliVariante(i, v)}>
                          <SelectTrigger><SelectValue placeholder="Scegli dal magazzino" /></SelectTrigger>
                          <SelectContent>
                            {varianti.map((v) => <SelectItem key={v.id} value={v.id}>{v.codice} — {articoloById.get(v.articolo_id)?.nome}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    <div className="flex-1 min-w-[220px]">
                      <Input value={r.descrizione} disabled={!modificabile} placeholder={nota ? "Testo della nota" : "Descrizione"} onChange={(e) => setRiga(i, { descrizione: e.target.value })} />
                    </div>
                    {!nota && (
                      <>
                        <div className="w-16"><Input value={r.um ?? ""} disabled={!modificabile} placeholder="UM" onChange={(e) => setRiga(i, { um: testoOppureNull(e.target.value) })} /></div>
                        <div className="w-24"><Input type="number" step="any" value={r.quantita} disabled={!modificabile} title="Quantità" className="text-right" onChange={(e) => setRiga(i, { quantita: numero(e.target.value) })} /></div>
                        <div className="w-28"><Input type="number" step="any" value={r.prezzo_unitario} disabled={!modificabile} title="Prezzo unitario" className="text-right" onChange={(e) => setRiga(i, { prezzo_unitario: numero(e.target.value) })} /></div>
                        <div className="w-20"><Input type="number" step="any" min={0} max={100} value={r.sconto_pct} disabled={!modificabile} title="Sconto %" className="text-right" onChange={(e) => setRiga(i, { sconto_pct: Math.min(100, Math.max(0, numero(e.target.value))) })} /></div>
                        <div className="w-28">
                          <Select value={r.aliquota_id ?? ""} disabled={!modificabile} onValueChange={(v) => setRiga(i, { aliquota_id: v })}>
                            <SelectTrigger title="Aliquota IVA"><SelectValue placeholder="IVA" /></SelectTrigger>
                            <SelectContent>
                              {aliquote.map((a) => <SelectItem key={a.id} value={a.id}>{a.descrizione}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="w-28 text-right tabular-nums font-semibold pb-2.5">{eur(importoRiga(r))}</div>
                      </>
                    )}
                    {modificabile && (
                      <div className="flex">
                        <Button size="icon" variant="ghost" title="Sposta su" disabled={i === 0} onClick={() => spostaRiga(i, -1)}><ArrowUp className="w-4 h-4" /></Button>
                        <Button size="icon" variant="ghost" title="Sposta giù" disabled={i === righe.length - 1} onClick={() => spostaRiga(i, 1)}><ArrowDown className="w-4 h-4" /></Button>
                        <Button size="icon" variant="ghost" title="Togli riga" onClick={() => togliRiga(i)}><Trash2 className="w-4 h-4" /></Button>
                      </div>
                    )}
                  </div>
                  {(r.tipo_riga === "lavorazione" || r.dettagli) && (
                    <Textarea
                      rows={2} className="ml-8 w-auto" value={r.dettagli ?? ""} disabled={!modificabile}
                      placeholder="Specifiche della lavorazione: misure finite, orli, occhielli, finiture…"
                      onChange={(e) => setRiga(i, { dettagli: testoOppureNull(e.target.value) })}
                    />
                  )}
                </div>
              );
            })}
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
const DocumentiTab = ({ anagrafiche, aliquote, articoli, varianti, puoScrivere, onAnagraficheChanged }: {
  anagrafiche: Anagrafica[];
  aliquote: AliquotaIva[];
  articoli: Articolo[];
  varianti: Variante[];
  puoScrivere: boolean;
  onAnagraficheChanged: () => void;
}) => {
  const [tipo, setTipo] = useState<TipoDocumento>("preventivo");
  const [documenti, setDocumenti] = useState<Documento[]>([]);
  const [loading, setLoading] = useState(true);
  const [aperto, setAperto] = useState<string | null>(null);
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
