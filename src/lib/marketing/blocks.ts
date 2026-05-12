export type BlockType = "header" | "text" | "button" | "image" | "separator" | "footer" | "social";

export type Align = "left" | "center" | "right";

export type HeaderBlock = { type: "header"; id: string; title: string; subtitle: string; logoUrl: string; bgColor: string; titleColor: string; fontFamily?: string; fontSize?: number; align?: Align; logoSize?: number; paddingY?: number };
export type TextBlock = { type: "text"; id: string; content: string; fontFamily?: string; fontSize?: number; align?: Align; paddingY?: number };
export type ButtonBlock = { type: "button"; id: string; label: string; url: string; color: string; fontFamily?: string; fontSize?: number; align?: Align; paddingX?: number; paddingYBtn?: number };
export type ImageBlock = { type: "image"; id: string; url: string; alt: string; width?: number; align?: Align; paddingY?: number };
export type SeparatorBlock = { type: "separator"; id: string; thickness?: number; paddingY?: number; color?: string };
export type FooterBlock = { type: "footer"; id: string; companyName: string; address: string; extra?: string; bgColor: string; textColor: string; linkColor: string; fontSize?: number; fontFamily?: string; align?: Align; paddingY?: number; showUnsubscribe?: boolean };

export type SocialPlatform = "whatsapp" | "facebook" | "instagram" | "telegram" | "tiktok" | "youtube" | "linkedin" | "x" | "email" | "website";
export type SocialItem = { platform: SocialPlatform; url: string };
export type SocialBlock = { type: "social"; id: string; items: SocialItem[]; iconSize?: number; gap?: number; align?: Align; paddingY?: number; color?: string };

export type NewsletterBlock = HeaderBlock | TextBlock | ButtonBlock | ImageBlock | SeparatorBlock | FooterBlock | SocialBlock;

export const SOCIAL_META: Record<SocialPlatform, { label: string; slug: string; urlPrefix: string }> = {
  whatsapp: { label: "WhatsApp", slug: "whatsapp", urlPrefix: "https://wa.me/" },
  facebook: { label: "Facebook", slug: "facebook", urlPrefix: "https://facebook.com/" },
  instagram: { label: "Instagram", slug: "instagram", urlPrefix: "https://instagram.com/" },
  telegram: { label: "Telegram", slug: "telegram", urlPrefix: "https://t.me/" },
  tiktok: { label: "TikTok", slug: "tiktok", urlPrefix: "https://tiktok.com/@" },
  youtube: { label: "YouTube", slug: "youtube", urlPrefix: "https://youtube.com/@" },
  linkedin: { label: "LinkedIn", slug: "linkedin", urlPrefix: "https://linkedin.com/in/" },
  x: { label: "X / Twitter", slug: "x", urlPrefix: "https://x.com/" },
  email: { label: "Email", slug: "maildotru", urlPrefix: "mailto:" },
  website: { label: "Sito web", slug: "googlechrome", urlPrefix: "https://" },
};

const socialIconUrl = (p: SocialPlatform, color: string) => {
  const c = color.replace("#", "");
  return `https://cdn.simpleicons.org/${SOCIAL_META[p].slug}/${c}`;
};

export const uid = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `b_${Math.random().toString(36).slice(2)}_${Date.now()}`);

