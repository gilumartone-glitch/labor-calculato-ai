import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, Boxes, Building2, Plus, Loader2, Scissors, Undo2, Archive, Flame } from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import {
  elencoArticoli, elencoVarianti, creaArticolo, creaVariante, archiviaArticolo, archiviaVariante,
  giacenzeVarianti, giacenzeBagni, elencoPezze, caricaPezza, tagliaPezza, elencoMovimenti, stornaMovimento,
} from "@/lib/gestionale/api";
import { elencoAnagrafiche, elencoAliquote, type Anagrafica, type AliquotaIva } from "@/lib/gestionale/documenti";
import DocumentiTab from "@/components/gestionale/DocumentiTab";
import ScadenzarioTab from "@/components/gestionale/ScadenzarioTab";
import PrimaNotaTab from "@/components/gestionale/PrimaNotaTab";
import { gestisciTasto } from "@/lib/gestionale/tastiera";
import { DatiAziendaDialog } from "@/components/gestionale/FatturaElettronica";
import { elencoCondizioni, type CondizionePagamento } from "@/lib/gestionale/scadenzario";
import AnagraficheTab from "@/components/gestionale/AnagraficheTab";
import {
  CATEGORIA_LABEL, descriviVariante, numeroOppureNull,
  type Articolo, type Variante, type Categoria, type UnitaMisura, type GiacenzaBagno,
  type PezzaGiacenza, type Movimento,
} from "@/lib/gestionale/types";

const fmtQta = (n: number) => new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 }).format(n);
const fmtData = (iso: string) =>
  new Date(iso).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const messaggio = (e: unknown) => (e instanceof Error ? e.message : String(e));
const errore = (e: unknown) => toast({ title: "Errore", description: messaggio(e), variant: "destructive" });

const UM_DEFAULT: Record<Categoria, UnitaMisura> = { tessuto: "m", pannello: "pz", altro: "pz" };

