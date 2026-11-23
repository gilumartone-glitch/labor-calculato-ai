import { useEffect, useState } from "react";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { collegamentoPosta, indirizzi } from "@/lib/gestionale/email-documento";

export type EmailDaInviare = { a: string; oggetto: string; testo: string; nomeFile: string };

/**
 * Prepara l'email di un documento: destinatari, oggetto e testo si possono ritoccare.
 * Alla conferma scarica il PDF e apre il programma di posta con tutto compilato.
 */
export const InviaEmailDialog = ({ email, onClose, onScaricaPdf }: {
  email: EmailDaInviare | null;
  onClose: () => void;
  /** scarica il PDF da allegare */
  onScaricaPdf: () => void | Promise<void>;
}) => {
  const [a, setA] = useState("");
  const [cc, setCc] = useState("");
  const [oggetto, setOggetto] = useState("");
  const [testo, setTesto] = useState("");

  useEffect(() => {
    if (!email) return;
    setA(email.a); setCc(""); setOggetto(email.oggetto); setTesto(email.testo);
  }, [email]);

  if (!email) return null;

  const invia = async () => {
    const destinatari = indirizzi(a); const copia = indirizzi(cc);
    const sbagliati = [...destinatari.scartati, ...copia.scartati];
    if (sbagliati.length > 0) { toast({ title: "Indirizzo non valido", description: sbagliati.join(", "), variant: "destructive" }); return; }
    if (destinatari.validi.length === 0) { toast({ title: "Manca il destinatario", description: "Scrivi almeno un indirizzo email.", variant: "destructive" }); return; }
    try {
      await onScaricaPdf();
      window.location.href = collegamentoPosta({ a: destinatari.validi, cc: copia.validi, oggetto, testo });
      toast({ title: "PDF scaricato, posta aperta", description: `Scegli la casella da cui spedire e allega ${email.nomeFile}.` });
      onClose();
    } catch (e) { toast({ title: "Errore", description: e instanceof Error ? e.message : String(e), variant: "destructive" }); }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Invia per email</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>A</Label>
            <Input value={a} onChange={(e) => setA(e.target.value)} placeholder="indirizzo del cliente; più indirizzi separati da virgola" />
            {!email.a && <p className="text-xs text-muted-foreground mt-1">Sulla scheda del cliente non c'è un'email: scrivila qui, e aggiungila alla scheda per le prossime volte.</p>}
          </div>
          <div><Label>Cc</Label><Input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="facoltativo" /></div>
          <div><Label>Oggetto</Label><Input value={oggetto} onChange={(e) => setOggetto(e.target.value)} /></div>
          <div><Label>Messaggio</Label><Textarea rows={11} value={testo} onChange={(e) => setTesto(e.target.value)} /></div>
          <p className="text-xs text-muted-foreground">
            Alla conferma viene scaricato <span className="font-mono">{email.nomeFile}</span> e si apre il programma di posta con il messaggio pronto:
            lì scegli la casella Tecnofra da cui spedire e alleghi il file appena scaricato.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annulla</Button>
          <Button onClick={invia}><Mail className="w-4 h-4 mr-1" /> Scarica il PDF e apri la posta</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