export function createBlock(type: BlockType): NewsletterBlock {
  const id = uid();
  switch (type) {
    case "header":
      return { type, id, title: "Tecnofra", subtitle: "Laboratorio · Stampa · Allestimenti", logoUrl: "", bgColor: "#0e6e7a", titleColor: "#ffffff", fontFamily: "Georgia, serif", fontSize: 22, align: "center", logoSize: 48, paddingY: 24 };
    case "text":
      return { type, id, content: "Ciao *|FNAME|*,\n\nScrivi qui il tuo messaggio. Lascia una riga vuota per separare i paragrafi.", fontFamily: "Arial, Helvetica, sans-serif", fontSize: 15, align: "left", paddingY: 20 };
    case "button":
      return { type, id, label: "Scopri di più", url: "https://tecnofra.it", color: "#0e6e7a", fontFamily: "Arial, Helvetica, sans-serif", fontSize: 15, align: "center", paddingX: 28, paddingYBtn: 12 };
    case "image":
      return { type, id, url: "", alt: "", width: 100, align: "center", paddingY: 8 };
    case "separator":
      return { type, id, thickness: 1, paddingY: 8, color: "#e5e5e5" };
    case "footer":
      return { type, id, companyName: "Tecnofra", address: "*|LIST:ADDRESS|*", extra: "", bgColor: "#0f172a", textColor: "#cbd5e1", linkColor: "#94a3b8", fontSize: 11, fontFamily: "Arial, Helvetica, sans-serif", align: "center", paddingY: 18, showUnsubscribe: true };
    case "social":
      return { type, id, items: [{ platform: "whatsapp", url: "https://wa.me/393331234567" }, { platform: "instagram", url: "https://instagram.com/tecnofra" }, { platform: "facebook", url: "https://facebook.com/tecnofra" }], iconSize: 32, gap: 12, align: "center", paddingY: 16, color: "#0e6e7a" };
  }
}

const esc = (s: string) => (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Trasforma marker inline in HTML: **grassetto**, __sottolineato__, *corsivo* */
function inlineFormat(s: string): string {
  let out = esc(s);
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/__([^_]+)__/g, '<span style="text-decoration:underline;">$1</span>');
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  return out;
}

