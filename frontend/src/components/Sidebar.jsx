import React, { useState, useRef } from 'react';
import axios from 'axios';
import {
  Target, BrainCircuit, Sparkles, Loader2, AlertCircle, Award,
  FileText, FolderKanban, Upload, Database, CheckCircle2, PhoneCall,
  Landmark, Info
} from 'lucide-react';

const API = 'http://127.0.0.1:8000';

// ── Shared input class ─────────────────────────────────────────────────────────
const inputCls =
  'w-full p-3 bg-slate-950 text-slate-200 placeholder-slate-500 rounded-lg border border-slate-700/80 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-xs outline-none transition';

// ─────────────────────────────────────────────────────────────────────────────
export default function Sidebar({
  cases              = [],
  selectedCaseIds    = [],
  activeCaseId       = null,
  casesLoading       = false,
  onCaseToggle,
  onSelectAllCases,
  onClearAllCases,
  kingpins           = [],
  kingpinsLoading    = true,
  onCaseCreated,     // (createdCaseId: string) => void
  onCasesRefresh,    // () => void
  onEvidenceIngested // (caseId: string) => void
}) {
  // ── Structured Evidence Ingestion State (Milestone 6A) ─────────────────────
  const [evidenceType, setEvidenceType] = useState('cdr'); // 'cdr' | 'financial'
  const [isDragging, setIsDragging]     = useState(false);
  const [uploading, setUploading]       = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [uploadSuccess, setUploadSuccess]   = useState(null); // { records, entities, relationships, fileName }
  const [uploadError, setUploadError]       = useState(null);
  const fileInputRef = useRef(null);

  const effectiveActiveCaseId = activeCaseId || (selectedCaseIds.length > 0 ? selectedCaseIds[0] : null);

  const handleFileUpload = async (file) => {
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.csv')) {
      setUploadError('Invalid file type. Please upload a structured .csv file.');
      setUploadSuccess(null);
      return;
    }

    if (!effectiveActiveCaseId) {
      setUploadError('Select an active case above before ingesting structured evidence.');
      setUploadSuccess(null);
      return;
    }

    setUploading(true);
    setUploadError(null);
    setUploadSuccess(null);
    setUploadProgress('Ingesting & Mapping Telemetry...');

    try {
      const formData = new FormData();
      formData.append('file_type', evidenceType);
      formData.append('file', file);

      const response = await axios.post(
        `${API}/api/cases/${encodeURIComponent(effectiveActiveCaseId)}/upload-csv`,
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        }
      );

      const data = response.data;
      setUploadSuccess({
        records: data.records_processed ?? 0,
        entities: data.new_entities_created ?? 0,
        relationships: data.new_relationships_created ?? 0,
        fileName: file.name,
      });
      setUploadProgress(null);

      // Immediately re-fetch graph data & audit ledger so new nodes and connections appear instantly
      if (onEvidenceIngested) {
        onEvidenceIngested(effectiveActiveCaseId);
      }
    } catch (err) {
      console.error('Evidence upload error:', err);
      const detail = err.response?.data?.detail;
      const msg = typeof detail === 'string'
        ? detail
        : Array.isArray(detail)
          ? detail.map(d => d.msg || d).join(', ')
          : err.message || 'Failed to ingest CSV evidence. Verify required schema columns.';
      setUploadError(msg);
      setUploadProgress(null);
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragging) setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  // ── FIR AI Extraction State ──────────────────────────────────────────────
  const [caseTitle, setCaseTitle] = useState('');
  const [firText,   setFirText]   = useState('');
  const [extracting,     setExtracting]     = useState(false);
  const [extractSuccess, setExtractSuccess] = useState(false);
  const [extractError,   setExtractError]   = useState(null);
  const [lastCreatedCase, setLastCreatedCase] = useState(null);

  const handleExtractEntities = async () => {
    if (!firText.trim()) return;
    setExtracting(true);
    setExtractError(null);
    setExtractSuccess(false);
    setLastCreatedCase(null);

    try {
      const response = await axios.post(`${API}/api/ai/extract`, {
        text:      firText,
        case_name: caseTitle.trim() || null,
      });

      const data = response.data;
      console.log('AI Entity Extraction Response:', data);

      setExtractSuccess(true);
      setLastCreatedCase(data.case);
      setFirText('');
      setCaseTitle('');

      // Notify Dashboard: refresh case list and auto-select new case
      if (onCasesRefresh) onCasesRefresh();
      if (onCaseCreated && data.case?.id) {
        onCaseCreated(data.case.id);
      }
    } catch (err) {
      console.error('Error extracting entities:', err);
      const msg = err.response?.data?.detail || 'Failed to extract entities. Check backend.';
      setExtractError(msg);
    } finally {
      setExtracting(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <aside className="bg-slate-950/80 backdrop-blur-xl text-white w-96 h-screen p-4 overflow-y-auto border-r border-slate-800 flex flex-col space-y-5 flex-shrink-0">

      {/* Header */}
      <div className="border-b border-slate-800 pb-3">
        <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
          <Target className="w-5 h-5 text-cyan-400" />
          Command Center
        </h2>
        <p className="text-xs text-slate-400 mt-0.5">Intelligence &amp; Analytics Controls</p>
      </div>

      {/* ── Section 0: Active Investigation Cases ───────────────────────── */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
            <FolderKanban className="w-4 h-4 text-cyan-400" />
            Active Investigation Cases
          </h3>
          <div className="flex items-center gap-1.5">
            {cases.length > 0 && (
              <button
                onClick={selectedCaseIds.length === cases.length ? onClearAllCases : onSelectAllCases}
                disabled={casesLoading}
                className="text-[10px] font-semibold text-cyan-400 hover:text-cyan-300 px-1.5 py-0.5 rounded bg-cyan-950/60 border border-cyan-500/30 transition cursor-pointer disabled:opacity-50"
              >
                {selectedCaseIds.length === cases.length ? 'Clear All' : 'Select All'}
              </button>
            )}
            <span className="text-[10px] font-semibold bg-cyan-500/20 text-cyan-300 px-1.5 py-0.5 rounded border border-cyan-500/30">
              {selectedCaseIds.length}/{cases.length}
            </span>
          </div>
        </div>

        {/* Loading state */}
        {casesLoading && (
          <div className="flex items-center justify-center p-3 bg-slate-900/60 rounded-xl border border-slate-700/60 text-slate-400 text-xs gap-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />
            Loading Cases...
          </div>
        )}

        {/* Case List container */}
        {!casesLoading && (
          <div className="bg-slate-900/60 border border-slate-700/60 rounded-xl p-2 max-h-48 overflow-y-auto space-y-1.5">
            {cases.length === 0 ? (
              <p className="text-xs text-slate-500 italic p-2 text-center">
                No cases found. Submit a FIR below to create one.
              </p>
            ) : (
              cases.map((c) => {
                const isSelected = selectedCaseIds.includes(c.id);
                return (
                  <div
                    key={c.id}
                    onClick={() => onCaseToggle && onCaseToggle(c.id)}
                    className={`p-2 rounded-lg border transition-all cursor-pointer flex items-center justify-between gap-2 select-none group ${
                      isSelected
                        ? 'bg-cyan-950/40 border-cyan-500/60 shadow-[0_0_10px_rgba(34,211,238,0.15)] ring-1 ring-cyan-500/30'
                        : 'bg-slate-950/50 border-slate-800/80 hover:border-slate-700 hover:bg-slate-900/50 text-slate-400'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isSelected ? 'bg-cyan-400 shadow-[0_0_4px_cyan]' : 'bg-slate-600'}`} />
                        <span className={`font-mono text-xs font-bold ${isSelected ? 'text-cyan-300' : 'text-slate-300'}`}>
                          {c.case_number}
                        </span>
                      </div>
                      {c.title && (
                        <p className={`text-[11px] truncate mt-0.5 ${isSelected ? 'text-slate-200' : 'text-slate-500 group-hover:text-slate-400'}`} title={c.title}>
                          {c.title}
                        </p>
                      )}
                    </div>

                    {/* Active Checkbox Indicator */}
                    <div className="flex-shrink-0">
                      <div
                        className={`w-4 h-4 rounded flex items-center justify-center border transition-all ${
                          isSelected
                            ? 'bg-cyan-500 border-cyan-400 text-slate-950 shadow-[0_0_6px_rgba(34,211,238,0.5)]'
                            : 'border-slate-700 bg-slate-800/80 group-hover:border-slate-600'
                        }`}
                      >
                        {isSelected && <span className="text-[10px] font-black leading-none">✓</span>}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </section>

      {/* ── Section 0.5: Structured Evidence Ingestion (CDR & Financial CSV) ── */}
      <section className="space-y-2 pt-1 border-t border-slate-850">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
            <Database className="w-4 h-4 text-cyan-400" />
            Structured Evidence Ingestion
          </h3>
          <span className="text-[10px] font-semibold bg-cyan-500/20 text-cyan-300 px-1.5 py-0.5 rounded border border-cyan-500/30 font-mono">
            CSV Engine
          </span>
        </div>

        <div className="bg-slate-900/60 border border-slate-700/60 rounded-xl p-3 space-y-2.5">
          {/* Segmented Control / Toggle */}
          <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-950/80 rounded-lg border border-slate-800">
            <button
              type="button"
              onClick={() => { setEvidenceType('cdr'); setUploadError(null); setUploadSuccess(null); }}
              disabled={uploading}
              className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-[11px] font-semibold transition-all cursor-pointer ${
                evidenceType === 'cdr'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50 shadow-[0_0_8px_rgba(34,211,238,0.25)]'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60 border border-transparent'
              }`}
            >
              <PhoneCall className={`w-3.5 h-3.5 ${evidenceType === 'cdr' ? 'text-cyan-400' : 'text-slate-500'}`} />
              <span>CDR Logs</span>
            </button>

            <button
              type="button"
              onClick={() => { setEvidenceType('financial'); setUploadError(null); setUploadSuccess(null); }}
              disabled={uploading}
              className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-[11px] font-semibold transition-all cursor-pointer ${
                evidenceType === 'financial'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50 shadow-[0_0_8px_rgba(245,158,11,0.25)]'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60 border border-transparent'
              }`}
            >
              <Landmark className={`w-3.5 h-3.5 ${evidenceType === 'financial' ? 'text-amber-400' : 'text-slate-500'}`} />
              <span>Financial Logs</span>
            </button>
          </div>

          {/* Sample Format Tooltip / Helper Badge */}
          <div className="flex items-start gap-1.5 px-2.5 py-1.5 bg-slate-950/70 rounded-lg border border-slate-800 text-[10px] text-slate-400">
            <Info className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0 mt-0.5" />
            <div className="leading-tight space-y-0.5 min-w-0 flex-1">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-300">
                  {evidenceType === 'cdr' ? 'Expected CDR Schema:' : 'Expected Financial Schema:'}
                </span>
                <span className="text-[9px] uppercase px-1 py-0.2 rounded bg-cyan-950 text-cyan-300 border border-cyan-500/30 font-mono">
                  CSV Header
                </span>
              </div>
              <p className="font-mono text-[9.5px] text-slate-400 truncate" title={evidenceType === 'cdr' ? 'caller, receiver, timestamp, duration' : 'source_account, target_account, amount, timestamp'}>
                {evidenceType === 'cdr'
                  ? 'caller, receiver, timestamp, duration'
                  : 'source_account, target_account, amount, timestamp'}
              </p>
            </div>
          </div>

          {/* Drag & Drop Dropzone */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => !uploading && fileInputRef.current?.click()}
            className={`relative flex flex-col items-center justify-center p-4 border-2 border-dashed rounded-xl transition-all cursor-pointer select-none text-center ${
              isDragging
                ? 'border-cyan-400 bg-cyan-950/40 shadow-[0_0_15px_rgba(34,211,238,0.3)] scale-[1.01]'
                : 'border-slate-700/80 hover:border-cyan-500/60 bg-slate-950/50 hover:bg-slate-950/80'
            } ${uploading ? 'opacity-60 pointer-events-none' : ''}`}
          >
            <input
              type="file"
              ref={fileInputRef}
              accept=".csv,text/csv"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  handleFileUpload(e.target.files[0]);
                }
              }}
              className="hidden"
            />

            {uploading ? (
              <div className="flex flex-col items-center space-y-2 py-1">
                <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
                <span className="text-xs font-semibold text-cyan-300 animate-pulse">
                  {uploadProgress || 'Ingesting & Mapping Telemetry...'}
                </span>
                <span className="text-[10px] text-slate-400">Forging nodes & recalculating threat centrality</span>
              </div>
            ) : (
              <div className="flex flex-col items-center space-y-1.5 py-1">
                <div className="p-2 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 group-hover:scale-110 transition">
                  <Upload className="w-4 h-4" />
                </div>
                <p className="text-xs font-semibold text-slate-200">
                  Drop CDR / Financial CSV or <span className="text-cyan-400 underline underline-offset-2">Click to Browse</span>
                </p>
                <p className="text-[10px] text-slate-500">
                  Accepted format: <span className="font-mono text-slate-400">.csv</span> (UTF-8)
                </p>
              </div>
            )}
          </div>

          {/* Active Case Warning if none selected */}
          {!effectiveActiveCaseId && (
            <div className="flex items-center gap-1.5 text-[10px] text-amber-400/90 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1.5 rounded-lg">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 text-amber-400" />
              <span>Please select an active case above to ingest evidence.</span>
            </div>
          )}

          {/* Success Notification */}
          {uploadSuccess && (
            <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/30 rounded-lg space-y-1 text-xs">
              <div className="flex items-center justify-between text-emerald-400 font-bold">
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  Evidence Ingested!
                </span>
                <button
                  type="button"
                  onClick={() => setUploadSuccess(null)}
                  className="text-slate-400 hover:text-slate-200 text-xs px-1 cursor-pointer"
                >
                  ✕
                </button>
              </div>
              <div className="grid grid-cols-3 gap-1.5 pt-1 text-center">
                <div className="bg-emerald-950/50 p-1.5 rounded border border-emerald-500/20">
                  <span className="block font-mono font-bold text-emerald-300">{uploadSuccess.records}</span>
                  <span className="text-[9px] uppercase text-emerald-400/80">Records</span>
                </div>
                <div className="bg-emerald-950/50 p-1.5 rounded border border-emerald-500/20">
                  <span className="block font-mono font-bold text-cyan-300">+{uploadSuccess.entities}</span>
                  <span className="text-[9px] uppercase text-cyan-400/80">Nodes</span>
                </div>
                <div className="bg-emerald-950/50 p-1.5 rounded border border-emerald-500/20">
                  <span className="block font-mono font-bold text-amber-300">+{uploadSuccess.relationships}</span>
                  <span className="text-[9px] uppercase text-amber-400/80">Links</span>
                </div>
              </div>
              <p className="text-[10px] text-emerald-300/80 pt-0.5 text-center">
                Canvas topology & Threat scores updated in real time.
              </p>
            </div>
          )}

          {/* Error Notification */}
          {uploadError && (
            <div className="p-2.5 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-xs flex items-start justify-between gap-2">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-red-400" />
                <span className="text-[11px] leading-tight">{uploadError}</span>
              </div>
              <button
                type="button"
                onClick={() => setUploadError(null)}
                className="text-red-400/80 hover:text-red-200 text-xs px-1 cursor-pointer"
              >
                ✕
              </button>
            </div>
          )}
        </div>
      </section>

      {/* ── Section 1: Top Targets (Kingpins) ──────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-2">
            <Award className="w-4 h-4 text-amber-400" />
            Top Targets (Kingpins)
          </h3>
          <span className="text-[10px] font-semibold bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded border border-amber-500/30">
            Top 5
          </span>
        </div>

        {/* Loading state */}
        {kingpinsLoading && (
          <div className="flex items-center justify-center p-4 bg-slate-950/50 rounded-lg border border-slate-800 text-slate-400 text-xs gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
            Loading Top Targets...
          </div>
        )}

        {/* Populated state */}
        {!kingpinsLoading && (
          <div className="space-y-2">
            {kingpins.length === 0 ? (
              <p className="text-xs text-slate-500 italic p-2">
                No kingpin data — select a case or submit a FIR.
              </p>
            ) : (
              kingpins.map((target, idx) => (
                <div
                  key={target.id || idx}
                  className="p-3 bg-slate-800/80 hover:bg-slate-800 rounded-lg border border-slate-700/80 transition shadow-sm flex items-center justify-between group"
                >
                  <div className="space-y-1">
                    <div className="flex items-center space-x-2">
                      <span className="text-xs font-bold text-slate-400 w-4">#{idx + 1}</span>
                      <h4 className="text-xs font-bold text-slate-100 group-hover:text-cyan-300 transition">
                        {target.name || target.id}
                      </h4>
                    </div>
                    {target.type && (
                      <p className="text-[11px] text-slate-400 pl-6">
                        Type: <span className="text-slate-300">{target.type}</span>
                      </p>
                    )}
                    {target.role && (
                      <p className="text-[11px] text-slate-400 pl-6">
                        Role: <span className="text-slate-300">{target.role}</span>
                      </p>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Threat</span>
                    <span className="text-xs font-extrabold px-2 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/30">
                      {target.threat_score !== undefined ? Number(target.threat_score).toFixed(2) : 'N/A'}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </section>

      {/* ── Section 2: AI FIR Analysis ─────────────────────────────────── */}
      <section className="space-y-3 pt-4 border-t border-slate-800">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-2">
            <BrainCircuit className="w-4 h-4 text-purple-400" />
            AI FIR Analysis
          </h3>
          <span className="text-[10px] font-semibold bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded border border-purple-500/30">
            LLM Powered
          </span>
        </div>

        <div className="space-y-2.5">
          {/* Optional Case Title field */}
          <div>
            <label className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
              <FileText className="w-3 h-3 text-slate-500" />
              Case Title <span className="text-slate-600 normal-case font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={caseTitle}
              onChange={e => setCaseTitle(e.target.value)}
              placeholder="e.g. Surat Drug Syndicate Operation"
              className={inputCls}
            />
          </div>

          {/* FIR Text Area */}
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
              FIR Text
            </label>
            <textarea
              value={firText}
              onChange={e => setFirText(e.target.value)}
              placeholder="Paste raw FIR text here to extract entities..."
              rows={5}
              className={inputCls + ' resize-none'}
            />
          </div>

          {/* Submit Button */}
          <button
            onClick={handleExtractEntities}
            disabled={extracting || !firText.trim()}
            className="w-full flex items-center justify-center gap-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3 px-4 rounded transition-all shadow-[0_0_15px_rgba(34,211,238,0.4)] cursor-pointer"
          >
            {extracting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Extracting Entities...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5 text-cyan-200" />
                <span>Extract Entities &amp; Create Case</span>
              </>
            )}
          </button>

          {/* Success State */}
          {extractSuccess && lastCreatedCase && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg space-y-1">
              <p className="text-[11px] text-emerald-400 font-bold">✓ Extraction complete!</p>
              <p className="text-[10px] text-emerald-300/80">
                Case created: <span className="font-mono font-bold">{lastCreatedCase.case_number}</span>
              </p>
              <p className="text-[10px] text-emerald-300/70 truncate" title={lastCreatedCase.title}>
                {lastCreatedCase.title}
              </p>
              <p className="text-[10px] text-emerald-300/60">Graph updated automatically.</p>
            </div>
          )}

          {/* Error State */}
          {extractError && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{extractError}</span>
            </div>
          )}
        </div>
      </section>
    </aside>
  );
}
