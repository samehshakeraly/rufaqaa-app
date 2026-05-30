import { useTranslation } from "react-i18next";

import "./finance.css";
import { FIN_ICONS, FinIcon } from "./financeIcons";

/**
 * F-06 — Bank Statement Import.
 *
 * TODO(backend): there is no statement-import / reconciliation endpoint
 * yet. Per the brief we render the mockup's static shell so the design
 * lands now (stepper, drop zone, column-mapping, reconciliation summary)
 * with a clear notice that the flow is not wired. No data is invented —
 * figures render as em-dash placeholders until the backend exists.
 */

const STEPS = ["step1", "step2", "step3", "step4", "step5"] as const;

// The mapping the importer will eventually populate. Field names mirror the
// payments schema; shown as informative design, not data claims.
const FIELD_ROWS = [
  { src: "Transaction Date", field: "payments.created_at" },
  { src: "Reference Number", field: "payments.bank_reference" },
  { src: "Amount", field: "payments.amount" },
  { src: "Currency", field: "payments.currency" },
  { src: "Description", field: "payments.description" },
] as const;

export function BankStatementImportPage() {
  const { t } = useTranslation();
  const dash = <span className="fin-ph">—</span>;

  return (
    <div className="fin-page">
      <div className="fin-head">
        <div>
          <h1>{t("financeImport.title")}</h1>
          <p>{t("financeImport.subtitle")}</p>
        </div>
        <div className="fin-head-actions">
          <button type="button" className="fin-btn-secondary" disabled>
            <FinIcon>{FIN_ICONS.clock}</FinIcon>
            {t("financeImport.importLog")}
          </button>
        </div>
      </div>

      <div className="fin-notice" role="status">
        <FinIcon>{FIN_ICONS.info}</FinIcon>
        {t("financeImport.notice")}
      </div>

      {/* Stepper — step 1 active, the rest pending (no progress without data) */}
      <div className="fin-stepper">
        {STEPS.map((s, i) => (
          <div key={s} style={{ display: "contents" }}>
            {i > 0 && <span className="fin-step-line" />}
            <div className={`fin-step ${i === 0 ? "active" : "pending"}`}>
              <span className="num">{i + 1}</span>
              <span className="lbl">
                <span className="l2">{t(`financeImport.${s}`)}</span>
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Step 1 — file drop zone (disabled) */}
      <section className="fin-card fin-import-card">
        <header className="fin-card-head">
          <h3>
            <FinIcon>{FIN_ICONS.upload}</FinIcon>
            {t("financeImport.step1")}
          </h3>
        </header>
        <div className="fin-card-body">
          <div className="fin-file-zone" aria-disabled="true">
            <div className="ic-lg">
              <FinIcon className="fin-icon">{FIN_ICONS.upload}</FinIcon>
            </div>
            <div className="ttl">{t("financeImport.fileTitle")}</div>
            <div className="sub">{t("financeImport.fileSub")}</div>
            <div className="formats">
              <span className="pill">CSV</span>
              <span className="pill">XLSX</span>
              <span className="pill">OFX</span>
            </div>
          </div>
          <p className="fin-card-note">{t("financeImport.fileDisabled")}</p>
        </div>
      </section>

      {/* Step 3 — column mapping (expected fields, static) */}
      <section className="fin-card fin-import-card">
        <header className="fin-card-head">
          <h3>
            <FinIcon>{FIN_ICONS.exchange}</FinIcon>
            {t("financeImport.mappingTitle")}
          </h3>
          <span className="fin-mapped-pill ignored">{t("financeImport.awaitingData")}</span>
        </header>
        <div className="fin-tbl-scroll">
          <table className="fin-mapping">
            <thead>
              <tr>
                <th scope="col">{t("financeImport.colStatement")}</th>
                <th scope="col">{t("financeImport.colSample")}</th>
                <th scope="col">{t("financeImport.colField")}</th>
                <th scope="col">{t("financeImport.colStatus")}</th>
              </tr>
            </thead>
            <tbody>
              {FIELD_ROWS.map((r) => (
                <tr key={r.src}>
                  <td className="col-src">{r.src}</td>
                  <td className="col-sample">{dash}</td>
                  <td className="fin-mono">{r.field}</td>
                  <td>
                    <span className="fin-mapped-pill ignored">{t("financeImport.mappedManual")}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Step 4 — reconciliation summary (placeholders) */}
      <section className="fin-card fin-import-card">
        <header className="fin-card-head">
          <div>
            <h3>
              <FinIcon>{FIN_ICONS.check}</FinIcon>
              {t("financeImport.reconTitle")}
            </h3>
            <p>{t("financeImport.reconDesc")}</p>
          </div>
        </header>
        <div className="fin-card-body">
          <div className="fin-recon-summary">
            <ReconTile tone="matched" label={t("financeImport.reconMatched")} value={dash} />
            <ReconTile tone="partial" label={t("financeImport.reconPartial")} value={dash} />
            <ReconTile tone="unmatched" label={t("financeImport.reconUnmatched")} value={dash} />
            <ReconTile tone="dup" label={t("financeImport.reconDup")} value={dash} />
          </div>
        </div>
      </section>
    </div>
  );
}

function ReconTile({
  tone,
  label,
  value,
}: {
  tone: string;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className={`fin-recon-tile ${tone}`}>
      <div className="lab">{label}</div>
      <div className="val">{value}</div>
    </div>
  );
}
