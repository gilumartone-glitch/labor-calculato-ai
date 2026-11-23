import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { eur } from "@/lib/format";
import {
  leggiRegistri, liquidazione, periodoIva, registroCsv, riepilogoPerAliquota,
  type Registro, type RigaRegistro,
} from "@/lib/gestionale/registri-iva";

const errore = (e: unknown) => toast({ title: "Errore", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
const fmtData = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
const selectClass = "h-10 rounded-md border border-input bg-background px-3 text-sm";
const MESI = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];
type Periodo = number | "T1" | "T2" | "T3" | "T4" | "anno";
const TIPO: Record<RigaRegistro["tipo"], string> = { fattura: "Fattura", nota_credito: "Nota di credito", fattura_fornitore: "Fattura" };

const RegistriIvaTab = ({ onApriDocumento }: { onApriDocumento: (id: string) => void }) => {
  const oggi = new Date();
  const [anno, setAnno] = useState(oggi.getFullYear());
  const [periodo, setPeriodo] = useState<Periodo>(oggi.getMonth() + 1);
  const [registro, setRegistro] = useState<Registro>("vendite");
  const [righe, setRighe] = useState<RigaRegistro[]>([]);
  const [loading, setLoading] = useState(true);
  const { dal, al } = useMemo(() => periodoIva(anno, periodo), [anno, periodo]);

  const carica = useCallback(async () => {
    setLoading(true);
    try { setRighe(await leggiRegistri(dal, al)); } catch (e) { errore(e); } finally { setLoading(false); }
  }, [dal, al]);
  useEffect(() => { carica(); }, [carica]);

  const delRegistro = useMemo(() => righe.filter((r) => r.registro === registro), [righe, registro]);
  const perAliquota = useMemo(() => riepilogoPerAliquota(delRegistro), [delRegistro]);
  const liq = useMemo(() => liquidazione(righe), [righe]);
  const totImponibile = perAliquota.reduce((t, a) => t + a.imponibile, 0);
  const totImposta = perAliquota.reduce((t, a) => t + a.imposta, 0);
  const conta = (r: Registro) => new Set(righe.filter((x) => x.registro === r).map((x) => x.documento_id)).size;

  const esporta = () => {
    const blob = new Blob(["﻿", registroCsv(righe, registro)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `registro-iva-${registro}_${dal}_${al}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const riquadro = (titolo: string, valore: number, nota?: string) => (
    <div className="border-2 border-ink/20 bg-paper rounded-sm px-4 py-3">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{titolo}</div>
      <div className="font-display text-xl font-semibold tabular-nums">{eur(valore)}</div>
      {nota && <div className="text-xs text-muted-foreground">{nota}</div>}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {riquadro("IVA sulle vendite", liq.ivaVendite, "a esigibilità immediata")}
        {riquadro("IVA sugli acquisti", liq.ivaAcquisti, "considerata tutta detraibile")}
        {riquadro(liq.saldo >= 0 ? "IVA a debito del periodo" : "IVA a credito del periodo", Math.abs(liq.saldo), "vendite meno acquisti")}
      </div>
      {(liq.ivaScissione !== 0 || liq.ivaDifferita !== 0) && (
        <p className="text-xs text-muted-foreground">
          Fuori dal conto:
          {liq.ivaScissione !== 0 && <> {eur(liq.ivaScissione)} in scissione dei pagamenti, versata dal cliente.</>}
          {liq.ivaDifferita !== 0 && <> {eur(liq.ivaDifferita)} a esigibilità differita, dovuta all'incasso.</>}
        </p>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <Label>Anno</Label>
            <select className={`${selectClass} block w-24`} value={anno} onChange={(e) => setAnno(Number(e.target.value))}>
              {Array.from({ length: 6 }, (_, i) => oggi.getFullYear() + 1 - i).map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <Label>Periodo</Label>
            <select className={`${selectClass} block w-44`} value={String(periodo)} onChange={(e) => setPeriodo(/^\d+$/.test(e.target.value) ? Number(e.target.value) : (e.target.value as Periodo))}>
              {MESI.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              {(["T1", "T2", "T3", "T4"] as const).map((t, i) => <option key={t} value={t}>{i + 1}° trimestre</option>)}
              <option value="anno">Tutto l'anno</option>
            </select>
          </div>
          <Button size="sm" variant={registro === "vendite" ? "default" : "outline"} onClick={() => setRegistro("vendite")}>Vendite ({conta("vendite")})</Button>
          <Button size="sm" variant={registro === "acquisti" ? "default" : "outline"} onClick={() => setRegistro("acquisti")}>Acquisti ({conta("acquisti")})</Button>
        </div>
        <Button size="sm" variant="outline" disabled={delRegistro.length === 0} onClick={esporta}><Download className="w-4 h-4 mr-1" /> Esporta per il commercialista</Button>
      </div>

      {loading ? (
        <div className="grid place-items-center py-16"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : delRegistro.length === 0 ? (
        <div className="text-center border-2 border-ink/20 bg-paper p-10 rounded-sm text-sm text-muted-foreground">
          Nessun documento confermato nel periodo. {registro === "vendite" ? "Qui entrano fatture e note di credito emesse." : "Qui entrano le fatture dei fornitori."} Le bozze non contano.
        </div>
      ) : (
        <>
          <div className="border-2 border-ink/20 bg-paper rounded-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>{registro === "vendite" ? "Numero" : "Protocollo"}</TableHead>
                  {registro === "acquisti" && <TableHead>Documento fornitore</TableHead>}
                  <TableHead>{registro === "vendite" ? "Cliente" : "Fornitore"}</TableHead>
                  <TableHead>P. IVA / C.F.</TableHead>
                  <TableHead>Aliquota</TableHead>
                  <TableHead className="text-right">Imponibile</TableHead>
                  <TableHead className="text-right">Imposta</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {delRegistro.map((r) => (
                  <TableRow key={`${r.documento_id}-${r.aliquota}`} data-elenco tabIndex={0} className="cursor-pointer focus:outline-none focus:bg-muted" onClick={() => onApriDocumento(r.documento_id)}>
                    <TableCell className="whitespace-nowrap">{fmtData(r.data)}</TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs">
                      {r.numero}
                      {r.tipo === "nota_credito" && <Badge variant="outline" className="ml-1">{TIPO[r.tipo]}</Badge>}
                    </TableCell>
                    {registro === "acquisti" && <TableCell className="text-xs">{r.documento_fornitore || "—"}</TableCell>}
                    <TableCell className="font-medium">{r.controparte || "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{r.partita_iva || "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {r.aliquota}
                      {r.esigibilita === "S" && <Badge variant="outline" className="ml-1" title="Scissione dei pagamenti: l'IVA la versa il cliente">scissione</Badge>}
                      {r.esigibilita === "D" && <Badge variant="outline" className="ml-1" title="Esigibilità differita">differita</Badge>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{eur(r.imponibile)}</TableCell>
                    <TableCell className="text-right tabular-nums">{eur(r.imposta)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="border-2 border-ink/20 bg-paper rounded-sm max-w-xl ml-auto">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Riepilogo per aliquota</TableHead><TableHead className="text-right">Imponibile</TableHead><TableHead className="text-right">Imposta</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {perAliquota.map((a) => (
                  <TableRow key={a.aliquota}><TableCell>{a.aliquota}</TableCell><TableCell className="text-right tabular-nums">{eur(a.imponibile)}</TableCell><TableCell className="text-right tabular-nums">{eur(a.imposta)}</TableCell></TableRow>
                ))}
                <TableRow className="font-semibold"><TableCell>Totale</TableCell><TableCell className="text-right tabular-nums">{eur(totImponibile)}</TableCell><TableCell className="text-right tabular-nums">{eur(totImposta)}</TableCell></TableRow>
              </TableBody>
            </Table>
          </div>
        </>
      )}
      <p className="text-xs text-muted-foreground">
        Prospetto di controllo costruito sui documenti confermati: la liquidazione ufficiale resta quella del commercialista (detraibilità parziale, reverse charge, credito dei periodi precedenti non sono considerati).
      </p>
    </div>
  );
};

export default RegistriIvaTab;
