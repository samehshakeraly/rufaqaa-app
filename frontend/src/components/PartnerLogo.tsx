/**
 * PartnerLogo — displays a partner's logo image, falling back to a coloured
 * monogram avatar if no logo_url is provided. Used on OA-03 Partners page
 * and anywhere else a partner is represented visually.
 */

import type { CSSProperties } from "react";

const GRADIENT_COLORS: [string, string][] = [
  ["#5B85B8", "#2D5683"], // trust blue
  ["#0F766E", "#047857"], // teal/green
  ["#B45309", "#855E08"], // amber/gold
  ["#6D28D9", "#4C1D95"], // purple
  ["#BE123C", "#881337"], // rose
  ["#1D4ED8", "#1E40AF"], // blue
];

function hashCode(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

interface PartnerLogoProps {
  /** Partner display name — used for monogram fallback */
  name: string;
  /** If provided, renders as an <img>; otherwise renders a coloured monogram */
  logoUrl?: string | null;
  /** Size in px — applied to both width and height */
  size?: number;
  className?: string;
}

export function PartnerLogo({ name, logoUrl, size = 52, className = "" }: PartnerLogoProps) {
  const radius = 12; // --radius-lg equivalent in px (just for border-radius token mapping)
  const style: CSSProperties = {
    width: size,
    height: size,
    borderRadius: radius,
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  };

  if (logoUrl) {
    return (
      <div style={style} className={className}>
        <img
          src={logoUrl}
          alt={name}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </div>
    );
  }

  const colors = GRADIENT_COLORS[hashCode(name) % GRADIENT_COLORS.length] ?? GRADIENT_COLORS[0]!;
  const [c1, c2] = colors;
  const monogram = [...name.trimStart()][0] ?? "؟";
  const fontSize = Math.round(size * 0.38);

  return (
    <div
      style={{
        ...style,
        background: `linear-gradient(135deg, ${c1}, ${c2})`,
        color: "white",
        fontWeight: 700,
        fontSize,
        fontFamily: "'IBM Plex Sans Arabic', system-ui, sans-serif",
        userSelect: "none",
      }}
      aria-hidden="true"
      className={className}
    >
      {monogram}
    </div>
  );
}
