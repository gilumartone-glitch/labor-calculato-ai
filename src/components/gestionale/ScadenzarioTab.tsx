import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Search, Undo2, Pencil, Archive, Settings2, CalendarClock, Link2, Landmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { eur } from "@/lib/format";
import { TIPO_LABEL } from "@/lib/gestionale/documenti";
import {
  archiviaCondizione, collegaScadenza, elencoPagamenti, elencoScadenze, giorniDaRate, rateDaGiorni, registraPagamento,
  riallineaBanca, riepilogoScadenze, salvaCondizione, spostaScadenza, stornaPagamento,
  type CondizionePagamento, type Pagamento, type Scadenza, type StatoScadenza, type Verso,
} from "@/lib/gestionale/scadenzario";
import { CONTI, etichettaConto } from "@/lib/gestionale/prima-nota";

const messaggio = (e: unknown) => (e instanceof Error ? e.message : String(e));
const errore = (e: unknown) => toast({ title: "Errore", description: messaggio(e), variant: "destructive" });
const fmtData = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("it-IT") : "—");
const oggi = () => new Date().toISOString().slice(0, 10);
const numero = (v: string): number => { const n = Number(v.replace(",", ".")); return Number.isFinite(n) ? n : 0; };
const selectClass = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";

const STATO_VARIANT: Record<StatoScadenza, "default" | "outline" | "destructive" | "secondary"> = {
  aperta: "outline", parziale: "secondary", scaduta: "destructive", saldata: "default",
};

const documentoDi = (s: Scadenza): string => {
  const n = s.documento_numero != null ? ` n. ${s.documento_numero}${s.documento_serie ? `/${s.documento_serie}` : ""}/${s.documento_anno}` : "";
  const rif = s.verso === "pagamento" && s.riferimento_esterno ? ` (${s.riferimento_esterno})` : "";
  return `${TIPO_LABEL[s.documento_tipo]}${n}${rif}`;
};

