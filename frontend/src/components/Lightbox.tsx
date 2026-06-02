import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import "./Lightbox.css";

interface LightboxProps {
  /** Image URL to show at full size — reuse the already-loaded presigned URL. */
  src: string;
  /** Accessible name for the image; also labels the dialog. */
  alt?: string;
  onClose: () => void;
}

/**
 * Minimal full-size image viewer. Reuses an already-loaded (presigned) URL —
 * it never fetches anything new. Dismiss via backdrop click, the close button,
 * or Escape.
 *
 * Portalled into document.body so the backdrop reliably covers the viewport
 * regardless of a transformed/overflow-clipped ancestor (the position:fixed
 * pitfall) — the same approach the partner ReasonDialog uses.
 */
export function Lightbox({ src, alt, onClose }: LightboxProps) {
  const { t } = useTranslation();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="lightbox-scrim"
      role="dialog"
      aria-modal="true"
      aria-label={alt || t("common.viewFullSize")}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <button
        type="button"
        className="lightbox-close"
        aria-label={t("common.close")}
        onClick={onClose}
      >
        ×
      </button>
      <img className="lightbox-img" src={src} alt={alt ?? ""} />
    </div>,
    document.body,
  );
}
