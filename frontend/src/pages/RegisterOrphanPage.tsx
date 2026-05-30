import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";

import { NewOrphanForm } from "@/components/NewOrphanForm";
import { toast } from "@/store/toasts";

import "./RegisterOrphanPage.css";

export function RegisterOrphanPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className="ps-register">
      <div className="ps-reg-header">
        <div className="ps-reg-titles">
          <h1>{t("orphans.register.title")}</h1>
          <p>{t("orphans.register.subtitle")}</p>
        </div>
        <Link to="/admin/orphans" className="ps-reg-back">
          <svg className="ps-icon ps-icon-sm" viewBox="0 0 24 24" aria-hidden="true">
            <polyline points="9 18 15 12 9 6" />
          </svg>
          {t("orphans.register.back")}
        </Link>
      </div>

      <div className="ps-reg-panel">
        <div className="ps-reg-head">
          <h2>
            <svg className="ps-icon ps-icon-sm" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            {t("orphans.register.sectionBasic")}
          </h2>
          <p>{t("orphans.register.sectionBasicDesc")}</p>
        </div>
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
