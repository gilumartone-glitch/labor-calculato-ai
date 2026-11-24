import { useCallback, useEffect, useState } from "react";
import { Archive, Loader2, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/usePermissions";
import { TIPO_LABEL, type AliquotaIva } from "@/lib/gestionale/documenti";
import {
  aggiornaAliquota, archiviaAliquota, controllaAliquota, creaAliquota, fattureAttive, leggiAvvio, NATURE_IVA, salvaFattureAttiveDal, type Avvio,
} from "@/lib/gestionale/impostazioni";

import { salvaChiaveServizioAziende, statoServizioAziende, type StatoServizio } from "@/lib/gestionale/cerca-azienda";

const errore = (e: unknown) => toast({ title: "Errore", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
const SENZA_NATURA = "-";

/** Impostazioni > Aliquote IVA. */
export const ImpostazioniIva = ({ aliquote, puoScrivere, onChanged }: { aliquote: AliquotaIva[]; puoScrivere: boolean; onChanged: () => void | Promise<void> }) => {
  const [inModifica, setInModifica] = useState<AliquotaIva | "nuova" | null>(null);
  const [codice, setCodice] = useState("");
  const [descrizione, setDescrizione] = useState("");
  const [percentuale, setPercentuale] = useState("");
  const [natura, setNatura] = useState(SENZA_NATURA);
  const [daArchiviare, setDaArchiviare] = useState<string | null>(null);
  const [occupato, setOccupato] = useState(false);

  const apri = (a: AliquotaIva | "nuova") => {
    setInModifica(a); setDaArchiviare(null);
    if (a === "nuova") { setCodice(""); setDescrizione(""); setPercentuale(""); setNatura(SENZA_NATURA); }
    else { setCodice(a.codice); setDescrizione(a.descrizione); setPercentuale(String(a.percentuale).replace(".", ",")); setNatura(a.natura || SENZA_NATURA); }
  };
  const esistente = inModifica && inModifica !== "nuova" ? inModifica : null;
  const salva = async () => {
    const bozza = { codice, descrizione, percentuale: percentuale.trim() === "" ? null : Number(percentuale.replace(",", ".")), natura: natura === SENZA_NATURA ? null : natura };
    const errori = controllaAliquota(bozza, aliquote, esistente?.id);
    if (errori.length > 0) { toast({ title: "Aliquota da correggere", description: errori.join(" "), variant: "destructive" }); return; }
    setOccupato(true);
    try {
      if (esistente) await aggiornaAliquota(esistente.id, bozza); else await creaAliquota(bozza);
      await onChanged(); setInModifica(null);
      toast({ title: esistente ? "Aliquota salvata" : "Aliquota aggiunta" });
    } catch (e) { errore(e); } finally { setOccupato(false); }
  };
  const archivia = async (a: AliquotaIva) => {
    setOccupato(true);
    try { await archiviaAliquota(a.id); await onChanged(); setDaArchiviare(null); toast({ title: `«${a.descrizione}» archiviata`, description: "Non si propone più nei documenti nuovi; quelli già fatti restano come sono." }); }
    catch (e) { errore(e); } finally { setOccupato(false); }
  };

  return (
    <div className="space-y-4 max-w-5xl">
      <p className="text-sm text-muted-foreground">
        Le aliquote che si possono scegliere sulle righe dei documenti. Per le operazioni senza IVA (esenti, non imponibili, inversione contabile…) crea un'aliquota a 0% con il suo codice natura:
        è quello che finisce nella fattura elettronica. Quale natura usare per ogni caso va deciso con il commercialista.
      </p>
      <div className="border-2 border-ink/20 rounded-sm bg-paper overflow-x-auto">
        <Table>
          <TableHeader><TableRow><TableHead>Codice</TableHead><TableHead>Descrizione</TableHead><TableHead className="text-right">%</TableHead><TableHead>Natura</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {aliquote.map((a) => (
              <TableRow key={a.id} data-riga>
                <TableCell className="font-mono">{a.codice}</TableCell>
                <TableCell>{a.descrizione}</TableCell>
                <TableCell className="text-right tabular-nums">{String(a.percentuale).replace(".", ",")}</TableCell>
                <TableCell>
                  {a.natura ? <span title={NATURE_IVA.find((n) => n.codice === a.natura)?.nome}>{a.natura}</span>
                    : a.percentuale === 0 ? <Badge variant="outline" className="border-amber-600 text-amber-800">manca la natura</Badge> : ""}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  {puoScrivere && (daArchiviare === a.id ? (
                    <span className="inline-flex items-center gap-2 text-sm">Archiviare?
                      <Button size="sm" variant="destructive" disabled={occupato} onClick={() => archivia(a)}>Sì, archivia</Button>
                      <Button size="sm" variant="outline" onClick={() => setDaArchiviare(null)}>No</Button>
                    </span>
                  ) : (
                    <>
                      <Button size="sm" variant="ghost" title="Modifica" onClick={() => apri(a)}><Pencil className="w-4 h-4" /></Button>
                      <Button size="sm" variant="ghost" title="Archivia" onClick={() => setDaArchiviare(a.id)}><Archive className="w-4 h-4" /></Button>
                    </>
                  ))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {puoScrivere && (inModifica ? (
        <div className="border-2 border-dashed border-ink/30 rounded-sm p-4 space-y-3">
          <h2 className="font-display text-lg font-semibold">{esistente ? `Modifica ${esistente.codice}` : "Nuova aliquota"}</h2>
          <div className="grid md:grid-cols-[8rem_1fr_7rem] gap-3">
            <div><Label>Codice</Label><Input value={codice} disabled={!!esistente} onChange={(e) => setCodice(e.target.value)} placeholder="es. N31" /></div>
            <div><Label>Descrizione (come compare nei documenti)</Label><Input value={descrizione} onChange={(e) => setDescrizione(e.target.value)} placeholder="es. Non imponibile art. 8 DPR 633/72" /></div>
            <div><Label>Percentuale</Label><Input inputMode="decimal" value={percentuale} disabled={!!esistente} onChange={(e) => setPercentuale(e.target.value)} placeholder="0" /></div>
          </div>
          <div>
            <Label>Natura (solo per le aliquote a 0%)</Label>
            <Select value={natura} onValueChange={setNatura}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={SENZA_NATURA}>— nessuna (aliquota con IVA) —</SelectItem>
                {NATURE_IVA.map((n) => <SelectItem key={n.codice} value={n.codice}>{n.codice} — {n.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {esistente && <p className="text-xs text-muted-foreground">Codice e percentuale non si cambiano: i documenti già fatti li usano. Se serve un'aliquota diversa, archivia questa e creane una nuova.</p>}
          <div className="flex gap-2">
            <Button data-f10 disabled={occupato} onClick={salva}>{occupato && <Loader2 className="w-4 h-4 mr-1 animate-spin" />} Salva</Button>
            <Button variant="outline" data-esc onClick={() => setInModifica(null)}>Annulla</Button>
          </div>
        </div>
      ) : (
        <Button data-nuovo onClick={() => apri("nuova")}><Plus className="w-4 h-4 mr-1" /> Nuova aliquota</Button>
      ))}
    </div>
  );
};

/** Impostazioni > Avvio e numerazione. */
export const ImpostazioniAvvio = () => {
  const { isAdmin } = usePermissions();
  const [avvio, setAvvio] = useState<Avvio | null>(null);
  const [data, setData] = useState("");
  const [occupato, setOccupato] = useState(false);
  const carica = useCallback(async () => { const a = await leggiAvvio(); setAvvio(a); setData(a.fattureAttiveDal ?? ""); }, []);
  useEffect(() => { void carica().catch(errore); }, [carica]);
  if (!avvio) return <div className="grid place-items-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  const oggi = new Date().toLocaleDateString("sv-SE");
  const attive = fattureAttive(avvio.fattureAttiveDal, oggi);
  const salva = async () => {
    setOccupato(true);
    try { await salvaFattureAttiveDal(data); await carica(); toast({ title: "Data di avvio salvata" }); } catch (e) { errore(e); } finally { setOccupato(false); }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <section className="space-y-2">
        <h2 className="font-display text-lg font-semibold">Avvio delle fatture</h2>
        <p className="text-sm text-muted-foreground">
          Fino a questa data fatture e note di credito si possono preparare ma restano bozze: non prendono numero e non generano scadenze, così non si sovrappongono a quelle emesse con il vecchio programma.
          Preventivi, conferme d'ordine, DDT e carichi di magazzino funzionano già.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <div><Label>Fatture confermabili dal</Label><Input type="date" className="w-44" value={data} disabled={!isAdmin} onChange={(e) => setData(e.target.value)} /></div>
          {isAdmin && <Button data-f10 disabled={occupato || !data || data === avvio.fattureAttiveDal} onClick={salva}>Salva</Button>}
          <Badge variant="outline" className={attive ? "border-emerald-700 text-emerald-800" : "border-amber-600 text-amber-800"}>{attive ? "Oggi le fatture si possono confermare" : "Oggi le fatture restano bozze"}</Badge>
        </div>
        {!isAdmin && <p className="text-xs text-muted-foreground">La data la cambia solo l'amministratore.</p>}
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-lg font-semibold">Numerazione</h2>
        <p className="text-sm text-muted-foreground">L'ultimo numero assegnato per tipo di documento, anno e serie. I numeri li assegna la conferma del documento, in ordine e senza buchi: qui si consultano soltanto.</p>
        {avvio.numeratori.length === 0 ? (
          <p className="text-sm border-2 border-ink/20 bg-paper rounded-sm px-3 py-4 text-center text-muted-foreground">Nessun documento confermato finora: ogni tipo partirà dal numero 1.</p>
        ) : (
          <div className="border-2 border-ink/20 rounded-sm bg-paper overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Anno</TableHead><TableHead>Documento</TableHead><TableHead>Serie</TableHead><TableHead className="text-right">Ultimo numero</TableHead><TableHead className="text-right">Prossimo</TableHead></TableRow></TableHeader>
              <TableBody>
                {avvio.numeratori.map((n) => (
                  <TableRow key={`${n.tipo}-${n.anno}-${n.serie}`}>
                    <TableCell className="tabular-nums">{n.anno}</TableCell>
                    <TableCell>{TIPO_LABEL[n.tipo] ?? n.tipo}</TableCell>
                    <TableCell className="font-mono">{n.serie || "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{n.ultimo}</TableCell>
                    <TableCell className="text-right tabular-nums">{n.ultimo + 1}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
};

/** Impostazioni > Servizi: la chiave del servizio che compila le schede dalla partita IVA. */
export const ImpostazioniServizi = () => {
  const { isAdmin } = usePermissions();
  const [stato, setStato] = useState<StatoServizio | null>(null);
  const [chiave, setChiave] = useState("");
  const [occupato, setOccupato] = useState(false);
  const [spegni, setSpegni] = useState(false);
  const carica = useCallback(async () => { setStato(isAdmin ? await statoServizioAziende() : { disponibile: true, attivo: false, aggiornato_il: null }); }, [isAdmin]);
  useEffect(() => { void carica(); }, [carica]);
  if (!stato) return <div className="grid place-items-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  const salva = async (valore: string) => {
    setOccupato(true);
    try {
      await salvaChiaveServizioAziende(valore);
      setChiave(""); setSpegni(false); await carica();
      toast({ title: valore ? "Chiave salvata" : "Servizio spento", description: valore ? "Prova subito: crea una scheda nuova e scrivi una partita IVA." : "Le schede si compilano di nuovo dal solo archivio gratuito." });
    } catch (e) { errore(e); } finally { setOccupato(false); }
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <h2 className="font-display text-lg font-semibold">Dati aziendali dalla partita IVA</h2>
      <p className="text-sm text-muted-foreground">
        Quando si crea un cliente o un fornitore, la scheda si compila dalla partita IVA. Senza chiave si usa l'archivio gratuito dell'Agenzia delle Entrate: ragione sociale e sede.
        Con la chiave di Openapi (servizio a pagamento che legge il Registro imprese) arrivano anche codice fiscale, PEC e codice destinatario. Ogni ricerca completa è una chiamata a pagamento sul tuo conto Openapi;
        per l'estero e in caso di problemi si usa comunque l'archivio gratuito.
      </p>
      {!isAdmin ? <p className="text-sm text-muted-foreground">Questa impostazione la vede e la cambia solo l'amministratore.</p> : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={stato.attivo ? "border-emerald-700 text-emerald-800" : "border-amber-600 text-amber-800"}>
              {stato.attivo ? `Servizio attivo, chiave salvata il ${new Date(stato.aggiornato_il ?? "").toLocaleDateString("it-IT")}` : "Nessuna chiave: si usa solo l'archivio gratuito"}
            </Badge>
          </div>
          {!stato.disponibile && <p className="text-sm border-2 border-amber-600 bg-amber-50 text-amber-900 rounded-sm px-3 py-2">{stato.motivo ?? "Il servizio non è ancora attivo sul server."}</p>}
          <div className="flex flex-wrap items-end gap-2">
            <div className="grow max-w-xl">
              <Label>{stato.attivo ? "Nuova chiave (sostituisce quella salvata)" : "Chiave (token) di Openapi per «Company»"}</Label>
              <Input type="password" autoComplete="new-password" value={chiave} disabled={!stato.disponibile} onChange={(e) => setChiave(e.target.value)} />
            </div>
            <Button data-f10 disabled={occupato || !chiave.trim() || !stato.disponibile} onClick={() => salva(chiave)}>{occupato && <Loader2 className="w-4 h-4 mr-1 animate-spin" />} Salva chiave</Button>
            {stato.attivo && (spegni
              ? <span className="inline-flex items-center gap-2 text-sm">Spegnere il servizio?<Button size="sm" variant="destructive" disabled={occupato} onClick={() => salva("")}>Sì, spegni</Button><Button size="sm" variant="outline" onClick={() => setSpegni(false)}>No</Button></span>
              : <Button variant="outline" disabled={occupato} onClick={() => setSpegni(true)}>Spegni</Button>)}
          </div>
          <p className="text-xs text-muted-foreground">
            La chiave si crea nella console di Openapi (sezione dei token), abilitata per l'API «Company», chiamata IT-advanced; lì scegli anche la scadenza: quando scade va rigenerata e reinserita qui.
            Viene conservata cifrata sul server e non si può più rileggere, solo sostituire o spegnere.
          </p>
        </>
      )}
    </div>
  );
};
