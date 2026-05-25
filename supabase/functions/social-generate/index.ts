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
    const { product, mode = 'all', tone = 'professionale', extraPrompt = '' } = body as {
      product: { name: string; short_description?: string; description?: string; categories?: string[]; images?: { src: string; alt?: string }[]; permalink?: string };
      mode?: 'caption' | 'image' | 'all';
      tone?: string;
      extraPrompt?: string;
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
    let imageDataUrl = '';

    // 1) Caption + hashtags
    if (mode === 'caption' || mode === 'all') {
      const sysPrompt = `Sei un social media manager italiano per Tecnofra, azienda di allestimenti tecnici, stampa e laboratorio teatrale. Crea contenuti per Instagram e Facebook che vanno bene per entrambi (massimo 2200 caratteri). Tono: ${tone}. Coerenza di brand: serio, competente, italiano, mai emoji eccessive (max 3-4). Rispondi SOLO con JSON valido nella forma {"caption":"...","hashtags":["tag1","tag2",...]}. Gli hashtag senza # e in minuscolo, da 15 a 25, mix di brand (tecnofra, allestimenti, palcoscenico), categoria prodotto e generici di settore.`;
      const userPrompt = `${productCtx}\n\n${extraPrompt ? `Indicazioni extra: ${extraPrompt}\n\n` : ''}Genera caption + hashtags.`;

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
      } catch {
        caption = j.choices?.[0]?.message?.content ?? '';
      }
    }

    // 2) Image generation (square 1080x1080 brand)
    if (mode === 'image' || mode === 'all') {
      const brandPrompt = `Crea un'immagine quadrata 1:1, alta qualità fotografica, del prodotto "${product.name}" per un post social. Sfondo nero #000000 pulito o leggero gradiente scuro, illuminazione studio drammatica, accento luminoso turchese-petrolio #00A3AC come luce di contorno o riflesso. Il prodotto è il SOGGETTO PRINCIPALE centrato e ben visibile, occupa circa il 70% dell'inquadratura, lasciando ~20% di spazio vuoto in basso per testo sovrapposto in post-produzione. NIENTE TESTO, NIENTE SCRITTE, NIENTE LOGHI, NIENTE WATERMARK nell'immagine. Look premium, industriale, tecnico, professionale. ${extraPrompt}`;

      const imgReq: any = {
        model: 'google/gemini-3.1-flash-image-preview',
        messages: [
          {
            role: 'user',
            content: product.images?.[0]?.src
              ? [
                  { type: 'text', text: brandPrompt + ' Usa l\'immagine fornita del prodotto come riferimento.' },
                  { type: 'image_url', image_url: { url: product.images[0].src } },
                ]
              : brandPrompt,
          },
        ],
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

    return new Response(JSON.stringify({ caption, hashtags, imageDataUrl }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e instanceof Error ? e.message : e) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