/* ------------------------------------------------------------------ */
/* Incasso o pagamento di una scadenza                                 */
/* ------------------------------------------------------------------ */
const PagamentoDialog = ({ scadenza, puoScrivere, onClose, onChanged }: {
  scadenza: Scadenza | null; puoScrivere: boolean; onClose: () => void; onChanged: () => void;
}) => {
  const [pagamenti, setPagamenti] = useState<Pagamento[]>([]);
  const [residuo, setResiduo] = useState(0);
  const [importo, setImporto] = useState("");
  const [data, setData] = useState(oggi());
  const [modalita, setModalita] = useState("");
  const [conto, setConto] = useState("contanti");
  const [collegata, setCollegata] = useState(false);
  const [nota, setNota] = useState("");
  const [nuovaData, setNuovaData] = useState("");
  const [occupato, setOccupato] = useState(false);

  const carica = useCallback(async (s: Scadenza) => {
    try { setPagamenti(await elencoPagamenti(s.id)); } catch (e) { errore(e); }
  }, []);

  useEffect(() => {
    if (!scadenza) return;
    setResiduo(scadenza.residuo);
    setImporto(String(scadenza.residuo));
    setData(oggi());
    setModalita(scadenza.modalita ?? "");
    setConto("contanti");
    setCollegata(scadenza.in_contabilita);
    setNota("");
    setNuovaData(scadenza.data_scadenza);
    setPagamenti([]);
    carica(scadenza);
  }, [scadenza, carica]);

  if (!scadenza) return null;
  const incasso = scadenza.verso === "incasso";
  const stornati = new Set(pagamenti.map((p) => p.storno_di).filter((x): x is number => x != null));

  const registra = async () => {
    const valore = numero(importo);
    if (valore === 0) {
      toast({ title: "Dati mancanti", description: "Indica l'importo.", variant: "destructive" });
      return;
    }
    setOccupato(true);
    try {
      const nuovoResiduo = await registraPagamento({
        scadenzaId: scadenza.id, importo: valore, data, conto: collegata ? "contanti" : conto,
        modalita: collegata ? "Contanti" : modalita.trim() || null, nota: nota.trim() || null,
      });
      toast({ title: incasso ? "Incasso registrato" : "Pagamento registrato", description: `Residuo: ${eur(nuovoResiduo)}` });
      setResiduo(nuovoResiduo);
      setImporto(String(nuovoResiduo));
      setNota("");
      onChanged();
      await carica(scadenza);
    } catch (e) { errore(e); } finally { setOccupato(false); }
  };

  const storna = async (p: Pagamento) => {
    if (!confirm(`Stornare ${eur(p.importo)} del ${fmtData(p.data)}? Viene registrato un movimento uguale e contrario.`)) return;
    setOccupato(true);
    try {
      await stornaPagamento(p.id);
      setResiduo((r) => Math.round((r + p.importo) * 100) / 100);
      onChanged();
      await carica(scadenza);
    } catch (e) { errore(e); } finally { setOccupato(false); }
  };

  const collega = async () => {
    setOccupato(true);
    try {
      if (await collegaScadenza(scadenza.id)) {
        setCollegata(true);
        toast({ title: "Collegata alla Contabilità", description: "La voce è ora in competenza alla data della scadenza." });
        onChanged();
      } else {
        toast({ title: "Non ancora collegabile", description: `Apri prima in Contabilità l'anno ${scadenza.data_scadenza.slice(0, 4)}, poi riprova.`, variant: "destructive" });
      }
    } catch (e) { errore(e); } finally { setOccupato(false); }
  };

  const sposta = async () => {
    if (!nuovaData) return;
    setOccupato(true);
    try {
      await spostaScadenza(scadenza.id, { data_scadenza: nuovaData, modalita: modalita.trim() || null, note: scadenza.note });
      toast({ title: "Scadenza spostata", description: fmtData(nuovaData) });
      onChanged();
    } catch (e) { errore(e); } finally { setOccupato(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{incasso ? "Incasso" : "Pagamento"} · {scadenza.ragione_sociale ?? "—"}</DialogTitle></DialogHeader>
        <div className="grid gap-3 text-sm">
          <p className="text-muted-foreground">
            {documentoDi(scadenza)} · rata {scadenza.numero_rata} · scadenza {fmtData(scadenza.data_scadenza)}
          </p>
          <div className="grid grid-cols-3 gap-2 border-2 border-ink/20 rounded-sm p-3">
            <div><div className="text-xs text-muted-foreground">Importo</div><div className="font-semibold tabular-nums">{eur(scadenza.importo)}</div></div>
            <div><div className="text-xs text-muted-foreground">{incasso ? "Incassato" : "Pagato"}</div><div className="font-semibold tabular-nums">{eur(Math.round((scadenza.importo - residuo) * 100) / 100)}</div></div>
            <div><div className="text-xs text-muted-foreground">Residuo</div><div className="font-semibold tabular-nums">{eur(residuo)}</div></div>
          </div>

          {collegata ? (
            <div className="flex gap-2 border-2 border-ink/20 rounded-sm p-3 text-xs text-muted-foreground">
              <Landmark className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Questa scadenza è in Contabilità come voce in competenza. <strong className="text-foreground">Bonifici, RiBa, PayPal</strong>: associa
                il movimento bancario alla voce in Contabilità → Conti e qui risulterà {incasso ? "incassata" : "pagata"} da sola.
                Da qui si registrano solo i <strong className="text-foreground">contanti</strong>.
              </span>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2 border-2 border-ink/20 rounded-sm p-3 text-xs text-muted-foreground">
              <span>Questa scadenza non è in Contabilità (anno contabile non aperto, o scadenza nata prima del collegamento).</span>
              {puoScrivere && residuo !== 0 && (
                <Button size="sm" variant="outline" disabled={occupato} onClick={collega}><Link2 className="w-4 h-4 mr-1" /> Collega alla Contabilità</Button>
              )}
            </div>
          )}

          {puoScrivere && residuo !== 0 && (
            <div className="grid gap-3 border-2 border-ink/20 rounded-sm p-3">
              <div className="grid grid-cols-3 gap-3">
                <div><Label>Data</Label><Input type="date" value={data} onChange={(e) => setData(e.target.value || oggi())} /></div>
                <div><Label>Importo (€)</Label><Input inputMode="decimal" className="text-right" value={importo} onChange={(e) => setImporto(e.target.value)} /></div>
                <div>
                  <Label>Conto</Label>
                  {collegata ? (
                    <Input value="Contanti" readOnly disabled />
                  ) : (
                    <select className={selectClass} value={conto} onChange={(e) => setConto(e.target.value)}>
                      {CONTI.map((c) => <option key={c.codice} value={c.codice}>{c.etichetta}</option>)}
                    </select>
                  )}
                </div>
              </div>
              <div><Label>Nota</Label><Input value={nota} onChange={(e) => setNota(e.target.value)} /></div>
              <div className="flex justify-end">
                <Button data-f10 onClick={registra} disabled={occupato}>
                  {occupato && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Registra {incasso ? "incasso" : "pagamento"}{collegata ? " in contanti" : ""}
                </Button>
              </div>
            </div>
          )}

          {puoScrivere && residuo !== 0 && (
            <div className="flex flex-wrap items-end gap-2">
              <div><Label>Sposta la scadenza al</Label><Input type="date" value={nuovaData} onChange={(e) => setNuovaData(e.target.value)} /></div>
              <Button variant="outline" disabled={occupato || !nuovaData || nuovaData === scadenza.data_scadenza} onClick={sposta}>
                <CalendarClock className="w-4 h-4 mr-1" /> Sposta
              </Button>
            </div>
          )}

          {pagamenti.length > 0 && (
            <div className="border-2 border-ink/20 rounded-sm">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead><TableHead>Conto</TableHead><TableHead>Nota</TableHead>
                    <TableHead className="text-right">Importo</TableHead><TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagamenti.map((p) => {
                    const annullato = stornati.has(p.id) || p.storno_di != null;
                    return (
                      <TableRow key={p.id} className={annullato ? "opacity-60" : undefined}>
                        <TableCell className="whitespace-nowrap">{fmtData(p.data)}</TableCell>
                        <TableCell>{p.conto ? etichettaConto(p.conto) : p.modalita ?? "—"}</TableCell>
                        <TableCell className="text-xs">{p.storno_di != null ? `Storno del n. ${p.storno_di}` : p.nota ?? "—"}{stornati.has(p.id) ? " · stornato" : ""}</TableCell>
                        <TableCell className="text-right tabular-nums">{eur(p.importo)}</TableCell>
                        <TableCell>
                          {puoScrivere && !annullato && p.origine !== "banca" && (
                            <Button size="icon" variant="ghost" className="h-7 w-7" title="Storna" disabled={occupato} onClick={() => storna(p)}><Undo2 className="w-4 h-4" /></Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Chiudi</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/* ------------------------------------------------------------------ */
/* Condizioni di pagamento                                             */
/* ------------------------------------------------------------------ */
export const CondizioniDialog = ({ open, condizioni, puoScrivere, onOpenChange, onChanged }: {
  open: boolean; condizioni: CondizionePagamento[]; puoScrivere: boolean; onOpenChange: (o: boolean) => void; onChanged: () => void;
}) => {
  const [inModifica, setInModifica] = useState<CondizionePagamento | "nuova" | null>(null);
  const [codice, setCodice] = useState("");
  const [descrizione, setDescrizione] = useState("");
  const [modalita, setModalita] = useState("");
  const [giorni, setGiorni] = useState("30");
  const [fineMese, setFineMese] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (!open) setInModifica(null); }, [open]);

  const apri = (c: CondizionePagamento | "nuova") => {
    setInModifica(c);
    if (c === "nuova") { setCodice(""); setDescrizione(""); setModalita(""); setGiorni("30"); setFineMese(false); }
    else { setCodice(c.codice); setDescrizione(c.descrizione); setModalita(c.modalita ?? ""); setGiorni(giorniDaRate(c.rate)); setFineMese(c.fine_mese); }
  };

  const rate = rateDaGiorni(giorni);

  const salva = async () => {
    if (!codice.trim() || !descrizione.trim() || !rate) {
      toast({ title: "Dati mancanti", description: "Servono codice, descrizione e i giorni delle rate (es. 30/60/90).", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await salvaCondizione(
        { codice: codice.trim().toUpperCase(), descrizione: descrizione.trim(), modalita: modalita.trim() || null, rate, fine_mese: fineMese },
        inModifica && inModifica !== "nuova" ? inModifica.id : undefined,
      );
      onChanged();
      setInModifica(null);
    } catch (e) { errore(e); } finally { setSaving(false); }
  };

  const archivia = async (c: CondizionePagamento) => {
    if (!confirm(`Archiviare «${c.descrizione}»? I documenti che la usano restano come sono.`)) return;
    try { await archiviaCondizione(c.id); onChanged(); } catch (e) { errore(e); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Condizioni di pagamento</DialogTitle></DialogHeader>
        {inModifica ? (
          <div className="grid gap-3">
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Codice</Label><Input value={codice} onChange={(e) => setCodice(e.target.value)} placeholder="BB30" /></div>
              <div className="col-span-2"><Label>Descrizione</Label><Input value={descrizione} onChange={(e) => setDescrizione(e.target.value)} placeholder="Bonifico 30 gg data fattura" /></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Modalità</Label><Input value={modalita} onChange={(e) => setModalita(e.target.value)} placeholder="Bonifico" /></div>
              <div><Label>Giorni delle rate</Label><Input value={giorni} onChange={(e) => setGiorni(e.target.value)} placeholder="30/60/90" /></div>
              <label className="flex items-center gap-2 text-sm self-end pb-2">
                <Switch checked={fineMese} onCheckedChange={setFineMese} /> Fine mese
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              {rate
                ? `${rate.length === 1 ? "Rata unica" : `${rate.length} rate uguali`}: ${rate.map((r) => `${r.giorni === 0 ? "a vista" : `${r.giorni} gg`} (${r.percentuale}%)`).join(", ")}${fineMese ? ", ciascuna spostata a fine mese" : ""}.`
                : "Scrivi i giorni separati da una barra: 0 per «a vista», 30/60/90 per tre rate."}
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setInModifica(null)}>Annulla</Button>
              <Button onClick={salva} disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Salva</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="grid gap-3">
            {puoScrivere && (
              <div className="flex justify-end"><Button size="sm" onClick={() => apri("nuova")}><Plus className="w-4 h-4 mr-1" /> Nuova condizione</Button></div>
            )}
            {condizioni.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">Nessuna condizione. Senza condizione, una fattura genera una sola scadenza alla data del documento.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Codice</TableHead><TableHead>Descrizione</TableHead><TableHead>Modalità</TableHead><TableHead>Rate</TableHead><TableHead className="w-20" /></TableRow>
                </TableHeader>
                <TableBody>
                  {condizioni.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-mono text-xs">{c.codice}</TableCell>
                      <TableCell>{c.descrizione}</TableCell>
                      <TableCell>{c.modalita ?? "—"}</TableCell>
                      <TableCell>{giorniDaRate(c.rate)}{c.fine_mese ? " f.m." : ""}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {puoScrivere && (
                          <>
                            <Button size="icon" variant="ghost" className="h-7 w-7" title="Modifica" onClick={() => apri(c)}><Pencil className="w-4 h-4" /></Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7" title="Archivia" onClick={() => archivia(c)}><Archive className="w-4 h-4" /></Button>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

/* ------------------------------------------------------------------ */
/* Scadenzario                                                         */
/* ------------------------------------------------------------------ */
type FiltroStato = "da_saldare" | "scadute" | "saldate" | "tutte";

const ScadenzarioTab = ({ condizioni, puoScrivere, onCondizioniChanged }: {
  condizioni: CondizionePagamento[]; puoScrivere: boolean; onCondizioniChanged: () => void;
}) => {
  const [scadenze, setScadenze] = useState<Scadenza[]>([]);
  const [loading, setLoading] = useState(true);
  const [verso, setVerso] = useState<Verso | "tutti">("tutti");
  const [stato, setStato] = useState<FiltroStato>("da_saldare");
  const [q, setQ] = useState("");
  const [aperta, setAperta] = useState<Scadenza | null>(null);
  const [condizioniDialog, setCondizioniDialog] = useState(false);

  const carica = useCallback(async () => {
    try { setScadenze(await elencoScadenze()); } catch (e) { errore(e); } finally { setLoading(false); }
  }, []);
  useEffect(() => {
    (async () => {
      // rete di sicurezza: riporta sulle scadenze eventuali associazioni bancarie rimaste indietro
      if (puoScrivere) { try { await riallineaBanca(); } catch { /* non blocca l'elenco */ } }
      await carica();
    })();
  }, [carica, puoScrivere]);

  const totali = useMemo(() => riepilogoScadenze(scadenze), [scadenze]);
  const filtrate = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return scadenze.filter((s) => {
      if (verso !== "tutti" && s.verso !== verso) return false;
      if (stato === "da_saldare" && s.stato === "saldata") return false;
      if (stato === "scadute" && s.stato !== "scaduta") return false;
      if (stato === "saldate" && s.stato !== "saldata") return false;
      if (!ql) return true;
      return [s.ragione_sociale, documentoDi(s), s.modalita].some((x) => (x ?? "").toLowerCase().includes(ql));
    });
  }, [scadenze, verso, stato, q]);

  const riquadro = (titolo: string, valore: number, allarme = false) => (
    <div className="border-2 border-ink/20 bg-paper rounded-sm px-4 py-3">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{titolo}</div>
      <div className={`font-display text-xl font-semibold tabular-nums ${allarme && valore !== 0 ? "text-destructive" : ""}`}>{eur(valore)}</div>
    </div>
  );

  if (loading) return <div className="grid place-items-center py-16"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {riquadro("Da incassare", totali.daIncassare)}
        {riquadro("Incassi scaduti", totali.incassiScaduti, true)}
        {riquadro("Da pagare", totali.daPagare)}
        {riquadro("Pagamenti scaduti", totali.pagamentiScaduti, true)}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input data-cerca className="pl-8 w-56" placeholder="Cerca nome o documento…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {([["tutti", "Tutti"], ["incasso", "Incassi"], ["pagamento", "Pagamenti"]] as const).map(([k, l]) => (
            <Button key={k} size="sm" variant={verso === k ? "default" : "outline"} onClick={() => setVerso(k)}>{l}</Button>
          ))}
          <span className="w-px h-6 bg-ink/20" />
          {([["da_saldare", "Da saldare"], ["scadute", "Scadute"], ["saldate", "Saldate"], ["tutte", "Tutte"]] as const).map(([k, l]) => (
            <Button key={k} size="sm" variant={stato === k ? "default" : "outline"} onClick={() => setStato(k)}>{l}</Button>
          ))}
        </div>
        <Button size="sm" variant="outline" onClick={() => setCondizioniDialog(true)}><Settings2 className="w-4 h-4 mr-1" /> Condizioni di pagamento</Button>
      </div>

      {filtrate.length === 0 ? (
        <div className="text-center border-2 border-ink/20 bg-paper p-10 rounded-sm text-sm text-muted-foreground">
          {scadenze.length === 0
            ? "Nessuna scadenza. Nascono da sole alla conferma di fatture, note di credito e fatture fornitori."
            : "Nessuna scadenza con questi filtri."}
        </div>
      ) : (
        <div className="border-2 border-ink/20 bg-paper rounded-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Scadenza</TableHead>
                <TableHead>Cliente / fornitore</TableHead>
                <TableHead>Documento</TableHead>
                <TableHead>Modalità</TableHead>
                <TableHead className="text-right">Importo</TableHead>
                <TableHead className="text-right">Residuo</TableHead>
                <TableHead>Stato</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtrate.map((s) => (
                <TableRow key={s.id} className={s.stato === "saldata" ? "opacity-60" : undefined}>
                  <TableCell className="whitespace-nowrap">{fmtData(s.data_scadenza)}</TableCell>
                  <TableCell className="font-medium">
                    {s.ragione_sociale ?? "—"}
                    <Badge variant="outline" className="ml-2">{s.verso === "incasso" ? "Incasso" : "Pagamento"}</Badge>
                  </TableCell>
                  <TableCell className="text-xs">{documentoDi(s)}{s.numero_rata > 1 ? ` · rata ${s.numero_rata}` : ""}</TableCell>
                  <TableCell>{s.modalita ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{eur(s.importo)}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">{eur(s.residuo)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    <Badge variant={STATO_VARIANT[s.stato]}>{s.stato}</Badge>
                    {!s.in_contabilita && s.stato !== "saldata" && <Badge variant="outline" className="ml-1" title="Non ancora in Contabilità: apri la scadenza per collegarla">fuori contabilità</Badge>}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => setAperta(s)}>
                      {s.stato === "saldata" || !puoScrivere ? "Dettagli" : s.verso === "incasso" ? "Incassa" : "Paga"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <PagamentoDialog scadenza={aperta} puoScrivere={puoScrivere} onClose={() => setAperta(null)} onChanged={carica} />
      <CondizioniDialog open={condizioniDialog} condizioni={condizioni} puoScrivere={puoScrivere} onOpenChange={setCondizioniDialog} onChanged={onCondizioniChanged} />
    </div>
  );
};

export default ScadenzarioTab;
