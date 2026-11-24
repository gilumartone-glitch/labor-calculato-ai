import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, ChevronsUpDown, FilePlus2, FileText, Loader2, RefreshCw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { usePermissions } from "@/hooks/usePermissions";
import { toast } from "@/hooks/use-toast";
import { eur } from "@/lib/format";
import { elencoAliquote, elencoAnagrafiche, numeroDocumento, type AliquotaIva, type Anagrafica } from "@/lib/gestionale/documenti";
import {
  aggiornaBozzaDaScheda, creaPreventivoDaScheda, preventiviDellaScheda, preventivoDaProgettazione,
  type PreventivoScheda, type RiepilogoProgetto,
} from "@/lib/gestionale/da-progettazione";

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const dataIt = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
const errore = (e: unknown) => toast({ title: "Errore", description: e instanceof Error ? e.message : String(e), variant: "destructive" });

/** Id della scheda di Progettazione attiva, se è una scheda salvata. */
const schedaAttiva = (): string | null => {
  try {
    const id = localStorage.getItem("officina:active-draft");
    return id && RE_UUID.test(id) ? id : null;
  } catch { return null; }
};

/**
 * Dal Riepilogo generale di Progettazione: il progetto diventa un preventivo del Gestionale.
 * Si sceglie il cliente e il preventivo prende subito il numero corrente, pronto da inviare;
 * oppure resta in bozza per ritoccarlo. Visibile solo a chi può scrivere nel Gestionale.
 */
