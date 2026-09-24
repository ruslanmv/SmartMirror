/**
 * Illustrated garment swatches. Real wardrobe photos stay in the owner's local
 * MinIO; the UI renders these vector stand-ins whenever no image URL is
 * available (demo mode, offline, or before thumbnails are generated).
 */

const COLOR_MAP: Record<string, string> = {
  black: "#1d1c1f",
  white: "#f1ede6",
  ivory: "#ece3d0",
  cream: "#e9dcc3",
  beige: "#cdb592",
  camel: "#b98b58",
  brown: "#6e4a32",
  chocolate: "#4a3024",
  red: "#b3263a",
  burgundy: "#6d1f2d",
  wine: "#5e1a2a",
  pink: "#e3a3b3",
  blush: "#e8bfb8",
  orange: "#d9793a",
  yellow: "#e2c14e",
  mustard: "#c9a13b",
  green: "#3f7a55",
  olive: "#6f7243",
  emerald: "#1f6b52",
  blue: "#2f5ea8",
  navy: "#1d2a4a",
  denim: "#4b6b93",
  "light blue": "#9dbbe0",
  purple: "#6b4a8f",
  lavender: "#b5a4d6",
  grey: "#8a8a8c",
  gray: "#8a8a8c",
  charcoal: "#3a3a3e",
  silver: "#c3c5c9",
  gold: "#c9a34f",
};

export function garmentColor(name: string | null | undefined): string {
  if (!name) return "#6f675c";
  const key = name.trim().toLowerCase();
  if (COLOR_MAP[key]) return COLOR_MAP[key];
  if (/^#[0-9a-f]{3,8}$/i.test(key)) return key;
  const hit = Object.keys(COLOR_MAP).find((c) => key.includes(c));
  return hit ? COLOR_MAP[hit]! : "#6f675c";
}

type Shape = "dress" | "top" | "skirt" | "pants" | "jacket" | "shoes" | "bag" | "accessory";

export function garmentShape(category: string | null | undefined): Shape {
  const c = (category || "").toLowerCase();
  if (/(dress|gown|jumpsuit)/.test(c)) return "dress";
  if (/(skirt)/.test(c)) return "skirt";
  if (/(pant|jean|trouser|short|legging)/.test(c)) return "pants";
  if (/(jacket|blazer|coat|cardigan|outer)/.test(c)) return "jacket";
  if (/(shoe|boot|heel|sneaker|sandal|loafer)/.test(c)) return "shoes";
  if (/(bag|clutch|tote|purse)/.test(c)) return "bag";
  if (/(top|shirt|blouse|tee|sweater|knit|bodysuit|cami)/.test(c)) return "top";
  return "accessory";
}

const SHAPES: Record<Shape, string> = {
  dress:
    "M41 14c2 4 5 6 9 6s7-2 9-6l7 3-3 17c6 10 12 30 15 52-9 5-19 7-28 7s-19-2-28-7c3-22 9-42 15-52l-3-17z",
  top: "M38 16c3 4 7 6 12 6s9-2 12-6l18 8-5 17-9-3v42c-5 2-11 3-16 3s-11-1-16-3V38l-9 3-5-17z",
  skirt: "M32 26h36l2 6c6 16 10 36 11 54-10 4-21 6-31 6s-21-2-31-6c1-18 5-38 11-54z",
  pants: "M33 16h34l4 76H56l-6-50-6 50H29z",
  jacket: "M36 14l14 20 14-20 16 6 8 52-10 2-6-30v52H28V44l-6 30-10-2 8-52z",
  shoes:
    "M20 58c0-6 3-18 6-24h12c2 8 8 14 16 17l22 8c6 2 9 6 9 11v4H20z",
  bag: "M28 42h44l6 46H22zM38 42c0-12 5-20 12-20s12 8 12 20",
  accessory: "M50 18l9 18 20 3-14 14 3 20-18-9-18 9 3-20-14-14 20-3z",
};

export interface GarmentSwatchProps {
  category?: string | null;
  color?: string | null;
  imageUrl?: string | null;
  label?: string;
  className?: string;
}

export function GarmentSwatch({ category, color, imageUrl, label, className }: GarmentSwatchProps) {
  const shape = garmentShape(category);
  const fill = garmentColor(color);
  const id = `g-${shape}-${fill.replace("#", "")}`;
  if (imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className={className} src={imageUrl} alt={label ?? category ?? "Garment"} loading="lazy" />;
  }
  const isBag = shape === "bag";
  return (
    <svg className={className} viewBox="0 0 100 110" role="img" aria-label={label ?? `${color ?? ""} ${category ?? "garment"}`.trim()}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={fill} stopOpacity="1" />
          <stop offset="1" stopColor={fill} stopOpacity="0.78" />
        </linearGradient>
        <linearGradient id={`${id}-sheen`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.45" stopColor="#fff" stopOpacity="0.18" />
          <stop offset="0.6" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d={SHAPES[shape]}
        fill={isBag ? "none" : `url(#${id})`}
        stroke={isBag ? fill : "rgba(255,255,255,0.22)"}
        strokeWidth={isBag ? 0 : 0.8}
        strokeLinejoin="round"
      />
      {isBag && (
        <>
          <path d="M28 42h44l6 46H22z" fill={`url(#${id})`} stroke="rgba(255,255,255,0.22)" strokeWidth="0.8" />
          <path d="M38 42c0-12 5-20 12-20s12 8 12 20" fill="none" stroke={fill} strokeWidth="3.5" strokeLinecap="round" />
        </>
      )}
      {shape === "jacket" && <path d="M50 34v60M36 14l6 30M64 14l-6 30" stroke="rgba(0,0,0,0.35)" strokeWidth="1.4" fill="none" />}
      <path d={SHAPES[shape]} fill={`url(#${id}-sheen)`} opacity={isBag ? 0 : 1} />
    </svg>
  );
}
