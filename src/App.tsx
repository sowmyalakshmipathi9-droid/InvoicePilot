"use client";

import {
  ArrowDownToLine,
  ArrowRight,
  BadgeCheck,
  Banknote,
  FileInput,
  FileText,
  Layers3,
  LoaderCircle,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { expensesToCsv } from "@/lib/csv";
import type { ExpenseRecord } from "@/lib/csv";
import { filterExpenses, listExpenses, removeExpense, saveExpense } from "@/lib/expense-store";
import { EXPENSE_CATEGORIES, getFinancialWarnings, invoiceExtractionSchema } from "@/lib/invoice";
import type { ExpenseCategory, InvoiceExtraction } from "@/lib/invoice";
import { loadModelStatus, type ModelStatus } from "@/lib/model-status";
import { SAMPLE_INVOICES } from "@/lib/sample-invoices";

function money(value: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function amountTotals(records: ExpenseRecord[]) {
  const totals = new Map<string, number>();
  for (const record of records) {
    if (record.currency && record.total !== null) {
      totals.set(record.currency, (totals.get(record.currency) ?? 0) + record.total);
    }
  }
  return [...totals].sort(([left], [right]) => left.localeCompare(right));
}

export default function App() {
  const [records, setRecords] = useState<ExpenseRecord[]>([]);
  const [sourceText, setSourceText] = useState("");
  const [selectedSampleId, setSelectedSampleId] = useState("");
  const [draft, setDraft] = useState<InvoiceExtraction | null>(null);
  const [extractionMode, setExtractionMode] = useState<"ai" | "demo" | null>(null);
  const [editing, setEditing] = useState<ExpenseRecord | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<ExpenseCategory | "All categories">("All categories");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [modelStatus, setModelStatus] = useState<ModelStatus | null>(null);
  const [storageReady, setStorageReady] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.allSettled([
      listExpenses(),
      loadModelStatus(),
    ]).then(([storageResult, statusResult]) => {
      if (!active) return;

      const failures: string[] = [];
      if (storageResult.status === "fulfilled") {
        setRecords(storageResult.value);
        setStorageReady(true);
      } else {
        failures.push("Could not load browser storage. Check that site storage is enabled and refresh.");
      }

      if (statusResult.status === "fulfilled") {
        setModelStatus(statusResult.value);
      } else {
        failures.push("Could not load extraction service status. Invoice extraction may not work until the server is configured.");
      }

      if (failures.length > 0) setError(failures.join(" "));
    });
    return () => {
      active = false;
    };
  }, []);

  const visibleRecords = useMemo(() => filterExpenses(records, search, category), [records, search, category]);
  const totals = useMemo(() => amountTotals(records), [records]);

  function beginNew() {
    setDraft(null);
    setEditing(null);
    setExtractionMode(null);
    setNotice("");
    setError("");
    document.getElementById("invoice-input")?.focus();
  }

  function loadSample() {
    const sample = SAMPLE_INVOICES.find(({ id }) => id === selectedSampleId);
    if (!sample) return;
    setSourceText(sample.text);
    setDraft(null);
    setEditing(null);
    setExtractionMode(null);
    setNotice(`${sample.label} loaded. This fictional sample is not a real invoice; submit it for live AI extraction or use the clearly labeled demo fixture.`);
    setError("");
    document.getElementById("invoice-input")?.focus();
  }

  function runDemoExtraction() {
    const sample = SAMPLE_INVOICES.find(({ id }) => id === selectedSampleId);
    if (!sample || sample.text !== sourceText) {
      setError("Load an unchanged sample invoice before using its demo fixture.");
      return;
    }
    setDraft(invoiceExtractionSchema.parse(sample.extraction));
    setEditing(null);
    setExtractionMode("demo");
    setNotice(`Demo fixture loaded for ${sample.label}. These values are not live AI inference and have not been saved.`);
    setError("");
    document.getElementById("review-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function processInvoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    setDraft(null);
    setEditing(null);
    setExtractionMode(null);
    try {
      const response = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: sourceText }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Extraction could not be completed.");
      setDraft(invoiceExtractionSchema.parse(result.extraction));
      setExtractionMode("ai");
      setModelStatus((current) => (current ? { ...current, model: result.model } : current));
      setNotice(`Extracted with ${result.model}. Review every field before saving.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Extraction failed. Check Ollama and try again.");
    } finally {
      setBusy(false);
    }
  }

  function updateDraft<K extends keyof InvoiceExtraction>(key: K, value: InvoiceExtraction[K]) {
    setDraft((current) => {
      if (!current) return current;
      const updated = { ...current, [key]: value };
      const field = key as string;
      const empty = value === null || value === "";
      const missingFields = empty
        ? [...new Set([...updated.missingFields, field])]
        : updated.missingFields.filter((item) => item !== field);
      return { ...updated, missingFields: missingFields as InvoiceExtraction["missingFields"] };
    });
  }

  async function saveDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    const checked = invoiceExtractionSchema.safeParse(draft);
    if (!checked.success) {
      setError("Some fields are invalid. Check the date, currency code, and amounts before saving.");
      return;
    }
    try {
      const saved = await saveExpense(checked.data, editing ?? undefined);
      setRecords((current) => [saved, ...current.filter((record) => record.id !== saved.id)]);
      setDraft(null);
      setEditing(null);
      setExtractionMode(null);
      setNotice(editing
        ? "Expense updated in this browser."
        : extractionMode === "demo"
          ? "Demo fixture saved to this browser after your approval."
          : "Expense saved to this browser.");
      setError("");
    } catch {
      setError("Could not save this expense to browser storage. Check available site storage and try again.");
    }
  }

  function editRecord(record: ExpenseRecord) {
    const editable = {
      vendor: record.vendor,
      invoiceNumber: record.invoiceNumber,
      invoiceDate: record.invoiceDate,
      currency: record.currency,
      subtotal: record.subtotal,
      tax: record.tax,
      total: record.total,
      category: record.category,
      description: record.description,
      confidence: record.confidence,
      missingFields: record.missingFields,
      reasoning: record.reasoning,
    } satisfies InvoiceExtraction;
    setDraft(editable);
    setEditing(record);
    setExtractionMode(null);
    setError("");
    setNotice(`Editing ${record.vendor || "unnamed expense"}. Your saved record is unchanged until you save.`);
    document.getElementById("review-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function deleteRecord(record: ExpenseRecord) {
    if (!window.confirm(`Delete ${record.vendor || "this expense"}? This cannot be undone.`)) return;
    try {
      await removeExpense(record.id);
      setRecords((current) => current.filter((item) => item.id !== record.id));
      setNotice("Expense deleted from this browser.");
      setError("");
    } catch {
      setError("Could not delete the expense from browser storage.");
    }
  }

  function exportCsv() {
    if (records.length === 0) return;
    const blob = new Blob(["\uFEFF", expensesToCsv(records)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `invoicepilot-expenses-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice(`Exported ${records.length} saved ${records.length === 1 ? "expense" : "expenses"} to CSV.`);
  }

  const financialWarnings = draft ? getFinancialWarnings(draft) : [];

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#dashboard" aria-label="InvoicePilot dashboard">
          <span className="brand-mark"><FileText size={19} strokeWidth={2.2} /></span>
          <span>invoice<span className="brand-light">pilot</span></span>
        </a>
        <div className="workspace-label">WORKSPACE</div>
        <nav aria-label="Main navigation" className="sidebar-nav">
          <a className="nav-link active" href="#dashboard"><Layers3 size={17} /> Overview</a>
          <a className="nav-link" href="#ledger"><Banknote size={17} /> Expenses <span className="nav-count">{records.length}</span></a>
          <a className="nav-link" href="#process"><FileInput size={17} /> Process invoice</a>
        </nav>
        <div className="sidebar-spacer" />
        <div className="privacy-card">
          <span className="privacy-icon"><ShieldCheck size={17} /></span>
          <strong>Your data stays yours</strong>
          <p>Documents go to your configured Ollama host. Saved records stay in this browser.</p>
          <a href="#privacy">How storage works <ArrowRight size={13} /></a>
        </div>
        <div className="sidebar-footer"><span className="online-dot" /> Local workspace</div>
      </aside>

      <section className="main-column" id="dashboard">
        <header className="topbar">
          <div className="breadcrumb">Workspace <span>/</span> Overview</div>
          <div className="topbar-right">
            <span className="model-chip"><span className="model-dot" /> {modelStatus?.model ?? "Checking model"}</span>
            <button className="avatar" type="button" aria-label="Local workspace">AP</button>
          </div>
        </header>

        <div className="page-content">
          <section className="welcome-row">
            <div>
              <div className="eyebrow"><span className="eyebrow-line" /> YOUR MONEY, IN ORDER</div>
              <h1>A clearer view<br className="mobile-break" /> of your expenses.</h1>
              <p className="welcome-copy">Turn invoices into a ledger you can actually work with.</p>
            </div>
            <a className="primary-button" href="#process"><Plus size={17} /> Process invoice</a>
          </section>

          <section className="summary-grid" aria-label="Expense summary">
            <article className="summary-card summary-total">
              <div className="summary-head"><span>TRACKED TOTALS</span><span className="summary-icon mint"><Banknote size={17} /></span></div>
              {totals.length ? <div className="total-list">{totals.map(([code, total]) => <strong key={code}>{money(total, code)}</strong>)}</div> : <strong className="summary-value">$0.00</strong>}
              <div className="summary-foot">{totals.length > 1 ? "Shown separately by currency" : totals.length === 1 ? totals[0][0] + " · saved records" : "Your ledger starts here"}</div>
            </article>
            <article className="summary-card">
              <div className="summary-head"><span>EXPENSES</span><span className="summary-icon peach"><FileText size={17} /></span></div>
              <strong className="summary-value">{records.length.toString().padStart(2, "0")}</strong>
              <div className="summary-foot">{records.length ? "Saved in this browser" : "No records yet"}</div>
            </article>
            <article className="summary-card">
              <div className="summary-head"><span>NEEDS REVIEW</span><span className="summary-icon yellow"><TriangleAlert size={17} /></span></div>
              <strong className="summary-value">{records.filter((record) => record.missingFields.length > 0).length.toString().padStart(2, "0")}</strong>
              <div className="summary-foot">Fields left unconfirmed</div>
            </article>
            <article className="summary-card model-summary">
              <div className="summary-head"><span>EXTRACTION MODEL</span><span className="summary-icon blue"><Sparkles size={17} /></span></div>
              <strong className="model-name">{modelStatus?.model ?? "Connecting…"}</strong>
              <div className="summary-foot">{modelStatus?.processingLocation === "local" ? "Local Ollama · private endpoint" : modelStatus?.processingLocation ?? "Checking configured endpoint"}</div>
            </article>
          </section>

          {notice && <div className="notice success-notice" role="status"><BadgeCheck size={16} /> <span>{notice}</span><button type="button" aria-label="Dismiss message" onClick={() => setNotice("")}><X size={15} /></button></div>}
          {error && <div className="notice error-notice" role="alert"><TriangleAlert size={16} /> <span>{error}</span><button type="button" aria-label="Dismiss error" onClick={() => setError("")}><X size={15} /></button></div>}

          <section className="workspace-grid" id="process">
            <article className="panel process-panel">
              <div className="panel-heading">
                <div><div className="section-kicker">01 <span>·</span> NEW EXPENSE</div><h2>Process an invoice</h2></div>
                <span className="step-badge">AI EXTRACTION</span>
              </div>
              <p className="panel-copy">Paste the text from an invoice or receipt. Your configured model finds the details; you decide what gets saved.</p>
              <form onSubmit={processInvoice}>
                <label className="field-label" htmlFor="invoice-input">INVOICE OR RECEIPT TEXT <span>Required</span></label>
                <textarea
                  id="invoice-input"
                  className="invoice-input"
                  value={sourceText}
                  onChange={(event) => setSourceText(event.target.value)}
                  placeholder="Paste invoice details here…"
                  minLength={20}
                  maxLength={30000}
                  required
                  aria-describedby="input-help"
                />
                <div className="input-meta" id="input-help"><span>Text is sent only to the Ollama URL you configured.</span><span>{sourceText.length.toLocaleString()} / 30,000</span></div>
                <div className="sample-controls">
                  <label htmlFor="sample-invoice">Load Sample Invoice</label>
                  <select id="sample-invoice" value={selectedSampleId} onChange={(event) => setSelectedSampleId(event.target.value)}>
                    <option value="">Choose a fictional invoice…</option>
                    {SAMPLE_INVOICES.map((sample) => <option key={sample.id} value={sample.id}>{sample.label}</option>)}
                  </select>
                  <button className="example-chip" type="button" onClick={loadSample} disabled={!selectedSampleId}>Load sample</button>
                </div>
                {SAMPLE_INVOICES.some(({ id, text }) => id === selectedSampleId && text === sourceText) && (
                  <button className="demo-button" type="button" onClick={runDemoExtraction} disabled={busy}>
                    Run demo extraction (fixture, not AI)
                  </button>
                )}
                <button className="submit-button" type="submit" disabled={busy || sourceText.trim().length < 20}>
                  {busy ? <><LoaderCircle className="spin" size={17} /> Extracting with {modelStatus?.model ?? "Ollama"}…</> : <><Sparkles size={17} /> Extract invoice details <ArrowRight size={16} /></>}
                </button>
                <p className="model-hint"><ShieldCheck size={14} /> {modelStatus?.processingLocation === "local" ? "Processing on your configured local Ollama service" : "Processing at your configured Ollama host"}</p>
              </form>
            </article>

            <article className="panel review-panel" id="review-form">
              <div className="panel-heading">
                <div><div className="section-kicker">02 <span>·</span> REVIEW & SAVE</div><h2>{editing ? "Edit expense" : "Check the details"}</h2></div>
                {draft && <button className="icon-button" type="button" aria-label="Discard review" title="Discard review" onClick={() => { setDraft(null); setEditing(null); setExtractionMode(null); }}><X size={17} /></button>}
              </div>
              {!draft ? (
                <div className="review-empty">
                  <span className="empty-illustration"><FileText size={25} /></span>
                  <strong>Nothing to review yet</strong>
                  <p>Extract an invoice and its details will appear here for your approval.</p>
                  <div className="review-empty-step"><span>1</span> Paste invoice text <ArrowRight size={13} /><span>2</span> Review each field</div>
                </div>
              ) : (
                <form onSubmit={saveDraft} className="review-form">
                  {extractionMode === "demo" && <div className="demo-disclosure" role="note"><TriangleAlert size={15} /> DEMO MODE — These pre-authored fixture values are not AI output. Review and edit them; nothing is saved until you approve.</div>}
                  {draft.confidence === "low" && <div className="review-alert"><TriangleAlert size={15} /> Low confidence. Verify every extracted field.</div>}
                  {draft.missingFields.length > 0 && <div className="missing-alert"><span className="missing-dot" /> {draft.missingFields.length} {draft.missingFields.length === 1 ? "field needs" : "fields need"} your attention</div>}
                  {financialWarnings.map((warning) => <div className="review-alert" key={warning}><TriangleAlert size={15} /> {warning}</div>)}
                  <div className="form-grid">
                    <label className="edit-field span-two"><span>VENDOR {draft.missingFields.includes("vendor") && <i>Missing</i>}</span><input value={draft.vendor ?? ""} onChange={(event) => updateDraft("vendor", event.target.value || null)} placeholder="Vendor name" /></label>
                    <label className="edit-field"><span>INVOICE NUMBER {draft.missingFields.includes("invoiceNumber") && <i>Missing</i>}</span><input value={draft.invoiceNumber ?? ""} onChange={(event) => updateDraft("invoiceNumber", event.target.value || null)} placeholder="Not found" /></label>
                    <label className="edit-field"><span>INVOICE DATE {draft.missingFields.includes("invoiceDate") && <i>Missing</i>}</span><input type="date" value={draft.invoiceDate} onChange={(event) => updateDraft("invoiceDate", event.target.value)} /></label>
                    <label className="edit-field"><span>CURRENCY {draft.missingFields.includes("currency") && <i>Missing</i>}</span><input maxLength={3} value={draft.currency ?? ""} onChange={(event) => updateDraft("currency", event.target.value ? event.target.value.toUpperCase() : null)} placeholder="USD" /></label>
                    <label className="edit-field"><span>CATEGORY {draft.missingFields.includes("category") && <i>Missing</i>}</span><select value={draft.category ?? ""} onChange={(event) => updateDraft("category", (event.target.value || null) as ExpenseCategory | null)}><option value="">Choose category</option>{EXPENSE_CATEGORIES.map((option) => <option key={option}>{option}</option>)}</select></label>
                    <label className="edit-field"><span>SUBTOTAL {draft.missingFields.includes("subtotal") && <i>Missing</i>}</span><input type="number" min="0" step="0.01" value={draft.subtotal ?? ""} onChange={(event) => updateDraft("subtotal", event.target.value ? Number(event.target.value) : null)} placeholder="0.00" /></label>
                    <label className="edit-field"><span>TAX {draft.missingFields.includes("tax") && <i>Missing</i>}</span><input type="number" min="0" step="0.01" value={draft.tax ?? ""} onChange={(event) => updateDraft("tax", event.target.value ? Number(event.target.value) : null)} placeholder="0.00" /></label>
                    <label className="edit-field"><span>TOTAL {draft.missingFields.includes("total") && <i>Missing</i>}</span><input type="number" min="0" step="0.01" value={draft.total ?? ""} onChange={(event) => updateDraft("total", event.target.value ? Number(event.target.value) : null)} placeholder="0.00" /></label>
                    <label className="edit-field"><span>DESCRIPTION</span><input value={draft.description} onChange={(event) => updateDraft("description", event.target.value)} placeholder="Short expense description" /></label>
                    <label className="edit-field span-two"><span>CATEGORY REASONING</span><textarea className="reasoning-input" value={draft.reasoning} onChange={(event) => updateDraft("reasoning", event.target.value)} placeholder="Why this category was suggested" /></label>
                  </div>
                  <div className="review-footer"><span className={`confidence confidence-${draft.confidence}`}>{draft.confidence} confidence</span><button className="save-button" type="submit">{editing ? <><Pencil size={15} /> Save changes</> : <><BadgeCheck size={15} /> Approve & save</>}</button></div>
                </form>
              )}
            </article>
          </section>

          <section className="ledger-section" id="ledger">
            <div className="ledger-header">
              <div><div className="section-kicker">YOUR RECORDS</div><h2>Expense ledger <span>{records.length}</span></h2></div>
              <button type="button" className="export-button" onClick={exportCsv} disabled={records.length === 0}><ArrowDownToLine size={16} /> Export CSV</button>
            </div>
            <div className="ledger-controls">
              <label className="search-box"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search vendor or invoice…" aria-label="Search vendor or invoice number" /></label>
              <label className="category-filter"><span className="sr-only">Filter by category</span><select value={category} onChange={(event) => setCategory(event.target.value as ExpenseCategory | "All categories")}><option>All categories</option>{EXPENSE_CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></label>
            </div>
            <div className="ledger-table-wrap">
              <table className="ledger-table">
                <thead><tr><th>VENDOR / DETAILS</th><th>DATE</th><th>CATEGORY</th><th>AMOUNT</th><th>REVIEW</th><th aria-label="Actions" /></tr></thead>
                <tbody>
                  {visibleRecords.map((record) => (
                    <tr key={record.id}>
                      <td><div className="vendor-cell"><span className="vendor-icon">{(record.vendor || "?").slice(0, 1).toUpperCase()}</span><span><strong>{record.vendor || "Unnamed expense"}</strong><small>{record.invoiceNumber || record.description || "No reference"}</small></span></div></td>
                      <td>{record.invoiceDate || <span className="muted">Not set</span>}</td>
                      <td>{record.category ? <span className="category-tag">{record.category}</span> : <span className="muted">Uncategorized</span>}</td>
                      <td className="amount-cell">{record.total !== null && record.currency ? money(record.total, record.currency) : <span className="muted">Not set</span>}</td>
                      <td>{record.missingFields.length ? <span className="review-tag"><span />{record.missingFields.length} missing</span> : <span className="verified-tag"><BadgeCheck size={14} /> Reviewed</span>}</td>
                      <td><div className="row-actions"><button type="button" title="Edit expense" aria-label={`Edit ${record.vendor || "expense"}`} onClick={() => editRecord(record)}><Pencil size={15} /></button><button type="button" title="Delete expense" aria-label={`Delete ${record.vendor || "expense"}`} onClick={() => void deleteRecord(record)}><Trash2 size={15} /></button></div></td>
                    </tr>
                  ))}
                  {visibleRecords.length === 0 && <tr><td colSpan={6}><div className="ledger-empty"><span className="empty-illustration"><FileText size={21} /></span><strong>{records.length ? "No matching expenses" : storageReady ? "Your ledger is ready" : "Loading your ledger…"}</strong><p>{records.length ? "Try a different search or category filter." : "Process an invoice to add your first reviewed expense."}</p>{!records.length && <button type="button" className="text-button" onClick={beginNew}>Process an invoice <ArrowRight size={14} /></button>}</div></td></tr>}
                </tbody>
              </table>
              {visibleRecords.length > 0 && <div className="table-foot">Showing {visibleRecords.length} of {records.length} saved {records.length === 1 ? "expense" : "expenses"} <span>Amounts are grouped by currency above</span></div>}
            </div>
          </section>

          <footer className="page-footer" id="privacy"><span><ShieldCheck size={14} /> Browser storage is not encrypted secure document storage and may be cleared by the browser.</span><a href="https://ollama.com/library/gemma3" target="_blank" rel="noreferrer">Gemma 3 model details <ArrowRight size={13} /></a></footer>
        </div>
      </section>
    </main>
  );
}
