import { avatarPaletteIndex } from "@/lib/donorOrphans";
import {
  AVATAR_FALLBACK_CLASS,
  AVATAR_PALETTE,
  monogram,
} from "@/lib/orphanAvatar";

/** PR-D01 — the one monogram avatar for a sponsored child, in the three
 * sizes the donor surfaces need. `lg` carries the exact classes the
 * original OrphanCard span used (`h-[52px] w-[52px] rounded-full
 * text-lg`) so extracting it changed nothing visually. Decorative only
 * (`aria-hidden`): the child's name is always rendered next to it. */
const SIZE_CLASSES: Record<"sm" | "md" | "lg", string> = {
  sm: "h-8 w-8 rounded-full text-xs",
  md: "h-10 w-10 rounded-full text-sm",
  lg: "h-[52px] w-[52px] rounded-full text-lg",
};

export function OrphanAvatar({
  orphanId,
  name,
  size = "md",
}: {
  orphanId: string;
  name: string;
  size?: "sm" | "md" | "lg";
}) {
  const palette =
    AVATAR_PALETTE[avatarPaletteIndex(orphanId, AVATAR_PALETTE.length)] ??
    AVATAR_FALLBACK_CLASS;
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 select-none items-center justify-center font-bold ${SIZE_CLASSES[size]} ${palette}`}
    >
      {monogram(name)}
    </span>
  );
}
