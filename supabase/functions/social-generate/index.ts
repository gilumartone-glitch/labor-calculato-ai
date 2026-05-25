import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const AI_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: 'LOVABLE_API_KEY mancante' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const body = await req.json();
    const { product, mode = 'all', tone = 'professionale', extraPrompt = '', background = 'scene' } = body as {
      product: { name: string; short_description?: string; description?: string; categories?: string[]; images?: { src: string; alt?: string }[]; permalink?: string };
      mode?: 'caption' | 'image' | 'all';
      tone?: string;
      extraPrompt?: string;
      background?: 'scene' | 'clean' | 'editorial';
    };

    if (!product?.name) {
      return new Response(JSON.stringify({ error: 'Prodotto mancante' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const productCtx = `Prodotto: ${product.name}
Categorie: ${(product.categories || []).join(', ')}
Descrizione breve: ${product.short_description || ''}
Descrizione: ${(product.description || '').slice(0, 1500)}`;

    let caption = '';
    let hashtags: string[] = [];
    let headline = '';
    let headlineAccent = '';
    let subtitle = '';
    let cta = '';
    let imageDataUrl = '';

    // 1) Caption + hashtags + editorial copy (headline, accent word, italic subtitle, CTA)
    if (mode === 'caption' || mode === 'all') {
      const sysPrompt = `Sei il social media manager italiano di Tecnofra (allestimenti tecnici, palcoscenico, laboratorio). Stile brand: serio, competente, leggermente provocatorio nei titoli. Rispondi SOLO con JSON: {"caption":"...","hashtags":["..."],"headline":"FRASE TUTTA MAIUSCOLA BREVE (max 6 parole) AD EFFETTO","headlineAccent":"UNA SOLA PAROLA della headline da evidenziare in turchese","subtitle":"sottotitolo italico breve di 3-7 parole, in minuscolo, evocativo (es. 'quella giusta... no.')","cta":"call to action breve in maiuscolo per la barra inferiore (max 8 parole, es. 'CONSULENZA GRATUITA PER LA SCELTA DELLA RUOTA')"}. caption max 2200 char, hashtag 15-25 senza # in minuscolo. headlineAccent DEVE essere una parola presente in headline. Tono: ${tone}.`;
      const userPrompt = `${productCtx}\n\n${extraPrompt ? `Indicazioni extra: ${extraPrompt}\n\n` : ''}Genera caption + hashtag + headline editoriale + sottotitolo + CTA per post Instagram/Facebook stile Tecnofra.`;

      const r = await fetch(AI_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages: [{ role: 'system', content: sysPrompt }, { role: 'user', content: userPrompt }],
          response_format: { type: 'json_object' },
        }),
      });
      if (!r.ok) {
        const t = await r.text();
        return new Response(JSON.stringify({ error: `AI caption ${r.status}`, detail: t.slice(0, 400) }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      const j = await r.json();
      try {
        const parsed = JSON.parse(j.choices?.[0]?.message?.content ?? '{}');
        caption = parsed.caption ?? '';
        hashtags = Array.isArray(parsed.hashtags) ? parsed.hashtags.map((h: string) => String(h).replace(/^#/, '').toLowerCase()) : [];
        headline = String(parsed.headline ?? '').toUpperCase();
        headlineAccent = String(parsed.headlineAccent ?? '').toUpperCase();
        subtitle = String(parsed.subtitle ?? '');
        cta = String(parsed.cta ?? '').toUpperCase();
      } catch {
        caption = j.choices?.[0]?.message?.content ?? '';
      }
    }

    // 2) Image generation (square 1080x1080 brand)
    if ((mode === 'image' || mode === 'all') && background === 'scene') {
      const brandPrompt = `Crea uno SFONDO/AMBIENTAZIONE quadrato 1:1 per un post social Tecnofra. Sfondo nero #000000 dominante con leggero gradiente, accenti luminosi turchese-petrolio #00A3AC (linee, bagliori, particolato, luce di scena). Atmosfera: palcoscenico/laboratorio tecnico industriale premium, luci di scena, profondità. IMPORTANTE: scena VUOTA, NIENTE prodotti, NIENTE oggetti centrali, NIENTE persone, NIENTE testo, NIENTE loghi, NIENTE watermark. Solo ambientazione di sfondo elegante con ampio spazio centrale libero dove verrà sovrapposto un prodotto in post-produzione. Look cinematografico, professionale. ${extraPrompt}`;




      const imgReq: any = {
        model: 'google/gemini-3.1-flash-image-preview',
        messages: [{ role: 'user', content: brandPrompt }],
        modalities: ['image', 'text'],
      };

      const r = await fetch(AI_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(imgReq),
      });
      if (!r.ok) {
        const t = await r.text();
        return new Response(JSON.stringify({ error: `AI image ${r.status}`, detail: t.slice(0, 400), caption, hashtags }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      const j = await r.json();
      const msg = j.choices?.[0]?.message;
      const imgs = msg?.images || [];
      if (imgs.length > 0) {
        imageDataUrl = imgs[0]?.image_url?.url || '';
      } else if (Array.isArray(msg?.content)) {
        const imgPart = msg.content.find((c: any) => c.type === 'image_url' || c.type === 'output_image' || c.type === 'image');
        imageDataUrl = imgPart?.image_url?.url || imgPart?.image_url || imgPart?.image || '';
      }
      if (!imageDataUrl) {
        console.log('AI image: nessuna immagine nella risposta', JSON.stringify(j).slice(0, 800));
        return new Response(JSON.stringify({ error: 'AI non ha restituito immagini', detail: JSON.stringify(j).slice(0, 400), caption, hashtags }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    return new Response(JSON.stringify({ caption, hashtags, imageDataUrl, headline, headlineAccent, subtitle, cta }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e instanceof Error ? e.message : e) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
