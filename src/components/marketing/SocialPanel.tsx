import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, Search, Sparkles, Download, Copy, RefreshCw, Image as ImageIcon, ExternalLink, Plus, X, Send, Facebook, Instagram } from "lucide-react";
import { toast } from "sonner";

type WooProduct = {
  id: number;
  name: string;
  permalink: string;
  short_description: string;
  description: string;
  images: { src: string; alt?: string }[];
  categories: string[];
  tags: string[];
};

type Slide = { id: string; productId: number; productName: string; dataUrl: string; style: "scene" | "clean" };

export const SocialPanel = () => {
  const [search, setSearch] = useState("");
  const [products, setProducts] = useState<WooProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<WooProduct | null>(null);
  const [loadError, setLoadError] = useState("");
  const [tone, setTone] = useState("professionale, italiano, competente");
  const [extra, setExtra] = useState("");
  const [style, setStyle] = useState<"scene" | "clean" | "editorial">("editorial");
  const [generating, setGenerating] = useState<null | "caption" | "image" | "all">(null);
  const [caption, setCaption] = useState("");
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [imageDataUrl, setImageDataUrl] = useState("");
  const [headline, setHeadline] = useState("LA RUOTA SBAGLIATA SI SENTE.");
  const [headlineAccent, setHeadlineAccent] = useState("SBAGLIATA");
  const [subtitle, setSubtitle] = useState("Quella giusta… no.");
  const [ctaText, setCtaText] = useState("CONSULENZA GRATUITA");
  const [carousel, setCarousel] = useState<Slide[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [targets, setTargets] = useState<{ fb: boolean; ig: boolean }>({ fb: true, ig: true });

  const loadProducts = async (q = "") => {
    setLoading(true);
    setLoadError("");
    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/woo-products${q ? `?search=${encodeURIComponent(q)}` : ""}`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`, apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY } });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Errore caricamento prodotti");
      setProducts(Array.isArray(j) ? j : Array.isArray(j.products) ? j.products : []);
      if (!Array.isArray(j) && j.warning) setLoadError(j.warning);
    } catch (e: any) {
      const message = e.message || "Errore";
      setLoadError(message);
      setProducts([]);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadProducts(); }, []);

  const loadImg = (src: string): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("img load fail: " + src));
      img.src = src;
    });

  // Brand colors: primary turquoise 0,163,172 (#00A3AC), secondary black, tertiary white
  const composeBrandedImage = async (bgUrl: string, productImgUrl: string, productName: string, mode: "scene" | "clean"): Promise<string> => {
    const SIZE = 1080;
    const canvas = document.createElement("canvas");
    canvas.width = SIZE; canvas.height = SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas non disponibile");

    if (mode === "scene") {
      try {
        const bg = await loadImg(bgUrl);
        const ratio = Math.max(SIZE / bg.width, SIZE / bg.height);
        const w = bg.width * ratio, h = bg.height * ratio;
        ctx.drawImage(bg, (SIZE - w) / 2, (SIZE - h) / 2, w, h);
      } catch {
        ctx.fillStyle = "#000000"; ctx.fillRect(0, 0, SIZE, SIZE);
      }
    } else {
      // CLEAN: white bg with diagonal turquoise stripes top-right + black footer band
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, SIZE, SIZE);
      // diagonal turquoise stripes in top-right corner
      ctx.save();
      ctx.fillStyle = "#00A3AC";
      ctx.translate(SIZE, 0);
      ctx.rotate(Math.PI / 4);
      for (let i = 0; i < 6; i++) ctx.fillRect(-200 + i * 60, -300, 24, 600);
      ctx.restore();
      // black bottom band
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, SIZE - 260, SIZE, 260);
      // turquoise top divider on band
      ctx.fillStyle = "#00A3AC";
      ctx.fillRect(0, SIZE - 264, SIZE, 4);
    }

    // product photo (original, untouched)
    try {
      const prod = await loadImg(productImgUrl);
      const targetBox = SIZE * (mode === "clean" ? 0.58 : 0.62);
      const r = Math.min(targetBox / prod.width, targetBox / prod.height);
      const pw = prod.width * r, ph = prod.height * r;
      const px = (SIZE - pw) / 2;
      const py = (mode === "clean" ? (SIZE - 260) / 2 - ph / 2 + 40 : (SIZE - ph) / 2 - 40);
      if (mode === "scene") {
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.beginPath();
        ctx.ellipse(SIZE / 2, py + ph + 30, pw / 2.2, 24, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.drawImage(prod, px, py, pw, ph);
    } catch (e) { console.warn("product image fail", e); }

    // logo top-left
    try {
      const logo = await loadImg("/tecnofra-logo.ico");
      const lh = mode === "clean" ? 80 : 72;
      const lw = (logo.width / logo.height) * lh;
      ctx.drawImage(logo, 48, 48, lw, lh);
    } catch {
      ctx.fillStyle = mode === "clean" ? "#000000" : "#00A3AC";
      ctx.font = "800 32px Inter, system-ui, sans-serif";
      ctx.textBaseline = "top";
      ctx.fillText("TECNOFRA", 48, 60);
    }

    // bottom: product name
    if (mode === "scene") {
      const grad = ctx.createLinearGradient(0, SIZE - 320, 0, SIZE);
      grad.addColorStop(0, "rgba(0,0,0,0)");
      grad.addColorStop(1, "rgba(0,0,0,0.95)");
      ctx.fillStyle = grad; ctx.fillRect(0, SIZE - 320, SIZE, 320);
      ctx.fillStyle = "#00A3AC"; ctx.fillRect(50, SIZE - 170, 80, 5);
    }

    const drawWrapped = (text: string, x: number, y: number, maxW: number, lineH: number, maxLines: number) => {
      const words = text.toUpperCase().split(" ");
      let line = ""; const lines: string[] = [];
      for (const w of words) {
        const test = line ? line + " " + w : w;
        if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
      }
      if (line) lines.push(line);
      const shown = lines.slice(0, maxLines);
      if (lines.length > maxLines) shown[maxLines - 1] = shown[maxLines - 1].replace(/.{0,3}$/, "…");
      shown.forEach((l, i) => ctx.fillText(l, x, y + i * lineH));
    };

    ctx.fillStyle = "#FFFFFF";
    ctx.textBaseline = "top";
    ctx.font = `800 ${mode === "clean" ? 48 : 54}px Inter, system-ui, sans-serif`;
    drawWrapped(productName, 50, mode === "clean" ? SIZE - 200 : SIZE - 150, SIZE - 100, mode === "clean" ? 56 : 62, 2);

    return canvas.toDataURL("image/png");
  };

  const generate = async (mode: "caption" | "image" | "all") => {
    if (!selected) return toast.error("Seleziona un prodotto");
    setGenerating(mode);
    try {
      const { data, error } = await supabase.functions.invoke("social-generate", {
        body: { product: selected, mode, tone, extraPrompt: extra, background: style },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (mode !== "image") {
        setCaption(data.caption || "");
        setHashtags(data.hashtags || []);
      }
      if (mode !== "caption") {
        try {
          const branded = await composeBrandedImage(data.imageDataUrl || "", selected.images?.[0]?.src || "", selected.name, style);
          setImageDataUrl(branded);
        } catch (err: any) {
          console.error(err);
          toast.warning("Overlay non riuscito: " + (err.message || ""));
        }
      }
      toast.success("Generato");
    } catch (e: any) {
      toast.error(e.message || "Errore generazione");
    } finally {
      setGenerating(null);
    }
  };

  const addToCarousel = () => {
    if (!imageDataUrl || !selected) return toast.error("Genera prima un'immagine");
    setCarousel((c) => [...c, { id: crypto.randomUUID(), productId: selected.id, productName: selected.name, dataUrl: imageDataUrl, style }]);
    toast.success(`Slide ${carousel.length + 1} aggiunta`);
  };
  const removeFromCarousel = (id: string) => setCarousel((c) => c.filter((s) => s.id !== id));

  const fullCaption = caption + (hashtags.length ? "\n\n" + hashtags.map((h) => `#${h}`).join(" ") : "");
  const copyAll = () => { navigator.clipboard.writeText(fullCaption); toast.success("Caption copiata"); };
  const downloadImage = () => {
    if (!imageDataUrl) return;
    const a = document.createElement("a");
    a.href = imageDataUrl; a.download = `tecnofra-${selected?.id || "post"}.png`; a.click();
  };

  const publish = async () => {
    const slidesToPublish = carousel.length > 0 ? carousel.map((s) => s.dataUrl) : (imageDataUrl ? [imageDataUrl] : []);
    if (!slidesToPublish.length) return toast.error("Nessuna immagine da pubblicare");
    if (!fullCaption.trim()) return toast.error("Caption mancante");
    if (!targets.fb && !targets.ig) return toast.error("Seleziona almeno un canale");
    setPublishing(true);
    try {
      const t: string[] = [];
      if (targets.fb) t.push("facebook");
      if (targets.ig) t.push("instagram");
      const { data, error } = await supabase.functions.invoke("social-publish", {
        body: { slides: slidesToPublish, caption: fullCaption, targets: t },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("Pubblicato!");
      console.log("publish result", data);
    } catch (e: any) {
      toast.error(e.message || "Errore pubblicazione");
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.4fr] gap-6">
      {/* LEFT — products */}
      <div className="border-2 border-ink/15 rounded-sm bg-paper p-4">
        <div className="flex items-center gap-2 mb-3">
          <Input
            placeholder="Cerca prodotto su tecnofra.it..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && loadProducts(search)}
          />
          <Button size="sm" variant="outline" onClick={() => loadProducts(search)}>
            <Search className="w-4 h-4" />
          </Button>
        </div>
        {loadError && (
          <div className="mb-3 rounded-sm border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {loadError}
          </div>
        )}
        {loading ? (
          <div className="grid place-items-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="grid grid-cols-2 gap-2 max-h-[70vh] overflow-y-auto pr-1">
            {products.map((p) => (
              <button
                key={p.id}
                onClick={() => { setSelected(p); setCaption(""); setHashtags([]); setImageDataUrl(""); }}
                className={`text-left border-2 rounded-sm overflow-hidden transition-all ${selected?.id === p.id ? "border-primary shadow-md" : "border-ink/15 hover:border-ink/40"}`}
              >
                <div className="aspect-square bg-muted overflow-hidden">
                  {p.images?.[0]?.src ? (
                    <img src={p.images[0].src} alt={p.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full grid place-items-center text-muted-foreground"><ImageIcon className="w-6 h-6" /></div>
                  )}
                </div>
                <div className="p-2">
                  <div className="text-xs font-semibold leading-tight line-clamp-2">{p.name}</div>
                  <div className="text-[10px] text-muted-foreground mt-1">{p.categories.slice(0, 2).join(" · ")}</div>
                </div>
              </button>
            ))}
            {products.length === 0 && (
              <div className="col-span-2 text-center text-sm text-muted-foreground py-8">Nessun prodotto</div>
            )}
          </div>
        )}
      </div>

      {/* RIGHT — generator */}
      <div className="space-y-4">
        {!selected ? (
          <div className="border-2 border-dashed border-ink/20 rounded-sm p-12 text-center text-muted-foreground">
            Seleziona un prodotto a sinistra per generare il post
          </div>
        ) : (
          <>
            <div className="border-2 border-ink/15 rounded-sm bg-paper p-4">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <div className="font-display text-lg font-semibold leading-tight">{selected.name}</div>
                  <a href={selected.permalink} target="_blank" rel="noreferrer" className="text-xs text-primary inline-flex items-center gap-1 hover:underline">
                    Vedi su tecnofra.it <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>

              {/* style toggle */}
              <div className="mb-3">
                <Label className="text-xs">Stile immagine</Label>
                <div className="flex gap-2 mt-1">
                  <button
                    type="button"
                    onClick={() => setStyle("clean")}
                    className={`flex-1 text-xs py-2 px-3 border-2 rounded-sm font-semibold transition ${style === "clean" ? "border-primary bg-primary/10" : "border-ink/15 hover:border-ink/40"}`}
                  >
                    Pulito (bianco/nero + colori brand)
                  </button>
                  <button
                    type="button"
                    onClick={() => setStyle("scene")}
                    className={`flex-1 text-xs py-2 px-3 border-2 rounded-sm font-semibold transition ${style === "scene" ? "border-primary bg-primary/10" : "border-ink/15 hover:border-ink/40"}`}
                  >
                    Ambientato (sfondo AI)
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Tono</Label>
                  <Input value={tone} onChange={(e) => setTone(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Indicazioni extra (opzionale)</Label>
                  <Input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="es. promozione fine stagione" />
                </div>
              </div>
              <div className="flex flex-wrap gap-2 mt-4">
                <Button onClick={() => generate("all")} disabled={!!generating} className="gap-2">
                  {generating === "all" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  Genera tutto
                </Button>
                <Button variant="outline" onClick={() => generate("caption")} disabled={!!generating} className="gap-2">
                  {generating === "caption" ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  Solo testo
                </Button>
                <Button variant="outline" onClick={() => generate("image")} disabled={!!generating} className="gap-2">
                  {generating === "image" ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
                  Solo immagine
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* image preview */}
              <div className="border-2 border-ink/15 rounded-sm bg-paper p-3">
                <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">Anteprima 1:1</div>
                <div className="aspect-square bg-black rounded-sm overflow-hidden grid place-items-center">
                  {imageDataUrl ? (
                    <img src={imageDataUrl} alt="post" className="w-full h-full object-cover" />
                  ) : (
                    <div className="text-white/40 text-xs">Nessuna immagine generata</div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <Button size="sm" variant="outline" className="gap-2" onClick={downloadImage} disabled={!imageDataUrl}>
                    <Download className="w-4 h-4" /> PNG
                  </Button>
                  <Button size="sm" variant="outline" className="gap-2" onClick={addToCarousel} disabled={!imageDataUrl}>
                    <Plus className="w-4 h-4" /> Carosello
                  </Button>
                </div>
              </div>

              {/* caption */}
              <div className="border-2 border-ink/15 rounded-sm bg-paper p-3 flex flex-col">
                <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">Caption</div>
                <Textarea
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  className="flex-1 min-h-[160px] text-sm"
                  placeholder="Caption…"
                />
                <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mt-3 mb-1">Hashtag ({hashtags.length})</div>
                <div className="flex flex-wrap gap-1 max-h-[120px] overflow-y-auto">
                  {hashtags.map((h, i) => (
                    <span key={i} className="text-[11px] bg-primary/10 text-primary px-2 py-0.5 rounded-sm font-mono">
                      #{h}
                      <button onClick={() => setHashtags((hs) => hs.filter((_, j) => j !== i))} className="ml-1 opacity-60 hover:opacity-100">×</button>
                    </span>
                  ))}
                  {hashtags.length === 0 && <span className="text-xs text-muted-foreground">Nessun hashtag</span>}
                </div>
                <Button size="sm" variant="outline" className="mt-3 gap-2" onClick={copyAll} disabled={!fullCaption}>
                  <Copy className="w-4 h-4" /> Copia caption + hashtag
                </Button>
              </div>
            </div>

            {/* CAROSELLO */}
            {carousel.length > 0 && (
              <div className="border-2 border-primary/40 rounded-sm bg-primary/5 p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-mono uppercase tracking-wider text-primary font-semibold">Carosello · {carousel.length} slide</div>
                  <Button size="sm" variant="ghost" onClick={() => setCarousel([])}>Svuota</Button>
                </div>
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {carousel.map((s, i) => (
                    <div key={s.id} className="relative shrink-0 w-24 h-24 border-2 border-ink/20 rounded-sm overflow-hidden">
                      <img src={s.dataUrl} alt={s.productName} className="w-full h-full object-cover" />
                      <div className="absolute top-0 left-0 bg-black/70 text-white text-[10px] px-1">{i + 1}</div>
                      <button onClick={() => removeFromCarousel(s.id)} className="absolute top-0 right-0 bg-destructive text-white p-0.5">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* PUBBLICA */}
            <div className="border-2 border-ink/15 rounded-sm bg-paper p-4">
              <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">Pubblica</div>
              <div className="flex flex-wrap gap-2 mb-3">
                <button
                  type="button"
                  onClick={() => setTargets((t) => ({ ...t, fb: !t.fb }))}
                  className={`flex items-center gap-2 text-xs py-2 px-3 border-2 rounded-sm font-semibold transition ${targets.fb ? "border-[#1877F2] bg-[#1877F2]/10 text-[#1877F2]" : "border-ink/15 text-muted-foreground"}`}
                >
                  <Facebook className="w-4 h-4" /> Facebook
                </button>
                <button
                  type="button"
                  onClick={() => setTargets((t) => ({ ...t, ig: !t.ig }))}
                  className={`flex items-center gap-2 text-xs py-2 px-3 border-2 rounded-sm font-semibold transition ${targets.ig ? "border-[#E4405F] bg-[#E4405F]/10 text-[#E4405F]" : "border-ink/15 text-muted-foreground"}`}
                >
                  <Instagram className="w-4 h-4" /> Instagram
                </button>
              </div>
              <Button onClick={publish} disabled={publishing} className="gap-2 w-full">
                {publishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Pubblica {carousel.length > 1 ? `carosello (${carousel.length} slide)` : "post"}
              </Button>
              <p className="text-[11px] text-muted-foreground mt-2">
                Richiede i secret <code>META_PAGE_ID</code>, <code>META_PAGE_ACCESS_TOKEN</code>, <code>META_IG_BUSINESS_ID</code>. Senza, vedrai un errore esplicito.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
