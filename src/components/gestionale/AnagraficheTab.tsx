import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Loader2, Pencil, Archive, Search, Upload, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import {
  archiviaAnagrafica, contaAnagraficheImportate, importaAnagrafiche, salvaAnagrafica,
  type Anagrafica, type DatiAnagrafica,
} from "@/lib/gestionale/documenti";
import { cercaAzienda, compilaScheda, leggiPartitaIva, partitaIvaItalianaValida, schedaConPartitaIva } from "@/lib/gestionale/cerca-azienda";
import { daMexal, leggiExportMexal, riepilogoImport, type LetturaMexal, type RiepilogoImport } from "@/lib/gestionale/import-mexal";

const messaggio = (e: unknown) => (e instanceof Error ? e.message : String(e));

const VUOTA: DatiAnagrafica = {
  is_cliente: true, is_fornitore: false, ragione_sociale: "", partita_iva: null, codice_fiscale: null,
  codice_sdi: null, pec: null, email: null, telefono: null, indirizzo: null, cap: null, citta: null,
  provincia: null, nazione: "IT", pagamento: null, note: null,
  codice_pagamento: null, senza_partita_iva: false, banca_appoggio: null, abi: null, cab: null,
  banca_presentazione: null, codice_iva_esenzione: null, fido: null, esigibilita_iva: "I", ordine_cliente_tipo: null,
};

const daAnagrafica = (a: Anagrafica): DatiAnagrafica => ({
  is_cliente: a.is_cliente, is_fornitore: a.is_fornitore, ragione_sociale: a.ragione_sociale,
  partita_iva: a.partita_iva, codice_fiscale: a.codice_fiscale, codice_sdi: a.codice_sdi, pec: a.pec,
  email: a.email, telefono: a.telefono, indirizzo: a.indirizzo, cap: a.cap, citta: a.citta,
  provincia: a.provincia, nazione: a.nazione, pagamento: a.pagamento, note: a.note,
  codice_pagamento: a.codice_pagamento, senza_partita_iva: a.senza_partita_iva, banca_appoggio: a.banca_appoggio,
  abi: a.abi, cab: a.cab, banca_presentazione: a.banca_presentazione, codice_iva_esenzione: a.codice_iva_esenzione,
  fido: a.fido, esigibilita_iva: a.esigibilita_iva ?? "I", ordine_cliente_tipo: a.ordine_cliente_tipo ?? null,
});

type CampoTesto = Exclude<keyof DatiAnagrafica, "is_cliente" | "is_fornitore" | "senza_partita_iva" | "fido" | "esigibilita_iva">;