/* ------------------------------------------------------------------ */
/* Dialog: nuovo articolo                                              */
/* ------------------------------------------------------------------ */
const ArticoloDialog = ({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => void }) => {
  const [codice, setCodice] = useState("");
  const [nome, setNome] = useState("");
  const [categoria, setCategoria] = useState<Categoria>("tessuto");
  const [um, setUm] = useState<UnitaMisura>("m");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setCodice(""); setNome(""); setCategoria("tessuto"); setUm("m"); }
  }, [open]);

  const salva = async () => {
    if (!codice.trim() || !nome.trim()) {
      toast({ title: "Dati mancanti", description: "Codice e nome sono obbligatori.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await creaArticolo({ codice: codice.trim().toUpperCase(), nome: nome.trim(), categoria, um });
      onSaved();
      onOpenChange(false);
    } catch (e) { errore(e); } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Nuovo articolo</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Codice</Label><Input value={codice} onChange={(e) => setCodice(e.target.value)} placeholder="VELL" /></div>
            <div><Label>Nome</Label><Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Velluto" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Categoria</Label>
              <Select value={categoria} onValueChange={(v) => { const c = v as Categoria; setCategoria(c); setUm(UM_DEFAULT[c]); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(CATEGORIA_LABEL) as Categoria[]).map((c) => <SelectItem key={c} value={c}>{CATEGORIA_LABEL[c]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Unità di misura</Label>
              <Select value={um} onValueChange={(v) => setUm(v as UnitaMisura)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="m">Metri</SelectItem>
                  <SelectItem value="m2">Metri quadri</SelectItem>
                  <SelectItem value="pz">Pezzi</SelectItem>
                </SelectContent>
              </Select>
            </div>
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

/* ------------------------------------------------------------------ */
/* Dialog: nuova variante                                              */
/* ------------------------------------------------------------------ */
const VARIANTE_VUOTA = {
  codice: "", colore: "", ignifugo: false, classe: "", certificato: "",
  altezza: "", peso: "", spessore: "", finitura: "", formatoL: "", formatoH: "", costo: "", prezzo: "",
};

const VarianteDialog = ({ articolo, onClose, onSaved }: { articolo: Articolo | null; onClose: () => void; onSaved: () => void }) => {
  const [f, setF] = useState(VARIANTE_VUOTA);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof VARIANTE_VUOTA, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => { if (articolo) setF(VARIANTE_VUOTA); }, [articolo]);

  if (!articolo) return null;
  const tessuto = articolo.categoria === "tessuto";
  const pannello = articolo.categoria === "pannello";

  const salva = async () => {
    if (!f.codice.trim()) {
      toast({ title: "Dati mancanti", description: "Il codice variante è obbligatorio.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await creaVariante({
        articolo_id: articolo.id,
        codice: f.codice.trim().toUpperCase(),
        colore: f.colore.trim() || null,
        ignifugo: f.ignifugo,
        classe_reazione: f.ignifugo ? f.classe.trim() || null : null,
        certificato_rif: f.ignifugo ? f.certificato.trim() || null : null,
        altezza_cm: tessuto ? numeroOppureNull(f.altezza) : null,
        peso_gm2: tessuto ? numeroOppureNull(f.peso) : null,
        spessore_mm: pannello ? numeroOppureNull(f.spessore) : null,
        finitura: pannello ? f.finitura.trim() || null : null,
        formato_larghezza_mm: pannello ? numeroOppureNull(f.formatoL) : null,
        formato_altezza_mm: pannello ? numeroOppureNull(f.formatoH) : null,
        costo_um: numeroOppureNull(f.costo),
        prezzo_um: numeroOppureNull(f.prezzo),
      });
      onSaved();
      onClose();
    } catch (e) { errore(e); } finally { setSaving(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Nuova variante · {articolo.nome}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Codice variante</Label><Input value={f.codice} onChange={(e) => set("codice", e.target.value)} placeholder={`${articolo.codice}-…`} /></div>
            <div><Label>Colore</Label><Input value={f.colore} onChange={(e) => set("colore", e.target.value)} /></div>
          </div>
          {tessuto && (
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Altezza (cm)</Label><Input inputMode="decimal" value={f.altezza} onChange={(e) => set("altezza", e.target.value)} /></div>
              <div><Label>Peso (g/m²)</Label><Input inputMode="decimal" value={f.peso} onChange={(e) => set("peso", e.target.value)} /></div>
            </div>
          )}
          {pannello && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Spessore (mm)</Label><Input inputMode="decimal" value={f.spessore} onChange={(e) => set("spessore", e.target.value)} /></div>
                <div><Label>Finitura</Label><Input value={f.finitura} onChange={(e) => set("finitura", e.target.value)} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Formato lastra · larghezza (mm)</Label><Input inputMode="numeric" value={f.formatoL} onChange={(e) => set("formatoL", e.target.value)} placeholder="3050" /></div>
                <div><Label>Formato lastra · altezza (mm)</Label><Input inputMode="numeric" value={f.formatoH} onChange={(e) => set("formatoH", e.target.value)} placeholder="2050" /></div>
              </div>
            </>
          )}
          <div className="flex items-center gap-2">
            <Switch checked={f.ignifugo} onCheckedChange={(v) => set("ignifugo", v)} id="var-ignifugo" />
            <Label htmlFor="var-ignifugo">Ignifugo</Label>
          </div>
          {f.ignifugo && (
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Classe di reazione al fuoco</Label><Input value={f.classe} onChange={(e) => set("classe", e.target.value)} placeholder="Classe 1" /></div>
              <div><Label>Rif. certificato / omologazione</Label><Input value={f.certificato} onChange={(e) => set("certificato", e.target.value)} /></div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Costo per {articolo.um} (€)</Label><Input inputMode="decimal" value={f.costo} onChange={(e) => set("costo", e.target.value)} /></div>
            <div><Label>Prezzo per {articolo.um} (€)</Label><Input inputMode="decimal" value={f.prezzo} onChange={(e) => set("prezzo", e.target.value)} /></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annulla</Button>
          <Button onClick={salva} disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Salva</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/* ------------------------------------------------------------------ */
/* Dialog: carico pezza / taglio                                       */
/* ------------------------------------------------------------------ */
const CaricoDialog = ({ variante, open, onOpenChange, onSaved }: { variante: Variante | null; open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => void }) => {
  const [metri, setMetri] = useState("");
  const [bagno, setBagno] = useState("");
  const [posizione, setPosizione] = useState("");
  const [fornitore, setFornitore] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) { setMetri(""); setPosizione(""); } }, [open]);

  const salva = async () => {
    const m = numeroOppureNull(metri);
    if (!variante || m == null || m <= 0) {
      toast({ title: "Dati mancanti", description: "Indica i metri della pezza.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const pezza = await caricaPezza({
        varianteId: variante.id, metri: m,
        codiceBagno: bagno.trim() || null, posizione: posizione.trim() || null, fornitore: fornitore.trim() || null,
      });
      toast({ title: "Pezza caricata", description: `Codice ${pezza.codice} · ${fmtQta(m)} m` });
      onSaved();
      onOpenChange(false);
    } catch (e) { errore(e); } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Carica pezza{variante ? ` · ${variante.codice}` : ""}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Metri</Label><Input inputMode="decimal" value={metri} onChange={(e) => setMetri(e.target.value)} autoFocus /></div>
            <div><Label>Bagno</Label><Input value={bagno} onChange={(e) => setBagno(e.target.value)} placeholder="Numero bagno del fornitore" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Posizione</Label><Input value={posizione} onChange={(e) => setPosizione(e.target.value)} placeholder="Scaffale A2" /></div>
            <div><Label>Fornitore</Label><Input value={fornitore} onChange={(e) => setFornitore(e.target.value)} /></div>
          </div>
          <p className="text-xs text-muted-foreground">Bagno e fornitore restano compilati per caricare più pezze dello stesso arrivo.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Chiudi</Button>
          <Button onClick={salva} disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Carica</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const TaglioDialog = ({ pezza, onClose, onSaved }: { pezza: PezzaGiacenza | null; onClose: () => void; onSaved: () => void }) => {
  const [metri, setMetri] = useState("");
  const [rif, setRif] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (pezza) { setMetri(""); setRif(""); } }, [pezza]);
  if (!pezza) return null;

  const salva = async () => {
    const m = numeroOppureNull(metri);
    if (m == null || m <= 0) {
      toast({ title: "Dati mancanti", description: "Indica i metri tagliati.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const residuo = await tagliaPezza({ pezzaId: pezza.id, metri: m, rifTipo: rif.trim() ? "ordine" : null, rifId: rif.trim() || null });
      toast({ title: "Taglio registrato", description: `${pezza.codice}: restano ${fmtQta(residuo)} m` });
      onSaved();
      onClose();
    } catch (e) { errore(e); } finally { setSaving(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Taglio da {pezza.codice}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          Residuo attuale: <strong>{fmtQta(pezza.residuo_m)} m</strong>{pezza.codice_bagno ? ` · bagno ${pezza.codice_bagno}` : ""}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Metri tagliati</Label><Input inputMode="decimal" value={metri} onChange={(e) => setMetri(e.target.value)} autoFocus /></div>
          <div><Label>Ordine di riferimento</Label><Input value={rif} onChange={(e) => setRif(e.target.value)} placeholder="Facoltativo" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annulla</Button>
          <Button onClick={salva} disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Registra taglio</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/* ------------------------------------------------------------------ */
/* Pagina                                                              */
/* ------------------------------------------------------------------ */
const Gestionale = () => {
  const { can } = usePermissions();
  const puoScrivere = can("gestionale", "write");

  const [parametri] = useSearchParams();
  const [documentoIniziale, setDocumentoIniziale] = useState<string | null>(parametri.get("doc"));
  const [tab, setTab] = useState("documenti");
  const [datiAzienda, setDatiAzienda] = useState(false);
  // tutto il Gestionale si usa anche da tastiera: vedi lib/gestionale/tastiera.ts
  const radice = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const tasto = (e: KeyboardEvent) => { if (radice.current) gestisciTasto(e, radice.current); };
    document.addEventListener("keydown", tasto, true);
    return () => document.removeEventListener("keydown", tasto, true);
  }, []);
  // dalla prima nota si salta al documento: la scheda Documenti si riapre su quello
  const apriDocumento = useCallback((id: string) => { setDocumentoIniziale(id); setTab("documenti"); }, []);
  const [anagrafiche, setAnagrafiche] = useState<Anagrafica[]>([]);
  const [aliquote, setAliquote] = useState<AliquotaIva[]>([]);
  const [condizioni, setCondizioni] = useState<CondizionePagamento[]>([]);
  const caricaCondizioni = useCallback(async () => {
    try { setCondizioni(await elencoCondizioni()); } catch (e) { errore(e); }
  }, []);
  useEffect(() => { caricaCondizioni(); }, [caricaCondizioni]);
  const [loading, setLoading] = useState(true);
  const [articoli, setArticoli] = useState<Articolo[]>([]);
  const [varianti, setVarianti] = useState<Variante[]>([]);
  const [giacenze, setGiacenze] = useState<Record<string, { giacenza: number; impegnato: number; disponibile: number }>>({});

  const [articoloDialog, setArticoloDialog] = useState(false);
  const [varianteDi, setVarianteDi] = useState<Articolo | null>(null);

  const [varianteSel, setVarianteSel] = useState<string>("");
  const [bagni, setBagni] = useState<GiacenzaBagno[]>([]);
  const [pezze, setPezze] = useState<PezzaGiacenza[]>([]);
  const [loadingPezze, setLoadingPezze] = useState(false);
  const [caricoDialog, setCaricoDialog] = useState(false);
  const [taglioDi, setTaglioDi] = useState<PezzaGiacenza | null>(null);

  const [movimenti, setMovimenti] = useState<Movimento[]>([]);
  const [loadingMov, setLoadingMov] = useState(false);

  const caricaAnagrafiche = useCallback(async () => {
    try {
      const [a, v, g] = await Promise.all([elencoArticoli(), elencoVarianti(), giacenzeVarianti()]);
      setArticoli(a);
      setVarianti(v);
      setGiacenze(Object.fromEntries(g.map((r) => [r.variante_id, r])));
    } catch (e) { errore(e); } finally { setLoading(false); }
  }, []);

  const caricaPezzeVariante = useCallback(async (varianteId: string) => {
    if (!varianteId) { setBagni([]); setPezze([]); return; }
    setLoadingPezze(true);
    try {
      const [b, p] = await Promise.all([giacenzeBagni(varianteId), elencoPezze(varianteId)]);
      setBagni(b);
      setPezze(p);
    } catch (e) { errore(e); } finally { setLoadingPezze(false); }
  }, []);

  const caricaMovimenti = useCallback(async () => {
    setLoadingMov(true);
    try { setMovimenti(await elencoMovimenti()); } catch (e) { errore(e); } finally { setLoadingMov(false); }
  }, []);

  const caricaClientiFornitori = useCallback(async () => {
    try {
      const [a, i] = await Promise.all([elencoAnagrafiche(), elencoAliquote()]);
      setAnagrafiche(a);
      setAliquote(i);
    } catch (e) { errore(e); }
  }, []);

  useEffect(() => { caricaAnagrafiche(); }, [caricaAnagrafiche]);
  useEffect(() => { caricaClientiFornitori(); }, [caricaClientiFornitori]);
  useEffect(() => { caricaPezzeVariante(varianteSel); }, [varianteSel, caricaPezzeVariante]);
  useEffect(() => { if (tab === "movimenti") caricaMovimenti(); }, [tab, caricaMovimenti]);

  const articoloById = useMemo(() => new Map(articoli.map((a) => [a.id, a])), [articoli]);
  const varianteById = useMemo(() => new Map(varianti.map((v) => [v.id, v])), [varianti]);
  const variantiTessuto = useMemo(
    () => varianti.filter((v) => articoloById.get(v.articolo_id)?.categoria === "tessuto"),
    [varianti, articoloById],
  );
  const varianteCorrente = varianteById.get(varianteSel) ?? null;

  const dopoMovimento = () => { caricaPezzeVariante(varianteSel); caricaAnagrafiche(); };

  const archivia = async (tipo: "articolo" | "variante", id: string, nome: string) => {
    if (!confirm(`Archiviare ${nome}? Resta nello storico ma esce dagli elenchi.`)) return;
    try {
      if (tipo === "articolo") await archiviaArticolo(id); else await archiviaVariante(id);
      caricaAnagrafiche();
    } catch (e) { errore(e); }
  };

  const storna = async (m: Movimento) => {
    if (!confirm(`Stornare il movimento n. ${m.id} (${m.tipo} ${fmtQta(m.quantita)})? Verrà registrato un movimento uguale e contrario.`)) return;
    try {
      await stornaMovimento(m.id);
      toast({ title: "Movimento stornato" });
      caricaMovimenti();
      dopoMovimento();
    } catch (e) { errore(e); }
  };

  const stornati = useMemo(() => new Set(movimenti.map((m) => m.storno_di).filter((x): x is number => x != null)), [movimenti]);

  return (
    <div className="min-h-screen bg-background pb-9" data-gestionale ref={radice}>
      <header className="border-b-2 border-ink bg-paper">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 py-3 flex items-center gap-3">
          <Link to="/hub" className="inline-flex items-center gap-1 text-xs uppercase tracking-wider text-muted-foreground hover:text-ink">
            <ArrowLeft className="w-3 h-3" /> Hub
          </Link>
          <h1 className="font-display text-2xl font-semibold flex items-center gap-2"><Boxes className="w-6 h-6" /> Gestionale</h1>
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => setDatiAzienda(true)}><Building2 className="w-4 h-4 mr-1" /> Dati azienda</Button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-3 sm:px-6 py-5">
        {loading ? (
          <div className="grid place-items-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="flex-wrap h-auto">
              <TabsTrigger value="documenti">Documenti</TabsTrigger>
              <TabsTrigger value="scadenzario">Scadenzario</TabsTrigger>
              <TabsTrigger value="prima-nota">Prima nota</TabsTrigger>
              <TabsTrigger value="anagrafiche">Clienti e fornitori</TabsTrigger>
              <TabsTrigger value="articoli">Articoli e varianti</TabsTrigger>
              <TabsTrigger value="pezze">Bagni e pezze</TabsTrigger>
              <TabsTrigger value="movimenti">Movimenti</TabsTrigger>
            </TabsList>

            <TabsContent value="documenti">
              <DocumentiTab
                anagrafiche={anagrafiche} aliquote={aliquote} condizioni={condizioni} articoli={articoli} varianti={varianti}
                puoScrivere={puoScrivere} onAnagraficheChanged={caricaClientiFornitori}
                documentoIniziale={documentoIniziale}
              />
            </TabsContent>

            <TabsContent value="scadenzario">
              <ScadenzarioTab condizioni={condizioni} puoScrivere={puoScrivere} onCondizioniChanged={caricaCondizioni} />
            </TabsContent>

            <TabsContent value="prima-nota">
              <PrimaNotaTab puoScrivere={puoScrivere} onApriDocumento={apriDocumento} />
            </TabsContent>

            <TabsContent value="anagrafiche">
              <AnagraficheTab anagrafiche={anagrafiche} puoScrivere={puoScrivere} onChanged={caricaClientiFornitori} />
            </TabsContent>

            {/* ---------------- Articoli e varianti ---------------- */}
            <TabsContent value="articoli" className="space-y-4">
              {puoScrivere && (
                <div className="flex justify-end">
                  <Button size="sm" data-nuovo onClick={() => setArticoloDialog(true)}><Plus className="w-4 h-4 mr-1" /> Nuovo articolo</Button>
                </div>
              )}
              {articoli.length === 0 && (
                <div className="text-center border-2 border-ink/20 bg-paper p-10 rounded-sm text-sm text-muted-foreground">
                  Nessun articolo. Crea il primo, poi aggiungi le varianti (colore, altezza, peso, ignifugo).
                </div>
              )}
              {articoli.map((a) => {
                const vs = varianti.filter((v) => v.articolo_id === a.id);
                return (
                  <section key={a.id} className="border-2 border-ink/20 bg-paper rounded-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-ink/10">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono text-xs text-muted-foreground">{a.codice}</span>
                        <h2 className="font-display text-lg font-semibold truncate">{a.nome}</h2>
                        <Badge variant="outline">{CATEGORIA_LABEL[a.categoria]}</Badge>
                      </div>
                      {puoScrivere && (
                        <div className="flex items-center gap-1">
                          <Button size="sm" variant="outline" onClick={() => setVarianteDi(a)}><Plus className="w-4 h-4 mr-1" /> Variante</Button>
                          <Button size="sm" variant="ghost" title="Archivia articolo" onClick={() => archivia("articolo", a.id, a.nome)}><Archive className="w-4 h-4" /></Button>
                        </div>
                      )}
                    </div>
                    {vs.length === 0 ? (
                      <p className="px-4 py-3 text-sm text-muted-foreground">Nessuna variante.</p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Codice</TableHead>
                            <TableHead>Caratteristiche</TableHead>
                            <TableHead className="text-right">Giacenza</TableHead>
                            <TableHead className="text-right">Impegnato</TableHead>
                            <TableHead className="text-right">Disponibile</TableHead>
                            <TableHead className="w-10" />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {vs.map((v) => (
                            <TableRow key={v.id}>
                              <TableCell className="font-mono text-xs">{v.codice}</TableCell>
                              <TableCell>
                                <span className="inline-flex items-center gap-1.5">
                                  {v.ignifugo && <Flame className="w-3.5 h-3.5 text-orange-600" aria-label="Ignifugo" />}
                                  {descriviVariante(v) || "—"}
                                </span>
                              </TableCell>
                              <TableCell className="text-right tabular-nums">{fmtQta(giacenze[v.id]?.giacenza ?? 0)} {a.um}</TableCell>
                              <TableCell className="text-right tabular-nums text-muted-foreground">{(giacenze[v.id]?.impegnato ?? 0) > 0 ? `${fmtQta(giacenze[v.id].impegnato)} ${a.um}` : "—"}</TableCell>
                              <TableCell className={`text-right tabular-nums font-medium ${(giacenze[v.id]?.disponibile ?? 0) < 0 ? "text-destructive" : ""}`}>{fmtQta(giacenze[v.id]?.disponibile ?? 0)} {a.um}</TableCell>
                              <TableCell>
                                {puoScrivere && (
                                  <Button size="sm" variant="ghost" title="Archivia variante" onClick={() => archivia("variante", v.id, v.codice)}><Archive className="w-4 h-4" /></Button>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </section>
                );
              })}
            </TabsContent>

            {/* ---------------- Bagni e pezze ---------------- */}
            <TabsContent value="pezze" className="space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="min-w-[260px] flex-1 max-w-md">
                  <Label>Variante tessuto</Label>
                  <Select value={varianteSel} onValueChange={setVarianteSel}>
                    <SelectTrigger><SelectValue placeholder="Scegli una variante" /></SelectTrigger>
                    <SelectContent>
                      {variantiTessuto.map((v) => (
                        <SelectItem key={v.id} value={v.id}>{v.codice} — {articoloById.get(v.articolo_id)?.nome} {descriviVariante(v)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {puoScrivere && (
                  <Button size="sm" disabled={!varianteCorrente} onClick={() => setCaricoDialog(true)}><Plus className="w-4 h-4 mr-1" /> Carica pezza</Button>
                )}
              </div>

              {variantiTessuto.length === 0 && (
                <p className="text-sm text-muted-foreground">Nessuna variante di tipo tessuto: creala nella scheda Articoli e varianti.</p>
              )}

              {varianteCorrente && (loadingPezze ? (
                <div className="grid place-items-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
              ) : (
                <>
                  <section className="border-2 border-ink/20 bg-paper rounded-sm">
                    <h2 className="px-4 py-3 border-b border-ink/10 font-display text-lg font-semibold">Disponibilità per bagno</h2>
                    {bagni.length === 0 ? (
                      <p className="px-4 py-3 text-sm text-muted-foreground">Nessuna pezza disponibile.</p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Bagno</TableHead>
                            <TableHead className="text-right">Pezze</TableHead>
                            <TableHead className="text-right">Metri totali</TableHead>
                            <TableHead className="text-right">Pezza più lunga</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {bagni.map((b) => (
                            <TableRow key={b.bagno_id ?? "senza"}>
                              <TableCell>{b.codice_bagno ?? <span className="text-muted-foreground">Senza bagno</span>}</TableCell>
                              <TableCell className="text-right tabular-nums">{b.pezze}</TableCell>
                              <TableCell className="text-right tabular-nums">{fmtQta(b.metri)} m</TableCell>
                              <TableCell className="text-right tabular-nums">{b.pezza_piu_lunga_m != null ? `${fmtQta(b.pezza_piu_lunga_m)} m` : "—"}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </section>

                  <section className="border-2 border-ink/20 bg-paper rounded-sm">
                    <h2 className="px-4 py-3 border-b border-ink/10 font-display text-lg font-semibold">Pezze</h2>
                    {pezze.length === 0 ? (
                      <p className="px-4 py-3 text-sm text-muted-foreground">Nessuna pezza registrata per questa variante.</p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Codice</TableHead>
                            <TableHead>Bagno</TableHead>
                            <TableHead>Posizione</TableHead>
                            <TableHead className="text-right">Iniziale</TableHead>
                            <TableHead className="text-right">Residuo</TableHead>
                            <TableHead>Stato</TableHead>
                            <TableHead className="w-10" />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {pezze.map((p) => (
                            <TableRow key={p.id} className={p.stato !== "disponibile" ? "opacity-60" : undefined}>
                              <TableCell className="font-mono text-xs">{p.codice}</TableCell>
                              <TableCell>{p.codice_bagno ?? "—"}</TableCell>
                              <TableCell>{p.posizione ?? "—"}</TableCell>
                              <TableCell className="text-right tabular-nums">{fmtQta(p.lunghezza_iniziale_m)} m</TableCell>
                              <TableCell className="text-right tabular-nums font-semibold">{fmtQta(p.residuo_m)} m</TableCell>
                              <TableCell><Badge variant={p.stato === "disponibile" ? "default" : "outline"}>{p.stato}</Badge></TableCell>
                              <TableCell>
                                {puoScrivere && p.stato === "disponibile" && p.residuo_m > 0 && (
                                  <Button size="sm" variant="outline" onClick={() => setTaglioDi(p)}><Scissors className="w-4 h-4 mr-1" /> Taglia</Button>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </section>
                </>
              ))}
            </TabsContent>

            {/* ---------------- Movimenti ---------------- */}
            <TabsContent value="movimenti" className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Registro di magazzino: i movimenti non si modificano né si cancellano. Un errore si corregge con lo storno. Ultimi 200.
              </p>
              {loadingMov ? (
                <div className="grid place-items-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
              ) : movimenti.length === 0 ? (
                <div className="text-center border-2 border-ink/20 bg-paper p-10 rounded-sm text-sm text-muted-foreground">Nessun movimento.</div>
              ) : (
                <div className="border-2 border-ink/20 bg-paper rounded-sm">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>N.</TableHead>
                        <TableHead>Data</TableHead>
                        <TableHead>Variante</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead className="text-right">Quantità</TableHead>
                        <TableHead>Riferimento</TableHead>
                        <TableHead className="w-10" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {movimenti.map((m) => {
                        const giaStornato = stornati.has(m.id);
                        return (
                          <TableRow key={m.id} className={giaStornato ? "opacity-60" : undefined}>
                            <TableCell className="font-mono text-xs">{m.id}</TableCell>
                            <TableCell className="whitespace-nowrap">{fmtData(m.creato_il)}</TableCell>
                            <TableCell className="font-mono text-xs">{varianteById.get(m.variante_id)?.codice ?? "—"}</TableCell>
                            <TableCell>
                              <Badge variant="outline">{m.tipo}</Badge>
                              {m.storno_di != null && <span className="ml-1 text-xs text-muted-foreground">del n. {m.storno_di}</span>}
                              {giaStornato && <span className="ml-1 text-xs text-muted-foreground">stornato</span>}
                            </TableCell>
                            <TableCell className={`text-right tabular-nums ${m.quantita < 0 ? "text-destructive" : ""}`}>
                              {m.quantita > 0 ? "+" : ""}{fmtQta(m.quantita)}
                            </TableCell>
                            <TableCell className="text-xs">{[m.riferimento_tipo, m.riferimento_id].filter(Boolean).join(" ") || m.nota || "—"}</TableCell>
                            <TableCell>
                              {puoScrivere && m.tipo !== "storno" && !giaStornato && (
                                <Button size="sm" variant="ghost" title="Storna movimento" onClick={() => storna(m)}><Undo2 className="w-4 h-4" /></Button>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>
          </Tabs>
        )}
      </main>
      <DatiAziendaDialog open={datiAzienda} onOpenChange={setDatiAzienda} />
      <footer className="fixed bottom-0 inset-x-0 z-30 border-t-2 border-ink bg-paper/95 backdrop-blur px-3 py-1.5 text-[11px] text-muted-foreground flex flex-wrap gap-x-4 gap-y-0.5 justify-center">
        {[["F10", "salva / conferma"], ["Invio", "campo successivo"], ["↑ ↓ ← →", "spostati tra campi e pulsanti"], ["F2", "nuovo"], ["F4", "nuova riga"], ["F6", "trasforma in"], ["F9", "stampa PDF"], ["Ctrl+Canc", "togli riga"], ["Esc", "indietro"], ["Alt+1…7", "sezioni"]].map(([t, d]) => (
          <span key={t}><kbd className="font-mono font-semibold text-foreground border border-ink/30 rounded-sm px-1">{t}</kbd> {d}</span>
        ))}
      </footer>

      <ArticoloDialog open={articoloDialog} onOpenChange={setArticoloDialog} onSaved={caricaAnagrafiche} />
      <VarianteDialog articolo={varianteDi} onClose={() => setVarianteDi(null)} onSaved={caricaAnagrafiche} />
      <CaricoDialog variante={varianteCorrente} open={caricoDialog} onOpenChange={setCaricoDialog} onSaved={dopoMovimento} />
      <TaglioDialog pezza={taglioDi} onClose={() => setTaglioDi(null)} onSaved={dopoMovimento} />
    </div>
  );
};

export default Gestionale;
