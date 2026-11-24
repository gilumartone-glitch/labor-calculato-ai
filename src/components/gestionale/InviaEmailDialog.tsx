import { useEffect, useState } from "react";
import { Download, Loader2, Mail, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { collegamentoPosta, indirizzi } from "@/lib/gestionale/email-documento";
import {
  casellaProposta, casellePerContesto, CONTESTI_EMAIL, inviaEmail, leggiCaselle, ricordaCasella, storicoEmail,
  type Caselle, type ContestoEmail, type EmailInviata,
} from "@/lib/gestionale/invio-email";

export type EmailDaInviare = {
  a: string; oggetto: string; testo: string; nomeFile: string;
  contesto: ContestoEmail; documentoId?: string | null; anagraficaId?: string | null;
};

const quando = (iso: string) => new Date(iso).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * Invia un documento per email. Se le caselle Tecnofra sono configurate sul server l'operatore sceglie
 * da quale spedire e il messaggio parte subito con il PDF allegato; altrimenti si scarica il PDF
 * e si apre il programma di posta con tutto compilato.
 */
export const InviaEmailDialog = ({ email, onClose, creaPdf }: {
  email: EmailDaInviare | null;
  onClose: () => void;
  /** i byte del PDF da allegare */
  creaPdf: () => Promise<Uint8Array>;
}) => {
  const [a, setA] = useState("");
  const [cc, setCc] = useState("");
  const [oggetto, setOggetto] = useState("");
  const [testo, setTesto] = useState("");
  const [caselle, setCaselle] = useState<Caselle | null>(null);
  const [da, setDa] = useState("");
  const [storico, setStorico] = useState<EmailInviata[]>([]);
  const [occupato, setOccupato] = useState(false);

  useEffect(() => {
    if (!email) return;
    setA(email.a); setCc(""); setOggetto(email.oggetto); setTesto(email.testo); setCaselle(null); setDa(""); setStorico([]);
    let vivo = true;
    void leggiCaselle().then((c) => {
      if (!vivo) return;
      setCaselle(c);
      setDa(casellaProposta(email.contesto, casellePerContesto(email.contesto, c).map((x) => x.indirizzo)));
    });
    void storicoEmail({ documento_id: email.documentoId, anagrafica_id: email.anagraficaId, contesto: email.contesto }).then((s) => { if (vivo) setStorico(s); });
    return () => { vivo = false; };
  }, [email]);

  if (!email) return null;

  const disponibili = caselle ? casellePerContesto(email.contesto, caselle) : [];
  const diretto = disponibili.length > 0;
  const tipo = (CONTESTI_EMAIL.find((c) => c.codice === email.contesto)?.nome ?? "questo documento").toLowerCase();

  const controlla = () => {
    const destinatari = indirizzi(a); const copia = indirizzi(cc);
    const sbagliati = [...destinatari.scartati, ...copia.scartati];
    if (sbagliati.length > 0) { toast({ title: "Indirizzo non valido", description: sbagliati.join(", "), variant: "destructive" }); return null; }
    if (destinatari.validi.length === 0) { toast({ title: "Manca il destinatario", description: "Scrivi almeno un indirizzo email.", variant: "destructive" }); return null; }
    return { a: destinatari.validi, cc: copia.validi };
  };
  const scarica = (byte: Uint8Array) => {
    const url = URL.createObjectURL(new Blob([byte as BlobPart], { type: "application/pdf" }));
    const link = document.createElement("a");
    link.href = url; link.download = email.nomeFile; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };
  const errore = (e: unknown) => toast({ title: "Email non inviata", description: e instanceof Error ? e.message : String(e), variant: "destructive" });

  const invia = async () => {
    const chi = controlla();
    if (!chi) return;
    if (!da) { toast({ title: "Scegli la casella", description: "Indica da quale casella Tecnofra spedire.", variant: "destructive" }); return; }
    setOccupato(true);
    try {
      await inviaEmail({
        contesto: email.contesto, documento_id: email.documentoId ?? null, anagrafica_id: email.anagraficaId ?? null,
        da, a: chi.a, cc: chi.cc, oggetto, testo, allegato: { nome: email.nomeFile, byte: await creaPdf() },
      });
      ricordaCasella(email.contesto, da);
      toast({ title: "Email inviata", description: `Da ${da} a ${chi.a.join(", ")}, con ${email.nomeFile} allegato.` });
      onClose();
    } catch (e) { errore(e); } finally { setOccupato(false); }
  };
  const apriPosta = async () => {
    const chi = controlla();
    if (!chi) return;
    setOccupato(true);
    try {
      scarica(await creaPdf());
      window.location.href = collegamentoPosta({ ...chi, oggetto, testo });
      toast({ title: "PDF scaricato, posta aperta", description: `Scegli la casella da cui spedire e allega ${email.nomeFile}.` });
      onClose();
    } catch (e) { errore(e); } finally { setOccupato(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !occupato) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Invia per email</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          {caselle === null ? (
            <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Leggo le caselle da cui si può spedire…</p>
          ) : diretto ? (
            <div>
              <Label>Da</Label>
              <Select value={da} onValueChange={setDa} disabled={disponibili.length === 1}>
                <SelectTrigger><SelectValue placeholder="Scegli la casella Tecnofra da cui spedire" /></SelectTrigger>
                <SelectContent>{disponibili.map((c) => <SelectItem key={c.indirizzo} value={c.indirizzo}>{c.nome ? `${c.nome} — ${c.indirizzo}` : c.indirizzo}</SelectItem>)}</SelectContent>
              </Select>
              {disponibili.length === 1 && <p className="text-xs text-muted-foreground mt-1">È l'unica casella abilitata per {tipo}. Le altre si abilitano in Impostazioni › Mail.</p>}
            </div>
          ) : (
            <p className="text-xs border-2 border-ink/20 bg-paper rounded-sm px-3 py-2">
              {caselle.configurato
                ? `Nessuna casella è abilitata a spedire ${tipo}: si abilita in Impostazioni › Mail. Per ora si scarica il PDF e si apre il programma di posta.`
                : "L'invio diretto non è ancora configurato (Impostazioni › Mail): per ora si scarica il PDF e si apre il programma di posta, dove scegli la casella e alleghi il file."}
            </p>
          )}
          <div>
            <Label>A</Label>
            <Input value={a} onChange={(e) => setA(e.target.value)} placeholder="indirizzo del cliente; più indirizzi separati da virgola" />
            {!email.a && <p className="text-xs text-muted-foreground mt-1">Sulla scheda del cliente non c'è un'email: scrivila qui, e aggiungila alla scheda per le prossime volte.</p>}
          </div>
          <div><Label>Cc</Label><Input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="facoltativo" /></div>
          <div><Label>Oggetto</Label><Input value={oggetto} onChange={(e) => setOggetto(e.target.value)} /></div>
          <div><Label>Messaggio</Label><Textarea rows={11} value={testo} onChange={(e) => setTesto(e.target.value)} /></div>
          <p className="text-xs text-muted-foreground">
            Allegato: <span className="font-mono">{email.nomeFile}</span>.
            {diretto && " Una copia del messaggio arriva anche alla casella che spedisce."}
          </p>
          {storico.length > 0 && (
            <div className="text-xs border-t border-ink/20 pt-2">
              <p className="font-semibold mb-1">Già inviato</p>
              <ul className="space-y-0.5">
                {storico.map((s) => (
                  <li key={s.id} className={s.esito === "errore" ? "text-destructive" : ""}>
                    {quando(s.creato_il)} — da {s.mittente} a {s.destinatari.join(", ")}{s.esito === "errore" ? ` — non partita: ${s.errore ?? "errore"}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={occupato} onClick={onClose}>Annulla</Button>
          {diretto && <Button variant="outline" disabled={occupato} onClick={apriPosta}><Download className="w-4 h-4 mr-1" /> Scarica e apri la posta</Button>}
          {diretto
            ? <Button data-f10 disabled={occupato} onClick={invia}>{occupato ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Send className="w-4 h-4 mr-1" />} Invia</Button>
            : <Button data-f10 disabled={occupato || caselle === null} onClick={apriPosta}><Mail className="w-4 h-4 mr-1" /> Scarica il PDF e apri la posta</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