export function blocksToHtml(blocks: NewsletterBlock[], opts?: { attachments?: { name: string; url: string }[] }): string {
  const inner = blocks.map((b) => {
    switch (b.type) {
      case "header":
        return `<tr><td style="background:${esc(b.bgColor)};padding:${b.paddingY ?? 24}px 32px;text-align:${b.align ?? "center"};color:${esc(b.titleColor)};">
          ${b.logoUrl ? `<img src="${esc(b.logoUrl)}" alt="" style="height:${b.logoSize ?? 48}px;margin:0 auto 12px;display:block;" />` : ""}
          <h1 style="margin:0;color:${esc(b.titleColor)};font-size:${b.fontSize ?? 22}px;letter-spacing:-0.01em;font-family:${esc(b.fontFamily || "Georgia, serif")};text-align:${b.align ?? "center"};">${inlineFormat(b.title)}</h1>
          ${b.subtitle ? `<p style="margin:6px 0 0;color:${esc(b.titleColor)};opacity:0.85;font-size:12px;text-transform:uppercase;letter-spacing:0.15em;">${esc(b.subtitle)}</p>` : ""}
        </td></tr>`;
      case "text": {
        const paragraphs = (b.content || "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
          .map((p) => `<p style="margin:0 0 16px;line-height:1.6;color:#1a1a2e;font-size:${b.fontSize ?? 15}px;font-family:${esc(b.fontFamily || "Arial, Helvetica, sans-serif")};text-align:${b.align ?? "left"};">${inlineFormat(p).replace(/\n/g, "<br/>")}</p>`).join("");
        return `<tr><td style="padding:${b.paddingY ?? 20}px 32px;">${paragraphs || '<p style="margin:0;color:#999;">…</p>'}</td></tr>`;
      }
      case "button":
        return `<tr><td style="padding:8px 32px 20px;text-align:${b.align ?? "center"};">
          <a href="${esc(b.url)}" target="_blank" style="display:inline-block;padding:${b.paddingYBtn ?? 12}px ${b.paddingX ?? 28}px;background:${esc(b.color)};color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;font-size:${b.fontSize ?? 15}px;font-family:${esc(b.fontFamily || "Arial, Helvetica, sans-serif")};">${esc(b.label)}</a>
        </td></tr>`;
      case "image":
        return b.url ? `<tr><td style="padding:${b.paddingY ?? 8}px 32px;text-align:${b.align ?? "center"};"><img src="${esc(b.url)}" alt="${esc(b.alt)}" style="width:${b.width ?? 100}%;max-width:100%;border-radius:6px;display:inline-block;margin:0;" /></td></tr>` : "";
      case "separator":
        return `<tr><td style="padding:${b.paddingY ?? 8}px 32px;"><hr style="border:none;border-top:${b.thickness ?? 1}px solid ${esc(b.color || "#e5e5e5")};margin:0;" /></td></tr>`;
      case "social": {
        const size = b.iconSize ?? 32;
        const gap = b.gap ?? 12;
        const color = b.color || "#0e6e7a";
        const icons = (b.items || []).filter((i) => i.url).map((i) => `<a href="${esc(i.url)}" target="_blank" style="display:inline-block;margin:0 ${gap / 2}px;text-decoration:none;"><img src="${esc(socialIconUrl(i.platform, color))}" alt="${esc(SOCIAL_META[i.platform].label)}" width="${size}" height="${size}" style="width:${size}px;height:${size}px;display:inline-block;border:0;" /></a>`).join("");
        return `<tr><td style="padding:${b.paddingY ?? 16}px 32px;text-align:${b.align ?? "center"};">${icons}</td></tr>`;
      }
      case "footer":
        return `<tr><td style="background:${esc(b.bgColor)};padding:${b.paddingY ?? 18}px 32px;color:${esc(b.textColor)};font-size:${b.fontSize ?? 11}px;line-height:1.6;text-align:${b.align ?? "center"};font-family:${esc(b.fontFamily || "Arial, Helvetica, sans-serif")};">
          ${b.companyName ? `<p style="margin:0 0 4px;color:#ffffff;font-weight:600;">${inlineFormat(b.companyName)}</p>` : ""}
          ${b.address ? `<p style="margin:0 0 8px;">${inlineFormat(b.address).replace(/\n/g, "<br/>")}</p>` : ""}
          ${b.extra ? `<p style="margin:0 0 8px;">${inlineFormat(b.extra).replace(/\n/g, "<br/>")}</p>` : ""}
          ${b.showUnsubscribe !== false ? `<p style="margin:0;"><a href="*|UNSUB|*" style="color:${esc(b.linkColor)};">Disiscriviti</a> · <a href="*|UPDATE_PROFILE|*" style="color:${esc(b.linkColor)};">Aggiorna preferenze</a></p>` : ""}
        </td></tr>`;
    }
  }).join("");

  const attachmentsHtml = opts?.attachments && opts.attachments.length > 0
    ? `<tr><td style="padding:8px 32px 20px;">
        <p style="margin:0 0 8px;font-size:13px;color:#475569;font-weight:600;">Allegati</p>
        <ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.7;">
          ${opts.attachments.map((a) => `<li><a href="${esc(a.url)}" style="color:#0e6e7a;text-decoration:underline;">${esc(a.name)}</a></li>`).join("")}
        </ul>
      </td></tr>`
    : "";

  const hasFooter = blocks.some((b) => b.type === "footer");
  const defaultFooter = hasFooter ? "" : `<tr><td style="background:#0f172a;padding:18px 32px;color:#cbd5e1;font-size:11px;line-height:1.6;text-align:center;">
          <p style="margin:0 0 4px;color:#ffffff;font-weight:600;">Tecnofra</p>
          <p style="margin:0 0 8px;">*|LIST:ADDRESS|*</p>
          <p style="margin:0;"><a href="*|UNSUB|*" style="color:#94a3b8;">Disiscriviti</a> · <a href="*|UPDATE_PROFILE|*" style="color:#94a3b8;">Aggiorna preferenze</a></p>
        </td></tr>`;

  return `<!doctype html><html lang="it"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
        ${inner}
        ${attachmentsHtml}
        ${defaultFooter}
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export const DEFAULT_BLOCKS: NewsletterBlock[] = [
  createBlock("header"),
  createBlock("text"),
  createBlock("button"),
];