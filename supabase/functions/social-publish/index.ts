import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Publish 1 or more 1080x1080 images (data URLs) to Facebook Page + Instagram Business as a single post / carousel.
// Requires secrets: META_PAGE_ID, META_PAGE_ACCESS_TOKEN, META_IG_BUSINESS_ID
// Images are uploaded to the public `marketing-attachments` bucket to get public URLs (Meta requires public URLs).

const GRAPH = 'https://graph.facebook.com/v21.0';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const PAGE_ID = Deno.env.get('META_PAGE_ID');
    const TOKEN = Deno.env.get('META_PAGE_ACCESS_TOKEN');
    const IG_ID = Deno.env.get('META_IG_BUSINESS_ID');
    if (!PAGE_ID || !TOKEN || !IG_ID) {
      return new Response(JSON.stringify({ error: 'Configurare i secret META_PAGE_ID, META_PAGE_ACCESS_TOKEN, META_IG_BUSINESS_ID' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { slides, caption, targets = ['facebook', 'instagram'] } = await req.json() as {
      slides: string[]; // data URLs
      caption: string;
      targets?: ('facebook' | 'instagram')[];
    };
    if (!slides?.length) return new Response(JSON.stringify({ error: 'Nessuna slide' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // 1) upload each slide → public URL
    const publicUrls: string[] = [];
    for (let i = 0; i < slides.length; i++) {
      const dataUrl = slides[i];
      const m = dataUrl.match(/^data:(.+);base64,(.+)$/);
      if (!m) throw new Error('Slide non valida (atteso data URL)');
      const mime = m[1];
      const bin = atob(m[2]);
      const buf = new Uint8Array(bin.length);
      for (let k = 0; k < bin.length; k++) buf[k] = bin.charCodeAt(k);
      const path = `social/${Date.now()}-${i}.png`;
      const up = await supabase.storage.from('marketing-attachments').upload(path, buf, { contentType: mime, upsert: true });
      if (up.error) throw new Error('Upload storage: ' + up.error.message);
      const { data: pub } = supabase.storage.from('marketing-attachments').getPublicUrl(path);
      publicUrls.push(pub.publicUrl);
    }

    const results: any = { facebook: null, instagram: null };

    // 2) Facebook
    if (targets.includes('facebook')) {
      if (publicUrls.length === 1) {
        const r = await fetch(`${GRAPH}/${PAGE_ID}/photos?access_token=${TOKEN}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: publicUrls[0], caption }),
        });
        results.facebook = await r.json();
      } else {
        // upload each as unpublished, then create a feed post linking them
        const mediaIds: string[] = [];
        for (const u of publicUrls) {
          const r = await fetch(`${GRAPH}/${PAGE_ID}/photos?access_token=${TOKEN}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: u, published: false }),
          });
          const j = await r.json();
          if (!r.ok) throw new Error('FB upload: ' + JSON.stringify(j));
          mediaIds.push(j.id);
        }
        const r = await fetch(`${GRAPH}/${PAGE_ID}/feed?access_token=${TOKEN}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: caption,
            attached_media: mediaIds.map((id) => ({ media_fbid: id })),
          }),
        });
        results.facebook = await r.json();
      }
    }

    // 3) Instagram
    if (targets.includes('instagram')) {
      if (publicUrls.length === 1) {
        const c = await fetch(`${GRAPH}/${IG_ID}/media?access_token=${TOKEN}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_url: publicUrls[0], caption }),
        }).then((r) => r.json());
        if (!c.id) throw new Error('IG container: ' + JSON.stringify(c));
        const pub = await fetch(`${GRAPH}/${IG_ID}/media_publish?access_token=${TOKEN}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ creation_id: c.id }),
        }).then((r) => r.json());
        results.instagram = pub;
      } else {
        const children: string[] = [];
        for (const u of publicUrls) {
          const c = await fetch(`${GRAPH}/${IG_ID}/media?access_token=${TOKEN}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image_url: u, is_carousel_item: true }),
          }).then((r) => r.json());
          if (!c.id) throw new Error('IG carousel item: ' + JSON.stringify(c));
          children.push(c.id);
        }
        const carousel = await fetch(`${GRAPH}/${IG_ID}/media?access_token=${TOKEN}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ media_type: 'CAROUSEL', children, caption }),
        }).then((r) => r.json());
        if (!carousel.id) throw new Error('IG carousel: ' + JSON.stringify(carousel));
        const pub = await fetch(`${GRAPH}/${IG_ID}/media_publish?access_token=${TOKEN}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ creation_id: carousel.id }),
        }).then((r) => r.json());
        results.instagram = pub;
      }
    }

    return new Response(JSON.stringify({ ok: true, urls: publicUrls, results }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e instanceof Error ? e.message : e) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
