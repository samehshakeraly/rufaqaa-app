import { useMutation } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { confirmBankTransferReceipt } from "@/lib/bankTransfers";
import { createUnattachedDocument, uploadFile } from "@/lib/documents";

const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp";

interface Props {
  transferId: string;
  onClose: () => void;
  onConfirmed: () => void | Promise<void>;
}

export function ConfirmReceiptDialog({ transferId, onClose, onConfirmed }: Props) {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: async (): Promise<void> => {
      let docId: string | undefined;
      if (file) {
        const uploaded = await uploadFile(file);
        const doc = await createUnattachedDocument({
          document_type: "other",
          file_url: uploaded.file_url,
          file_name: uploaded.file_name,
          file_size_bytes: uploaded.file_size_bytes,
          file_mime_type: uploaded.file_mime_type,
          title: "Bank-transfer confirmation",
        });
        docId = doc.id;
      }
      await confirmBankTransferReceipt(transferId, {
        confirmation_document_id: docId,
        notes: notes.trim() || undefined,
      });
    },
    onSuccess: async () => {
      await onConfirmed();
      onClose();
    },
    onError: (err) => {
      if (err instanceof AxiosError) {
        setServerError(err.response?.data?.detail ?? err.message);
      } else {
        setServerError((err as Error).message);
      }
    },
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      data-testid="confirm-receipt-dialog"
    >
      <div className="w-full max-w-lg space-y-4 rounded-lg bg-white p-5 shadow-xl">
        <h2 className="text-lg font-semibold">
          {t("bankTransfers.confirmDialog.title")}
        </h2>
        <p className="text-sm text-slate-600">
          {t("bankTransfers.confirmDialog.body")}
        </p>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">
            {t("bankTransfers.confirmDialog.attachDoc")}
          </span>
          <input
            type="file"
            accept={ACCEPT}
            className="block w-full text-sm"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            data-testid="confirm-receipt-file"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">
            {t("bankTransfers.confirmDialog.notes")}
          </span>
          <textarea
            className="input"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            data-testid="confirm-receipt-notes"
          />
        </label>

        {serverError && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {serverError}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded-lg border border-sky px-3 py-1 text-sm text-slate-700 hover:bg-tranquil"
            onClick={onClose}
            disabled={submit.isPending}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => submit.mutate()}
            disabled={submit.isPending}
            data-testid="confirm-receipt-submit"
          >
            {submit.isPending
              ? t("bankTransfers.confirmDialog.uploading")
              : t("bankTransfers.confirmDialog.submit")}
          </button>
        </div>
      </div>
    </div>
  );
}
