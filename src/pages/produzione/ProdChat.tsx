import { useEffect, useMemo, useRef, useState } from "react";
import { Send, Hash } from "lucide-react";
import { format } from "date-fns";
import { ProdLayout } from "@/components/produzione/ProdLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useProdStore } from "@/lib/produzione/store";

type Channel = { id: string; name: string; kind: string; order_id: string | null };
type Msg = { id: string; channel_id: string; user_id: string; body: string; created_at: string; reactions: Record<string, string[]> };

const ProdChat = () => {
  const { user } = useAuth();
  const { profiles, orders } = useProdStore();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  // load channels: generale + per ordine in corso
  useEffect(() => {
    (async () => {
      const { data: chans } = await supabase.from("prod_chat_channels").select("*").order("created_at", { ascending: true });
      let list = (chans ?? []) as Channel[];
      // Auto-create order-specific channels for orders not yet having one
      const inProgress = orders.filter((o) => !["chiuso", "annullato"].includes(o.status));
      const existing = new Set(list.filter((c) => c.kind === "ordine").map((c) => c.order_id));
      const missing = inProgress.filter((o) => !existing.has(o.id));
      if (missing.length) {
        const { data: ins } = await supabase.from("prod_chat_channels").insert(
          missing.map((o) => ({ kind: "ordine" as const, name: `#${o.code}`, order_id: o.id }))
        ).select();
        list = [...list, ...((ins ?? []) as Channel[])];
      }
      setChannels(list);
      if (!active && list[0]) setActive(list[0].id);
    })();
  }, [orders]);

  useEffect(() => {
    if (!active) return;
    (async () => {
      const { data } = await supabase.from("prod_chat_messages").select("*").eq("channel_id", active).order("created_at", { ascending: true }).limit(200);
      setMsgs((data ?? []) as any);
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    })();
    const ch = supabase.channel(`chat-${active}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "prod_chat_messages", filter: `channel_id=eq.${active}` }, (p) => {
        setMsgs((prev) => [...prev, p.new as Msg]);
        setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
      }).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [active]);

  const profileById = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);

  const send = async () => {
    if (!text.trim() || !active || !user) return;
    const body = text.trim();
    setText("");
    await supabase.from("prod_chat_messages").insert({ channel_id: active, user_id: user.id, body });
  };

  const activeChan = channels.find((c) => c.id === active);

  return (
    <ProdLayout>
      <div className="flex h-[calc(100vh-48px)]">
        <aside className="w-60 border-r-2 border-ink/15 bg-paper overflow-y-auto">
          <div className="px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground border-b">Canali</div>
          {channels.map((c) => (
            <button
              key={c.id}
              onClick={() => setActive(c.id)}
              className={`w-full text-left px-3 py-1.5 text-[12px] flex items-center gap-1.5 ${active === c.id ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            >
              <Hash className="w-3 h-3" />
              {c.name.replace(/^#/, "")}
            </button>
          ))}
        </aside>
        <div className="flex-1 flex flex-col bg-background">
          <div className="h-10 border-b-2 border-ink/15 bg-paper flex items-center px-4 font-display font-semibold text-sm">
            {activeChan?.name ?? "—"}
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {msgs.map((m) => {
              const author = profileById.get(m.user_id);
              const mine = m.user_id === user?.id;
              return (
                <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[70%] rounded-sm border-2 px-3 py-1.5 ${mine ? "bg-primary text-primary-foreground border-primary" : "bg-paper border-ink/15"}`}>
                    <div className="text-[10px] font-mono opacity-70 mb-0.5">
                      {author?.display_name ?? "Utente"} · {format(new Date(m.created_at), "HH:mm")}
                    </div>
                    <div className="text-[13px]">{m.body}</div>
                  </div>
                </div>
              );
            })}
            <div ref={endRef} />
          </div>
          <div className="border-t-2 border-ink/15 bg-paper p-3 flex gap-2">
            <Input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="Scrivi un messaggio…" />
            <Button onClick={send} className="gap-1.5"><Send className="w-3.5 h-3.5" />Invia</Button>
          </div>
        </div>
      </div>
    </ProdLayout>
  );
};

export default ProdChat;