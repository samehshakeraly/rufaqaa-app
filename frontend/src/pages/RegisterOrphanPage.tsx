import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";

import { NewOrphanForm } from "@/components/NewOrphanForm";
import { toast } from "@/store/toasts";

export function RegisterOrphanPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-900">
          {t("orphans.register.title")}
        </h1>
        <Link
          to="/admin/orphans"
          className="rounded-lg border border-sky px-3 py-2 text-sm text-gray-700 hover:bg-tranquil"
        >
          {t("orphans.register.back")}
        </Link>
      </div>

      <div className="max-w-2xl">
        <NewOrphanForm
          onCreated={async (created) => {
            toast.success(t("common.save"));
            navigate(`/admin/orphans/${created.id}`);
          }}
          onCancel={() => navigate("/admin/orphans")}
        />
      </div>
    </div>
  );
}
