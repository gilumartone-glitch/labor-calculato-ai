import { useEffect, useState } from "react";
import { Landmark } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { eur } from "@/lib/format";
export type BankAccount = { id: string; bank: string; account_ref: string; display_name: string; iban_last4: string | null; balance: number | null; balance_date: string | null; last_sync_at: string | null; is_active: boolean };
export function BankBalances({ accounts: supplied }: { accounts?: BankAccount[] }) {
  const [loaded, setLoaded] = useState<BankAccount[]>([]);
  useEffect(() => {
    if (supplied) return;
    void supabase.from("bank_accounts").select("*").eq("is_active", true).then(({ data }) => setLoaded((data ?? []) as BankAccount[]));
  }, [supplied]);
  const accounts = supplied ?? loaded;
  if (!accounts.length) return null;
  return <section aria-label="Saldi bancari" className="space-y-3 border-y border-border py-4"><h3 className="flex items-center gap-2 text-xl font-semibold"><Landmark />Saldi bancari rilevati</h3><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{accounts.map((a) => <div key={a.id} className="space-y-1 border-b border-border pb-3"><div className="text-lg font-semibold">{a.bank} · {a.display_name}</div><div className="text-base text-muted-foreground">{a.iban_last4 ? `IBAN •••• ${a.iban_last4}` : "Conto senza IBAN disponibile"}</div><div className="text-2xl font-semibold">{a.balance === null ? "Saldo non ancora rilevato" : eur(Number(a.balance))}</div><div className="text-base text-muted-foreground">{a.balance_date ? `Rilevato il ${new Date(a.balance_date).toLocaleString("it-IT")}` : "In attesa della prima lettura bancaria"}</div></div>)}</div></section>;
}