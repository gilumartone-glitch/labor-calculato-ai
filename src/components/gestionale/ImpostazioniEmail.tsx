import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, KeyRound, Loader2, Plus, PlugZap, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/usePermissions";
import { CONTESTI_EMAIL, type ContestoEmail } from "@/lib/gestionale/invio-email";
import {
  aggiornaCasella, creaCasella, documentiProposti, impostaPassword, leggiImpostazioniEmail, mancanzeCasella, normalizzaIndirizzo,
  provaCasella, salvaServerPosta, type CasellaEmail, type ImpostazioniEmail as Impostazioni,
} from "@/lib/gestionale/caselle-email";

const errore = (e: unknown) => toast({ title: "Errore", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
const giorno = (iso: string) => new Date(iso).toLocaleDateString("it-IT");

/** Caselle di spunta dei documenti che una casella può spedire. */
const SceltaDocumenti = ({ valore, onChange, disabled, prefisso }: { valore: ContestoEmail[]; onChange: (v: ContestoEmail[]) => void; disabled?: boolean; prefisso: string }) => (
  <div className="flex flex-wrap gap-x-4 gap-y-2">
    {CONTESTI_EMAIL.map((c) => (
      <label key={c.codice} htmlFor={`${prefisso}-${c.codice}`} className="flex items-center gap-2 text-sm cursor-pointer">
        <Checkbox id={`${prefisso}-${c.codice}`} disabled={disabled} checked={valore.includes(c.codice)}
          onCheckedChange={(si) => onChange(CONTESTI_EMAIL.map((x) => x.codice).filter((x) => (x === c.codice ? si === true : valore.includes(x))))} />
        {c.nome}
      </label>
    ))}
  </div>
);

/** Una casella già salvata: documenti abilitati, password, prova, attiva sì/no. */
const SchedaCasella = ({ casella, imp, puoModificare, ricarica }: { casella: CasellaEmail; imp: Impostazioni; puoModificare: boolean; ricarica: () => Promise<void> }) => {
  const [nome, setNome] = useState(casella.nome);
  const [documenti, setDocumenti] = useState<ContestoEmail[]>(casella.documenti);
  const [password, setPassword] = useState("");
  const [occupato, setOccupato] = useState<"" | "salva" | "password" | "prova">("");
  useEffect(() => { setNome(casella.nome); setDocumenti(casella.documenti); }, [casella]);

  const salvata = imp.conPassword[casella.id];
  const mancanze = mancanzeCasella(casella, Boolean(salvata), imp.smtp);
  const cambiata = nome.trim() !== casella.nome || documenti.join() !== casella.documenti.join();
  const esegui = async (cosa: typeof occupato, azione: () => Promise<void>, fatto: string) => {
    setOccupato(cosa);
    try { await azione(); toast({ title: fatto }); await ricarica(); } catch (e) { errore(e); } finally { setOccupato(""); }
  };

  return (
    <div className={`border-2 rounded-sm bg-paper p-4 space-y-3 ${casella.attiva ? "border-ink/20" : "border-ink/10 opacity-80"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono font-semibold">{casella.indirizzo}</span>
        {mancanze.length === 0
          ? <Badge className="bg-emerald-700 hover:bg-emerald-700"><CheckCircle2 className="w-3 h-3 mr-1" /> Pronta</Badge>
          : <Badge variant="outline" className="border-amber-600 text-amber-800"><TriangleAlert className="w-3 h-3 mr-1" /> {mancanze.join(", ")}</Badge>}
        <label className="ml-auto flex items-center gap-2 text-sm">
          <Switch checked={casella.attiva} disabled={!puoModificare || occupato !== ""}
            onCheckedChange={(si) => esegui("salva", () => aggiornaCasella(casella.id, { attiva: si }), si ? "Casella riattivata" : "Casella disattivata")} />
          Attiva
        </label>
      </div>
      <div className="grid md:grid-cols-[16rem_1fr] gap-3">
        <div><Label>Nome (come la vede l'operatore)</Label><Input value={nome} disabled={!puoModificare} onChange={(e) => setNome(e.target.value)} placeholder="es. Commerciale" /></div>
        <div><Label>Può spedire</Label><div className="pt-2"><SceltaDocumenti prefisso={casella.id} valore={documenti} onChange={setDocumenti} disabled={!puoModificare} /></div></div>
      </div>
      {puoModificare && (
        <div className="flex flex-wrap items-end gap-2">
          <Button size="sm" data-f10 disabled={!cambiata || occupato !== ""} onClick={() => esegui("salva", () => aggiornaCasella(casella.id, { nome: nome.trim(), documenti }), "Casella salvata")}>
            {occupato === "salva" && <Loader2 className="w-4 h-4 mr-1 animate-spin" />} Salva
          </Button>
          <div className="ml-auto flex flex-wrap items-end gap-2">
            <div>
              <Label>{salvata ? `Password salvata il ${giorno(salvata)}: per cambiarla scrivi la nuova` : "Password della casella"}</Label>
              <Input type="password" autoComplete="new-password" className="w-64" value={password} onChange={(e) => setPassword(e.target.value)} disabled={!imp.disponibile} />
            </div>
            <Button size="sm" variant="outline" disabled={!password || occupato !== "" || !imp.disponibile}
              onClick={() => esegui("password", async () => { await impostaPassword(casella.id, password); setPassword(""); }, "Password salvata")}>
              {occupato === "password" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <KeyRound className="w-4 h-4 mr-1" />} Salva password
            </Button>
            <Button size="sm" variant="outline" disabled={!salvata || !imp.smtp.host || occupato !== ""} title="Prova l'accesso al server di posta, senza spedire nulla"
              onClick={() => esegui("prova", () => provaCasella(casella.id), `${casella.indirizzo}: accesso riuscito`)}>
              {occupato === "prova" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <PlugZap className="w-4 h-4 mr-1" />} Prova
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

/** Impostazioni > Mail: server di posta e caselle da cui partono i documenti. */
export const ImpostazioniEmail = () => {
  const { isAdmin } = usePermissions();
  const [imp, setImp] = useState<Impostazioni | null>(null);
  const [host, setHost] = useState("");
  const [porta, setPorta] = useState("465");
  const [nuova, setNuova] = useState({ indirizzo: "", nome: "", password: "" });
  const [documentiNuova, setDocumentiNuova] = useState<ContestoEmail[] | null>(null);
  const [occupato, setOccupato] = useState(false);

  const ricarica = useCallback(async () => {
    const letto = await leggiImpostazioniEmail();
    setImp(letto); setHost(letto.smtp.host); setPorta(String(letto.smtp.porta));
  }, []);
  useEffect(() => { void ricarica().catch(errore); }, [ricarica]);

  if (!imp) return <div className="grid place-items-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  const indirizzoNuovo = normalizzaIndirizzo(nuova.indirizzo);
  const documentiScelti = documentiNuova ?? (indirizzoNuovo ? documentiProposti(indirizzoNuovo) : []);
  const salvaServer = async () => {
    setOccupato(true);
    try { await salvaServerPosta({ host, porta: Number(porta) }); toast({ title: "Server di posta salvato" }); await ricarica(); } catch (e) { errore(e); } finally { setOccupato(false); }
  };
  const aggiungi = async () => {
    setOccupato(true);
    try {
      const creata = await creaCasella({ indirizzo: nuova.indirizzo, nome: nuova.nome, documenti: documentiScelti });
      let nota = "Ora scrivi la sua password e premi «Salva password».";
      if (nuova.password) {
        try { await impostaPassword(creata.id, nuova.password); nota = "Password salvata: premi «Prova» per controllare l'accesso."; }
        catch (e) { nota = `Casella creata, ma la password non è stata salvata: ${e instanceof Error ? e.message : String(e)}`; }
      }
      toast({ title: `Casella ${creata.indirizzo} aggiunta`, description: nota });
      setNuova({ indirizzo: "", nome: "", password: "" }); setDocumentiNuova(null);
      await ricarica();
    } catch (e) { errore(e); } finally { setOccupato(false); }
  };

  return (
    <div className="space-y-5 max-w-5xl">
      {!imp.disponibile && (
        <p className="text-sm border-2 border-amber-600 bg-amber-50 text-amber-900 rounded-sm px-3 py-2">
          <TriangleAlert className="w-4 h-4 inline mr-1" /> {imp.motivo ?? "L'invio diretto non è ancora attivo sul server."} Finché non lo è, i documenti si spediscono scaricando il PDF e aprendo il programma di posta.
        </p>
      )}
      {!isAdmin && <p className="text-sm text-muted-foreground">Queste impostazioni le modifica solo l'amministratore.</p>}

      <section className="space-y-2">
        <h2 className="font-display text-lg font-semibold">Server di posta in uscita</h2>
        <p className="text-sm text-muted-foreground">È lo stesso per tutte le caselle: lo trovi in SiteGround, nella configurazione della casella (server SMTP in uscita).</p>
        <div className="flex flex-wrap items-end gap-2">
          <div><Label>Server (SMTP)</Label><Input className="w-72" value={host} disabled={!isAdmin} onChange={(e) => setHost(e.target.value)} placeholder="es. mail.tecnofra.it" /></div>
          <div><Label>Porta</Label><Input className="w-24" inputMode="numeric" value={porta} disabled={!isAdmin} onChange={(e) => setPorta(e.target.value.replace(/\D/g, ""))} /></div>
          {isAdmin && <Button data-f10 disabled={occupato || (host.trim().toLowerCase() === imp.smtp.host && Number(porta) === imp.smtp.porta)} onClick={salvaServer}>Salva server</Button>}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold">Caselle</h2>
        <p className="text-sm text-muted-foreground">
          Per ogni casella scegli quali documenti può spedire: quando l'operatore invia un documento vede solo le caselle abilitate per quel tipo.
          La password si scrive una volta, viene conservata cifrata sul server e non si può più rileggere, solo sostituire. Una casella non si cancella: si disattiva.
        </p>
        {imp.caselle.length === 0 && <p className="text-sm border-2 border-ink/20 bg-paper rounded-sm px-3 py-4 text-center text-muted-foreground">Nessuna casella: aggiungi la prima qui sotto.</p>}
        {imp.caselle.map((c) => <SchedaCasella key={c.id} casella={c} imp={imp} puoModificare={isAdmin} ricarica={ricarica} />)}
      </section>

      {isAdmin && (
        <section className="border-2 border-dashed border-ink/30 rounded-sm p-4 space-y-3">
          <h2 className="font-display text-lg font-semibold">Aggiungi una casella</h2>
          <div className="grid md:grid-cols-3 gap-3">
            <div><Label>Indirizzo</Label><Input data-nuovo value={nuova.indirizzo} onChange={(e) => setNuova({ ...nuova, indirizzo: e.target.value })} placeholder="nome@tecnofra.it" /></div>
            <div><Label>Nome</Label><Input value={nuova.nome} onChange={(e) => setNuova({ ...nuova, nome: e.target.value })} placeholder="es. Commerciale" /></div>
            <div><Label>Password della casella</Label><Input type="password" autoComplete="new-password" value={nuova.password} disabled={!imp.disponibile} onChange={(e) => setNuova({ ...nuova, password: e.target.value })} /></div>
          </div>
          <div><Label>Può spedire</Label><div className="pt-2"><SceltaDocumenti prefisso="nuova" valore={documentiScelti} onChange={setDocumentiNuova} /></div></div>
          <Button disabled={occupato || !indirizzoNuovo} onClick={aggiungi}>{occupato ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Plus className="w-4 h-4 mr-1" />} Aggiungi casella</Button>
        </section>
      )}
    </div>
  );
};
