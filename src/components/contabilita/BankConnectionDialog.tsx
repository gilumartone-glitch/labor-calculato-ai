import { useState } from "react";
import { ArrowLeft, ArrowRight, ExternalLink, Loader2, ShieldCheck } from "lucide-react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { providerInquiry, type BankingAssessment, type BankingBank } from "@/lib/open-banking";

export function BankConnectionDialog({ bank, onClose }: { bank: BankingBank | null; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [product, setProduct] = useState("");
  const [assessment, setAssessment] = useState<BankingAssessment | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const close = () => { if (busy) return; setStep(0); setProduct(""); setAssessment(null); setError(""); setCopied(false); onClose(); };
  const verify = async () => {
    if (!bank || busy || product.trim().length < 2) return;
    setBusy(true); setError("");
    try {
      const { data, error: e } = await supabase.functions.invoke("bank-connection-assessment", { body: { bank, product: product.trim() } });
      if (e) {
        const details = e instanceof FunctionsHttpError ? await e.context.json().catch(() => null) : null;
        throw new Error(details?.error ?? "Verifica non disponibile. Nessun collegamento attivato.");
      }
      if (!data || data.bank !== bank || !Array.isArray(data.blockers)) throw new Error("Risposta non valida. Nessun collegamento attivato.");
      setAssessment(data); setStep(1);
    } catch (e) { setError(e instanceof Error ? e.message : "Verifica non riuscita."); }
    finally { setBusy(false); }
  };
  return <Dialog open={bank !== null} onOpenChange={(open) => { if (!open) close(); }}><DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto text-base"><DialogHeader><DialogTitle className="text-2xl">Collega {bank}</DialogTitle><DialogDescription className="text-base">Enable Banking · Solo saldi e movimenti · Non attivo</DialogDescription></DialogHeader>
    <ol className="flex flex-wrap gap-x-5 gap-y-2 border-b border-border pb-3 text-base" aria-label="Passaggi collegamento">{["Conto e compatibilità", "Costi e autorizzazioni", "Attivazione"].map((label, i) => <li key={label} aria-current={step === i ? "step" : undefined} className={step === i ? "font-semibold text-foreground" : "text-muted-foreground"}>{i + 1}. {label}</li>)}</ol>
    {step === 0 && <div className="space-y-4"><div className="space-y-2"><Label htmlFor="bank-product" className="text-base">Servizio utilizzato per accedere al conto aziendale</Label><Input id="bank-product" placeholder="Nome del servizio di home banking" maxLength={150} className="h-11 text-base" value={product} onChange={(e) => { setProduct(e.target.value); setAssessment(null); }} /></div><p>La presenza del nome della banca nell’elenco pubblico non conferma il supporto del tuo conto aziendale.</p><Button asChild variant="outline" className="h-auto whitespace-normal text-base"><a href="https://enablebanking.com/open-banking-apis?country=IT" target="_blank" rel="noopener noreferrer"><ExternalLink />Consulta le banche del provider</a></Button><p className="text-muted-foreground">Non inserire password, PIN, codici di sicurezza o IBAN. Le credenziali bancarie vanno inserite soltanto nella pagina della banca.</p><Button disabled={busy || product.trim().length < 2} onClick={() => void verify()} className="text-base">{busy ? <Loader2 className="animate-spin" /> : <ShieldCheck />}Verifica requisiti</Button></div>}
    {step === 1 && assessment && <div className="space-y-4"><div role="status" className="border-l-4 border-destructive pl-3"><h3 className="text-lg font-semibold">Verifica incompleta — sincronizzazione bloccata</h3><ul className="mt-2 list-disc space-y-2 pl-5">{assessment.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul></div><dl className="space-y-3"><div><dt className="font-semibold">Costi</dt><dd>Importo non confermato. Il provider indica prezzi a volume e un minimo mensile; serve un preventivo scritto con canone, costo per conto, avviamento e IVA.</dd></div><div><dt className="font-semibold">Autorizzazioni richieste</dt><dd>Solo lettura di saldi e movimenti. Nessun bonifico o pagamento. Conferma finale nella pagina della banca.</dd></div><div><dt className="font-semibold">Durata e rinnovi</dt><dd>Scadenza non disponibile prima del consenso. La durata dipende dalla banca; nessun rinnovo automatico viene dato per scontato. Alla scadenza occorre una nuova autorizzazione.</dd></div><div><dt className="font-semibold">Aggiornamenti e contabilità</dt><dd>Frequenza e storico da confermare. I movimenti importati restano da associare manualmente: non passano da competenza a cassa da soli.</dd></div></dl><Button asChild variant="link" className="h-auto p-0 text-base"><a href="https://enablebanking.com/docs/faq/" target="_blank" rel="noopener noreferrer">Condizioni del provider<ExternalLink /></a></Button><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setStep(0)} className="text-base"><ArrowLeft />Indietro</Button><Button onClick={() => setStep(2)} className="text-base">Riepilogo<ArrowRight /></Button></div></div>}
    {step === 2 && assessment && bank && <div className="space-y-4"><h3 className="text-xl font-semibold">Prima di autorizzare {bank}</h3><p className="break-words">Conto aziendale · {product} · Provider Enable Banking</p><p>Servono conferma del conto supportato, offerta economica accettata, contratto, verifica aziendale e configurazione sicura del provider. Solo dopo sarà disponibile l’autorizzazione nella banca.</p><p className="font-semibold">Nessun collegamento bancario o aggiornamento automatico è stato attivato.</p><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setStep(1)} className="text-base"><ArrowLeft />Indietro</Button><Button onClick={async () => { try { await navigator.clipboard.writeText(providerInquiry(bank, product)); setCopied(true); setError(""); } catch { setError("Copia non disponibile. Usa il testo qui sotto."); } }} className="h-auto whitespace-normal text-base">{copied ? "Richiesta copiata" : "Copia richiesta per il provider"}</Button><Button asChild variant="outline" className="text-base"><a href="https://enablebanking.com/contact/" target="_blank" rel="noopener noreferrer">Contatta il provider<ExternalLink /></a></Button></div><details className="border-t border-border pt-3"><summary className="cursor-pointer font-semibold">Testo della richiesta</summary><p className="mt-3 break-words">{providerInquiry(bank, product)}</p></details><Button disabled className="h-auto whitespace-normal text-base"><ShieldCheck />Attivazione non disponibile: requisiti mancanti</Button></div>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
  </DialogContent></Dialog>;
}