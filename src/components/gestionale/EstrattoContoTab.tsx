import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Printer, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { eur } from "@/lib/format";
import { leggiAzienda, logoAzienda } from "@/lib/gestionale/azienda";
import type { Anagrafica } from "@/lib/gestionale/documenti";
import { elencoScadenze, type Scadenza, type Verso } from "@/lib/gestionale/scadenzario";
import {
  anagraficheConPartite, creaPdfEstrattoConto, estrattoConto, nomeDocumentoEstratto, nomeFileEstratto, statoRata,
} from "@/lib/gestionale/estratto-conto";

const errore = (e: unknown) => toast({ title: "Errore", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
const fmtData = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");
const oggi = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

const EstrattoContoTab = ({ anagrafiche, onApriDocumento }: { anagrafiche: Anagrafica[]; onApriDocumento: (id: string) => void }) => {
  const [scadenze, setScadenze] = useState<Scadenza[]>([]);
  const [loading, setLoading] = useState(true);
  const [verso, setVerso] = useState<Verso>("incasso");
  const [scelta, setScelta] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [soloAperte, setSoloAperte] = useState(true);
  const [dal, setDal] = useState("");
  const [al, setAl] = useState("");
  const [stampando, setStampando] = useState(false);

  const carica = useCallback(async () => {
    try { setScadenze(await elencoScadenze()); } catch (e) { errore(e); } finally { setLoading(false); }
  }, []);
  useEffect(() => { carica(); }, [carica]);

  const partite = useMemo(() => anagraficheConPartite(scadenze, verso), [scadenze, verso]);
  const visibili = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return ql ? partite.filter((p) => p.ragione_sociale.toLowerCase().includes(ql)) : partite;
  }, [partite, q]);
  const corrente = partite.find((p) => p.anagrafica_id === scelta) ?? null;
  const filtro = useMemo(() => ({ verso, soloAperte, dal: dal || null, al: al || null }), [verso, soloAperte, dal, al]);
  const estratto = useMemo(() => (scelta ? estrattoConto(scadenze, scelta, filtro) : null), [scadenze, scelta, filtro]);
  const cliente = verso === "incasso";

  const stampa = async () => {
    if (!corrente || !estratto) return;
    setStampando(true);
    try {
      const [azienda, logo] = await Promise.all([leggiAzienda(), logoAzienda()]);
      const scheda = anagrafiche.find((a) => a.id === corrente.anagrafica_id);
      const giorno = oggi();
      creaPdfEstrattoConto(azienda, scheda ?? { ragione_sociale: corrente.ragione_sociale }, estratto, { ...filtro, alGiorno: giorno }, logo)
        .save(nomeFileEstratto(corrente.ragione_sociale, giorno));
      if (!azienda.denominazione.trim()) toast({ title: "Dati azienda mancanti", description: "Il PDF è senza intestazione: compila «Dati azienda» in alto a destra." });
    } catch (e) { errore(e); } finally { setStampando(false); }
  };

  const riquadro = (titolo: string, valore: number, forte = false) => (
    <div className="border-2 border-ink/20 bg-paper rounded-sm px-4 py-3">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{titolo}</div>
      <div className={`font-display text-xl font-semibold tabular-nums ${forte && valore !== 0 ? "text-destructive" : ""}`}>{eur(valore)}</div>
    </div>
  );

  if (loading) return <div className="grid place-items-center py-16"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4 items-start">
      {/* Elenco di chi ha partite */}
      <div className="border-2 border-ink/20 bg-paper rounded-sm">
        <div className="p-3 border-b border-ink/10 grid gap-2">
          <div className="flex gap-2">
            <Button size="sm" className="flex-1" variant={cliente ? "default" : "outline"} onClick={() => { setVerso("incasso"); setScelta(null); }}>Clienti</Button>
            <Button size="sm" className="flex-1" variant={!cliente ? "default" : "outline"} onClick={() => { setVerso("pagamento"); setScelta(null); }}>Fornitori</Button>
          </div>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input data-cerca className="pl-8" placeholder="Cerca per nome…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        {visibili.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            {partite.length === 0 ? `Nessun ${cliente ? "cliente" : "fornitore"} con fatture confermate. Le partite nascono quando una fattura viene confermata.` : "Nessun nome corrisponde."}
          </p>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto divide-y divide-ink/10">
            {visibili.map((p) => (
              <button
                key={p.anagrafica_id} type="button" data-elenco onClick={() => setScelta(p.anagrafica_id)}
                className={`w-full text-left px-3 py-2 focus:outline-none focus:bg-muted hover:bg-muted/60 ${p.anagrafica_id === scelta ? "bg-muted shadow-[inset_3px_0_0_0_hsl(var(--foreground))]" : ""}`}
              >
                <div className="font-medium text-sm truncate">{p.ragione_sociale || "—"}</div>
                <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
                  <span>{p.documenti} {p.documenti === 1 ? "documento" : "documenti"}</span>
                  <span>
                    {p.scaduto !== 0 && <span className="text-destructive font-semibold mr-2">scaduto {eur(p.scaduto)}</span>}
                    {p.residuo !== 0 ? `da saldare ${eur(p.residuo)}` : "saldato"}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Estratto conto */}
      {!corrente || !estratto ? (
        <div className="text-center border-2 border-ink/20 bg-paper p-10 rounded-sm text-sm text-muted-foreground">
          Scegli un {cliente ? "cliente" : "fornitore"} dall'elenco per vedere documenti, saldi e quanto resta da saldare.
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="font-display text-xl font-semibold">{corrente.ragione_sociale}</h2>
            <Button data-stampa disabled={stampando} onClick={stampa}>
              {stampando ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Printer className="w-4 h-4 mr-1" />} Estratto conto in PDF
            </Button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {riquadro("Totale documenti", estratto.totali.totale)}
            {riquadro(cliente ? "Già incassato" : "Già pagato", estratto.totali.pagato)}
            {riquadro("Da saldare", estratto.totali.residuo)}
            {riquadro("Di cui scaduto", estratto.totali.scaduto, true)}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex items-center gap-2 text-sm h-10"><Switch checked={soloAperte} onCheckedChange={setSoloAperte} /> Solo documenti da saldare</label>
            <div><Label>Documenti dal</Label><Input type="date" className="w-40" value={dal} onChange={(e) => setDal(e.target.value)} /></div>
            <div><Label>al</Label><Input type="date" className="w-40" value={al} onChange={(e) => setAl(e.target.value)} /></div>
          </div>

          {estratto.documenti.length === 0 ? (
            <div className="text-center border-2 border-ink/20 bg-paper p-8 rounded-sm text-sm text-muted-foreground">
              {soloAperte ? "Nessun documento da saldare: tutto pagato. Togli «Solo documenti da saldare» per vedere lo storico." : "Nessun documento nel periodo."}
            </div>
          ) : (
            <div className="border-2 border-ink/20 bg-paper rounded-sm">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Documento</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead>Scadenza</TableHead>
                    <TableHead className="text-right">Importo</TableHead>
                    <TableHead className="text-right">{cliente ? "Incassato" : "Pagato"}</TableHead>
                    <TableHead className="text-right">Da saldare</TableHead>
                    <TableHead>Stato</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {estratto.documenti.flatMap((d) => d.rate.map((r, i) => (
                    <TableRow key={r.scadenza_id} className={`cursor-pointer ${r.stato === "saldata" ? "text-muted-foreground" : ""}`} onClick={() => onApriDocumento(d.documento_id)}>
                      <TableCell className="font-medium text-foreground">{i === 0 ? nomeDocumentoEstratto(d) : ""}</TableCell>
                      <TableCell className="whitespace-nowrap">{i === 0 ? fmtData(d.data) : ""}</TableCell>
                      <TableCell className="whitespace-nowrap">{fmtData(r.data_scadenza)}</TableCell>
                      <TableCell className="text-right tabular-nums">{eur(r.importo)}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.pagato !== 0 ? eur(r.pagato) : ""}</TableCell>
                      <TableCell className={`text-right tabular-nums font-semibold ${r.stato === "scaduta" && r.residuo > 0 ? "text-destructive" : ""}`}>{r.residuo !== 0 ? eur(r.residuo) : ""}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        <Badge variant={r.stato === "scaduta" && r.residuo > 0 ? "destructive" : r.stato === "saldata" ? "outline" : "secondary"}>{statoRata(r)}</Badge>
                        {r.stato === "saldata" && r.ultimo_pagamento && <span className="ml-1 text-xs">il {fmtData(r.ultimo_pagamento)}</span>}
                      </TableCell>
                    </TableRow>
                  )))}
                </TableBody>
              </Table>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Situazione a oggi. Il PDF riporta gli stessi documenti con i filtri scelti{cliente ? ", l'IBAN per il pagamento" : ""} e i totali: saldato, da saldare, scaduto.
          </p>
        </div>
      )}
    </div>
  );
};

export default EstrattoContoTab;
