import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Lightbox } from "@/components/Lightbox";
import { listOrphanPhotos, uploadOrphanPhoto } from "@/lib/media";
import { toast } from "@/store/toasts";

const ACCEPTED = "image/jpeg,image/png,image/webp";
const MAX_BYTES = 10 * 1024 * 1024;

export function OrphanPhotoUpload({ orphanId }: { orphanId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const photosQ = useQuery({
    queryKey: ["orphan", orphanId, "photos"],
    queryFn: () => listOrphanPhotos(orphanId),
    enabled: !!orphanId,
  });

  const upload = useMutation({
    mutationFn: (file: File) => uploadOrphanPhoto(orphanId, file),
    onSuccess: async () => {
      setServerError(null);
      if (inputRef.current) inputRef.current.value = "";
      await qc.invalidateQueries({ queryKey: ["orphan", orphanId, "photos"] });
      toast.success(t("orphans.photo.uploaded"));
    },
    onError: (err) => {
      const msg =
        err instanceof AxiosError
          ? err.response?.data?.detail ?? err.message
          : (err as Error).message;
      setServerError(String(msg));
    },
  });

  function handleFile(file: File) {
    if (file.size > MAX_BYTES) {
      setServerError(t("orphans.photo.tooLarge"));
      return;
    }
    upload.mutate(file);
  }

  return (
    <div className="card space-y-4">
      <h2 className="text-lg font-semibold">{t("orphans.photo.title")}</h2>

      <div className="flex items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          className="block flex-1 text-sm"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
          disabled={upload.isPending}
        />
        {upload.isPending && (
          <span className="text-sm text-slate-500">{t("common.saving")}</span>
        )}
      </div>

      {serverError && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{serverError}</p>
      )}

      {photosQ.data && photosQ.data.length === 0 && (
        <p className="text-sm text-slate-500">{t("orphans.photo.none")}</p>
      )}

      {photosQ.data && photosQ.data.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {photosQ.data.map((p) => (
            <li
              key={p.id}
              className="overflow-hidden rounded-lg border border-sky bg-snow"
            >
              <button
                type="button"
                className="block w-full cursor-pointer"
                aria-label={t("common.viewFullSize")}
                onClick={() => setLightbox(p.presigned_url)}
              >
                <img
                  src={p.presigned_url}
                  alt=""
                  className="aspect-square w-full object-cover"
                  loading="lazy"
                />
              </button>
              <p className="flex flex-wrap items-center gap-1 px-2 py-1 text-[10px] text-slate-500">
                <span>{new Date(p.created_at).toLocaleDateString()}</span>
                {p.moderation_status !== "approved" && (
                  <span className="rounded bg-amber-100 px-1 py-0.5 text-amber-800">
                    {t(`orphans.photo.status.${p.moderation_status}`, {
                      defaultValue: p.moderation_status,
                    })}
                  </span>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}

      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}
