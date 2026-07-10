import { useEffect, useMemo, useRef, useState } from "react";
import { Send, Hash, Paperclip, X, Download, FileArchive, FileText, Image as ImageIcon, File as FileIcon, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { ProdLayout } from "@/components/produzione/ProdLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useProdStore } from "@/lib/produzione/store";
import { toast } from "sonner";

type Channel = { id: string; name: string; kind: string; order_id: string | null };
type Attachment = { path: string; name: string; size: number; type: string };
type Msg = {
  id: string;
  channel_id: string;
  user_id: string;
  body: string;
  created_at: string;
  reactions: Record<string, string[]>;
  attachments?: Attachment[] | null;
};

const BUCKET = "prod-chat-attachments";
const MAX_FILE_MB = 50;

const fmtSize = (b: number) => {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
};

const iconFor = (name: string, type: string) => {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["rar", "zip", "7z", "tar", "gz"].includes(ext)) return FileArchive;
  if (type.startsWith("image/")) return ImageIcon;
  if (["pdf", "doc", "docx", "txt", "md", "csv", "xls", "xlsx"].includes(ext)) return FileText;
  return FileIcon;
};

const AttachmentChip = ({ a }: { a: Attachment }) => {
  const Icon = iconFor(a.name, a.type);
  const download = async () => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(a.path, 60);
    if (error || !data) {
      toast.error("Impossibile scaricare il file");
      return;
    }
    const res = await fetch(data.signedUrl);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = a.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };
  return (
    <button
      onClick={download}
      className="flex items-center gap-2 rounded-sm border border-ink/20 bg-background/60 px-2 py-1 text-[12px] hover:bg-background transition-colors"
      title={`Scarica ${a.name}`}
    >
      <Icon className="w-4 h-4 shrink-0" />
      <span className="truncate max-w-[220px]">{a.name}</span>
      <span className="opacity-60 text-[10px]">{fmtSize(a.size)}</span>
      <Download className="w-3.5 h-3.5 opacity-60" />
    </button>
  );
};

const ProdChat = () => {
  const { user } = useAuth();
  const { profiles, orders } = useProdStore();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [pending, setPending] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      const { data: chans } = await supabase.from("prod_chat_channels").select("*").order("created_at", { ascending: true });
      let list = (chans ?? []) as Channel[];
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

  const addFiles = (files: FileList | null) => {
    if (!files || !user) return;
    const arr = Array.from(files);
    const oversize = arr.find((f) => f.size > MAX_FILE_MB * 1024 * 1024);
    if (oversize) {
      toast.error(`"${oversize.name}" supera ${MAX_FILE_MB}MB`);
      return;
    }
    setPending((prev) => [...prev, ...arr]);
  };

  const removePending = (i: number) => setPending((prev) => prev.filter((_, idx) => idx !== i));

  const send = async () => {
    if ((!text.trim() && pending.length === 0) || !active || !user) return;
    const body = text.trim();
    const files = pending;
    setText("");
    setPending([]);

    let attachments: Attachment[] = [];
    if (files.length) {
      setUploading(true);
      try {
        for (const f of files) {
          const safe = f.name.replace(/[^\w.\-]+/g, "_");
          // preserve folder path (webkitRelativePath) when uploading a folder
          const rel = (f as any).webkitRelativePath || "";
          const nameForStorage = rel ? rel.replace(/[^\w./\-]+/g, "_") : safe;
          const path = `${user.id}/${active}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${nameForStorage}`;
          const { error } = await supabase.storage.from(BUCKET).upload(path, f, {
            contentType: f.type || "application/octet-stream",
            upsert: false,
          });
          if (error) {
            toast.error(`Upload fallito: ${f.name}`);
            continue;
          }
          attachments.push({
            path,
            name: rel || f.name,
            size: f.size,
            type: f.type || "application/octet-stream",
          });
        }
      } finally {
        setUploading(false);
      }
    }

    const { error } = await supabase.from("prod_chat_messages").insert({
      channel_id: active,
      user_id: user.id,
      body,
      attachments: attachments as any,
    });
    if (error) toast.error("Invio messaggio fallito");
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
              const atts = (m.attachments ?? []) as Attachment[];
              return (
                <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[70%] rounded-sm border-2 px-3 py-1.5 ${mine ? "bg-primary text-primary-foreground border-primary" : "bg-paper border-ink/15"}`}>
                    <div className="text-[10px] font-mono opacity-70 mb-0.5">
                      {author?.display_name ?? "Utente"} · {format(new Date(m.created_at), "HH:mm")}
                    </div>
                    {m.body && <div className="text-[13px] whitespace-pre-wrap break-words">{m.body}</div>}
                    {atts.length > 0 && (
                      <div className="mt-1.5 flex flex-col gap-1">
                        {atts.map((a, i) => <AttachmentChip key={i} a={a} />)}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={endRef} />
          </div>
          {pending.length > 0 && (
            <div className="border-t border-ink/15 bg-paper/60 px-3 py-2 flex flex-wrap gap-1.5">
              {pending.map((f, i) => {
                const Icon = iconFor(f.name, f.type);
                return (
                  <div key={i} className="flex items-center gap-1.5 rounded-sm border border-ink/20 bg-background px-2 py-1 text-[11px]">
                    <Icon className="w-3.5 h-3.5" />
                    <span className="max-w-[180px] truncate">{(f as any).webkitRelativePath || f.name}</span>
                    <span className="opacity-60">{fmtSize(f.size)}</span>
                    <button onClick={() => removePending(i)} className="opacity-60 hover:opacity-100" aria-label="Rimuovi">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          <div className="border-t-2 border-ink/15 bg-paper p-3 flex gap-2 items-center">
            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => { addFiles(e.target.files); if (fileRef.current) fileRef.current.value = ""; }}
            />
            <input
              ref={folderRef}
              type="file"
              multiple
              className="hidden"
              // @ts-expect-error non-standard attribute for folder upload
              webkitdirectory=""
              directory=""
              onChange={(e) => { addFiles(e.target.files); if (folderRef.current) folderRef.current.value = ""; }}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => fileRef.current?.click()}
              title="Allega file (qualsiasi formato: .rar, .zip, .pdf, immagini…)"
            >
              <Paperclip className="w-4 h-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => folderRef.current?.click()}
              title="Allega intera cartella"
            >
              <FileArchive className="w-4 h-4" />
            </Button>
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Scrivi un messaggio…"
            />
            <Button onClick={send} disabled={uploading} className="gap-1.5">
              {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              Invia
            </Button>
          </div>
        </div>
      </div>
    </ProdLayout>
  );
};

export default ProdChat;
