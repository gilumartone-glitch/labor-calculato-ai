import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Building2, CircleCheck, CircleX, Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { eur } from "@/lib/format";
import { usePermissions } from "@/hooks/usePermissions";
import { leggiAzienda, leggiOrigine, salvaAzienda } from "@/lib/gestionale/azienda";
import {
  AZIENDA_VUOTA, REGIMI_FISCALI, VERSIONE_SPECIFICHE, controllaFattura, creaFatturaXml, nomeFileFattura, totaliFattura,
  type DatiAzienda, type DatiFattura,
} from "@/lib/gestionale/fattura-pa";
import type { TipoDocumento } from "@/lib/gestionale/documenti";

const messaggio = (e: unknown) => (e instanceof Error ? e.message : String(e));
const errore = (e: unknown) => toast({ title: "Errore", description: messaggio(e), variant: "destructive" });
const selectClass = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";

/* ------------------------------------------------------------------ */
/* Dati dell'azienda che emette                                        */
/* ------------------------------------------------------------------ */
export const DatiAziendaDialog = ({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; onSaved?: (a: DatiAzienda) => void }) => {
  const { isAdmin } = usePermissions();
  const [f, setF] = useState<DatiAzienda>(AZIENDA_VUOTA);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    leggiAzienda().then(setF).catch(errore).finally(() => setLoading(false));
  }, [open]);

  const campo = (k: Exclude<keyof DatiAzienda, "socio_unico" | "regime_fiscale">, etichetta: string, opz: { className?: string; placeholder?: string } = {}) => (
    <div className={opz.className}>
      <Label>{etichetta}</Label>
      <Input value={f[k]} placeholder={opz.placeholder} disabled={!isAdmin} onChange={(e) => setF((p) => ({ ...p, [k]: e.target.value }))} />
    </div>
  );

  const salva = async () => {
    setSaving(true);
    try {
      await salvaAzienda(f);
      toast({ title: "Dati azienda salvati" });
      onSaved?.(f);
      onOpenChange(false);
    } catch (e) { errore(e); } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Dati azienda</DialogTitle></DialogHeader>
        {loading ? (
          <div className="grid place-items-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="grid gap-3">
            <p className="text-xs text-muted-foreground">
              Sono i dati di chi emette, riportati su ogni fattura elettronica. Copiali dalla visura camerale.
              {!isAdmin && " Li modifica solo l'amministratore."}
            </p>
            {campo("denominazione", "Denominazione", { placeholder: "come in visura" })}
            <div className="grid grid-cols-3 gap-3">
              {campo("partita_iva", "Partita IVA")}
              {campo("codice_fiscale", "Codice fiscale")}
              <div>
                <Label>Regime fiscale</Label>
                <select className={selectClass} value={f.regime_fiscale} disabled={!isAdmin} onChange={(e) => setF((p) => ({ ...p, regime_fiscale: e.target.value }))}>
                  {REGIMI_FISCALI.map((r) => <option key={r.codice} value={r.codice}>{r.etichetta}</option>)}
                </select>
              </div>
            </div>
            {campo("indirizzo", "Indirizzo della sede legale")}
            <div className="grid grid-cols-4 gap-3">
              {campo("cap", "CAP")}
              {campo("comune", "Comune", { className: "col-span-2" })}
              {campo("provincia", "Prov.", { placeholder: "NA" })}
            </div>
            <div className="grid grid-cols-4 gap-3">
              {campo("rea_ufficio", "REA: ufficio", { placeholder: "NA" })}
              {campo("rea_numero", "REA: numero")}
              {campo("capitale_sociale", "Capitale sociale (€)")}
              <div>
                <Label>Soci</Label>
                <select className={selectClass} value={f.socio_unico} disabled={!isAdmin} onChange={(e) => setF((p) => ({ ...p, socio_unico: e.target.value as DatiAzienda["socio_unico"] }))}>
                  <option value="">Non indicato</option>
                  <option value="SU">Socio unico</option>
                  <option value="SM">Più soci</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {campo("telefono", "Telefono")}
              {campo("email", "Email")}
            </div>
            <div className="grid grid-cols-3 gap-3">
              {campo("iban", "IBAN per i bonifici dei clienti", { className: "col-span-2" })}
              {campo("banca", "Banca")}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{isAdmin ? "Annulla" : "Chiudi"}</Button>
          {isAdmin && <Button onClick={salva} disabled={saving || loading}>{saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Salva</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/* ------------------------------------------------------------------ */
/* Controllo e file XML di una fattura o nota di credito               */
/* ------------------------------------------------------------------ */
export type FatturaDaControllare = Omit<DatiFattura, "origine"> & { origine_id: string | null };

export const FatturaElettronicaDialog = ({ fattura, onClose }: { fattura: FatturaDaControllare | null; onClose: () => void }) => {
  const [azienda, setAzienda] = useState<DatiAzienda | null>(null);
  const [origine, setOrigine] = useState<DatiFattura["origine"]>(null);
  const [loading, setLoading] = useState(true);
  const [datiAzienda, setDatiAzienda] = useState(false);
  const origineId = fattura?.origine_id ?? null;
  const aperta = fattura != null;

  useEffect(() => {
    if (!aperta) return;
    setLoading(true);
    Promise.all([leggiAzienda(), origineId ? leggiOrigine(origineId) : Promise.resolve(null)])
      .then(([a, o]) => {
        setAzienda(a);
        setOrigine(o && o.numero != null
          ? { tipo: o.tipo as TipoDocumento, numero: `${o.numero}${o.serie ? `/${o.serie}` : ""}/${o.anno}`, data: o.data }
          : null);
      })
      .catch(errore)
      .finally(() => setLoading(false));
  }, [aperta, origineId]);

  const dati = useMemo<DatiFattura | null>(() => {
    if (!fattura) return null;
    const { origine_id: _o, ...resto } = fattura;
    return { ...resto, origine };
  }, [fattura, origine]);
  const controllo = useMemo(() => (azienda && dati ? controllaFattura(azienda, dati) : null), [azienda, dati]);
  const totali = useMemo(() => (dati ? totaliFattura(dati) : null), [dati]);

  if (!fattura || !dati) return null;
  const bozza = dati.numero == null;

  const scarica = () => {
    if (!azienda) return;
    try {
      const blob = new Blob([creaFatturaXml(azienda, dati)], { type: "application/xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = bozza ? `PROVA_${nomeFileFattura(azienda, dati)}` : nomeFileFattura(azienda, dati);
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) { errore(e); }
  };

  return (
    <>
      <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Fattura elettronica</DialogTitle></DialogHeader>
          {loading || !controllo || !totali ? (
            <div className="grid place-items-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="grid gap-3 text-sm">
              <div className="grid grid-cols-3 gap-2 border-2 border-ink/20 rounded-sm p-3">
                <div><div className="text-xs text-muted-foreground">Imponibile</div><div className="font-semibold tabular-nums">{eur(totali.imponibile)}</div></div>
                <div><div className="text-xs text-muted-foreground">IVA</div><div className="font-semibold tabular-nums">{eur(totali.imposta)}</div></div>
                <div><div className="text-xs text-muted-foreground">{dati.esigibilita_iva === "S" ? "Da incassare (senza IVA)" : "Totale"}</div><div className="font-semibold tabular-nums">{eur(totali.daPagare)}</div></div>
              </div>

              {controllo.errori.length === 0 && controllo.avvisi.length === 0 && (
                <p className="flex items-center gap-2"><CircleCheck className="w-4 h-4 text-emerald-600" /> Tutti i dati richiesti ci sono.</p>
              )}
              {controllo.errori.length > 0 && (
                <div>
                  <p className="font-semibold mb-1">Da sistemare prima di creare il file</p>
                  <ul className="grid gap-1">
                    {controllo.errori.map((e) => <li key={e} className="flex gap-2"><CircleX className="w-4 h-4 shrink-0 mt-0.5 text-destructive" />{e}</li>)}
                  </ul>
                </div>
              )}
              {controllo.avvisi.length > 0 && (
                <div>
                  <p className="font-semibold mb-1">Da controllare</p>
                  <ul className="grid gap-1 text-muted-foreground">
                    {controllo.avvisi.map((a) => <li key={a} className="flex gap-2"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />{a}</li>)}
                  </ul>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Tracciato dell'Agenzia delle Entrate, specifiche tecniche {VERSIONE_SPECIFICHE}. Il file si scarica soltanto: l'invio allo SDI non è ancora collegato.
              </p>
            </div>
          )}
          <DialogFooter className="sm:justify-between gap-2">
            <Button variant="outline" onClick={() => setDatiAzienda(true)}><Building2 className="w-4 h-4 mr-1" /> Dati azienda</Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose}>Chiudi</Button>
              <Button onClick={scarica} disabled={loading || !controllo || controllo.errori.length > 0}>
                <Download className="w-4 h-4 mr-1" /> {bozza ? "Scarica XML di prova" : "Scarica XML"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <DatiAziendaDialog open={datiAzienda} onOpenChange={setDatiAzienda} onSaved={setAzienda} />
    </>
  );
};