export const AnagraficaDialog = ({ open, anagrafica, predefinito, onOpenChange, onSaved }: {
  open: boolean;
  anagrafica: Anagrafica | null;
  /** Ruolo proposto per una nuova scheda. */
  predefinito?: "cliente" | "fornitore";
  onOpenChange: (o: boolean) => void;
  onSaved: (a: Anagrafica) => void;
}) => {
  const [f, setF] = useState<DatiAnagrafica>(VUOTA);
  const [saving, setSaving] = useState(false);
  const [cercando, setCercando] = useState(false);
  const [esitoRicerca, setEsitoRicerca] = useState<{ tono: "ok" | "avviso"; testo: string } | null>(null);
  const ultimaCercata = useRef("");

  /** Dalla partita IVA compila ragione sociale e sede (dati dell'Agenzia delle Entrate, via VIES). */
  const compilaDaPartitaIva = async (testoPiva: string) => {
    const { paese, numero } = leggiPartitaIva(testoPiva, f.nazione);
    ultimaCercata.current = `${paese}${numero}`;
    setCercando(true); setEsitoRicerca(null);
    try {
      const [esito, doppia] = await Promise.all([cercaAzienda(testoPiva, f.nazione), schedaConPartitaIva(numero, anagrafica?.id)]);
      const nota = doppia ? ` Attenzione: questa partita IVA è già sulla scheda ${doppia.codice} «${doppia.ragione_sociale}».` : "";
      if (esito.trovata === false) { setEsitoRicerca({ tono: "avviso", testo: esito.messaggio + nota }); return; }
      let riepilogo = "";
      setF((p) => {
        const { scheda, compilati, diversi } = compilaScheda(p, esito, !!anagrafica);
        riepilogo = [
          compilati.length ? `Compilati: ${compilati.join(", ")}.` : "Nessun campo da compilare: la scheda li aveva già.",
          diversi.length ? `All'Agenzia delle Entrate risultano diversi (non li ho cambiati): ${diversi.join("; ")}.` : "",
        ].filter(Boolean).join(" ");
        return scheda;
      });
      setEsitoRicerca({ tono: doppia ? "avviso" : "ok", testo: `${esito.denominazione || "Partita IVA attiva"} — ${riepilogo} PEC, codice destinatario e codice fiscale non sono in questo archivio: vanno chiesti al cliente.${nota}` });
    } catch (e) {
      setEsitoRicerca({ tono: "avviso", testo: `${messaggio(e)} Puoi compilare la scheda a mano.` });
    } finally { setCercando(false); }
  };

  // scheda nuova: appena la partita IVA è completa e corretta si compila da sola, una volta per numero
  useEffect(() => {
    if (!open || anagrafica || cercando || f.ragione_sociale.trim()) return;
    const { paese, numero } = leggiPartitaIva(f.partita_iva ?? "", f.nazione);
    if (paese !== "IT" || !partitaIvaItalianaValida(numero) || ultimaCercata.current === `${paese}${numero}`) return;
    void compilaDaPartitaIva(f.partita_iva ?? "");
  }, [open, anagrafica, f.partita_iva]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    setEsitoRicerca(null); ultimaCercata.current = "";
    if (anagrafica) setF(daAnagrafica(anagrafica));
    else setF({ ...VUOTA, is_cliente: predefinito !== "fornitore", is_fornitore: predefinito === "fornitore" });
  }, [open, anagrafica, predefinito]);

  const testo = (k: CampoTesto) => (f[k] as string | null) ?? "";
  const setTesto = (k: CampoTesto, v: string) => setF((p) => ({ ...p, [k]: k === "ragione_sociale" || k === "nazione" ? v : v.trim() === "" ? null : v }));

  const salva = async () => {
    if (!f.ragione_sociale.trim()) {
      toast({ title: "Dati mancanti", description: "La ragione sociale è obbligatoria.", variant: "destructive" });
      return;
    }
    if (!f.is_cliente && !f.is_fornitore) {
      toast({ title: "Dati mancanti", description: "Indica se è cliente, fornitore o entrambi.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const salvata = await salvaAnagrafica({
        ...f,
        ragione_sociale: f.ragione_sociale.trim(),
        nazione: (f.nazione || "IT").trim().toUpperCase(),
        partita_iva: f.partita_iva?.replace(/\s+/g, "") || null,
        codice_fiscale: f.codice_fiscale?.replace(/\s+/g, "").toUpperCase() || null,
        codice_sdi: f.codice_sdi?.trim().toUpperCase() || null,
        provincia: f.provincia?.trim().toUpperCase() || null,
      }, anagrafica?.id);
      onSaved(salvata);
      onOpenChange(false);
    } catch (e) {
      toast({ title: "Errore", description: messaggio(e), variant: "destructive" });
    } finally { setSaving(false); }
  };

  const campo = (k: CampoTesto, etichetta: string, extra?: { placeholder?: string; className?: string }) => (
    <div className={extra?.className}>
      <Label>{etichetta}</Label>
      <Input value={testo(k)} onChange={(e) => setTesto(k, e.target.value)} placeholder={extra?.placeholder} />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{anagrafica ? `Modifica ${anagrafica.codice}` : "Nuova anagrafica"}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Partita IVA</Label>
              <div className="flex gap-2">
                <Input value={testo("partita_iva")} onChange={(e) => setTesto("partita_iva", e.target.value)} placeholder={anagrafica ? undefined : "scrivila e il resto si compila"} autoFocus={!anagrafica} />
                <Button type="button" variant="outline" disabled={cercando || !(f.partita_iva ?? "").trim()} onClick={() => compilaDaPartitaIva(f.partita_iva ?? "")} title="Compila ragione sociale e sede dalla partita IVA">
                  {cercando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}<span className="ml-1 hidden sm:inline">Compila</span>
                </Button>
              </div>
            </div>
            {campo("codice_fiscale", "Codice fiscale")}
          </div>
          {esitoRicerca && (
            <p className={`text-xs rounded-sm border px-2 py-1.5 ${esitoRicerca.tono === "ok" ? "border-emerald-700/40 bg-emerald-50 text-emerald-900" : "border-amber-600/50 bg-amber-50 text-amber-900"}`}>{esitoRicerca.testo}</p>
          )}
          {campo("ragione_sociale", "Ragione sociale")}
          <div className="flex flex-wrap items-center gap-5">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={f.is_cliente} onCheckedChange={(v) => setF((p) => ({ ...p, is_cliente: v }))} /> Cliente
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={f.is_fornitore} onCheckedChange={(v) => setF((p) => ({ ...p, is_fornitore: v }))} /> Fornitore
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={f.senza_partita_iva} onCheckedChange={(v) => setF((p) => ({ ...p, senza_partita_iva: v }))} /> Senza partita IVA
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {campo("codice_sdi", "Codice destinatario SDI", { placeholder: "7 caratteri" })}
            {campo("pec", "PEC")}
          </div>
          {campo("indirizzo", "Indirizzo")}
          <div className="grid grid-cols-4 gap-3">
            {campo("cap", "CAP")}
            {campo("citta", "Città", { className: "col-span-2" })}
            {campo("provincia", "Prov.")}
          </div>
          <div className="grid grid-cols-3 gap-3">
            {campo("nazione", "Nazione", { placeholder: "IT" })}
            {campo("email", "Email")}
            {campo("telefono", "Telefono")}
          </div>
          {campo("ordine_cliente_tipo", "Come chiama il suo ordine di acquisto", { placeholder: "es. OP, RdA, OC, Ord." })}
          <div>
            <Label>IVA in fattura</Label>
            <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={f.esigibilita_iva}
              onChange={(e) => setF((p) => ({ ...p, esigibilita_iva: e.target.value as DatiAnagrafica["esigibilita_iva"] }))}>
              <option value="I">Normale (esigibilità immediata)</option>
              <option value="S">Scissione dei pagamenti (split payment): PA e società controllate</option>
              <option value="D">Esigibilità differita</option>
            </select>
          </div>
          <div className="grid grid-cols-4 gap-3">
            {campo("codice_pagamento", "Cod. pag.")}
            {campo("pagamento", "Condizioni di pagamento abituali", { placeholder: "es. Bonifico 30 gg data fattura", className: "col-span-3" })}
          </div>
          <div className="grid grid-cols-4 gap-3">
            {campo("banca_appoggio", "Banca di appoggio", { className: "col-span-2" })}
            {campo("abi", "ABI")}
            {campo("cab", "CAB")}
          </div>
          <div className="grid grid-cols-4 gap-3">
            {campo("banca_presentazione", "Banca di presentazione", { className: "col-span-2" })}
            {campo("codice_iva_esenzione", "Cod. IVA / esenzione")}
            <div>
              <Label>Fido (€)</Label>
              <Input
                type="number" step="any" min={0} value={f.fido ?? ""}
                onChange={(e) => setF((p) => ({ ...p, fido: e.target.value === "" ? null : Number(e.target.value) }))}
              />
            </div>
          </div>
          <div>
            <Label>Note</Label>
            <Textarea rows={2} value={testo("note")} onChange={(e) => setTesto("note", e.target.value)} />
          </div>
          {anagrafica?.dati_origine && (
            <details className="border-2 border-ink/20 rounded-sm">
              <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
                Dati originali da {anagrafica.origine === "mexal" ? "Mexal" : anagrafica.origine ?? "import"}
                {anagrafica.importato_il ? ` · importati il ${new Date(anagrafica.importato_il).toLocaleDateString("it-IT")}` : ""}
              </summary>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 px-3 pb-3 text-xs">
                {Object.entries(anagrafica.dati_origine).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="font-mono break-all">{v === "" ? "—" : v}</dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annulla</Button>
          <Button onClick={salva} disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Salva</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/* ------------------------------------------------------------------ */
/* Import da Mexal                                                     */
/* ------------------------------------------------------------------ */
const ImportMexalDialog = ({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) => {
  const [lettura, setLettura] = useState<LetturaMexal | null>(null);
  const [riepilogo, setRiepilogo] = useState<RiepilogoImport | null>(null);
  const [nomeFile, setNomeFile] = useState("");
  const [giaPresenti, setGiaPresenti] = useState<number | null>(null);
  const [avanzamento, setAvanzamento] = useState<{ fatte: number; totale: number } | null>(null);
  const [esito, setEsito] = useState<{ importate: number; inArchivio: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    setLettura(null); setRiepilogo(null); setNomeFile(""); setAvanzamento(null); setEsito(null);
    contaAnagraficheImportate("mexal").then(setGiaPresenti).catch(() => setGiaPresenti(null));
  }, [open]);

  const scegli = async (file: File | undefined) => {
    if (!file) return;
    try {
      const l = leggiExportMexal(await file.text());
      if (l.righe.length === 0) throw new Error("Il file non contiene schede.");
      setLettura(l);
      setRiepilogo(riepilogoImport(l));
      setNomeFile(file.name);
    } catch (e) {
      setLettura(null); setRiepilogo(null);
      toast({ title: "File non leggibile", description: messaggio(e), variant: "destructive" });
    }
  };

  const importa = async () => {
    if (!lettura) return;
    const adesso = new Date().toISOString();
    setAvanzamento({ fatte: 0, totale: lettura.righe.length });
    try {
      const importate = await importaAnagrafiche(
        lettura.righe.map((r) => daMexal(r, adesso)),
        (fatte, totale) => setAvanzamento({ fatte, totale }),
      );
      // controllo finale sul database: quante schede Mexal ci sono davvero
      const inArchivio = await contaAnagraficheImportate("mexal");
      setEsito({ importate, inArchivio });
      onDone();
    } catch (e) {
      toast({ title: "Import interrotto", description: `${messaggio(e)} — Le schede già scritte restano; si può rilanciare l'import senza creare doppioni.`, variant: "destructive" });
    } finally { setAvanzamento(null); }
  };

  const inCorso = avanzamento !== null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!inCorso) onOpenChange(o); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>Importa clienti e fornitori da Mexal</DialogTitle></DialogHeader>

        {esito ? (
          <div className="grid gap-2 text-sm">
            <p className="font-medium">Import completato.</p>
            <p>Schede scritte: <strong>{esito.importate}</strong>. Schede Mexal ora in archivio: <strong>{esito.inArchivio}</strong>.</p>
            {esito.inArchivio < esito.importate && (
              <p className="text-destructive">Attenzione: in archivio risultano meno schede di quelle scritte. Rilancia l'import.</p>
            )}
          </div>
        ) : (
          <div className="grid gap-3 text-sm">
            <p className="text-muted-foreground">
              Scegli il file XML esportato da Mexal («Anagrafica Clienti Fornitori per Excel»). Ogni colonna del file viene
              conservata così com'è nella scheda, alla voce «Dati originali».
            </p>
            <Input type="file" accept=".xml,text/xml,application/xml" disabled={inCorso} onChange={(e) => scegli(e.target.files?.[0])} />
            {giaPresenti !== null && giaPresenti > 0 && (
              <p className="border-2 border-ink/20 rounded-sm px-3 py-2">
                In archivio ci sono già {giaPresenti} schede arrivate da Mexal: quelle con lo stesso codice conto verranno
                <strong> aggiornate</strong> con i dati del file, non duplicate.
              </p>
            )}
            {riepilogo && (
              <div className="border-2 border-ink/20 rounded-sm px-3 py-2 grid gap-1">
                <p className="font-medium">{nomeFile}</p>
                <p>Schede trovate: <strong>{riepilogo.totale}</strong> — {riepilogo.clienti} clienti, {riepilogo.fornitori} fornitori.</p>
                {riepilogo.pivaSegnaposto > 0 && (
                  <p className="text-muted-foreground">
                    {riepilogo.pivaSegnaposto} schede hanno una partita IVA segnaposto (solo zeri): il campo Partita IVA resta vuoto,
                    il valore originale è conservato nei dati originali.
                  </p>
                )}
                {riepilogo.cfSegnaposto > 0 && (
                  <p className="text-muted-foreground">{riepilogo.cfSegnaposto} schede hanno un codice fiscale segnaposto (XXX…): stesso trattamento.</p>
                )}
                {riepilogo.altriMastri.length > 0 && (
                  <p className="text-muted-foreground">Conti con mastro diverso da 501/601 ({riepilogo.altriMastri.join(", ")}): importati come clienti.</p>
                )}
                <p className="text-muted-foreground">Righe del foglio che non sono schede (titolo, azienda, fine stampa): {riepilogo.nonSchede}.</p>
              </div>
            )}
            {avanzamento && (
              <p className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Import in corso: {avanzamento.fatte} di {avanzamento.totale}…</p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" disabled={inCorso} onClick={() => onOpenChange(false)}>{esito ? "Chiudi" : "Annulla"}</Button>
          {!esito && <Button disabled={!lettura || inCorso} onClick={importa}>Importa {riepilogo ? `${riepilogo.totale} schede` : ""}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const AnagraficheTab = ({ anagrafiche, puoScrivere, onChanged }: {
  anagrafiche: Anagrafica[];
  puoScrivere: boolean;
  onChanged: () => void;
}) => {
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState<"tutti" | "clienti" | "fornitori">("tutti");
  const [dialog, setDialog] = useState(false);
  const [inModifica, setInModifica] = useState<Anagrafica | null>(null);
  const [importDialog, setImportDialog] = useState(false);
  const [mostrate, setMostrate] = useState(200);

  useEffect(() => { setMostrate(200); }, [q, filtro]);

  const filtrate = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return anagrafiche.filter((a) => {
      if (filtro === "clienti" && !a.is_cliente) return false;
      if (filtro === "fornitori" && !a.is_fornitore) return false;
      if (!ql) return true;
      return [a.ragione_sociale, a.partita_iva, a.codice_fiscale, a.codice, a.citta, a.email].some((x) => (x ?? "").toLowerCase().includes(ql));
    });
  }, [anagrafiche, q, filtro]);

  const archivia = async (a: Anagrafica) => {
    if (!confirm(`Archiviare ${a.ragione_sociale}? Resta nei documenti già emessi e nello storico, ma esce dagli elenchi.`)) return;
    try { await archiviaAnagrafica(a.id); onChanged(); }
    catch (e) { toast({ title: "Errore", description: messaggio(e), variant: "destructive" }); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input data-cerca className="pl-8 w-64" placeholder="Cerca nome, P.IVA, città…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {(["tutti", "clienti", "fornitori"] as const).map((k) => (
            <Button key={k} size="sm" variant={filtro === k ? "default" : "outline"} onClick={() => setFiltro(k)} className="capitalize">{k}</Button>
          ))}
        </div>
        {puoScrivere && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setImportDialog(true)}><Upload className="w-4 h-4 mr-1" /> Importa da Mexal</Button>
            <Button size="sm" data-nuovo onClick={() => { setInModifica(null); setDialog(true); }}><Plus className="w-4 h-4 mr-1" /> Nuova anagrafica</Button>
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{filtrate.length} di {anagrafiche.length} schede</p>

      {filtrate.length === 0 ? (
        <div className="text-center border-2 border-ink/20 bg-paper p-10 rounded-sm text-sm text-muted-foreground">
          {anagrafiche.length === 0 ? "Nessuna anagrafica. Crea il primo cliente o fornitore." : "Nessun risultato."}
        </div>
      ) : (
        <div className="border-2 border-ink/20 bg-paper rounded-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Codice</TableHead>
                <TableHead>Ragione sociale</TableHead>
                <TableHead>P.IVA / C.F.</TableHead>
                <TableHead>Città</TableHead>
                <TableHead>Ruolo</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtrate.slice(0, mostrate).map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-mono text-xs">{a.codice}</TableCell>
                  <TableCell className="font-medium">{a.ragione_sociale}</TableCell>
                  <TableCell className="font-mono text-xs">{a.partita_iva ?? a.codice_fiscale ?? "—"}</TableCell>
                  <TableCell>{[a.citta, a.provincia].filter(Boolean).join(" ") || "—"}</TableCell>
                  <TableCell className="space-x-1">
                    {a.is_cliente && <Badge variant="outline">Cliente</Badge>}
                    {a.is_fornitore && <Badge variant="outline">Fornitore</Badge>}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {puoScrivere && (
                      <>
                        <Button size="sm" variant="ghost" title="Modifica" onClick={() => { setInModifica(a); setDialog(true); }}><Pencil className="w-4 h-4" /></Button>
                        <Button size="sm" variant="ghost" title="Archivia" onClick={() => archivia(a)}><Archive className="w-4 h-4" /></Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {filtrate.length > mostrate && (
            <div className="p-3 text-center border-t border-ink/10">
              <Button size="sm" variant="outline" onClick={() => setMostrate((n) => n + 500)}>
                Mostra altre ({filtrate.length - mostrate} rimanenti)
              </Button>
            </div>
          )}
        </div>
      )}

      <AnagraficaDialog open={dialog} anagrafica={inModifica} onOpenChange={setDialog} onSaved={onChanged} />
      <ImportMexalDialog open={importDialog} onOpenChange={setImportDialog} onDone={onChanged} />
    </div>
  );
};

export default AnagraficheTab;
