import { useEffect, useMemo, useState } from "react";
import { Loader2, Send, Calendar, CheckCircle2, Clock, MessageSquare, Trash2, Star, StarOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useCommessaUpdates, type UpdateTipo, TIPO_LABEL } from "@/lib/flow/updates";
import type { Profile } from "./types";

type Props = {
  commessaId: string;
  onCommessaChanged?: () => void;
};

type AssignRow = { user_id: string; responsabile: boolean; profile?: Profile | null };

const TIPO_ICON: Record<UpdateTipo, JSX.Element> = {
  nota: <MessageSquare className="w-3.5 h-3.5" />,
  aggiornamento: <MessageSquare className="w-3.5 h-3.5" />,
  completamento: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />,
  richiesta_prolungamento: <Clock className="w-3.5 h-3.5 text-amber-600" />,
  risposta_admin: <CheckCircle2 className="w-3.5 h-3.5 text-primary" />,
};

const fmt = (iso: string) => {
  try { return new Date(iso).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" }); } catch { return iso; }
};
const fmtDate = (iso: string | null) => iso ? new Date(iso).toLocaleDateString("it-IT") : "—";

export const CommessaUpdatesTab = ({ commessaId, onCommessaChanged }: Props) => {
  const { user } = useAuth();
  const { isAdmin, roles } = usePermissions();
  const isCoord = isAdmin || roles.includes("coordinatore");
  const { items, loading, create, decide, remove } = useCommessaUpdates(commessaId);

  const [assignees, setAssignees] = useState<AssignRow[]>([]);

  const loadAssignees = async () => {
    const { data: ass } = await supabase
      .from("commessa_assegnatari")
      .select("user_id, responsabile")
      .eq("commessa_id", commessaId);
    const ids = (ass ?? []).map((a: any) => a.user_id);
    if (ids.length === 0) { setAssignees([]); return; }
    const { data: profs } = await supabase
      .from("profiles").select("id, display_name, avatar_url").in("id", ids);
    const byId = new Map<string, Profile>((profs ?? []).map((p: any) => [p.id, p as Profile]));
    setAssignees((ass ?? []).map((a: any) => ({ user_id: a.user_id, responsabile: !!a.responsabile, profile: byId.get(a.user_id) ?? null })));
  };
  useEffect(() => { loadAssignees(); /* eslint-disable-next-line */ }, [commessaId]);

  const myRow = useMemo(() => assignees.find((a) => a.user_id === user?.id), [assignees, user]);
  const isResponsabile = !!myRow?.responsabile;
  const isAssigned = !!myRow;
  const canWrite = isAssigned || isCoord;
  const canCompleteOrExtend = isResponsabile || isCoord;

  const [tipo, setTipo] = useState<UpdateTipo>("nota");
  const [body, setBody] = useState("");
  const [proposed, setProposed] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!body.trim() && tipo !== "completamento") return toast.error("Scrivi qualcosa");
    if (tipo === "richiesta_prolungamento" && !proposed) return toast.error("Indica la nuova data proposta");
    setBusy(true);
    try {
      await create({
        tipo,
        body: body.trim() || (tipo === "completamento" ? "Cantiere dichiarato completato" : ""),
        proposed_date: tipo === "richiesta_prolungamento" ? proposed : null,
      });
      if (tipo === "completamento") {
        await supabase.from("commesse").update({ stato: "consegnato" }).eq("id", commessaId);
        onCommessaChanged?.();
      }
      if (tipo === "richiesta_prolungamento") {
        // notifica admin
        const { data: admins } = await supabase.rpc("get_admin_user_ids" as never);
        const ids = ((admins ?? []) as string[]).filter(Boolean);
        if (ids.length > 0 && user) {
          await supabase.from("prod_notifications").insert(ids.map((uid: string) => ({
            user_id: uid,
            type: "ordine_rimandato" as const,
            message: `Richiesta prolungamento cantiere → nuova data ${fmtDate(proposed)}`,
            is_urgent: false,
          })));
        }
      }
      setBody(""); setProposed(""); setTipo("nota");
      toast.success("Inserito");
    } catch (e: any) {
      toast.error(e.message ?? "Errore");
    } finally { setBusy(false); }
  };

  const toggleResponsabile = async (uid: string, makeIt: boolean) => {
    if (!isCoord && !(isResponsabile && uid === user?.id)) return toast.error("Non autorizzato");
    try {
      if (makeIt) {
        // azzera tutti, poi setta uno
        await supabase.from("commessa_assegnatari").update({ responsabile: false } as any).eq("commessa_id", commessaId);
        await supabase.from("commessa_assegnatari").update({ responsabile: true } as any).eq("commessa_id", commessaId).eq("user_id", uid);
      } else {
        await supabase.from("commessa_assegnatari").update({ responsabile: false } as any).eq("commessa_id", commessaId).eq("user_id", uid);
      }
      await loadAssignees();
      toast.success(makeIt ? "Responsabile aggiornato" : "Responsabile rimosso");
    } catch (e: any) { toast.error(e.message ?? "Errore"); }
  };

  const onDecide = async (id: string, decision: "approvato" | "rifiutato", proposed_date: string | null) => {
    const reason = window.prompt(`${decision === "approvato" ? "Approva" : "Rifiuta"} richiesta — motivo / nota:`, "") ?? "";
    try {
      await decide(id, decision, reason);
      if (decision === "approvato" && proposed_date) {
        await supabase.from("commesse").update({ data_scadenza: proposed_date }).eq("id", commessaId);
        onCommessaChanged?.();
      }
      toast.success(decision === "approvato" ? "Approvata" : "Rifiutata");
    } catch (e: any) { toast.error(e.message ?? "Errore"); }
  };

  return (
    <div className="space-y-4">
      {/* Responsabili */}
      <div className="border border-ink/15 rounded-sm p-3">
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">Responsabile cantiere</div>
        {assignees.length === 0 ? (
          <div className="text-xs text-muted-foreground italic">Nessun assegnatario. Aggiungi gli operatori dalla scheda.</div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {assignees.map((a) => (
              <button
                key={a.user_id}
                type="button"
                onClick={() => toggleResponsabile(a.user_id, !a.responsabile)}
                disabled={!isCoord && !(isResponsabile && a.user_id === user?.id)}
                className={`inline-flex items-center gap-1.5 px-2 py-1 border rounded-sm text-xs transition-colors ${
                  a.responsabile ? "border-primary bg-primary/10 text-primary" : "border-ink/20 hover:border-primary/50"
                }`}
                title={a.responsabile ? "Rimuovi responsabile" : "Imposta come responsabile cantiere"}
              >
                {a.responsabile ? <Star className="w-3 h-3 fill-current" /> : <StarOff className="w-3 h-3 opacity-40" />}
                <span className="w-5 h-5 rounded-full bg-ink text-paper text-[9px] font-mono font-bold grid place-items-center">
                  {(a.profile?.display_name ?? "?").slice(0, 1).toUpperCase()}
                </span>
                {a.profile?.display_name ?? "Utente"}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Form */}
      {canWrite && (
        <div className="border-2 border-primary/30 bg-primary/5 rounded-sm p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Select value={tipo} onValueChange={(v) => setTipo(v as UpdateTipo)}>
              <SelectTrigger className="w-[220px] h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="nota">Nota</SelectItem>
                <SelectItem value="aggiornamento">Aggiornamento</SelectItem>
                {canCompleteOrExtend && <SelectItem value="completamento">Dichiara cantiere completo</SelectItem>}
                {canCompleteOrExtend && <SelectItem value="richiesta_prolungamento">Richiedi prolungamento</SelectItem>}
              </SelectContent>
            </Select>
            {tipo === "richiesta_prolungamento" && (
              <Input type="date" value={proposed} onChange={(e) => setProposed(e.target.value)} className="h-9 w-[170px]" />
            )}
          </div>
          <Textarea
            placeholder={tipo === "completamento" ? "Note di chiusura (opzionale)" : "Scrivi qui…"}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
          />
          <div className="flex justify-end">
            <Button onClick={submit} disabled={busy} size="sm">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Pubblica
            </Button>
          </div>
        </div>
      )}

      {/* Timeline */}
      <div className="space-y-2">
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Timeline ({items.length})</div>
        {loading ? (
          <div className="grid place-items-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : items.length === 0 ? (
          <div className="text-center text-xs text-muted-foreground py-6 italic">Nessun aggiornamento ancora.</div>
        ) : (
          items.map((u) => {
            const author = assignees.find((a) => a.user_id === u.author_id)?.profile;
            const isMine = u.author_id === user?.id;
            const canApprove = u.tipo === "richiesta_prolungamento" && u.status === "pending" && isAdmin;
            return (
              <div key={u.id} className="border border-ink/15 rounded-sm p-3 bg-paper">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="flex items-center gap-2 text-xs">
                    {TIPO_ICON[u.tipo]}
                    <span className="font-bold uppercase tracking-wider text-[10px]">{TIPO_LABEL[u.tipo]}</span>
                    {u.status && (
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-sm uppercase font-bold ${
                        u.status === "pending" ? "bg-amber-100 text-amber-800" :
                        u.status === "approvato" ? "bg-emerald-100 text-emerald-800" :
                        "bg-rose-100 text-rose-800"
                      }`}>{u.status}</span>
                    )}
                    <span className="text-muted-foreground">· {author?.display_name ?? "Utente"} · {fmt(u.created_at)}</span>
                  </div>
                  {(isMine || isAdmin) && (
                    <button onClick={() => remove(u.id)} className="text-muted-foreground hover:text-destructive" title="Elimina">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                {u.body && <div className="text-sm whitespace-pre-wrap">{u.body}</div>}
                {u.proposed_date && (
                  <div className="text-xs mt-1 text-muted-foreground"><Calendar className="inline w-3 h-3 mr-1" />Nuova data proposta: <b>{fmtDate(u.proposed_date)}</b></div>
                )}
                {canApprove && (
                  <div className="flex gap-2 mt-2">
                    <Button size="sm" variant="default" onClick={() => onDecide(u.id, "approvato", u.proposed_date)}>Approva</Button>
                    <Button size="sm" variant="outline" onClick={() => onDecide(u.id, "rifiutato", u.proposed_date)}>Rifiuta</Button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