export const CreaPreventivoGestionaleButton = ({ riepilogo, disabled, className }: {
  riepilogo: () => RiepilogoProgetto;
  disabled?: boolean;
  className?: string;
}) => {
  const { can } = usePermissions();
  const navigate = useNavigate();
  const [aperto, setAperto] = useState(false);
  const [dati, setDati] = useState<{ clienti: Anagrafica[]; aliquote: AliquotaIva[]; esistenti: PreventivoScheda[]; draftId: string | null; foto: RiepilogoProgetto } | null>(null);
  const [clienteId, setClienteId] = useState<string | null>(null);
  const [scegliCliente, setScegliCliente] = useState(false);
  const [produzione, setProduzione] = useState("");
  const [validita, setValidita] = useState("30");
  const [occupato, setOccupato] = useState<"" | "numero" | "bozza" | string>("");

  useEffect(() => {
    if (!aperto) return;
    setDati(null); setClienteId(null); setProduzione(""); setOccupato("");
    const draftId = schedaAttiva();
    const foto = riepilogo();
    Promise.all([elencoAnagrafiche(), elencoAliquote(), preventiviDellaScheda(draftId)])
      .then(([a, aliquote, esistenti]) => setDati({ clienti: a.filter((x) => x.is_cliente), aliquote, esistenti, draftId, foto }))
      .catch((e) => { errore(e); setAperto(false); });
  }, [aperto]); // eslint-disable-line react-hooks/exhaustive-deps

  const preventivo = useMemo(() => (dati ? preventivoDaProgettazione(dati.foto, dati.aliquote) : null), [dati]);
  if (!can("gestionale", "write")) return null;

  const cliente = dati?.clienti.find((c) => c.id === clienteId) ?? null;
  const richiesta = () => ({
    preventivo: preventivo!, draftId: dati!.draftId, cliente,
    produzione, validitaGiorni: /^\d{1,3}$/.test(validita.trim()) ? Number(validita) : null,
  });

  const crea = async (conNumero: boolean) => {
    if (!preventivo || !dati) return;
    if (conNumero && !cliente) { toast({ title: "Scegli il cliente", description: "Per dare il numero al preventivo serve il cliente.", variant: "destructive" }); return; }
    setOccupato(conNumero ? "numero" : "bozza");
    try {
      const creato = await creaPreventivoDaScheda(richiesta(), conNumero);
      if (conNumero) {
        toast({ title: `Preventivo n. ${numeroDocumento(creato)}`, description: "Ha preso il numero: ora puoi inviarlo al cliente." });
        navigate(`/gestionale?doc=${creato.id}&invia=1`);
      } else {
        toast({ title: "Preventivo creato in bozza", description: "Ritoccalo nel Gestionale e conferma per dargli il numero." });
        navigate(`/gestionale?doc=${creato.id}`);
      }
    } catch (e) {
      errore(e); setOccupato("");
      // se è rimasto in bozza lo si ritrova subito nell'elenco qui sopra
      preventiviDellaScheda(dati.draftId).then((esistenti) => setDati((d) => (d ? { ...d, esistenti } : d))).catch(() => undefined);
    }
  };
  const aggiorna = async (p: PreventivoScheda) => {
    if (!preventivo) return;
    setOccupato(p.id);
    try {
      await aggiornaBozzaDaScheda(p.id, { ...richiesta(), cliente: cliente ?? null });
      toast({ title: "Bozza aggiornata", description: "Le righe ora riportano i valori della scheda." });
      navigate(`/gestionale?doc=${p.id}`);
    } catch (e) { errore(e); setOccupato(""); }
  };

  return (
    <>
      <button type="button" onClick={() => setAperto(true)} disabled={disabled} className={className}>
        <FilePlus2 className="w-3.5 h-3.5" /> Preventivo al cliente (Gestionale)
      </button>
      <Dialog open={aperto} onOpenChange={(o) => { if (!occupato) setAperto(o); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Preventivo al cliente da questo progetto</DialogTitle></DialogHeader>
          {!dati || !preventivo ? (
            <div className="grid place-items-center py-10"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : preventivo.righe.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">La scheda non ha ancora costi: non c'è nulla da portare nel preventivo.</p>
          ) : (
            <div className="grid gap-4">
              <div className="border-2 border-ink/20 rounded-sm bg-paper px-3 py-2 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold truncate">{preventivo.oggetto ?? "Progetto senza nome"}</span>
                  <span className="tabular-nums">Imponibile <strong>{eur(preventivo.netto)}</strong></span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {preventivo.righe.filter((r) => r.tipo_riga !== "nota").length} righe: una per reparto, con il dettaglio di cosa comprende e senza i costi interni.
                  {preventivo.aliquotaMancante !== null && ` Attenzione: nel Gestionale non c'è l'aliquota ${preventivo.aliquotaMancante}%, le righe nascono senza IVA (si aggiunge in Impostazioni › Aliquote IVA).`}
                </p>
              </div>

              {dati.esistenti.length > 0 && (
                <div className="text-sm">
                  <p className="font-semibold mb-1">Da questa scheda sono già nati</p>
                  <ul className="space-y-1">
                    {dati.esistenti.map((p) => (
                      <li key={p.id} className="flex flex-wrap items-center gap-2 border border-ink/15 rounded-sm px-2 py-1">
                        <FileText className="w-4 h-4 shrink-0" />
                        <span>{p.numero == null ? "Preventivo in bozza" : `Preventivo n. ${numeroDocumento(p)}`} del {dataIt(p.data)}</span>
                        <span className="text-muted-foreground truncate">{p.ragione_sociale ?? "senza cliente"} · {eur(p.imponibile)}</span>
                        {p.imponibile !== preventivo.netto && <Badge variant="outline" className="border-amber-600 text-amber-800">la scheda è cambiata</Badge>}
                        <span className="ml-auto flex gap-1">
                          {p.stato === "bozza" && (
                            <Button size="sm" variant="outline" disabled={occupato !== ""} onClick={() => aggiorna(p)} title="Riscrive le righe della bozza con i valori di adesso">
                              {occupato === p.id ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1" />} Aggiorna
                            </Button>
                          )}
                          <Button size="sm" variant="outline" disabled={occupato !== ""} onClick={() => navigate(`/gestionale?doc=${p.id}`)}>Apri</Button>
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-muted-foreground mt-1">Un preventivo che ha già il numero non si riscrive: se il progetto è cambiato, creane uno nuovo qui sotto.</p>
                </div>
              )}

              <div className="grid gap-3">
                <div>
                  <Label>Cliente</Label>
                  <Popover open={scegliCliente} onOpenChange={setScegliCliente}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
                        <span className="truncate">{cliente ? cliente.ragione_sociale : "Scegli il cliente…"}</span>
                        <ChevronsUpDown className="w-4 h-4 opacity-50 shrink-0" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="p-0 w-[420px]" align="start">
                      <Command>
                        <CommandInput placeholder="Cerca per nome o partita IVA…" />
                        <CommandList>
                          <CommandEmpty>Nessun cliente trovato: aggiungilo in Gestionale › Clienti e fornitori.</CommandEmpty>
                          <CommandGroup>
                            {dati.clienti.map((a) => (
                              <CommandItem key={a.id} value={`${a.ragione_sociale} ${a.partita_iva ?? ""} ${a.codice}`} onSelect={() => { setClienteId(a.id); setScegliCliente(false); }}>
                                <Check className={`w-4 h-4 mr-1 ${a.id === clienteId ? "opacity-100" : "opacity-0"}`} />
                                <span className="truncate">{a.ragione_sociale}</span>
                                <span className="ml-auto pl-2 font-mono text-xs text-muted-foreground">{a.partita_iva ?? a.codice}</span>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="grid grid-cols-[1fr_9rem] gap-3">
                  <div><Label>Produzione (nome dello spettacolo)</Label><Input value={produzione} onChange={(e) => setProduzione(e.target.value)} placeholder="facoltativo" /></div>
                  <div><Label>Validità (giorni)</Label><Input inputMode="numeric" value={validita} onChange={(e) => setValidita(e.target.value.replace(/\D/g, ""))} /></div>
                </div>
              </div>

              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="outline" disabled={occupato !== ""} onClick={() => setAperto(false)}>Annulla</Button>
                <Button variant="outline" disabled={occupato !== ""} onClick={() => crea(false)}>
                  {occupato === "bozza" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <FilePlus2 className="w-4 h-4 mr-1" />} Crea in bozza
                </Button>
                <Button disabled={occupato !== "" || !cliente} onClick={() => crea(true)}>
                  {occupato === "numero" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Send className="w-4 h-4 mr-1" />} Dai il numero e invia
                </Button>
              </div>
              <p className="text-xs text-muted-foreground -mt-2">
                «Dai il numero e invia» assegna al preventivo il numero corrente dei preventivi e apre l'email con il PDF allegato: da quel momento il preventivo non si cancella, al più si annulla.
                «Crea in bozza» lo lascia senza numero, da ritoccare nel Gestionale.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};
