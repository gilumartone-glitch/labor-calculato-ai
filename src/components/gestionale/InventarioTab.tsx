import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { eur } from "@/lib/format";
import { CATEGORIA_LABEL, type Articolo, type Variante } from "@/lib/gestionale/types";
import { inventarioAllaData, inventarioCsv, riepilogoInventario, tuttiIMovimenti, type MovimentoInventario } from "@/lib/gestionale/inventario";

const errore = (e: unknown) => toast({ title: "Errore", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmtQta = (n: number) => new Intl.NumberFormat("it-IT", { maximumFractionDigits: 3 }).format(n);

const InventarioTab = ({ articoli, varianti }: { articoli: Articolo[]; varianti: Variante[] }) => {
  const [movimenti, setMovimenti] = useState<MovimentoInventario[]>([]);
  const [loading, setLoading] = useState(true);
  const [giorno, setGiorno] = useState(iso(new Date()));
  const [ancheVuote, setAncheVuote] = useState(false);
  const [q, setQ] = useState("");

  const carica = useCallback(async () => {
    try { setMovimenti(await tuttiIMovimenti()); } catch (e) { errore(e); } finally { setLoading(false); }
  }, []);
  useEffect(() => { carica(); }, [carica]);

  const righe = useMemo(() => inventarioAllaData(movimenti, varianti, articoli, giorno || iso(new Date()), ancheVuote), [movimenti, varianti, articoli, giorno, ancheVuote]);
  const totali = useMemo(() => riepilogoInventario(righe), [righe]);
  const visibili = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return ql ? righe.filter((r) => `${r.codice} ${r.articolo} ${r.variante}`.toLowerCase().includes(ql)) : righe;
  }, [righe, q]);
  const fineAnnoScorso = `${new Date().getFullYear() - 1}-12-31`;

  const esporta = () => {
    const blob = new Blob(["﻿", inventarioCsv(righe)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `inventario_${giorno}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <div className="grid place-items-center py-16"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="border-2 border-ink/20 bg-paper rounded-sm px-4 py-3">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Valore del magazzino</div>
          <div className="font-display text-xl font-semibold tabular-nums">{eur(totali.valore)}</div>
        </div>
        {totali.categorie.map((c) => (
          <div key={c.categoria} className="border-2 border-ink/20 bg-paper rounded-sm px-4 py-3">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{CATEGORIA_LABEL[c.categoria]} · {c.righe} {c.righe === 1 ? "voce" : "voci"}</div>
            <div className="font-display text-xl font-semibold tabular-nums">{eur(c.valore)}</div>
          </div>
        ))}
      </div>
      {(totali.senzaCosto > 0 || totali.negative > 0) && (
        <p className="text-sm border-2 border-amber-500/50 bg-amber-50 dark:bg-amber-950/30 rounded-sm px-3 py-2">
          {totali.senzaCosto > 0 && <>{totali.senzaCosto} {totali.senzaCosto === 1 ? "variante è" : "varianti sono"} senza costo: non {totali.senzaCosto === 1 ? "entra" : "entrano"} nel valore. Indica il costo nella scheda Articoli e varianti. </>}
          {totali.negative > 0 && <>{totali.negative} {totali.negative === 1 ? "giacenza è negativa" : "giacenze sono negative"}: è uscito più materiale di quanto ne risultava caricato.</>}
        </p>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <div><Label>Giacenze al</Label><Input type="date" className="w-40" value={giorno} onChange={(e) => setGiorno(e.target.value)} /></div>
          <Button size="sm" variant="outline" onClick={() => setGiorno(iso(new Date()))}>Oggi</Button>
          <Button size="sm" variant="outline" onClick={() => setGiorno(fineAnnoScorso)}>31/12 scorso</Button>
          <label className="flex items-center gap-2 text-sm h-10"><Switch checked={ancheVuote} onCheckedChange={setAncheVuote} /> Anche le varianti a zero</label>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input data-cerca className="pl-8 w-56" placeholder="Cerca codice o articolo…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        <Button size="sm" variant="outline" disabled={righe.length === 0} onClick={esporta}><Download className="w-4 h-4 mr-1" /> Esporta inventario</Button>
      </div>

      {visibili.length === 0 ? (
        <div className="text-center border-2 border-ink/20 bg-paper p-10 rounded-sm text-sm text-muted-foreground">
          {righe.length === 0 ? "A questa data il magazzino risulta vuoto. Le giacenze nascono dalle bolle di carico e dai carichi delle pezze." : "Nessuna voce corrisponde alla ricerca."}
        </div>
      ) : (
        <div className="border-2 border-ink/20 bg-paper rounded-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Categoria</TableHead>
                <TableHead>Codice</TableHead>
                <TableHead>Articolo</TableHead>
                <TableHead>Variante</TableHead>
                <TableHead className="text-right">Giacenza</TableHead>
                <TableHead className="text-right">Costo unitario</TableHead>
                <TableHead className="text-right">Valore</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibili.map((r) => (
                <TableRow key={r.variante_id}>
                  <TableCell>{CATEGORIA_LABEL[r.categoria]}</TableCell>
                  <TableCell className="font-mono text-xs">{r.codice}</TableCell>
                  <TableCell className="font-medium">{r.articolo}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.variante || "—"}</TableCell>
                  <TableCell className={`text-right tabular-nums ${r.giacenza < 0 ? "text-destructive font-semibold" : ""}`}>{fmtQta(r.giacenza)} {r.um}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.costo_um != null ? eur(r.costo_um) : <span className="text-amber-700 dark:text-amber-400">manca</span>}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">{r.valore != null ? eur(r.valore) : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Le quantità sono ricostruite dal registro dei movimenti, quindi valgono per qualsiasi data. Il valore usa il costo che la variante ha oggi, non quello del giorno scelto.
      </p>
    </div>
  );
};

export default InventarioTab;
