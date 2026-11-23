import { useEffect, useRef, useState } from "react";
import { CircleCheck, CircleX, Download, FileSearch, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import {
  ETICHETTA_TABELLA, TABELLE_COPIA, conteggiAttuali, creaCopia, impacchettaCopia, leggiCopia, nomeFileCopia, ricordaUltimaCopia, ultimaCopia,
  type EsitoVerifica,
} from "@/lib/gestionale/copia-sicurezza";

const errore = (e: unknown) => toast({ title: "Errore", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
const quando = (iso: string) => new Date(iso).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

export const CopiaSicurezzaDialog = ({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) => {
  const [avanzamento, setAvanzamento] = useState<string | null>(null);
  const [ultima, setUltima] = useState<string | null>(null);
  const [verifica, setVerifica] = useState<(EsitoVerifica & { oggi: Record<string, number>; file: string }) | null>(null);
  const [verificando, setVerificando] = useState(false);
  const scegliFile = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) { setUltima(ultimaCopia()); setVerifica(null); } }, [open]);

  const scarica = async () => {
    setAvanzamento("Preparazione…");
    try {
      const copia = await creaCopia((tabella, fatte, totale) => setAvanzamento(tabella ? `${ETICHETTA_TABELLA[tabella] ?? tabella} (${fatte + 1} di ${totale})` : "Compressione…"));
      const byte = await impacchettaCopia(copia);
      // prima di consegnarlo si rilegge il file appena creato: una copia che non si riapre non serve
      const riletta = await leggiCopia(byte);
      if (!riletta.integra) throw new Error(`La copia appena creata non supera il controllo: ${riletta.problemi.join(" ")}`);
      const url = URL.createObjectURL(new Blob([byte as BlobPart], { type: "application/zip" }));
      const a = document.createElement("a");
      a.href = url; a.download = nomeFileCopia(copia); a.click();
      URL.revokeObjectURL(url);
      ricordaUltimaCopia(copia.creata_il);
      setUltima(copia.creata_il);
      const righe = Object.values(copia.conteggi).reduce((t, n) => t + n, 0);
      toast({ title: "Copia scaricata", description: `${righe.toLocaleString("it-IT")} righe in ${TABELLE_COPIA.length} tabelle. Conservala fuori da questo computer.` });
    } catch (e) { errore(e); } finally { setAvanzamento(null); }
  };

  const controlla = async (file: File | undefined) => {
    if (!file) return;
    setVerificando(true); setVerifica(null);
    try {
      const [esito, oggi] = await Promise.all([leggiCopia(file), conteggiAttuali()]);
      setVerifica({ ...esito, oggi, file: file.name });
    } catch (e) { errore(e); } finally { setVerificando(false); if (scegliFile.current) scegliFile.current.value = ""; }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!avanzamento) onOpenChange(o); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Copia di sicurezza</DialogTitle></DialogHeader>
        <div className="grid gap-4 text-sm">
          <p className="text-muted-foreground">
            Scarica in un unico file tutto il Gestionale: documenti, righe, clienti e fornitori, magazzino, scadenze, pagamenti,
            prima nota e lo storico di ogni modifica. Conserva il file fuori da questo computer (disco esterno o cloud aziendale).
            La Contabilità e gli altri moduli non sono compresi.
          </p>
          <div className="flex flex-wrap items-center justify-between gap-3 border-2 border-ink/20 rounded-sm p-3">
            <span>
              {ultima ? <>Ultima copia scaricata da questo computer: <strong>{quando(ultima)}</strong></> : "Da questo computer non è ancora stata scaricata nessuna copia."}
            </span>
            <Button data-f10 onClick={scarica} disabled={avanzamento != null}>
              {avanzamento != null ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Download className="w-4 h-4 mr-1" />}
              {avanzamento ?? "Scarica la copia"}
            </Button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-2 border-ink/20 rounded-sm p-3">
            <span>Controlla che un file di copia sia integro e confrontalo con i dati di oggi.</span>
            <input ref={scegliFile} type="file" accept=".zip,.json" className="hidden" onChange={(e) => controlla(e.target.files?.[0])} />
            <Button variant="outline" disabled={verificando} onClick={() => scegliFile.current?.click()}>
              {verificando ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <FileSearch className="w-4 h-4 mr-1" />} Verifica una copia
            </Button>
          </div>

          {verifica && (
            <div className="grid gap-2">
              <p className="flex items-start gap-2">
                {verifica.integra
                  ? <><CircleCheck className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600" /><span><strong>{verifica.file}</strong> è integro. Creato il {quando(verifica.copia.creata_il)}.</span></>
                  : <><CircleX className="w-4 h-4 mt-0.5 shrink-0 text-destructive" /><span><strong>{verifica.file}</strong> non supera il controllo: {verifica.problemi.join(" ")}</span></>}
              </p>
              <div className="border-2 border-ink/20 rounded-sm">
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Tabella</TableHead><TableHead className="text-right">Nella copia</TableHead><TableHead className="text-right">Oggi</TableHead><TableHead className="text-right">Aggiunte dopo</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {TABELLE_COPIA.map((t) => {
                      const inCopia = verifica.copia.conteggi?.[t.nome] ?? 0; const oggi = verifica.oggi[t.nome] ?? 0;
                      return (
                        <TableRow key={t.nome}>
                          <TableCell>{ETICHETTA_TABELLA[t.nome] ?? t.nome}</TableCell>
                          <TableCell className="text-right tabular-nums">{inCopia.toLocaleString("it-IT")}</TableCell>
                          <TableCell className="text-right tabular-nums">{oggi.toLocaleString("it-IT")}</TableCell>
                          <TableCell className={`text-right tabular-nums ${oggi < inCopia ? "text-destructive font-semibold" : ""}`}>{oggi === inCopia ? "—" : (oggi - inCopia > 0 ? "+" : "") + (oggi - inCopia).toLocaleString("it-IT")}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <p className="text-xs text-muted-foreground">
                Nel Gestionale niente si cancella: «Oggi» non dovrebbe mai essere minore di «Nella copia». Se una riga è in rosso, avvisami subito.
              </p>
            </div>
          )}
        </div>
        <DialogFooter><Button variant="outline" disabled={avanzamento != null} onClick={() => onOpenChange(false)}>Chiudi</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
