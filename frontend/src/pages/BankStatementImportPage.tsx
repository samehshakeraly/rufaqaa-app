import { useTranslation } from "react-i18next";

import "./finance.css";
import "./BankStatementImportPage.css";
import { FIN_ICONS, FinIcon } from "./financeIcons";

/**
 * F-06 — Bank Statement Import.
 *
 * TODO(backend): there is no statement-import / reconciliation endpoint
 * yet. Per the brief we render the mockup's full static shell so the design
 * lands now (stepper, drop zone + file card, bank picker, column mapping,
 * reconciliation summary + match bar + filter tabs + results table, and the
 * footer nav) with a clear notice that the flow is not wired. No data is
 * invented — every figure renders as an em-dash placeholder until a backend
 * exists.
 */

const STEPS = ["step1", "step2", "step3", "step4", "step5"] as const;

// Banks the importer will recognise. Codes are latin glyphs; names/format
// hints are i18n. No "detected" claim is made without an uploaded file.
const BANKS = [
  { code: "KFH", name: "bankKfh", tone: "kfh" },
  { code: "NBK", name: "bankNbk", tone: "nbk" },
  { code: "GLF", name: "bankGulf", tone: "gulf" },
  { code: "AHL", name: "bankAhli", tone: "ahli" },
  { code: "BBY", name: "bankBoubyan", tone: "boubyan" },
  { code: "+", name: "bankCustom", tone: "cust" },
] as const;

// The mapping the importer will eventually populate. Field names mirror the
// payments schema; shown as informative design, not data claims.
const FIELD_ROWS = [
  { src: "Transaction Date", field: "payments.created_at" },
  { src: "Reference Number", field: "payments.bank_reference" },
  { src: "Amount", field: "payments.amount" },
  { src: "Currency", field: "payments.currency" },
  { src: "Description", field: "payments.description" },
  { src: "Payer Name", field: "payments.donor_id" },
  { src: "Branch Code", field: "—" },
] as const;

// Reconciliation result buckets, mirrored by the summary tiles + match bar.
const RECON_TILES = ["matched", "partial", "unmatched", "dup"] as const;
const RECON_TABS = ["tabAll", "tabMatched", "tabReview", "tabDup"] as const;

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

      {/* Step 1 — file drop zone + (empty) file-info card */}
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
          {/* File-info card — placeholder until a file is selected. */}
          <div className="fin-fileinfo" aria-disabled="true">
            <span className="fi-ic">CSV</span>
            <div className="fi-text">
              <div className="nm">{t("financeImport.fileInfoEmpty")}</div>
              <div className="meta">
                <span>{t("financeImport.fileRows")}: {dash}</span>
                <span className="dot">·</span>
                <span>{dash}</span>
              </div>
            </div>
            <div className="fi-actions">
              <button type="button" className="fin-icon-btn" disabled aria-label={t("financeImport.fileReplace")}>
                <FinIcon>{FIN_ICONS.exchange}</FinIcon>
              </button>
              <button type="button" className="fin-icon-btn" disabled aria-label={t("financeImport.fileRemove")}>
                <FinIcon>{FIN_ICONS.x}</FinIcon>
              </button>
            </div>
          </div>
          <p className="fin-card-note">{t("financeImport.fileDisabled")}</p>
        </div>
      </section>

      {/* Step 2 — bank picker (static shell) */}
      <section className="fin-card fin-import-card">
        <header className="fin-card-head">
          <h3>
            <FinIcon>{FIN_ICONS.bank}</FinIcon>
            {t("financeImport.bankTitle")}
          </h3>
        </header>
        <div className="fin-card-body">
          <div className="fin-bankgrid" role="group" aria-label={t("financeImport.bankTitle")} aria-disabled="true">
            {BANKS.map((b) => (
              <div key={b.code} className="fin-bank" aria-disabled="true">
                <span className={`lg ${b.tone}`}>{b.code}</span>
                <div className="info">
                  <div className="nm">{t(`financeImport.${b.name}`)}</div>
                  <div className="meta">{t("financeImport.bankFormat")}</div>
                </div>
              </div>
            ))}
          </div>
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
                <th scope="col" aria-hidden="true" />
                <th scope="col">{t("financeImport.colField")}</th>
                <th scope="col">{t("financeImport.colStatus")}</th>
              </tr>
            </thead>
            <tbody>
              {FIELD_ROWS.map((r) => (
                <tr key={r.src}>
                  <td className="col-src">{r.src}</td>
                  <td className="col-sample">{dash}</td>
                  <td className="fin-arrow-cell" aria-hidden="true">
                    <FinIcon>{FIN_ICONS.chevronStart}</FinIcon>
                  </td>
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

      {/* Step 4 — reconciliation review (summary + bar + tabs + table) */}
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
            {RECON_TILES.map((tone) => (
              <ReconTile key={tone} tone={tone} label={t(`financeImport.recon${cap(tone)}`)} value={dash} />
            ))}
          </div>

          {/* Match bar — empty track until reconciliation runs. */}
          <div className="fin-matchbar" role="img" aria-label={t("financeImport.matchBarLabel")} />
          <div className="fin-matchlegend">
            {RECON_TILES.map((tone) => (
              <span key={tone}>
                <span className={`dot ${tone}`} />
                {t(`financeImport.recon${cap(tone)}`)} {dash}
              </span>
            ))}
          </div>

          {/* Filter tabs — inert until there are results to filter. */}
          <nav className="fin-rtabs" aria-label={t("financeImport.tabsLabel")}>
            {RECON_TABS.map((tab, i) => (
              <button key={tab} type="button" className={`fin-rtab${i === 2 ? " active" : ""}`} disabled>
                {t(`financeImport.${tab}`)} <span className="pp fin-ph">—</span>
              </button>
            ))}
          </nav>

          {/* Reconciliation results table — header + empty state, no fake rows. */}
          <div className="fin-tbl-scroll">
            <table className="fin-recon-table">
              <caption className="sr-only">{t("financeImport.reconTitle")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("financeImport.colDate")}</th>
                  <th scope="col">{t("financeImport.colStatement")}</th>
                  <th scope="col" className="num-h">
                    {t("financeImport.colAmount")}
                  </th>
                  <th scope="col">{t("financeImport.colMatch")}</th>
                  <th scope="col">{t("financeImport.colStatus")}</th>
                  <th scope="col" aria-hidden="true" />
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td colSpan={6}>
                    <div className="fin-empty">
                      <FinIcon className="fin-icon">{FIN_ICONS.inbox}</FinIcon>
                      <div className="fin-empty-title">{t("financeImport.reconEmpty")}</div>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Footer nav (disabled — nothing to import until the flow is wired) */}
      <footer className="fin-import-foot">
        <span className="note">
          <FinIcon>{FIN_ICONS.check}</FinIcon>
          {t("financeImport.footerNote")}
        </span>
        <div className="acts">
          <button type="button" className="fin-btn-secondary" disabled>
            {t("financeImport.footerPrev")}
          </button>
          <button type="button" className="fin-btn-primary" disabled>
            {t("financeImport.footerImport")}
          </button>
        </div>
      </footer>
    </div>
  );
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
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
