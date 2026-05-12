import { useRef, useState } from "react";
import { Plus, Trash2, ArrowUp, ArrowDown, Heading, Type, MousePointerClick, Image as ImageIcon, Minus, Upload, Bold, Italic, Underline, AlignLeft, AlignCenter, AlignRight, PanelBottom, Copy, Share2, X as XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { NewsletterBlock, BlockType, createBlock, uid, SOCIAL_META, SocialPlatform } from "@/lib/marketing/blocks";

const ADD_BUTTONS: { type: BlockType; label: string; Icon: typeof Heading }[] = [
  { type: "header", label: "Header", Icon: Heading },
  { type: "text", label: "Testo", Icon: Type },
  { type: "button", label: "Bottone", Icon: MousePointerClick },
  { type: "image", label: "Immagine", Icon: ImageIcon },
  { type: "separator", label: "Divider", Icon: Minus },
  { type: "footer", label: "Footer", Icon: PanelBottom },
  { type: "social", label: "Social", Icon: Share2 },
];

const FONTS = [
  { label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { label: "Helvetica", value: "Helvetica, Arial, sans-serif" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Times New Roman", value: "'Times New Roman', Times, serif" },
  { label: "Courier New", value: "'Courier New', Courier, monospace" },
  { label: "Verdana", value: "Verdana, Geneva, sans-serif" },
  { label: "Tahoma", value: "Tahoma, Geneva, sans-serif" },
  { label: "Trebuchet MS", value: "'Trebuchet MS', sans-serif" },
];

function AlignPicker({ value, onChange }: { value: "left" | "center" | "right" | undefined; onChange: (v: "left" | "center" | "right") => void }) {
  const v = value || "left";
  return (
    <div className="flex gap-1">
      {([["left", AlignLeft], ["center", AlignCenter], ["right", AlignRight]] as const).map(([k, Icon]) => (
        <Button key={k} type="button" size="icon" variant={v === k ? "default" : "outline"} className="h-7 w-7" onClick={() => onChange(k)} title={k}>
          <Icon className="w-3 h-3" />
        </Button>
      ))}
    </div>
  );
}

export function NewsletterBlockEditor({ blocks, onChange }: { blocks: NewsletterBlock[]; onChange: (b: NewsletterBlock[]) => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(blocks[0]?.id ?? null);
  const textareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  const update = (id: string, patch: Partial<NewsletterBlock>) =>
    onChange(blocks.map((b) => (b.id === id ? ({ ...b, ...patch } as NewsletterBlock) : b)));

  const remove = (id: string) => onChange(blocks.filter((b) => b.id !== id));

  const duplicate = (id: string) => {
    const idx = blocks.findIndex((b) => b.id === id);
    if (idx < 0) return;
    const copy = { ...blocks[idx], id: uid() } as NewsletterBlock;
    const next = [...blocks.slice(0, idx + 1), copy, ...blocks.slice(idx + 1)];
    onChange(next);
    setSelectedId(copy.id);
  };

  const move = (id: string, dir: -1 | 1) => {
    const idx = blocks.findIndex((b) => b.id === id);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= blocks.length) return;
    const next = [...blocks];
    [next[idx], next[target]] = [next[target], next[idx]];
    onChange(next);
  };

  const add = (type: BlockType) => {
    const b = createBlock(type);
    onChange([...blocks, b]);
    setSelectedId(b.id);
  };

  const wrapSelection = (id: string, current: string, marker: string, markerEnd?: string) => {
    const ta = textareaRefs.current[id];
    const end = markerEnd ?? marker;
    if (!ta) {
      update(id, { content: current + marker + "testo" + end } as any);
      return;
    }
    const start = ta.selectionStart ?? current.length;
    const finish = ta.selectionEnd ?? current.length;
    const sel = current.slice(start, finish) || "testo";
    const next = current.slice(0, start) + marker + sel + end + current.slice(finish);
    update(id, { content: next } as any);
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + marker.length;
      ta.setSelectionRange(pos, pos + sel.length);
    });
  };

  const uploadImage = async (id: string, file: File, field: "logoUrl" | "url") => {
    const ext = file.name.split(".").pop() || "png";
    const path = `images/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage.from("marketing-attachments").upload(path, file, { upsert: false, contentType: file.type });
    if (error) { toast.error(error.message); return; }
    const { data } = supabase.storage.from("marketing-attachments").getPublicUrl(path);
    update(id, { [field]: data.publicUrl } as any);
    toast.success("Immagine caricata");
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {ADD_BUTTONS.map(({ type, label, Icon }) => (
          <Button key={type} size="sm" variant="outline" className="gap-1 h-7 text-xs" onClick={() => add(type)}>
            <Plus className="w-3 h-3" /> <Icon className="w-3 h-3" /> {label}
          </Button>
        ))}
      </div>

      <div className="space-y-1.5">
        {blocks.length === 0 && <div className="text-xs text-muted-foreground border-2 border-dashed border-ink/15 rounded-sm p-4 text-center">Aggiungi un blocco per iniziare.</div>}
        {blocks.map((b, idx) => {
          const open = selectedId === b.id;
          return (
            <div key={b.id} className="border-2 border-ink/15 rounded-sm bg-paper">
              <div className="flex items-center justify-between gap-1 px-2 py-1 border-b border-ink/10 bg-ink/5">
                <button className="flex-1 text-left text-xs font-mono uppercase tracking-wider" onClick={() => setSelectedId(open ? null : b.id)}>
                  {idx + 1}. {b.type}
                </button>
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => move(b.id, -1)} disabled={idx === 0}><ArrowUp className="w-3 h-3" /></Button>
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => move(b.id, 1)} disabled={idx === blocks.length - 1}><ArrowDown className="w-3 h-3" /></Button>
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => duplicate(b.id)} title="Duplica"><Copy className="w-3 h-3" /></Button>
                <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => remove(b.id)}><Trash2 className="w-3 h-3" /></Button>
              </div>
              {open && (
                <div className="p-2 space-y-2 text-xs">
                  {b.type === "header" && (
                    <>
                      <div><Label className="text-[10px]">Titolo</Label><Input value={b.title} onChange={(e) => update(b.id, { title: e.target.value })} className="h-8" /></div>
                      <div><Label className="text-[10px]">Sottotitolo</Label><Input value={b.subtitle} onChange={(e) => update(b.id, { subtitle: e.target.value })} className="h-8" /></div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-[10px]">Font</Label>
                          <Select value={b.fontFamily || "Georgia, serif"} onValueChange={(v) => update(b.id, { fontFamily: v } as any)}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>{FONTS.map((f) => <SelectItem key={f.value} value={f.value} className="text-xs">{f.label}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                        <div><Label className="text-[10px]">Dimensione (px)</Label><Input type="number" min={10} max={60} value={b.fontSize ?? 22} onChange={(e) => update(b.id, { fontSize: Number(e.target.value) || 22 } as any)} className="h-8" /></div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 items-end">
                        <div><Label className="text-[10px]">Allineamento</Label><AlignPicker value={b.align} onChange={(v) => update(b.id, { align: v } as any)} /></div>
                        <div><Label className="text-[10px]">Logo (px)</Label><Input type="number" min={16} max={200} value={b.logoSize ?? 48} onChange={(e) => update(b.id, { logoSize: Number(e.target.value) || 48 } as any)} className="h-8" /></div>
                        <div><Label className="text-[10px]">Padding V (px)</Label><Input type="number" min={0} max={120} value={b.paddingY ?? 24} onChange={(e) => update(b.id, { paddingY: Number(e.target.value) || 0 } as any)} className="h-8" /></div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div><Label className="text-[10px]">Bg</Label><Input type="color" value={b.bgColor} onChange={(e) => update(b.id, { bgColor: e.target.value })} className="h-8 w-full" /></div>
                        <div><Label className="text-[10px]">Testo</Label><Input type="color" value={b.titleColor} onChange={(e) => update(b.id, { titleColor: e.target.value })} className="h-8 w-full" /></div>
                      </div>
                      <div>
                        <Label className="text-[10px]">Logo URL</Label>
                        <Input value={b.logoUrl} onChange={(e) => update(b.id, { logoUrl: e.target.value })} className="h-8" placeholder="https://..." />
                        <label className="inline-flex items-center gap-1 mt-1 text-[11px] cursor-pointer text-primary">
                          <Upload className="w-3 h-3" /> Carica logo
                          <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadImage(b.id, f, "logoUrl"); }} />
                        </label>
                      </div>
                    </>
                  )}
                  {b.type === "text" && (
                    <div>
                      <div className="grid grid-cols-2 gap-2 mb-2">
                        <div>
                          <Label className="text-[10px]">Font</Label>
                          <Select value={b.fontFamily || "Arial, Helvetica, sans-serif"} onValueChange={(v) => update(b.id, { fontFamily: v } as any)}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>{FONTS.map((f) => <SelectItem key={f.value} value={f.value} className="text-xs">{f.label}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                        <div><Label className="text-[10px]">Dimensione (px)</Label><Input type="number" min={10} max={40} value={b.fontSize ?? 15} onChange={(e) => update(b.id, { fontSize: Number(e.target.value) || 15 } as any)} className="h-8" /></div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 mb-2 items-end">
                        <div><Label className="text-[10px]">Allineamento</Label><AlignPicker value={b.align} onChange={(v) => update(b.id, { align: v } as any)} /></div>
                        <div><Label className="text-[10px]">Padding V (px)</Label><Input type="number" min={0} max={80} value={b.paddingY ?? 20} onChange={(e) => update(b.id, { paddingY: Number(e.target.value) || 0 } as any)} className="h-8" /></div>
                      </div>
                      <div className="flex gap-1 mb-1">
                        <Button type="button" size="icon" variant="outline" className="h-7 w-7" onClick={() => wrapSelection(b.id, b.content, "**")} title="Grassetto"><Bold className="w-3 h-3" /></Button>
                        <Button type="button" size="icon" variant="outline" className="h-7 w-7" onClick={() => wrapSelection(b.id, b.content, "*")} title="Corsivo"><Italic className="w-3 h-3" /></Button>
                        <Button type="button" size="icon" variant="outline" className="h-7 w-7" onClick={() => wrapSelection(b.id, b.content, "__")} title="Sottolineato"><Underline className="w-3 h-3" /></Button>
                      </div>
                      <Label className="text-[10px]">Contenuto (riga vuota = nuovo paragrafo)</Label>
                      <Textarea ref={(el) => { textareaRefs.current[b.id] = el; }} value={b.content} onChange={(e) => update(b.id, { content: e.target.value })} rows={6} className="text-xs" />
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Merge tag: <span className="font-mono">*|FNAME|*</span> <span className="font-mono">*|LNAME|*</span> · Format: <span className="font-mono">**grassetto**</span> <span className="font-mono">*corsivo*</span> <span className="font-mono">__sottolineato__</span>
                      </p>
                    </div>
                  )}
                  {b.type === "button" && (
                    <>
                      <div><Label className="text-[10px]">Etichetta</Label><Input value={b.label} onChange={(e) => update(b.id, { label: e.target.value })} className="h-8" /></div>
                      <div><Label className="text-[10px]">URL</Label><Input value={b.url} onChange={(e) => update(b.id, { url: e.target.value })} className="h-8" placeholder="https://..." /></div>
                      <div className="grid grid-cols-3 gap-2">
                        <div><Label className="text-[10px]">Colore</Label><Input type="color" value={b.color} onChange={(e) => update(b.id, { color: e.target.value })} className="h-8 w-full" /></div>
                        <div className="col-span-1">
                          <Label className="text-[10px]">Font</Label>
                          <Select value={b.fontFamily || "Arial, Helvetica, sans-serif"} onValueChange={(v) => update(b.id, { fontFamily: v } as any)}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>{FONTS.map((f) => <SelectItem key={f.value} value={f.value} className="text-xs">{f.label}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                        <div><Label className="text-[10px]">Dim. (px)</Label><Input type="number" min={10} max={28} value={b.fontSize ?? 15} onChange={(e) => update(b.id, { fontSize: Number(e.target.value) || 15 } as any)} className="h-8" /></div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 items-end">
                        <div><Label className="text-[10px]">Allineamento</Label><AlignPicker value={b.align} onChange={(v) => update(b.id, { align: v } as any)} /></div>
                        <div><Label className="text-[10px]">Padding X (px)</Label><Input type="number" min={4} max={80} value={b.paddingX ?? 28} onChange={(e) => update(b.id, { paddingX: Number(e.target.value) || 28 } as any)} className="h-8" /></div>
                        <div><Label className="text-[10px]">Padding Y (px)</Label><Input type="number" min={4} max={40} value={b.paddingYBtn ?? 12} onChange={(e) => update(b.id, { paddingYBtn: Number(e.target.value) || 12 } as any)} className="h-8" /></div>
                      </div>
                    </>
                  )}
                  {b.type === "image" && (
                    <>
                      <div><Label className="text-[10px]">URL immagine</Label><Input value={b.url} onChange={(e) => update(b.id, { url: e.target.value })} className="h-8" placeholder="https://..." /></div>
                      <div><Label className="text-[10px]">Testo alt</Label><Input value={b.alt} onChange={(e) => update(b.id, { alt: e.target.value })} className="h-8" /></div>
                      <div className="grid grid-cols-3 gap-2 items-end">
                        <div><Label className="text-[10px]">Larghezza (%)</Label><Input type="number" min={10} max={100} value={b.width ?? 100} onChange={(e) => update(b.id, { width: Number(e.target.value) || 100 } as any)} className="h-8" /></div>
                        <div><Label className="text-[10px]">Allineamento</Label><AlignPicker value={b.align} onChange={(v) => update(b.id, { align: v } as any)} /></div>
                        <div><Label className="text-[10px]">Padding V (px)</Label><Input type="number" min={0} max={80} value={b.paddingY ?? 8} onChange={(e) => update(b.id, { paddingY: Number(e.target.value) || 0 } as any)} className="h-8" /></div>
                      </div>
                      <label className="inline-flex items-center gap-1 text-[11px] cursor-pointer text-primary">
                        <Upload className="w-3 h-3" /> Carica immagine
                        <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadImage(b.id, f, "url"); }} />
                      </label>
                    </>
                  )}
                  {b.type === "separator" && (
                    <div className="grid grid-cols-3 gap-2 items-end">
                      <div><Label className="text-[10px]">Spessore (px)</Label><Input type="number" min={1} max={20} value={b.thickness ?? 1} onChange={(e) => update(b.id, { thickness: Number(e.target.value) || 1 } as any)} className="h-8" /></div>
                      <div><Label className="text-[10px]">Padding V (px)</Label><Input type="number" min={0} max={80} value={b.paddingY ?? 8} onChange={(e) => update(b.id, { paddingY: Number(e.target.value) || 0 } as any)} className="h-8" /></div>
                      <div><Label className="text-[10px]">Colore</Label><Input type="color" value={b.color || "#e5e5e5"} onChange={(e) => update(b.id, { color: e.target.value } as any)} className="h-8 w-full" /></div>
                    </div>
                  )}
                  {b.type === "social" && (
                    <>
                      <div className="grid grid-cols-4 gap-2">
                        <div><Label className="text-[10px]">Dim. (px)</Label><Input type="number" min={16} max={64} value={b.iconSize ?? 32} onChange={(e) => update(b.id, { iconSize: Number(e.target.value) || 32 } as any)} className="h-8" /></div>
                        <div><Label className="text-[10px]">Spazio (px)</Label><Input type="number" min={0} max={40} value={b.gap ?? 12} onChange={(e) => update(b.id, { gap: Number(e.target.value) || 0 } as any)} className="h-8" /></div>
                        <div><Label className="text-[10px]">Colore</Label><Input type="color" value={b.color || "#0e6e7a"} onChange={(e) => update(b.id, { color: e.target.value } as any)} className="h-8 w-full" /></div>
                        <div><Label className="text-[10px]">Padding V</Label><Input type="number" min={0} max={60} value={b.paddingY ?? 16} onChange={(e) => update(b.id, { paddingY: Number(e.target.value) || 0 } as any)} className="h-8" /></div>
                      </div>
                      <div><Label className="text-[10px]">Allineamento</Label><AlignPicker value={b.align} onChange={(v) => update(b.id, { align: v } as any)} /></div>
                      <div className="space-y-1">
                        <Label className="text-[10px]">Icone</Label>
                        {(b.items || []).map((it, i) => (
                          <div key={i} className="flex gap-1 items-center">
                            <Select value={it.platform} onValueChange={(v) => { const items = [...b.items]; items[i] = { ...items[i], platform: v as SocialPlatform }; update(b.id, { items } as any); }}>
                              <SelectTrigger className="h-8 text-xs w-32"><SelectValue /></SelectTrigger>
                              <SelectContent>{(Object.keys(SOCIAL_META) as SocialPlatform[]).map((p) => <SelectItem key={p} value={p} className="text-xs">{SOCIAL_META[p].label}</SelectItem>)}</SelectContent>
                            </Select>
                            <Input value={it.url} onChange={(e) => { const items = [...b.items]; items[i] = { ...items[i], url: e.target.value }; update(b.id, { items } as any); }} className="h-8 flex-1" placeholder={SOCIAL_META[it.platform].urlPrefix + "..."} />
                            <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => { const items = b.items.filter((_, j) => j !== i); update(b.id, { items } as any); }}><XIcon className="w-3 h-3" /></Button>
                          </div>
                        ))}
                        <Button type="button" size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => update(b.id, { items: [...(b.items || []), { platform: "whatsapp", url: "" }] } as any)}>
                          <Plus className="w-3 h-3" /> Aggiungi icona
                        </Button>
                      </div>
                    </>
                  )}
                  {b.type === "footer" && (
                    <>
                      <div><Label className="text-[10px]">Nome azienda</Label><Input value={b.companyName} onChange={(e) => update(b.id, { companyName: e.target.value } as any)} className="h-8" /></div>
                      <div><Label className="text-[10px]">Indirizzo / P.IVA</Label><Textarea value={b.address} onChange={(e) => update(b.id, { address: e.target.value } as any)} rows={2} className="text-xs" /></div>
                      <div><Label className="text-[10px]">Riga extra (opzionale)</Label><Textarea value={b.extra || ""} onChange={(e) => update(b.id, { extra: e.target.value } as any)} rows={2} className="text-xs" /></div>
                      <div className="grid grid-cols-3 gap-2">
                        <div><Label className="text-[10px]">Sfondo</Label><Input type="color" value={b.bgColor} onChange={(e) => update(b.id, { bgColor: e.target.value } as any)} className="h-8 w-full" /></div>
                        <div><Label className="text-[10px]">Testo</Label><Input type="color" value={b.textColor} onChange={(e) => update(b.id, { textColor: e.target.value } as any)} className="h-8 w-full" /></div>
                        <div><Label className="text-[10px]">Link</Label><Input type="color" value={b.linkColor} onChange={(e) => update(b.id, { linkColor: e.target.value } as any)} className="h-8 w-full" /></div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-[10px]">Font</Label>
                          <Select value={b.fontFamily || "Arial, Helvetica, sans-serif"} onValueChange={(v) => update(b.id, { fontFamily: v } as any)}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>{FONTS.map((f) => <SelectItem key={f.value} value={f.value} className="text-xs">{f.label}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                        <div><Label className="text-[10px]">Dimensione (px)</Label><Input type="number" min={9} max={20} value={b.fontSize ?? 11} onChange={(e) => update(b.id, { fontSize: Number(e.target.value) || 11 } as any)} className="h-8" /></div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 items-end">
                        <div><Label className="text-[10px]">Allineamento</Label><AlignPicker value={b.align} onChange={(v) => update(b.id, { align: v } as any)} /></div>
                        <div><Label className="text-[10px]">Padding V (px)</Label><Input type="number" min={0} max={60} value={b.paddingY ?? 18} onChange={(e) => update(b.id, { paddingY: Number(e.target.value) || 0 } as any)} className="h-8" /></div>
                      </div>
                      <label className="inline-flex items-center gap-2 text-[11px] cursor-pointer">
                        <input type="checkbox" checked={b.showUnsubscribe !== false} onChange={(e) => update(b.id, { showUnsubscribe: e.target.checked } as any)} />
                        Mostra link "Disiscriviti / Aggiorna preferenze" (richiesto per legge)
                      </label>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}