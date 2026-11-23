import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Loader2, Plus, Search, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { eur } from "@/lib/format";
import {
  CONTI, documentoRiga, elencoPrimaNota, etichettaConto, primaNotaCsv, registraMovimento, riepilogoPrimaNota, stornaMovimento,
  type RigaPrimaNota, type VersoMovimento,
} from "@/lib/gestionale/prima-nota";

const messaggio = (e: unknown) => (e instanceof Error ? e.message : String(e));
const errore = (e: unknown) => toast({ title: "Errore", description: messaggio(e), variant: "destructive" });
const fmtData = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("it-IT");
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const oggi = () => iso(new Date());
const numero = (v: string): number => { const n = Number(v.replace(",", ".")); return Number.isFinite(n) ? n : 0; };
const selectClass = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";

/* ------------------------------------------------------------------ */
/* Movimento senza fattura, ma con il suo documento                    */
/* ------------------------------------------------------------------ */
const MovimentoDialog = ({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => void }) => {
  const [data, setData] = useState(oggi());
  const [verso, setVerso] = useState<VersoMovimento>("uscita");
  const [importo, setImporto] = useState("");
  const [conto, setConto] = useState("contanti");
  const [descrizione, setDescrizione] = useState("");
  const [documento, setDocumento] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setData(oggi()); setVerso("uscita"); setImporto(""); setConto("contanti"); setDescrizione(""); setDocumento("");
  }, [open]);

  const salva = async () => {
    const valore = numero(importo);
    if (valore <= 0 || !descrizione.trim() || !documento.trim()) {
      toast({ title: "Dati mancanti", description: "Servono importo, descrizione e il documento che giustifica il movimento.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await registraMovimento({ data, verso, importo: valore, conto, descrizione: descrizione.trim(), documentoRif: documento.trim() });
      toast({ title: "Movimento registrato" });
      onSaved();
      onOpenChange(false);
    } catch (e) { errore(e); } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Nuovo movimento di prima nota</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <p className="text-xs text-muted-foreground">
            Per i movimenti che non nascono da una fattura: scontrini, ricevute, F24, stipendi, commissioni bancarie.
            Incassi e pagamenti delle fatture entrano da soli.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Data</Label><Input type="date" value={data} onChange={(e) => setData(e.target.value || oggi())} /></div>
            <div>
              <Label>Tipo</Label>
              <div className="flex gap-2">
                <Button type="button" className="flex-1" variant={verso === "uscita" ? "default" : "outline"} onClick={() => setVerso("uscita")}>Uscita</Button>
                <Button type="button" className="flex-1" variant={verso === "entrata" ? "default" : "outline"} onClick={() => setVerso("entrata")}>Entrata</Button>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Importo (€)</Label><Input inputMode="decimal" className="text-right" value={importo} onChange={(e) => setImporto(e.target.value)} /></div>
            <div>
              <Label>Conto</Label>
              <select className={selectClass} value={conto} onChange={(e) => setConto(e.target.value)}>
                {CONTI.map((c) => <option key={c.codice} value={c.codice}>{c.etichetta}</option>)}
              </select>
            </div>
          </div>
          <div><Label>Descrizione</Label><Input value={descrizione} onChange={(e) => setDescrizione(e.target.value)} placeholder="Cancelleria, carburante furgone…" /></div>
          <div><Label>Documento</Label><Input value={documento} onChange={(e) => setDocumento(e.target.value)} placeholder="Scontrino n. 45 del 15/01, ricevuta, F24…" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annulla</Button>
          <Button onClick={salva} disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Registra</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/* ------------------------------------------------------------------ */
/* Prima nota                                                          */
/* ------------------------------------------------------------------ */
const PrimaNotaTab = ({ puoScrivere, onApriDocumento }: { puoScrivere: boolean; onApriDocumento: (id: string) => void }) => {
  const adesso = new Date();
  const [dal, setDal] = useState(iso(new Date(adesso.getFullYear(), adesso.getMonth(), 1)));
  const [al, setAl] = useState(iso(new Date(adesso.getFullYear(), adesso.getMonth() + 1, 0)));
  const [righe, setRighe] = useState<RigaPrimaNota[]>([]);
  const [loading, setLoading] = useState(true);
  const [conto, setConto] = useState("tutti");
  const [q, setQ] = useState("");
  const [nuovo, setNuovo] = useState(false);
  const [daStornare, setDaStornare] = useState<RigaPrimaNota | null>(null);
  const [occupato, setOccupato] = useState(false);

  const carica = useCallback(async () => {
    if (!dal || !al) return;
    setLoading(true);
    try { setRighe(await elencoPrimaNota(dal, al)); } catch (e) { errore(e); } finally { setLoading(false); }
  }, [dal, al]);
  useEffect(() => { carica(); }, [carica]);

  const periodo = (mesi: number) => {
    const d = new Date();
    setDal(iso(new Date(d.getFullYear(), d.getMonth() + mesi, 1)));
    setAl(iso(new Date(d.getFullYear(), d.getMonth() + mesi + 1, 0)));
  };
  const anno = () => { const a = new Date().getFullYear(); setDal(`${a}-01-01`); setAl(`${a}-12-31`); };

  const filtrate = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return righe.filter((r) => {
      if (conto !== "tutti" && r.conto !== conto) return false;
      if (!ql) return true;
      return [r.ragione_sociale, documentoRiga(r), r.descrizione].some((x) => (x ?? "").toLowerCase().includes(ql));
    });
  }, [righe, conto, q]);
  const totali = useMemo(() => riepilogoPrimaNota(filtrate), [filtrate]);
  const contiPresenti = useMemo(() => {
    const codici = new Set([...CONTI.map((c) => c.codice), ...righe.map((r) => r.conto)]);
    return [...codici];
  }, [righe]);
  const stornati = useMemo(() => new Set(righe.filter((r) => r.e_storno).map((r) => r.id)), [righe]);

  const esporta = () => {
    const blob = new Blob(["﻿", primaNotaCsv(filtrate)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `prima-nota_${dal}_${al}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const storna = async () => {
    if (!daStornare?.manuale_id) return;
    setOccupato(true);
    try {
      await stornaMovimento(daStornare.manuale_id);
      toast({ title: "Movimento stornato" });
      setDaStornare(null);
      await carica();
    } catch (e) { errore(e); } finally { setOccupato(false); }
  };

  const riquadro = (titolo: string, valore: number) => (
    <div className="border-2 border-ink/20 bg-paper rounded-sm px-4 py-3">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{titolo}</div>
      <div className="font-display text-xl font-semibold tabular-nums">{eur(valore)}</div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {riquadro("Entrate del periodo", totali.entrate)}
        {riquadro("Uscite del periodo", totali.uscite)}
        {riquadro("Saldo del periodo", totali.saldo)}
      </div>
      {totali.conti.length > 0 && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
          {totali.conti.map((c) => (
            <span key={c.conto}><span className="font-semibold text-foreground">{etichettaConto(c.conto)}</span> entrate {eur(c.entrate)} · uscite {eur(c.uscite)} · saldo {eur(c.saldo)}</span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <div><Label>Dal</Label><Input type="date" className="w-40" value={dal} onChange={(e) => setDal(e.target.value)} /></div>
          <div><Label>Al</Label><Input type="date" className="w-40" value={al} onChange={(e) => setAl(e.target.value)} /></div>
          <Button size="sm" variant="outline" onClick={() => periodo(0)}>Questo mese</Button>
          <Button size="sm" variant="outline" onClick={() => periodo(-1)}>Mese scorso</Button>
          <Button size="sm" variant="outline" onClick={anno}>Anno</Button>
          <select className="h-10 w-40 rounded-md border border-input bg-background px-3 text-sm" value={conto} onChange={(e) => setConto(e.target.value)} aria-label="Conto">
            <option value="tutti">Tutti i conti</option>
            {contiPresenti.map((c) => <option key={c} value={c}>{etichettaConto(c)}</option>)}
          </select>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input data-cerca className="pl-8 w-52" placeholder="Cerca…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={filtrate.length === 0} onClick={esporta}><Download className="w-4 h-4 mr-1" /> Esporta per il commercialista</Button>
          {puoScrivere && <Button size="sm" data-nuovo onClick={() => setNuovo(true)}><Plus className="w-4 h-4 mr-1" /> Nuovo movimento</Button>}
        </div>
      </div>

      {loading ? (
        <div className="grid place-items-center py-16"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : filtrate.length === 0 ? (
        <div className="text-center border-2 border-ink/20 bg-paper p-10 rounded-sm text-sm text-muted-foreground">
          {righe.length === 0
            ? "Nessun movimento nel periodo. Incassi e pagamenti delle fatture entrano da soli: i contanti dallo Scadenzario, le banche quando associ il movimento in Contabilità → Conti."
            : "Nessun movimento con questi filtri."}
        </div>
      ) : (
        <div className="border-2 border-ink/20 bg-paper rounded-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Conto</TableHead>
                <TableHead>Documento</TableHead>
                <TableHead>Cliente / fornitore</TableHead>
                <TableHead>Descrizione</TableHead>
                <TableHead className="text-right">Entrata</TableHead>
                <TableHead className="text-right">Uscita</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtrate.map((r) => {
                const stornabile = puoScrivere && r.manuale_id != null && !r.e_storno;
                return (
                  <TableRow key={r.id} className={r.e_storno ? "opacity-60" : undefined}>
                    <TableCell className="whitespace-nowrap">{fmtData(r.data)}</TableCell>
                    <TableCell>{etichettaConto(r.conto)}</TableCell>
                    <TableCell className="text-xs">
                      {r.documento_id ? (
                        <button type="button" className="underline underline-offset-2 text-left" onClick={() => onApriDocumento(r.documento_id!)}>{documentoRiga(r)}</button>
                      ) : documentoRiga(r)}
                    </TableCell>
                    <TableCell className="font-medium">{r.ragione_sociale || "—"}</TableCell>
                    <TableCell className="text-xs">
                      {r.e_storno && <Badge variant="outline" className="mr-1">Storno</Badge>}
                      {r.descrizione || (r.origine === "banca" ? "Movimento bancario" : "")}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.verso === "entrata" ? eur(r.importo) : ""}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.verso === "uscita" ? eur(r.importo) : ""}</TableCell>
                    <TableCell>
                      {stornabile && (
                        <Button size="icon" variant="ghost" className="h-7 w-7" title="Storna" onClick={() => setDaStornare(r)}><Undo2 className="w-4 h-4" /></Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Nessuna riga si cancella: un errore si corregge con uno storno, che resta visibile.
        {stornati.size > 0 ? ` Storni nel periodo: ${stornati.size}.` : ""} Gli incassi e i pagamenti delle fatture si stornano dallo Scadenzario.
      </p>

      <MovimentoDialog open={nuovo} onOpenChange={setNuovo} onSaved={carica} />
      <Dialog open={daStornare != null} onOpenChange={(o) => { if (!o) setDaStornare(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Stornare il movimento?</DialogTitle></DialogHeader>
          {daStornare && (
            <p className="text-sm">
              {fmtData(daStornare.data)} · {daStornare.descrizione} · {eur(daStornare.importo)} ({daStornare.verso}).
              Viene registrato oggi un movimento uguale e contrario; l'originale resta in elenco.
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDaStornare(null)}>Annulla</Button>
            <Button onClick={storna} disabled={occupato}>{occupato && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Storna</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PrimaNotaTab;
