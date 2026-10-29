import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export default function BankCallback() {
  const started = useRef(false);
  const [message, setMessage] = useState("Verifica dell’autorizzazione bancaria…");
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    window.history.replaceState(null, "", window.location.pathname);
    if (!code || !state) { setMessage("Autorizzazione annullata o incompleta. Ripeti il collegamento da Conti."); return; }
    void (async () => {
      const { data, error } = await supabase.functions.invoke("bank-authorize", { body: { action: "finish", code, state } });
      if (error) {
        const details = error instanceof FunctionsHttpError ? await error.context.json().catch(() => null) : null;
        setMessage(details?.error ?? "Autorizzazione non completata. Accedi a Flow e ripeti da Conti.");
      } else setMessage(`${data.bank}: autorizzazione salvata per ${data.accountCount} conti. Importazione in attesa della verifica delle condizioni economiche.`);
    })();
  }, []);
  return <main className="mx-auto max-w-2xl space-y-6 px-6 py-16"><h1 className="text-2xl font-semibold">Tecnofra Flow · Collegamento bancario</h1><p role="status" className="text-lg">{message}</p><Button asChild><Link to="/contabilita">Torna a Contabilità</Link></Button></main>;
}