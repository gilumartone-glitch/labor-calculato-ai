import { useEffect, useMemo, useState } from "react";
import { Plus, Loader2, Pencil, Archive, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { archiviaAnagrafica, salvaAnagrafica, type Anagrafica, type DatiAnagrafica } from "@/lib/gestionale/documenti";

const messaggio = (e: unknown) => (e instanceof Error ? e.message : String(e));

const VUOTA: DatiAnagrafica = {
  is_cliente: true, is_fornitore: false, ragione_sociale: "", partita_iva: null, codice_fiscale: null,
  codice_sdi: null, pec: null, email: null, telefono: null, indirizzo: null, cap: null, citta: null,
  provincia: null, nazione: "IT", pagamento: null, note: null,
};

const daAnagrafica = (a: Anagrafica): DatiAnagrafica => ({
  is_cliente: a.is_cliente, is_fornitore: a.is_fornitore, ragione_sociale: a.ragione_sociale,
  partita_iva: a.partita_iva, codice_fiscale: a.codice_fiscale, codice_sdi: a.codice_sdi, pec: a.pec,
  email: a.email, telefono: a.telefono, indirizzo: a.indirizzo, cap: a.cap, citta: a.citta,
  provincia: a.provincia, nazione: a.nazione, pagamento: a.pagamento, note: a.note,
});

type CampoTesto = Exclude<keyof DatiAnagrafica, "is_cliente" | "is_fornitore">;

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

  useEffect(() => {
    if (!open) return;
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
      const m = messaggio(e);
      toast({
        title: "Errore",
        description: m.includes("gest_anagrafiche_piva_unica") ? "Esiste già un'anagrafica con questa partita IVA." : m,
        variant: "destructive",
      });
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
          {campo("ragione_sociale", "Ragione sociale")}
          <div className="flex flex-wrap items-center gap-5">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={f.is_cliente} onCheckedChange={(v) => setF((p) => ({ ...p, is_cliente: v }))} /> Cliente
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={f.is_fornitore} onCheckedChange={(v) => setF((p) => ({ ...p, is_fornitore: v }))} /> Fornitore
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {campo("partita_iva", "Partita IVA")}
            {campo("codice_fiscale", "Codice fiscale")}
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
          {campo("pagamento", "Condizioni di pagamento abituali", { placeholder: "es. Bonifico 30 gg data fattura" })}
          <div>
            <Label>Note</Label>
            <Textarea rows={2} value={testo("note")} onChange={(e) => setTesto("note", e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Annulla</Button>
          <Button onClick={salva} disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Salva</Button>
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

  const filtrate = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return anagrafiche.filter((a) => {
      if (filtro === "clienti" && !a.is_cliente) return false;
      if (filtro === "fornitori" && !a.is_fornitore) return false;
      if (!ql) return true;
      return [a.ragione_sociale, a.partita_iva, a.codice_fiscale, a.codice, a.citta].some((x) => (x ?? "").toLowerCase().includes(ql));
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
            <Input className="pl-8 w-64" placeholder="Cerca nome, P.IVA, città…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {(["tutti", "clienti", "fornitori"] as const).map((k) => (
            <Button key={k} size="sm" variant={filtro === k ? "default" : "outline"} onClick={() => setFiltro(k)} className="capitalize">{k}</Button>
          ))}
        </div>
        {puoScrivere && (
          <Button size="sm" onClick={() => { setInModifica(null); setDialog(true); }}><Plus className="w-4 h-4 mr-1" /> Nuova anagrafica</Button>
        )}
      </div>

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
              {filtrate.map((a) => (
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
        </div>
      )}

      <AnagraficaDialog open={dialog} anagrafica={inModifica} onOpenChange={setDialog} onSaved={onChanged} />
    </div>
  );
};

export default AnagraficheTab;
