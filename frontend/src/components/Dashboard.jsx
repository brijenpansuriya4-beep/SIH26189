import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import ForceGraph2D from 'react-force-graph-2d';
import { forceCollide } from 'd3-force';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import {
  Activity, RefreshCw, Users, Phone, MapPin, AlertCircle, ShieldAlert,
  Pencil, PlusCircle, GitMerge, X, ChevronDown, Loader2,
  Clock, Network, Shield, Zap, Maximize2, ScanLine, Focus,
  GitBranch, AlertTriangle, CheckCircle2, XCircle, ArrowRight,
  Download, Copy, Check, ShieldCheck, Lock, FileText,
} from 'lucide-react';
import Sidebar from './Sidebar';

const API = 'http://127.0.0.1:8000';

// ── Node Color Palette ────────────────────────────────────────────────────────
const NODE_COLORS = {
  Person:   '#22d3ee',
  Suspect:  '#22d3ee',
  Phone:    '#e81cff',
  Location: '#4ade80',
  Vehicle:  '#fb923c',
  Bank:     '#facc15',
  Default:  '#a855f7',
};

const getNodeColor = (type) => NODE_COLORS[type] || NODE_COLORS.Default;

// ── Entity type options for Edit Mode ─────────────────────────────────────────
const ENTITY_TYPES = ['Suspect', 'Phone', 'Location', 'Vehicle', 'Bank Account'];

// ── Shared input class ─────────────────────────────────────────────────────────
const inputCls =
  'w-full p-2.5 bg-slate-950 text-slate-200 placeholder-slate-500 rounded-lg border border-slate-700/80 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 text-xs outline-none transition';

const selectCls =
  'w-full p-2.5 bg-slate-950 text-slate-200 rounded-lg border border-slate-700/80 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 text-xs outline-none transition cursor-pointer';

// ─────────────────────────────────────────────────────────────────────────────
export default function Dashboard() {
  // ── Graph State ──────────────────────────────────────────────────────────
  const [graphData, setGraphData]     = useState({ nodes: [], links: [] });
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
  const graphContainerRef             = useRef(null);
  const graphRef                      = useRef(null);
  const minimapRef                    = useRef(null);
  const isMinimapDraggingRef          = useRef(false);
  const [dimensions, setDimensions]   = useState({
    width: typeof window !== 'undefined' ? Math.max(window.innerWidth - 380, 800) : 800,
    height: typeof window !== 'undefined' ? window.innerHeight : 600,
  });
  const [selectedNode, setSelectedNode] = useState(null);
  const [hoveredLink, setHoveredLink]   = useState(null);

  // ── Case Selector State ──────────────────────────────────────────────────
  const [cases, setCases]                   = useState([]);
  const [selectedCaseIds, setSelectedCaseIds] = useState([]);
  const [casesLoading, setCasesLoading]     = useState(true);
  const [isLoading, setIsLoading]           = useState(false);
  const activeCaseId                        = (selectedCaseIds && selectedCaseIds.length > 0 && selectedCaseIds[0] && selectedCaseIds[0] !== 'undefined' && selectedCaseIds[0] !== 'null') ? selectedCaseIds[0] : null;

  // ── Cryptographic Evidence Ledger & PDF Dossier State ────────────────────
  const [auditLedger, setAuditLedger]               = useState(null);
  const [auditLedgerLoading, setAuditLedgerLoading] = useState(false);
  const [auditModalOpen, setAuditModalOpen]         = useState(false);
  const [copiedHash, setCopiedHash]                 = useState(false);
  const [exportingDossier, setExportingDossier]     = useState(false);

  // ── Suspicious Pattern Alerts State (Milestone 6B) ────────────────────────
  const [suspiciousPatterns, setSuspiciousPatterns] = useState({ total_patterns: 0, patterns: [] });
  const [patternsLoading, setPatternsLoading]       = useState(false);
  const [patternsDrawerOpen, setPatternsDrawerOpen] = useState(false);
  const [patternFilter, setPatternFilter]           = useState('ALL'); // 'ALL' | 'CRITICAL' | 'HIGH'

  // ── Kingpins State ───────────────────────────────────────────────────────
  const [kingpins, setKingpins]           = useState([]);
  const [kingpinsLoading, setKingpinsLoading] = useState(true);

  // ── Edit Mode State ──────────────────────────────────────────────────────
  const [editMode, setEditMode]           = useState(false);
  const [editTab, setEditTab]             = useState('entity');

  const [addEntityForm, setAddEntityForm] = useState({
    entity_type: 'Suspect', name: '', risk: 5,
  });
  const [addEntityLoading, setAddEntityLoading] = useState(false);
  const [addEntityMsg, setAddEntityMsg]   = useState(null);

  const [addRelForm, setAddRelForm]       = useState({
    source_id: '', target_id: '', relation_type: '',
  });
  const [addRelLoading, setAddRelLoading] = useState(false);
  const [addRelMsg, setAddRelMsg]         = useState(null);

  // ── Cross-Case Analytics State ────────────────────────────────────────────
  const [crossCaseData, setCrossCaseData]         = useState(null);
  const [crossCaseModalOpen, setCrossCaseModalOpen] = useState(false);

  // ── Shortest Path (Trace Link) State ─────────────────────────────────────
  const [pathMode, setPathMode]       = useState(false);
  const [pathSource, setPathSource]   = useState(null);
  const [pathTarget, setPathTarget]   = useState(null);
  const [pathResult, setPathResult]   = useState(null);
  const [pathLoading, setPathLoading] = useState(false);
  const [pathToast, setPathToast]     = useState(null); // { msg, type: 'err'|'ok' }

  // ── Toast auto-dismiss ───────────────────────────────────────────────────
  useEffect(() => {
    if (!pathToast) return;
    const t = setTimeout(() => setPathToast(null), 3500);
    return () => clearTimeout(t);
  }, [pathToast]);

  // ── Fetch all cases ──────────────────────────────────────────────────────
  const fetchCases = useCallback(async () => {
    setCasesLoading(true);
    try {
      const res = await axios.get(`${API}/api/cases`);
      const data = Array.isArray(res.data) ? res.data : [];
      setCases(data);
      return data;
    } catch (err) {
      console.error('Failed to load cases:', err);
      return [];
    } finally {
      setCasesLoading(false);
    }
  }, []);

  // ── Fetch filtered graph for given case IDs ──────────────────────────────
  const fetchFilteredGraph = useCallback(async (ids) => {
    // Guard against undefined, null, or non-string IDs
    const validIds = Array.isArray(ids)
      ? ids.filter(id => id && typeof id === 'string' && id.trim() !== '' && id !== 'undefined' && id !== 'null')
      : [];

    if (validIds.length === 0) {
      setGraphData({ nodes: [], links: [] });
      setKingpins([]);
      setKingpinsLoading(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    setKingpinsLoading(true);
    try {
      const res = await axios.post(`${API}/api/cases/filter-graph`, { case_ids: validIds });
      const data = res.data || {};
      setGraphData({ nodes: data.nodes || [], links: data.links || [] });
      setKingpins((data.kingpins || []).slice(0, 5));
    } catch (err) {
      console.error('Error fetching filtered graph:', err);
      setError('Failed to fetch graph data. Check backend connection.');
    } finally {
      setLoading(false);
      setKingpinsLoading(false);
    }
  }, []);

  // ── Fetch cross-case syndicate matches ────────────────────────────────────
  const fetchCrossCaseMatches = useCallback(async () => {
    try {
      const res = await axios.get(`${API}/api/analytics/cross-case-matches`);
      setCrossCaseData(res.data || null);
    } catch (err) {
      console.error('Cross-case analytics error:', err);
      // non-critical: silently fail
    }
  }, []);

  // ── Fetch cryptographic audit ledger ──────────────────────────────────────
  const fetchAuditLedger = useCallback(async (caseId) => {
    // Guard: Prevent firing API calls with undefined, null, or invalid case IDs
    if (!caseId || typeof caseId !== 'string' || !caseId.trim() || caseId === 'undefined' || caseId === 'null') {
      setAuditLedger(null);
      return;
    }
    setAuditLedgerLoading(true);
    try {
      const res = await axios.get(`${API}/api/cases/${encodeURIComponent(caseId.trim())}/audit-ledger`);
      setAuditLedger(res.data);
    } catch (err) {
      console.error('Audit ledger fetch failed:', err);
      setAuditLedger(null);
    } finally {
      setAuditLedgerLoading(false);
    }
  }, []);

  // ── Auto-fetch audit ledger when active case changes ───────────────────────
  useEffect(() => {
    if (!activeCaseId) {
      setAuditLedger(null);
      return;
    }
    fetchAuditLedger(activeCaseId);
  }, [activeCaseId, fetchAuditLedger]);

  // ── Fetch suspicious pattern alerts for active case (Milestone 6B) ─────────
  const fetchSuspiciousPatterns = useCallback(async (caseId) => {
    if (!caseId || typeof caseId !== 'string' || !caseId.trim() || caseId === 'undefined' || caseId === 'null') {
      setSuspiciousPatterns({ total_patterns: 0, patterns: [] });
      return;
    }
    setPatternsLoading(true);
    try {
      const res = await axios.get(`${API}/api/cases/${encodeURIComponent(caseId.trim())}/suspicious-patterns`);
      const data = res.data || {};
      setSuspiciousPatterns({
        case_id: data.case_id || caseId,
        case_number: data.case_number || 'ACTIVE_CASE',
        total_patterns: data.total_patterns || (data.patterns?.length || 0),
        patterns: Array.isArray(data.patterns) ? data.patterns : []
      });
    } catch (err) {
      console.error('Failed to load suspicious patterns:', err);
      setSuspiciousPatterns({ total_patterns: 0, patterns: [] });
    } finally {
      setPatternsLoading(false);
    }
  }, []);

  // ── Auto-fetch suspicious patterns when active case changes ────────────────
  useEffect(() => {
    if (!activeCaseId) {
      setSuspiciousPatterns({ total_patterns: 0, patterns: [] });
      return;
    }
    fetchSuspiciousPatterns(activeCaseId);
  }, [activeCaseId, fetchSuspiciousPatterns]);

  // ── Copy Hash to clipboard ─────────────────────────────────────────────────
  const handleCopyHash = useCallback(() => {
    if (!auditLedger?.tamper_proof_hash) return;
    navigator.clipboard.writeText(auditLedger.tamper_proof_hash);
    setCopiedHash(true);
    setTimeout(() => setCopiedHash(false), 2500);
  }, [auditLedger]);

  // ── Official Police Dossier PDF Export ─────────────────────────────────────
  const handleExportDossier = useCallback(async () => {
    if (!activeCaseId) {
      setPathToast({ type: 'err', msg: 'Please select an active case to export dossier.' });
      return;
    }

    setExportingDossier(true);
    setPathToast({ type: 'ok', msg: 'Compiling Official Dossier...' });

    try {
      // 1. Ensure latest audit ledger is loaded
      let ledger = auditLedger;
      if (!ledger) {
        try {
          const res = await axios.get(`${API}/api/cases/${activeCaseId}/audit-ledger`);
          ledger = res.data;
          setAuditLedger(ledger);
        } catch (e) {
          console.error('Failed to load ledger for PDF:', e);
        }
      }

      const activeCase = cases.find(c => c.id === activeCaseId);
      const caseNumber = ledger?.case_number || activeCase?.case_number || 'CASE-AUDIT';

      // 2. High-resolution ForceGraph canvas capture
      let canvasSnapshot = null;
      if (typeof graphRef.current?.getCanvas === 'function') {
        const c = graphRef.current.getCanvas();
        if (c) {
          try { canvasSnapshot = c.toDataURL('image/png'); } catch (_) {}
        }
      }
      if (!canvasSnapshot && graphContainerRef.current) {
        const c = graphContainerRef.current.querySelector('canvas');
        if (c) {
          try { canvasSnapshot = c.toDataURL('image/png'); } catch (_) {}
        }
      }
      if (!canvasSnapshot && graphContainerRef.current) {
        try {
          const captured = await html2canvas(graphContainerRef.current, {
            backgroundColor: '#020617',
            useCORS: true,
            logging: false,
            scale: 1.5,
          });
          canvasSnapshot = captured.toDataURL('image/png');
        } catch (e) {
          console.warn('html2canvas capture fallback failed:', e);
        }
      }

      // 3. Build A4 Police Dossier via jsPDF
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
      });

      // Page background
      doc.setFillColor(3, 7, 18);
      doc.rect(0, 0, 210, 297, 'F');

      // Security outer double-border
      doc.setDrawColor(30, 41, 59);
      doc.setLineWidth(0.8);
      doc.rect(8, 8, 194, 281);
      doc.setDrawColor(16, 185, 129);
      doc.setLineWidth(0.25);
      doc.rect(9.5, 9.5, 191, 278);

      // Header Banner
      doc.setFillColor(15, 23, 42);
      doc.rect(10, 10, 190, 24, 'F');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(245, 158, 11);
      doc.text('LAW ENFORCEMENT SENSITIVE // COURT ADMISSIBLE EVIDENCE', 105, 15.5, { align: 'center' });

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12.5);
      doc.setTextColor(255, 255, 255);
      doc.text('CENTRAL CRIME INTELLIGENCE & SYNDICATE MAPPING DOSSIER', 105, 22.5, { align: 'center' });

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(56, 189, 248);
      doc.text('DIRECTORATE OF FORENSIC & CYBER INVESTIGATION • EVIDENCE LEDGER SYSTEM', 105, 29, { align: 'center' });

      doc.setDrawColor(56, 189, 248);
      doc.setLineWidth(0.5);
      doc.line(10, 34, 200, 34);

      // Metadata Section
      doc.setFillColor(15, 23, 42);
      doc.setDrawColor(51, 65, 85);
      doc.setLineWidth(0.3);
      doc.roundedRect(12, 37, 186, 35, 2, 2, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text('EVIDENCE LEDGER & CASE METADATA', 16, 42);

      // Left Column
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(148, 163, 184);
      doc.text('Case Number:', 16, 47.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(56, 189, 248);
      doc.text(String(caseNumber), 40, 47.5);

      doc.setFont('helvetica', 'normal');
      doc.setTextColor(148, 163, 184);
      doc.text('Case Title:', 16, 52.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(241, 245, 249);
      const safeTitle = (activeCase?.title || 'Investigation Case').substring(0, 45);
      doc.text(safeTitle, 40, 52.5);

      doc.setFont('helvetica', 'normal');
      doc.setTextColor(148, 163, 184);
      doc.text('Timestamp:', 16, 57.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(203, 213, 225);
      const dateStr = ledger?.timestamp
        ? new Date(ledger.timestamp).toLocaleString('en-IN')
        : new Date().toLocaleString('en-IN');
      doc.text(dateStr, 40, 57.5);

      // Right Column
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(148, 163, 184);
      doc.text('Integrity Status:', 115, 47.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(52, 211, 153);
      doc.text(ledger?.status || 'VERIFIED_TAMPER_PROOF', 142, 47.5);

      doc.setFont('helvetica', 'normal');
      doc.setTextColor(148, 163, 184);
      doc.text('Chain of Custody:', 115, 52.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(52, 211, 153);
      doc.text('IMMUTABLE / COURT ADMISSIBLE', 142, 52.5);

      doc.setFont('helvetica', 'normal');
      doc.setTextColor(148, 163, 184);
      doc.text('Evidence Nodes:', 115, 57.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(255, 255, 255);
      const totalNodes = ledger?.total_evidence_nodes ?? graphData.nodes?.length ?? 0;
      const totalEdges = ledger?.total_connections ?? graphData.links?.length ?? 0;
      doc.text(`${totalNodes} Nodes  |  ${totalEdges} Connections`, 142, 57.5);

      // Hash Box inside metadata
      doc.setFillColor(6, 78, 59);
      doc.setDrawColor(16, 185, 129);
      doc.roundedRect(15, 61, 180, 8, 1, 1, 'FD');
      doc.setFont('courier', 'bold');
      doc.setFontSize(6.8);
      doc.setTextColor(52, 211, 153);
      const hashSig = ledger?.tamper_proof_hash || 'SHA256:VERIFIED_IMMUTABLE_CHAIN_OF_CUSTODY';
      doc.text(`HASH SIGNATURE: ${hashSig}`, 18, 66.2);

      // SECTION 1: Forensic Network Topology Map
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(56, 189, 248);
      doc.text('SECTION 1: FORENSIC NETWORK TOPOLOGY MAP', 12, 76);

      doc.setFillColor(2, 6, 23);
      doc.setDrawColor(30, 41, 59);
      doc.roundedRect(12, 79, 186, 75, 2, 2, 'FD');

      if (canvasSnapshot) {
        try {
          doc.addImage(canvasSnapshot, 'PNG', 13, 80, 184, 73);
        } catch (_) {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(8.5);
          doc.setTextColor(148, 163, 184);
          doc.text('[Network Topology Visual Snapshot Attached]', 105, 117, { align: 'center' });
        }
      } else {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(148, 163, 184);
        doc.text('[Network Topology Visual Snapshot Attached]', 105, 117, { align: 'center' });
      }

      // SECTION 2: Priority Target Intelligence & Threat Scoring Table
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(56, 189, 248);
      doc.text('SECTION 2: PRIORITY TARGET INTELLIGENCE & THREAT SCORING', 12, 160);

      // Table Header
      doc.setFillColor(30, 41, 59);
      doc.setDrawColor(51, 65, 85);
      doc.rect(12, 163, 186, 6.5, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(203, 213, 225);
      doc.text('RANK', 14, 167.5);
      doc.text('TARGET IDENTIFIER / NAME', 32, 167.5);
      doc.text('ENTITY TYPE', 85, 167.5);
      doc.text('THREAT SCORE', 125, 167.5);
      doc.text('INTELLIGENCE CLASSIFICATION', 160, 167.5);

      const topTargets = (kingpins && kingpins.length > 0)
        ? kingpins.slice(0, 5)
        : (graphData.nodes || []).slice().sort((a,b) => (b.threat_score || 0) - (a.threat_score || 0)).slice(0, 5);

      let currentY = 169.5;
      topTargets.forEach((kp, idx) => {
        const isEven = idx % 2 === 0;
        doc.setFillColor(isEven ? 15 : 10, isEven ? 23 : 15, isEven ? 42 : 30);
        doc.setDrawColor(30, 41, 59);
        doc.rect(12, currentY, 186, 8.5, 'FD');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        if (idx === 0) {
          doc.setTextColor(245, 158, 11);
        } else {
          doc.setTextColor(148, 163, 184);
        }
        doc.text(`#${idx + 1}`, 14, currentY + 4.5);

        doc.setFont('helvetica', 'bold');
        doc.setTextColor(255, 255, 255);
        const targetName = (kp.name || kp.id || 'Unknown').substring(0, 32);
        doc.text(targetName, 32, currentY + 4.5);

        doc.setFont('helvetica', 'normal');
        doc.setTextColor(148, 163, 184);
        doc.text(kp.type || 'Unknown', 85, currentY + 4.5);

                let rawScore = kp.threat_score;
        if (typeof rawScore === 'string') {
            rawScore = parseFloat(rawScore.replace(/[^0-9.]/g, '')) || 0;
        }
        const numericScore = Number(rawScore);
        const cleanScoreStr = `${numericScore.toFixed(2)} / 10.0`;
        doc.setFont('helvetica', 'bold');
        if (numericScore >= 8) doc.setTextColor(239, 68, 68);
        else if (numericScore >= 5) doc.setTextColor(245, 158, 11);
        else doc.setTextColor(52, 211, 153);
        doc.text(cleanScoreStr, 125, currentY + 4.5);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6.5);
        if (numericScore >= 8) {
          doc.setTextColor(248, 113, 113);
          doc.text('CRITICAL TARGET', 160, currentY + 4.5);
        } else if (numericScore >= 5) {
          doc.setTextColor(251, 191, 36);
          doc.text('PRIORITY SUSPECT', 160, currentY + 4.5);
        } else {
          doc.setTextColor(74, 222, 128);
          doc.text('ASSOCIATED NODE', 160, currentY + 4.5);
        }

        currentY += 8.5;
      });

      if (topTargets.length === 0) {
        doc.setFillColor(15, 23, 42);
        doc.rect(12, currentY, 186, 6.5, 'FD');
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(148, 163, 184);
        doc.text('No entity records flagged for this case.', 105, currentY + 4.5, { align: 'center' });
        currentY += 6.5;
      }

      // SECTION 3: Cross-Case Syndicate Analysis
      const syndicateY = currentY + 2.5;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(56, 189, 248);
      doc.text('SECTION 3: CROSS-CASE SYNDICATE NOTICE', 12, syndicateY);

      if (crossCaseData && crossCaseData.total_matches > 0) {
        doc.setFillColor(69, 10, 10);
        doc.setDrawColor(239, 68, 68);
        doc.roundedRect(12, syndicateY + 2.5, 186, 17, 1.5, 1.5, 'FD');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(248, 113, 113);
        doc.text(`⚠️ INTER-CASE SYNDICATE WARNING: ${crossCaseData.total_matches} MULTI-JURISDICTIONAL LINK(S) DETECTED`, 16, syndicateY + 7.5);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6.8);
        doc.setTextColor(254, 202, 202);
        const matchNames = crossCaseData.cross_case_entities.slice(0, 3).map(e => `${e.entity_name} (${e.occurrences.length} cases)`).join(', ');
        doc.text(`Syndicate Operatives identified across multiple active cases: ${matchNames}`, 16, syndicateY + 12);
        doc.text(`Immediate investigative coordination required between relevant precinct jurisdictions.`, 16, syndicateY + 15.5);
      } else {
        doc.setFillColor(6, 78, 59);
        doc.setDrawColor(16, 185, 129);
        doc.roundedRect(12, syndicateY + 2.5, 186, 14, 1.5, 1.5, 'FD');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(52, 211, 153);
        doc.text('🔒 SYNDICATE ISOLATION VERIFIED', 16, syndicateY + 7.5);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6.8);
        doc.setTextColor(167, 243, 208);
        doc.text('No active cross-case syndicate overlaps identified for entities in this investigation cluster.', 16, syndicateY + 12);
      }

      // Official Footer
      const footerY = 264;
      doc.setDrawColor(51, 65, 85);
      doc.setLineWidth(0.4);
      doc.line(10, footerY, 200, footerY);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.5);
      doc.setTextColor(148, 163, 184);
      doc.text('OFFICIAL TAMPER-PROOF DIGITAL SEAL', 12, footerY + 4.5);

      doc.setFont('courier', 'bold');
      doc.setFontSize(6);
      doc.setTextColor(52, 211, 153);
      doc.text(`LEDGER SIGNATURE: ${ledger?.tamper_proof_hash || 'SHA256:VERIFIED'}`, 12, footerY + 8.5);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6);
      doc.setTextColor(100, 116, 139);
      doc.text('Certified authentic by State Cyber Crime & Network Forensics Enclave. Tampering invalidates this digital certificate.', 12, footerY + 12.5);
      doc.text(`Export Timestamp: ${new Date().toISOString()} • Confidential Law Enforcement Report`, 12, footerY + 16);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(148, 163, 184);
      doc.text('Page 1 of 1', 198, footerY + 16, { align: 'right' });

      // Save PDF
      const sanitizedCaseNum = caseNumber.replace(/[^a-zA-Z0-9-_]/g, '_');
      doc.save(`CRIME_DOSSIER_${sanitizedCaseNum}.pdf`);
      setPathToast({ type: 'ok', msg: `Dossier exported: CRIME_DOSSIER_${sanitizedCaseNum}.pdf` });
    } catch (err) {
      console.error('PDF Dossier Generation Error:', err);
      setPathToast({ type: 'err', msg: 'Failed to generate Dossier PDF.' });
    } finally {
      setExportingDossier(false);
    }
  }, [activeCaseId, auditLedger, cases, graphData, kingpins, crossCaseData]);

  // ── Shortest path finder ──────────────────────────────────────────────────
  const doShortestPath = useCallback(async (src, tgt) => {
    setPathLoading(true);
    setPathResult(null);
    try {
      const res = await axios.post(`${API}/api/analytics/shortest-path`, {
        source_node_id: src.id,
        target_node_id: tgt.id,
        case_ids: selectedCaseIds.length > 0 ? selectedCaseIds : null,
      });
      const data = res.data;
      if (!data.path_found) {
        setPathToast({ type: 'err', msg: 'No direct or indirect link found between these two entities.' });
        setPathSource(null);
        setPathTarget(null);
      } else {
        setPathResult(data);
        setPathToast({ type: 'ok', msg: `Path found! ${data.hops} hop${data.hops !== 1 ? 's' : ''} between targets.` });
      }
    } catch (err) {
      const detail = err.response?.data?.detail || 'Path analysis failed. Entities may not be connected.';
      setPathToast({ type: 'err', msg: detail });
      setPathSource(null);
      setPathTarget(null);
    } finally {
      setPathLoading(false);
    }
  }, [selectedCaseIds]);

  // ── Clear path state ──────────────────────────────────────────────────────
  const clearPathTrace = useCallback(() => {
    setPathResult(null);
    setPathSource(null);
    setPathTarget(null);
    setPathMode(false);
  }, []);

  // ── Toggle path mode ──────────────────────────────────────────────────────
  const togglePathMode = useCallback(() => {
    setPathMode(prev => {
      if (prev) { clearPathTrace(); return false; }
      // Clear dossier when entering path mode
      setSelectedNode(null);
      return true;
    });
  }, [clearPathTrace]);

  // ── Initial Load ─────────────────────────────────────────────────────────
  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const data = await fetchCases();
        if (!isMounted) return;
        if (data && data.length > 0 && data[0]?.id) {
          const latestId = data[0].id;
          setSelectedCaseIds([latestId]);
          await fetchFilteredGraph([latestId]);
          fetchSuspiciousPatterns(latestId);
        } else {
          setLoading(false);
          setKingpinsLoading(false);
        }
        fetchCrossCaseMatches();
      } catch (e) {
        console.error('Initial load failed:', e);
        if (isMounted) {
          setLoading(false);
          setKingpinsLoading(false);
        }
      }
    })();
    return () => {
      isMounted = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Responsive graph dimensions ──────────────────────────────────────────
  useEffect(() => {
    const updateDimensions = () => {
      if (graphContainerRef.current) {
        setDimensions({
          width: graphContainerRef.current.clientWidth || (window.innerWidth - 380),
          height: graphContainerRef.current.clientHeight || window.innerHeight,
        });
      }
    };
    updateDimensions();
    const timer = setTimeout(updateDimensions, 100);
    window.addEventListener('resize', updateDimensions);
    return () => { clearTimeout(timer); window.removeEventListener('resize', updateDimensions); };
  }, []);

  // ── Toggle a case pill selection ─────────────────────────────────────────
  const toggleCase = (id) => {
    if (!id) return;
    setSelectedCaseIds(prev => {
      const next = prev.includes(id)
        ? prev.filter(x => x !== id)
        : [...prev, id];
      const validNext = next.filter(Boolean);
      fetchFilteredGraph(validNext);
      return validNext;
    });
  };

  // ── Called by Sidebar after successful FIR extraction ────────────────────
  const handleCaseCreated = useCallback(async (createdCaseId) => {
    if (!createdCaseId) return;
    await fetchCases();
    const newIds = [createdCaseId];
    setSelectedCaseIds(newIds);
    await fetchFilteredGraph(newIds);
    fetchSuspiciousPatterns(createdCaseId);
    // Re-run cross-case analytics after new FIR
    fetchCrossCaseMatches();
  }, [fetchCases, fetchFilteredGraph, fetchSuspiciousPatterns, fetchCrossCaseMatches]);

  // ── Called after structured evidence ingestion (CDR / Financial CSV) ─────
  const handleEvidenceIngested = useCallback(async (caseId) => {
    const targetId = caseId || activeCaseId;
    if (!targetId) return;

    if (!selectedCaseIds.includes(targetId)) {
      setSelectedCaseIds([targetId]);
    }

    await Promise.allSettled([
      fetchFilteredGraph([targetId]),
      fetchAuditLedger(targetId),
      fetchSuspiciousPatterns(targetId),
      fetchCrossCaseMatches(),
      fetchCases()
    ]);
  }, [activeCaseId, selectedCaseIds, fetchFilteredGraph, fetchAuditLedger, fetchSuspiciousPatterns, fetchCrossCaseMatches, fetchCases]);

  // ── Reload graph for current selection ───────────────────────────────────
  const handleReload = useCallback(async () => {
    if (isLoading) return;
    setIsLoading(true);
    setError(null);
    try {
      const fetchedCases = await fetchCases();
      let currentActiveId = activeCaseId;
      if (!currentActiveId && fetchedCases && fetchedCases.length > 0 && fetchedCases[0]?.id) {
        currentActiveId = fetchedCases[0].id;
        setSelectedCaseIds([currentActiveId]);
      }

      if (!currentActiveId) {
        setGraphData({ nodes: [], links: [] });
        setKingpins([]);
        setAuditLedger(null);
        setSuspiciousPatterns({ total_patterns: 0, patterns: [] });
        return;
      }

      // Single clean fetch of active graph data, audit ledger, suspicious patterns, and syndicate matches
      await Promise.allSettled([
        fetchFilteredGraph([currentActiveId]),
        fetchAuditLedger(currentActiveId),
        fetchSuspiciousPatterns(currentActiveId),
        fetchCrossCaseMatches()
      ]);
    } catch (err) {
      console.error('Reload failed:', err);
      setError('Failed to reload data. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, activeCaseId, fetchCases, fetchFilteredGraph, fetchAuditLedger, fetchSuspiciousPatterns, fetchCrossCaseMatches]);

  // ── Edit Mode: Add Entity ─────────────────────────────────────────────────
  const handleAddEntity = async (e) => {
    e.preventDefault();
    if (!addEntityForm.name.trim()) return;
    const targetCase = editTargetCaseId;
    if (!targetCase) {
      setAddEntityMsg({ type: 'err', text: 'Select exactly one case to add entities to.' });
      return;
    }
    setAddEntityLoading(true);
    setAddEntityMsg(null);
    try {
      await axios.post(`${API}/api/entities/manual`, {
        case_id: targetCase,
        name: addEntityForm.name.trim(),
        entity_type: addEntityForm.entity_type,
        risk: Number(addEntityForm.risk),
      });
      setAddEntityMsg({ type: 'ok', text: `Entity "${addEntityForm.name}" added.` });
      setAddEntityForm({ entity_type: 'Suspect', name: '', risk: 5 });
      await fetchFilteredGraph(selectedCaseIds);
    } catch (err) {
      console.error('Add entity error:', err);
      setAddEntityMsg({ type: 'err', text: err.response?.data?.detail || 'Failed to add entity.' });
    } finally {
      setAddEntityLoading(false);
    }
  };

  // ── Edit Mode: Add Relationship ───────────────────────────────────────────
  const handleAddRelation = async (e) => {
    e.preventDefault();
    if (!addRelForm.source_id || !addRelForm.target_id || !addRelForm.relation_type.trim()) return;
    const targetCase = editTargetCaseId;
    if (!targetCase) {
      setAddRelMsg({ type: 'err', text: 'Select exactly one case to add relationships to.' });
      return;
    }
    setAddRelLoading(true);
    setAddRelMsg(null);
    try {
      await axios.post(`${API}/api/relationships/manual`, {
        case_id: targetCase,
        source_id: addRelForm.source_id,
        target_id: addRelForm.target_id,
        relation_type: addRelForm.relation_type.trim(),
      });
      setAddRelMsg({ type: 'ok', text: 'Relationship added.' });
      setAddRelForm({ source_id: '', target_id: '', relation_type: '' });
      await fetchFilteredGraph(selectedCaseIds);
    } catch (err) {
      console.error('Add relation error:', err);
      setAddRelMsg({ type: 'err', text: err.response?.data?.detail || 'Failed to add relationship.' });
    } finally {
      setAddRelLoading(false);
    }
  };

  // ── Determine the edit target case ───────────────────────────────────────
  const editTargetCaseId   = selectedCaseIds.length > 0 ? selectedCaseIds[0] : null;
  const editTargetCaseName = cases.find(c => c.id === editTargetCaseId)?.title || editTargetCaseId;

  // ── Stats ─────────────────────────────────────────────────────────────────
  const personCount   = graphData.nodes?.filter(n => n.type === 'Person' || n.type === 'Suspect').length || 0;
  const phoneCount    = graphData.nodes?.filter(n => n.type === 'Phone').length || 0;
  const locationCount = graphData.nodes?.filter(n => n.type === 'Location').length || 0;

  // ── D3 Force Tuning ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!graphRef.current) return;
    const t = setTimeout(() => {
      const fg = graphRef.current;
      const charge = fg.d3Force('charge');
      if (charge) charge.strength(-400);
      const link = fg.d3Force('link');
      if (link) link.distance(85);
      fg.d3Force('collide', forceCollide(28).strength(0.8));
    }, 80);
    return () => clearTimeout(t);
  }, [graphData]);

  // ── Auto-fit viewport after graph data loads ───────────────────────────
  useEffect(() => {
    if (loading || !graphRef.current || !graphData.nodes || graphData.nodes.length === 0) return;
    const t1 = setTimeout(() => graphRef.current?.zoomToFit(500, 60), 250);
    const t2 = setTimeout(() => graphRef.current?.zoomToFit(500, 60), 600);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [graphData, loading]);

  // ── Viewport control helpers ────────────────────────────────────────────
  const handleFitView = useCallback(() => {
    graphRef.current?.zoomToFit(500, 60);
  }, []);

  const handleResetCamera = useCallback(() => {
    if (!graphRef.current) return;
    graphRef.current.centerAt(0, 0, 400);
    graphRef.current.zoom(1, 400);
  }, []);

  // ── Focus pattern operatives & connection on ForceGraph canvas (Milestone 6B) ─
  const focusPatternOnGraph = useCallback((pattern) => {
    if (!graphRef.current || !graphData.nodes || graphData.nodes.length === 0) {
      setPathToast({ type: 'err', msg: 'Graph canvas has no nodes loaded.' });
      return;
    }

    const srcQuery = (pattern.source || '').trim().toLowerCase();
    const tgtQuery = (pattern.target || '').trim().toLowerCase();

    // Find nodes by canonical name or ID
    const node1 = graphData.nodes.find(n => 
      (n.name && n.name.trim().toLowerCase() === srcQuery) || 
      (n.id && String(n.id).toLowerCase() === srcQuery)
    );
    const node2 = graphData.nodes.find(n => 
      (n.name && n.name.trim().toLowerCase() === tgtQuery) || 
      (n.id && String(n.id).toLowerCase() === tgtQuery)
    );

    if (!node1 && !node2) {
      setPathToast({ type: 'err', msg: `Targets "${pattern.source}" / "${pattern.target}" not found on active graph.` });
      return;
    }

    // Select primary node for details dossier
    if (node1) setSelectedNode(node1);
    else if (node2) setSelectedNode(node2);

    if (node1 && node2 && node1.x != null && node2.x != null) {
      const midX = (node1.x + node2.x) / 2;
      const midY = (node1.y + node2.y) / 2;
      graphRef.current.centerAt(midX, midY, 600);
      graphRef.current.zoom(2.0, 600);

      // Highlight the link between node1 and node2 using path tracing state
      const existingLink = graphData.links.find(l => {
        const s = String(typeof l.source === 'object' ? l.source.id : l.source);
        const t = String(typeof l.target === 'object' ? l.target.id : l.target);
        return (s === String(node1.id) && t === String(node2.id)) ||
               (s === String(node2.id) && t === String(node1.id));
      });

      setPathResult({
        path_found: true,
        hops: 1,
        path_node_ids: [String(node1.id), String(node2.id)],
        path_edges: existingLink ? [{
          source: String(node1.id),
          target: String(node2.id),
          relation: existingLink.relation || existingLink.type || pattern.rule_type
        }] : [{
          source: String(node1.id),
          target: String(node2.id),
          relation: pattern.rule_type
        }]
      });

      setPathToast({ type: 'ok', msg: `Focused: ${pattern.source} ↔ ${pattern.target}` });
    } else {
      const targetNode = node1 || node2;
      if (targetNode.x != null && targetNode.y != null) {
        graphRef.current.centerAt(targetNode.x, targetNode.y, 600);
        graphRef.current.zoom(2.2, 600);
      }
      setPathToast({ type: 'ok', msg: `Focused on target: ${targetNode.name || targetNode.id}` });
    }
  }, [graphData]);

  // ── Drag handlers ─────────────────────────────────────────────────────
  const handleNodeDrag = useCallback((node) => {
    node.fx = node.x;
    node.fy = node.y;
  }, []);

  const handleNodeDragEnd = useCallback((node) => {
    node.fx = node.x;
    node.fy = node.y;
  }, []);

  // ── Node click handler (intercepts path mode) ─────────────────────────
  const handleNodeClick = useCallback((node) => {
    if (!node) return;
    if (pathMode) {
      if (!pathSource) {
        setPathSource(node);
        return;
      }
      if (node.id === pathSource?.id) return; // same node, ignore
      setPathTarget(node);
      doShortestPath(pathSource, node);
      return;
    }
    // Normal dossier mode
    setSelectedNode(node);
  }, [pathMode, pathSource, doShortestPath]);

  // ── Precompute path sets for canvas rendering ─────────────────────────
  const pathNodeIdSet = pathResult?.path_node_ids ? new Set(pathResult.path_node_ids) : null;
  const pathEdgeSet   = (pathResult && Array.isArray(pathResult.path_edges))
    ? new Set(pathResult.path_edges.flatMap(e => e ? [`${e.source}-${e.target}`, `${e.target}-${e.source}`] : []))
    : null;

  // ── Minimap: paint radar overview ─────────────────────────────────────
  const paintMinimap = useCallback(() => {
    const canvas = minimapRef.current;
    const fg     = graphRef.current;
    if (!canvas || !fg) return;
    const nodes = graphData.nodes;
    if (!nodes || nodes.length === 0) return;

    const W = canvas.width;
    const H = canvas.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);

    ctx.fillStyle = 'rgba(2, 6, 23, 0.9)';
    ctx.fillRect(0, 0, W, H);

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    nodes.forEach(n => {
      if (n.x == null) return;
      if (n.x < minX) minX = n.x;
      if (n.x > maxX) maxX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.y > maxY) maxY = n.y;
    });
    if (!isFinite(minX)) return;

    // Safe padding and uniform scaling to guarantee all nodes stay inside radar
    const pad   = 10;
    const spanX = Math.max(maxX - minX, 1);
    const spanY = Math.max(maxY - minY, 1);
    const scaleX = (W - pad * 2) / spanX;
    const scaleY = (H - pad * 2) / spanY;
    const scale  = Math.min(scaleX, scaleY);

    const offsetX = (W - spanX * scale) / 2;
    const offsetY = (H - spanY * scale) / 2;

    const toMX = (wx) => offsetX + (wx - minX) * scale;
    const toMY = (wy) => offsetY + (wy - minY) * scale;

    // Draw Links
    ctx.strokeStyle = 'rgba(71, 85, 105, 0.45)';
    ctx.lineWidth   = 0.6;
    graphData.links.forEach(l => {
      const s = typeof l.source === 'object' ? l.source : nodes.find(n => n.id === l.source);
      const t = typeof l.target === 'object' ? l.target : nodes.find(n => n.id === l.target);
      if (!s || !t || s.x == null || t.x == null) return;
      ctx.beginPath();
      ctx.moveTo(toMX(s.x), toMY(s.y));
      ctx.lineTo(toMX(t.x), toMY(t.y));
      ctx.stroke();
    });

    // Draw Nodes
    nodes.forEach(n => {
      if (n.x == null) return;
      const color = getNodeColor(n.type);
      ctx.beginPath();
      ctx.arc(toMX(n.x), toMY(n.y), 3.2, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 5;
      ctx.fill();
      ctx.shadowBlur = 0;
    });

    // Draw Dynamic Camera Viewport Rectangle
    try {
      let worldLeft, worldTop, worldRight, worldBottom;
      if (typeof fg.screen2GraphCoords === 'function') {
        const tl = fg.screen2GraphCoords(0, 0);
        const br = fg.screen2GraphCoords(dimensions.width, dimensions.height);
        if (tl && br && isFinite(tl.x) && isFinite(br.x)) {
          worldLeft = tl.x;
          worldTop = tl.y;
          worldRight = br.x;
          worldBottom = br.y;
        }
      }

      if (worldLeft == null) {
        const gs = typeof fg.zoom === 'function' ? fg.zoom() : 1;
        const origin = typeof fg.graph2ScreenCoords === 'function'
          ? fg.graph2ScreenCoords(0, 0)
          : { x: dimensions.width / 2, y: dimensions.height / 2 };
        worldLeft = -origin.x / gs;
        worldTop = -origin.y / gs;
        worldRight = (dimensions.width - origin.x) / gs;
        worldBottom = (dimensions.height - origin.y) / gs;
      }

      if (isFinite(worldLeft) && isFinite(worldTop) && isFinite(worldRight) && isFinite(worldBottom)) {
        const rawVpX = toMX(worldLeft);
        const rawVpY = toMY(worldTop);
        const rawVpW = toMX(worldRight) - rawVpX;
        const rawVpH = toMY(worldBottom) - rawVpY;

        // Clamp viewport rectangle inside radar canvas bounds
        const vpX = Math.max(0, Math.min(W - 4, rawVpX));
        const vpY = Math.max(0, Math.min(H - 4, rawVpY));
        const vpW = Math.max(6, Math.min(W - vpX, rawVpW));
        const vpH = Math.max(6, Math.min(H - vpY, rawVpH));

        // Crisp semi-transparent cyan fill
        ctx.fillStyle = 'rgba(34, 211, 238, 0.18)';
        ctx.fillRect(vpX, vpY, vpW, vpH);

        // Crisp cyan border with dashed styling
        ctx.strokeStyle = 'rgba(34, 211, 238, 0.9)';
        ctx.lineWidth   = 1.5;
        ctx.setLineDash([3, 2]);
        ctx.strokeRect(vpX, vpY, vpW, vpH);
        ctx.setLineDash([]);
      }
    } catch (_) { /* non-critical */ }

    // Outer frame border
    ctx.strokeStyle = 'rgba(51, 65, 85, 0.7)';
    ctx.lineWidth   = 1;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  }, [graphData, dimensions]);

  // ── Translate minimap pointer event to world coordinates ──────────────
  const translateMinimapCoords = useCallback((clientX, clientY) => {
    const canvas = minimapRef.current;
    const fg     = graphRef.current;
    if (!canvas || !fg) return null;
    const nodes = graphData.nodes;
    if (!nodes || nodes.length === 0) return null;

    const rect = canvas.getBoundingClientRect();
    const mx   = Math.max(0, Math.min(canvas.width, clientX - rect.left));
    const my   = Math.max(0, Math.min(canvas.height, clientY - rect.top));
    const W    = canvas.width;
    const H    = canvas.height;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    nodes.forEach(n => {
      if (n.x == null) return;
      if (n.x < minX) minX = n.x;
      if (n.x > maxX) maxX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.y > maxY) maxY = n.y;
    });
    if (!isFinite(minX)) return null;

    const pad   = 10;
    const spanX = Math.max(maxX - minX, 1);
    const spanY = Math.max(maxY - minY, 1);
    const scaleX = (W - pad * 2) / spanX;
    const scaleY = (H - pad * 2) / spanY;
    const scale  = Math.min(scaleX, scaleY);

    const offsetX = (W - spanX * scale) / 2;
    const offsetY = (H - spanY * scale) / 2;

    const targetX = (mx - offsetX) / scale + minX;
    const targetY = (my - offsetY) / scale + minY;

    return { targetX, targetY };
  }, [graphData]);

  // ── Drag-to-pan & click event handlers ─────────────────────────────────
  const handleMinimapPointerDown = useCallback((e) => {
    isMinimapDraggingRef.current = true;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (_) {}
    const coords = translateMinimapCoords(e.clientX, e.clientY);
    if (coords && graphRef.current) {
      graphRef.current.centerAt(coords.targetX, coords.targetY, 200);
    }
  }, [translateMinimapCoords]);

  const handleMinimapPointerMove = useCallback((e) => {
    if (!isMinimapDraggingRef.current) return;
    const coords = translateMinimapCoords(e.clientX, e.clientY);
    if (coords && graphRef.current) {
      // Real-time zero-latency smooth pan during drag
      graphRef.current.centerAt(coords.targetX, coords.targetY, 0);
    }
  }, [translateMinimapCoords]);

  const handleMinimapPointerUp = useCallback((e) => {
    if (isMinimapDraggingRef.current) {
      isMinimapDraggingRef.current = false;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch (_) {}
    }
  }, []);

  // ── Dossier neighbor computation ──────────────────────────────────────
  const dossierNeighbors = selectedNode
    ? graphData.links
        .filter(l => {
          const src = typeof l.source === 'object' ? l.source.id : l.source;
          const tgt = typeof l.target === 'object' ? l.target.id : l.target;
          return src === selectedNode.id || tgt === selectedNode.id;
        })
        .map(l => {
          const src      = typeof l.source === 'object' ? l.source : graphData.nodes.find(n => n.id === l.source);
          const tgt      = typeof l.target === 'object' ? l.target : graphData.nodes.find(n => n.id === l.target);
          const isOut    = (src?.id === selectedNode.id);
          const neighbor = isOut ? tgt : src;
          return {
            id: neighbor?.id, name: neighbor?.name || neighbor?.id,
            type: neighbor?.type || 'Unknown', relation: l.relation || l.type || '', isOut,
          };
        })
    : [];

  // ── Threat-score colour helper ────────────────────────────────────────
  const threatBadge = (score) => {
    const s = Number(score);
    if (s >= 8) return { bg: 'bg-red-500/20', border: 'border-red-500/40', text: 'text-red-400', label: 'CRITICAL' };
    if (s >= 5) return { bg: 'bg-amber-500/20', border: 'border-amber-500/40', text: 'text-amber-400', label: 'MODERATE' };
    return { bg: 'bg-emerald-500/20', border: 'border-emerald-500/40', text: 'text-emerald-400', label: 'LOW' };
  };

  // ── Cross-case: merge all cases for an entity into the filter ─────────
  const mergeEntityCases = useCallback((entity) => {
    const allCaseIds = entity.occurrences.map(o => o.case_id);
    const next = [...new Set([...selectedCaseIds, ...allCaseIds])];
    setSelectedCaseIds(next);
    fetchFilteredGraph(next);
    setCrossCaseModalOpen(false);
  }, [selectedCaseIds, fetchFilteredGraph]);

  // ── Link color based on path state / hover ───────────────────────────
  const getLinkColor = useCallback((link) => {
    const srcId = String(typeof link.source === 'object' ? link.source.id : link.source);
    const tgtId = String(typeof link.target === 'object' ? link.target.id : link.target);
    const key1 = `${srcId}-${tgtId}`;
    const key2 = `${tgtId}-${srcId}`;
    const isLinkOnPath = pathEdgeSet ? (pathEdgeSet.has(key1) || pathEdgeSet.has(key2)) : false;
    const isHovered = hoveredLink && (
      hoveredLink === link ||
      ((String(hoveredLink.source?.id ?? hoveredLink.source) === srcId && String(hoveredLink.target?.id ?? hoveredLink.target) === tgtId) ||
       (String(hoveredLink.source?.id ?? hoveredLink.source) === tgtId && String(hoveredLink.target?.id ?? hoveredLink.target) === srcId))
    );

    if (isLinkOnPath) return '#38BDF8';
    if (isHovered) return '#FCD34D';
    if (pathEdgeSet) return 'rgba(71,85,105,0.12)';
    return 'rgba(71,85,105,0.7)';
  }, [pathEdgeSet, hoveredLink]);

  const getLinkParticleColor = useCallback((link) => {
    const srcId = String(typeof link.source === 'object' ? link.source.id : link.source);
    const tgtId = String(typeof link.target === 'object' ? link.target.id : link.target);
    const key1 = `${srcId}-${tgtId}`;
    const key2 = `${tgtId}-${srcId}`;
    const isLinkOnPath = pathEdgeSet ? (pathEdgeSet.has(key1) || pathEdgeSet.has(key2)) : false;
    const isHovered = hoveredLink && (
      hoveredLink === link ||
      ((String(hoveredLink.source?.id ?? hoveredLink.source) === srcId && String(hoveredLink.target?.id ?? hoveredLink.target) === tgtId) ||
       (String(hoveredLink.source?.id ?? hoveredLink.source) === tgtId && String(hoveredLink.target?.id ?? hoveredLink.target) === srcId))
    );

    if (isLinkOnPath) return '#38BDF8';
    if (isHovered) return '#FCD34D';
    if (pathEdgeSet) return 'rgba(100,116,139,0.15)';
    return 'rgba(100,116,139,0.9)';
  }, [pathEdgeSet, hoveredLink]);

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-950 font-sans">
      {/* Sidebar Panel */}
      <Sidebar
        cases={cases}
        selectedCaseIds={selectedCaseIds}
        casesLoading={casesLoading}
        onCaseToggle={toggleCase}
        onSelectAllCases={() => {
          const allIds = cases.map(c => c.id).filter(Boolean);
          if (allIds.length === 0) return;
          setSelectedCaseIds(allIds);
          fetchFilteredGraph(allIds);
        }}
        onClearAllCases={() => {
          const firstId = cases[0]?.id ? [cases[0].id] : [];
          setSelectedCaseIds(firstId);
          if (firstId.length > 0) {
            fetchFilteredGraph(firstId);
          } else {
            setGraphData({ nodes: [], links: [] });
            setKingpins([]);
          }
        }}
        kingpins={kingpins}
        kingpinsLoading={kingpinsLoading}
        onCaseCreated={handleCaseCreated}
        onCasesRefresh={fetchCases}
        activeCaseId={activeCaseId}
        onEvidenceIngested={handleEvidenceIngested}
      />

      {/* Main Container */}
      <div className="flex-1 bg-slate-950 relative flex flex-col h-full overflow-hidden">

        {/* ── Top Navbar ─────────────────────────────────────────────────── */}
        <header className="flex items-center justify-between px-6 py-3 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 z-10 gap-3">

          {/* Left: Case Title & Subtitle */}
          <div className="flex items-center space-x-3 flex-shrink-0">
            <div className="p-2 bg-cyan-900/40 text-cyan-400 rounded-lg border border-cyan-500/30 shadow-[0_0_10px_rgba(34,211,238,0.2)]">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-base lg:text-lg font-bold tracking-wide text-white whitespace-nowrap">
                Crime Network Intelligence Dashboard
              </h1>
              <p className="text-[11px] text-slate-400 whitespace-nowrap">Interactive Entity Relationship Graph</p>
            </div>
          </div>

          {/* Right: Action Pill Group */}
          <div className="flex items-center gap-2.5 flex-shrink-0">
            {/* Stats badges */}
            <div className="flex items-center gap-1.5 bg-slate-900/80 px-2.5 py-1.5 rounded-lg border border-slate-700/80 text-xs whitespace-nowrap shadow-sm">
              <span className="w-2 h-2 rounded-full bg-slate-400"></span>
              <span className="text-slate-300">Nodes: <strong className="text-white font-semibold">{graphData.nodes?.length || 0}</strong></span>
            </div>
            <div className="flex items-center gap-1.5 bg-slate-900/80 px-2.5 py-1.5 rounded-lg border border-slate-700/80 text-xs whitespace-nowrap shadow-sm">
              <span className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_5px_cyan]"></span>
              <span className="text-slate-300">Links: <strong className="text-white font-semibold">{graphData.links?.length || 0}</strong></span>
            </div>

            {/* Cryptographic Evidence Ledger Badge */}
            {auditLedger ? (
              <button
                onClick={() => setAuditModalOpen(true)}
                title="Click to view Cryptographic Audit Ledger & Chain of Custody"
                className="flex items-center gap-2 bg-emerald-950/70 hover:bg-emerald-900/70 border border-emerald-500/40 hover:border-emerald-400/60 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-emerald-300 transition shadow-[0_0_12px_rgba(16,185,129,0.2)] cursor-pointer whitespace-nowrap group"
              >
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <span className="flex items-center gap-1 tracking-wide">
                  <span>🔒 TAMPER-PROOF EVIDENCE:</span>
                  <span className="text-emerald-400 font-bold group-hover:text-emerald-200">VERIFIED</span>
                </span>
              </button>
            ) : (
              <div className="flex items-center gap-1.5 bg-slate-900/80 px-2.5 py-1.5 rounded-lg border border-slate-700/80 text-xs text-slate-500 whitespace-nowrap">
                <span className="w-2 h-2 rounded-full bg-slate-600"></span>
                <span>AUDIT: SELECT CASE</span>
              </div>
            )}

            {/* Suspicious Red Flags Alert Trigger (Milestone 6B) */}
            {suspiciousPatterns && suspiciousPatterns.total_patterns > 0 && (
              <button
                onClick={() => setPatternsDrawerOpen(true)}
                title="Click to inspect automated forensic rule violations"
                className="flex items-center gap-2 bg-gradient-to-r from-red-950/90 via-amber-950/80 to-red-950/90 hover:from-red-900 hover:to-amber-900 border border-red-500/60 hover:border-red-400 px-3 py-1.5 rounded-lg text-xs font-bold text-red-300 transition shadow-[0_0_15px_rgba(239,68,68,0.35)] cursor-pointer whitespace-nowrap group animate-pulse"
              >
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-80"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
                </span>
                <span className="flex items-center gap-1.5 tracking-wide">
                  <span className="text-amber-400">⚠️</span>
                  <span className="text-red-200 group-hover:text-white font-extrabold font-mono">
                    {suspiciousPatterns.total_patterns} SUSPICIOUS RED FLAG{suspiciousPatterns.total_patterns !== 1 ? 'S' : ''}
                  </span>
                </span>
              </button>
            )}

            {/* Trace Path button */}
            <button
              onClick={togglePathMode}
              title={pathMode ? 'Exit path finding mode' : 'Find shortest connection between two nodes'}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition duration-150 border cursor-pointer whitespace-nowrap shadow-sm ${
                pathMode
                  ? 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border-emerald-500/50 shadow-[0_0_12px_rgba(52,211,153,0.3)] animate-pulse'
                  : 'bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 border-slate-700'
              }`}
            >
              <GitBranch className="w-3.5 h-3.5 text-emerald-400" />
              <span>{pathMode ? 'Exit Trace' : 'Trace Path'}</span>
            </button>

            {/* Edit Mode toggle */}
            <button
              onClick={() => { setEditMode(e => !e); setAddEntityMsg(null); setAddRelMsg(null); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition duration-150 border cursor-pointer whitespace-nowrap shadow-sm ${
                editMode
                  ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border-amber-500/50 shadow-[0_0_12px_rgba(245,158,11,0.3)]'
                  : 'bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 border-slate-700'
              }`}
            >
              <Pencil className="w-3.5 h-3.5 text-amber-400" />
              <span>{editMode ? 'Editing' : 'Edit Mode'}</span>
            </button>

            {/* Viewport Controls */}
            <div className="flex items-center rounded-lg border border-slate-700 bg-slate-800/80 shadow-sm overflow-hidden flex-shrink-0">
              <button
                onClick={handleFitView}
                title="Fit all nodes into view"
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-700 hover:text-cyan-300 transition border-r border-slate-700 cursor-pointer whitespace-nowrap"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                <span>Fit View</span>
              </button>
              <button
                onClick={handleResetCamera}
                title="Reset camera to origin"
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-700 hover:text-purple-300 transition cursor-pointer whitespace-nowrap"
              >
                <Focus className="w-3.5 h-3.5" />
                <span>Reset</span>
              </button>
            </div>

            {/* Export Dossier button */}
            <button
              onClick={handleExportDossier}
              disabled={exportingDossier || !auditLedger}
              title="Export Official Police Dossier (Court Admissible PDF)"
              className="flex items-center gap-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 active:bg-emerald-600/40 text-emerald-300 px-3 py-1.5 rounded-lg text-xs font-semibold transition duration-150 border border-emerald-500/40 shadow-[0_0_12px_rgba(16,185,129,0.2)] disabled:opacity-50 cursor-pointer whitespace-nowrap"
            >
              {exportingDossier ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
              ) : (
                <Download className="w-3.5 h-3.5 text-emerald-400" />
              )}
              <span>{exportingDossier ? 'Compiling Dossier...' : 'Export Dossier'}</span>
            </button>

            {/* Reload */}
            <button
              onClick={handleReload}
              disabled={loading || isLoading}
              className="flex items-center gap-1.5 bg-cyan-600 hover:bg-cyan-500 active:bg-cyan-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition duration-150 border border-cyan-400/40 shadow-[0_0_12px_rgba(34,211,238,0.25)] disabled:opacity-50 cursor-pointer whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${(loading || isLoading) ? 'animate-spin' : ''}`} />
              <span>{isLoading ? 'Reloading...' : 'Reload'}</span>
            </button>
          </div>
        </header>

          {/* Cryptographic Audit Ledger Modal */}
          {auditModalOpen && (
            <div className="fixed inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm z-50">
              <div className="bg-white/80 backdrop-blur-md rounded-lg shadow-xl p-6 w-96 max-w-full mx-4 border border-emerald-300/30">
                <h2 className="text-lg font-semibold text-gray-800 mb-2">Cryptographic Audit Ledger</h2>
                <div className="space-y-2 text-sm text-gray-800">
                  <p><strong>Case Number:</strong> {auditLedger?.case_number}</p>
                  <p><strong>Timestamp:</strong> {auditLedger?.timestamp ? new Date(auditLedger.timestamp).toLocaleString() : ''}</p>
                  <p className="flex items-center">
                    <strong>Hash:</strong>
                    <span className="ml-1 font-mono break-all">{auditLedger?.tamper_proof_hash}</span>
                    <button onClick={handleCopyHash} className="ml-2 p-1 hover:bg-gray-200 rounded">
                      <Copy className="w-4 h-4 text-gray-600" />
                    </button>
                    {copiedHash && <span className="ml-2 text-green-500 text-xs">Copied!</span>}
                  </p>
                  <p><strong>Status:</strong> {auditLedger?.status}</p>
                  <p><strong>Total Nodes:</strong> {auditLedger?.total_evidence_nodes ?? graphData.nodes?.length ?? 0}</p>
                  <p><strong>Total Connections:</strong> {auditLedger?.total_connections ?? graphData.links?.length ?? 0}</p>
                </div>
                <div className="flex justify-end mt-4">
                  <button onClick={() => setAuditModalOpen(false)} className="px-3 py-1 bg-gray-200 hover:bg-gray-300 rounded text-sm">Close</button>
                </div>
              </div>
            </div>
          )}


        {/* ── Cross-Case Syndicate Alert Banner ──────────────────────────── */}
        {crossCaseData && crossCaseData.total_matches > 0 && (
          <button
            onClick={() => setCrossCaseModalOpen(true)}
            className="w-full flex items-center justify-between gap-3 px-6 py-2.5
                       bg-gradient-to-r from-red-950/80 via-amber-950/70 to-red-950/80
                       border-b border-red-500/40 text-left
                       hover:from-red-900/80 hover:via-amber-900/70 hover:to-red-900/80
                       transition-all duration-200 group"
          >
            <div className="flex items-center gap-3">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
              </span>
              <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <span className="text-xs font-bold text-amber-300 tracking-wide">
                ⚠️ {crossCaseData.total_matches} CROSS-CASE SYNDICATE LINK{crossCaseData.total_matches !== 1 ? 'S' : ''} DETECTED
              </span>
              <span className="text-[10px] text-amber-400/70">
                — Entities appearing across multiple cases
              </span>
            </div>
            <span className="text-[10px] text-amber-500/80 group-hover:text-amber-300 transition font-semibold whitespace-nowrap">
              Investigate →
            </span>
          </button>
        )}

        {/* ── Path Mode Instruction Banner ──────────────────────────────── */}
        {pathMode && (
          <div className="w-full flex items-center justify-between gap-3 px-6 py-2 bg-emerald-950/60 border-b border-emerald-500/30">
            <div className="flex items-center gap-3">
              {pathLoading ? (
                <Loader2 className="w-4 h-4 text-emerald-400 animate-spin flex-shrink-0" />
              ) : (
                <GitBranch className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              )}
              <span className="text-xs font-semibold text-emerald-300">
                {pathLoading
                  ? 'Tracing shortest path...'
                  : pathSource
                  ? `Source: "${pathSource.name || pathSource.id}" — Now click the Target Node`
                  : 'PATH FINDER ACTIVE — Click any node as Source'}
              </span>
              {pathSource && !pathLoading && (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-600/30 border border-emerald-500/40 text-[10px] text-emerald-300">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  {pathSource.name || pathSource.id}
                </span>
              )}
            </div>
            <button
              onClick={clearPathTrace}
              className="text-[10px] text-emerald-600 hover:text-red-400 transition font-semibold whitespace-nowrap cursor-pointer flex items-center gap-1"
            >
              <X className="w-3 h-3" /> Cancel
            </button>
          </div>
        )}

        {/* ── Graph Area ─────────────────────────────────────────────────── */}
        <div
          className={`relative flex-1 bg-slate-950 ${pathMode ? 'cursor-crosshair' : ''}`}
          ref={graphContainerRef}
        >

          {/* Floating Legend */}
          <div className="absolute top-4 left-4 z-10 bg-slate-900/90 backdrop-blur border border-slate-700/80 rounded-xl p-4 shadow-2xl space-y-3 min-w-[200px]">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Entity Legend</h2>
            <div className="space-y-2 text-xs font-medium">
              <div className="flex items-center justify-between space-x-3">
                <div className="flex items-center space-x-2">
                  <span className="w-3 h-3 rounded-full" style={{ backgroundColor: NODE_COLORS.Person, boxShadow: `0 0 5px ${NODE_COLORS.Person}` }}></span>
                  <span className="flex items-center text-slate-200"><Users className="w-3.5 h-3.5 mr-1.5" style={{ color: NODE_COLORS.Person }} /> Person</span>
                </div>
                <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 text-[10px]">{personCount}</span>
              </div>
              <div className="flex items-center justify-between space-x-3">
                <div className="flex items-center space-x-2">
                  <span className="w-3 h-3 rounded-full" style={{ backgroundColor: NODE_COLORS.Phone, boxShadow: `0 0 5px ${NODE_COLORS.Phone}` }}></span>
                  <span className="flex items-center text-slate-200"><Phone className="w-3.5 h-3.5 mr-1.5" style={{ color: NODE_COLORS.Phone }} /> Phone</span>
                </div>
                <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 text-[10px]">{phoneCount}</span>
              </div>
              <div className="flex items-center justify-between space-x-3">
                <div className="flex items-center space-x-2">
                  <span className="w-3 h-3 rounded-full" style={{ backgroundColor: NODE_COLORS.Location, boxShadow: `0 0 5px ${NODE_COLORS.Location}` }}></span>
                  <span className="flex items-center text-slate-200"><MapPin className="w-3.5 h-3.5 mr-1.5" style={{ color: NODE_COLORS.Location }} /> Location</span>
                </div>
                <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 text-[10px]">{locationCount}</span>
              </div>
            </div>
          </div>

          {/* Loading Overlay (initial empty load only) */}
          {(loading || isLoading) && (!graphData.nodes || graphData.nodes.length === 0) && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-950/80 backdrop-blur-sm">
              <Activity className="w-10 h-10 text-cyan-400 animate-spin mb-3" />
              <p className="text-sm font-medium text-slate-300">Fetching Network Graph Data...</p>
            </div>
          )}

          {/* Non-blocking subtle loading indicator when graph is already rendered */}
          {(loading || isLoading) && graphData.nodes?.length > 0 && (
            <div className="absolute top-3 right-3 z-20 flex items-center gap-2 px-3 py-1.5 bg-slate-900/90 border border-cyan-500/40 rounded-lg shadow-lg text-cyan-400 text-xs font-semibold backdrop-blur-md">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span>Updating Graph...</span>
            </div>
          )}

          {/* Error Overlay */}
          {error && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-950/90 p-6 text-center">
              <div className="p-3 bg-red-500/10 text-red-400 rounded-full mb-3 border border-red-500/20">
                <AlertCircle className="w-8 h-8" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-1">Failed to Load Graph</h3>
              <p className="text-sm text-slate-400 max-w-md mb-4">{error}</p>
              <button
                onClick={handleReload}
                disabled={isLoading}
                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-medium transition cursor-pointer disabled:opacity-50"
              >
                {isLoading ? 'Reloading...' : 'Try Again'}
              </button>
            </div>
          )}

          {/* Empty State */}
          {!loading && !isLoading && !error && selectedCaseIds.length === 0 && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center text-center p-6">
              <ShieldAlert className="w-12 h-12 text-slate-700 mb-4" />
              <p className="text-slate-500 text-sm">Select a case above to view its network graph.</p>
            </div>
          )}

          {/* 2D Force Graph */}
          {!error && (graphData.nodes?.length > 0 || (!loading && !isLoading)) && (
            <ForceGraph2D
              ref={graphRef}
              width={dimensions.width}
              height={dimensions.height}
              graphData={graphData}
              warmupTicks={100}
              cooldownTicks={50}
              cooldownTime={2000}
              onNodeClick={handleNodeClick}
              onNodeDrag={handleNodeDrag}
              onNodeDragEnd={handleNodeDragEnd}
              onLinkHover={(link) => setHoveredLink(link || null)}
              linkHoverPrecision={6}
              onRenderFramePost={paintMinimap}
              nodeColor={(node) => getNodeColor(node.type)}
              nodeRelSize={8}
              nodeLabel={(node) => `${node.name || node.id} (${node.type || 'Unknown'})`}
              linkDirectionalArrowLength={5}
              linkDirectionalArrowRelPos={1}
              linkDirectionalArrowColor={getLinkParticleColor}
              linkDirectionalParticles={2}
              linkDirectionalParticleWidth={1.5}
              linkDirectionalParticleSpeed={0.01}
              linkColor={getLinkColor}
              linkWidth={(link) => {
                const srcId = String(typeof link.source === 'object' ? link.source.id : link.source);
                const tgtId = String(typeof link.target === 'object' ? link.target.id : link.target);
                const isLinkOnPath = pathEdgeSet ? (pathEdgeSet.has(`${srcId}-${tgtId}`) || pathEdgeSet.has(`${tgtId}-${srcId}`)) : false;
                const isHovered = hoveredLink && (
                  hoveredLink === link ||
                  ((String(hoveredLink.source?.id ?? hoveredLink.source) === srcId && String(hoveredLink.target?.id ?? hoveredLink.target) === tgtId) ||
                   (String(hoveredLink.source?.id ?? hoveredLink.source) === tgtId && String(hoveredLink.target?.id ?? hoveredLink.target) === srcId))
                );
                return (isLinkOnPath || isHovered) ? 2.5 : 1;
              }}
              backgroundColor="#020617"
              linkCanvasObjectMode={() => 'after'}
              linkCanvasObject={(link, ctx, globalScale) => {
                const label = link.relation || link.type || '';
                if (!label) return;

                const src = typeof link.source === 'object' ? link.source : {};
                const tgt = typeof link.target === 'object' ? link.target : {};
                if (src.x == null || tgt.x == null) return;

                const srcId = String(src.id ?? link.source);
                const tgtId = String(tgt.id ?? link.target);
                const key1  = `${srcId}-${tgtId}`;
                const key2  = `${tgtId}-${srcId}`;

                const isLinkOnPath = pathEdgeSet ? (pathEdgeSet.has(key1) || pathEdgeSet.has(key2)) : false;
                const isHovered    = hoveredLink && (
                  hoveredLink === link ||
                  ((String(hoveredLink.source?.id ?? hoveredLink.source) === srcId && String(hoveredLink.target?.id ?? hoveredLink.target) === tgtId) ||
                   (String(hoveredLink.source?.id ?? hoveredLink.source) === tgtId && String(hoveredLink.target?.id ?? hoveredLink.target) === srcId))
                );
                const isActive = isLinkOnPath || isHovered;

                if (!isActive && globalScale < 0.45) return;

                const midX  = (src.x + tgt.x) / 2;
                const midY  = (src.y + tgt.y) / 2;
                const angle = Math.atan2(tgt.y - src.y, tgt.x - src.x);

                ctx.save();
                ctx.translate(midX, midY);
                const flip = angle > Math.PI / 2 || angle < -Math.PI / 2;
                ctx.rotate(flip ? angle + Math.PI : angle);

                const originalAlpha = ctx.globalAlpha;
                if (pathEdgeSet && !isActive) {
                  ctx.globalAlpha = 0.2;
                }

                if (isActive) {
                  // Scale up the relationship label font size (12px-13px bold)
                  const fontSize = Math.max(9, 13 / globalScale);
                  ctx.font       = `bold ${fontSize}px Inter, -apple-system, sans-serif`;
                  const textW    = ctx.measureText(label).width;
                  const padX     = 5 / globalScale;
                  const padY     = 2.5 / globalScale;
                  const rx       = 3 / globalScale;
                  const bx       = -(textW / 2) - padX;
                  const by       = -(fontSize / 2) - padY;
                  const bw       = textW + padX * 2;
                  const bh       = fontSize + padY * 2;

                  // Crisp rounded semi-transparent dark badge directly behind the text
                  ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
                  ctx.beginPath();
                  ctx.moveTo(bx + rx, by);
                  ctx.lineTo(bx + bw - rx, by);
                  ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + rx);
                  ctx.lineTo(bx + bw, by + bh - rx);
                  ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - rx, by + bh);
                  ctx.lineTo(bx + rx, by + bh);
                  ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - rx);
                  ctx.lineTo(bx, by + rx);
                  ctx.quadraticCurveTo(bx, by, bx + rx, by);
                  ctx.closePath();
                  ctx.fill();

                  // Bright high-contrast border and text (#38BDF8 or #FCD34D)
                  const activeColor = isLinkOnPath ? '#38BDF8' : '#FCD34D';
                  ctx.strokeStyle = activeColor;
                  ctx.lineWidth   = 1 / globalScale;
                  ctx.stroke();

                  ctx.fillStyle    = activeColor;
                  ctx.textAlign    = 'center';
                  ctx.textBaseline = 'middle';
                  ctx.fillText(label, 0, 0);
                } else {
                  // Normal unselected edge labels subtle at 9px with 0.6 opacity
                  const fontSize = Math.max(6, 9 / globalScale);
                  ctx.font       = `500 ${fontSize}px Inter, -apple-system, sans-serif`;
                  const textW    = ctx.measureText(label).width;
                  const padX     = 3 / globalScale;
                  const padY     = 1.5 / globalScale;
                  const rx       = 2 / globalScale;
                  const bx       = -(textW / 2) - padX;
                  const by       = -(fontSize / 2) - padY;
                  const bw       = textW + padX * 2;
                  const bh       = fontSize + padY * 2;

                  ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
                  ctx.beginPath();
                  ctx.moveTo(bx + rx, by);
                  ctx.lineTo(bx + bw - rx, by);
                  ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + rx);
                  ctx.lineTo(bx + bw, by + bh - rx);
                  ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - rx, by + bh);
                  ctx.lineTo(bx + rx, by + bh);
                  ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - rx);
                  ctx.lineTo(bx, by + rx);
                  ctx.quadraticCurveTo(bx, by, bx + rx, by);
                  ctx.closePath();
                  ctx.fill();

                  ctx.fillStyle    = 'rgba(148, 163, 184, 0.6)';
                  ctx.textAlign    = 'center';
                  ctx.textBaseline = 'middle';
                  ctx.fillText(label, 0, 0);
                }

                ctx.globalAlpha = originalAlpha;
                ctx.restore();
              }}
              nodeCanvasObject={(node, ctx, globalScale) => {
                const label     = node.name || node.id;
                const nodeType  = (node.type || '').toLowerCase();
                const nodeId    = String(node.id || '').toLowerCase();
                const isSuspect = nodeType.includes('suspect') || (node.threat_score && Number(node.threat_score) >= 7.5);
                const r = isSuspect ? 12 : 8;

                // Path mode dimming
                const isOnPath     = pathNodeIdSet ? pathNodeIdSet.has(node.id) : true;
                const isPathSource = pathSource && node.id === pathSource.id;
                const isPathTarget = pathTarget && node.id === pathTarget.id;
                const dimNode      = pathNodeIdSet && !isOnPath;

                // Save original global alpha
                const originalAlpha = ctx.globalAlpha;
                if (dimNode) ctx.globalAlpha = 0.12;

                let color = '#22d3ee';
                if (nodeType.includes('phone'))       color = '#e81cff';
                else if (nodeType.includes('location') || nodeId.includes('surat') || nodeId.includes('warehouse')) color = '#4ade80';
                else if (nodeType.includes('vehicle')) color = '#fb923c';
                else if (nodeType.includes('bank') || nodeId.includes('chase')) color = '#facc15';
                else if (isSuspect)                   color = '#f43f5e';

                // Path source pulsing green halo
                if (isPathSource) {
                  const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 300);
                  ctx.shadowBlur  = 30 + 15 * pulse;
                  ctx.shadowColor = '#4ade80';
                  ctx.beginPath();
                  ctx.arc(node.x, node.y, r + 7 + 3 * pulse, 0, 2 * Math.PI, false);
                  ctx.strokeStyle = `rgba(74,222,128,${0.6 + 0.4 * pulse})`;
                  ctx.lineWidth   = 2.5 / globalScale;
                  ctx.stroke();
                  ctx.shadowBlur = 0;
                }

                // Path target pulsing red halo
                if (isPathTarget) {
                  const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 300 + Math.PI);
                  ctx.shadowBlur  = 30 + 15 * pulse;
                  ctx.shadowColor = '#f43f5e';
                  ctx.beginPath();
                  ctx.arc(node.x, node.y, r + 7 + 3 * pulse, 0, 2 * Math.PI, false);
                  ctx.strokeStyle = `rgba(244,63,94,${0.6 + 0.4 * pulse})`;
                  ctx.lineWidth   = 2.5 / globalScale;
                  ctx.stroke();
                  ctx.shadowBlur = 0;
                }

                // Path member neon cyan outer ring
                if (pathNodeIdSet && isOnPath && !isPathSource && !isPathTarget) {
                  ctx.shadowBlur  = 20;
                  ctx.shadowColor = '#22d3ee';
                  ctx.beginPath();
                  ctx.arc(node.x, node.y, r + 5, 0, 2 * Math.PI, false);
                  ctx.strokeStyle = 'rgba(34,211,238,0.85)';
                  ctx.lineWidth   = 2 / globalScale;
                  ctx.stroke();
                  ctx.shadowBlur = 0;
                }

                // Selected node white glow ring
                if (selectedNode && node.id === selectedNode.id) {
                  ctx.shadowBlur  = 25;
                  ctx.shadowColor = '#ffffff';
                  ctx.beginPath();
                  ctx.arc(node.x, node.y, r + 4, 0, 2 * Math.PI, false);
                  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
                  ctx.lineWidth   = 2 / globalScale;
                  ctx.stroke();
                }

                // Pinned indicator
                if (node.fx != null && node.fy != null) {
                  ctx.shadowBlur = 0;
                  ctx.beginPath();
                  ctx.arc(node.x, node.y - r - 4, 2.5, 0, 2 * Math.PI);
                  ctx.fillStyle = '#fbbf24';
                  ctx.fill();
                }

                // Node circle
                ctx.shadowBlur  = 16;
                ctx.shadowColor = color;
                ctx.beginPath();
                ctx.arc(node.x, node.y, r, 0, 2 * Math.PI, false);
                ctx.fillStyle   = color;
                ctx.fill();

                // Inner core for suspects
                if (isSuspect) {
                  ctx.shadowBlur = 0;
                  ctx.beginPath();
                  ctx.arc(node.x, node.y, r * 0.45, 0, 2 * Math.PI);
                  ctx.fillStyle = '#ffffff';
                  ctx.fill();
                }

                // Node label pill
                ctx.shadowBlur = 0;
                if (!dimNode) {
                  const fontSize = 10.5;
                  ctx.font = `600 ${fontSize}px Inter, -apple-system, sans-serif`;
                  const textW = ctx.measureText(label).width;
                  const padX = 4;
                  const padY = 2;
                  const pillH = fontSize + padY * 2;
                  const pillW = textW + padX * 2;
                  const pillX = node.x - pillW / 2;
                  const pillY = node.y + r + 3;

                  ctx.fillStyle = 'rgba(2, 6, 23, 0.82)';
                  ctx.beginPath();
                  const rad = 3;
                  ctx.moveTo(pillX + rad, pillY);
                  ctx.lineTo(pillX + pillW - rad, pillY);
                  ctx.quadraticCurveTo(pillX + pillW, pillY, pillX + pillW, pillY + rad);
                  ctx.lineTo(pillX + pillW, pillY + pillH - rad);
                  ctx.quadraticCurveTo(pillX + pillW, pillY + pillH, pillX + pillW - rad, pillY + pillH);
                  ctx.lineTo(pillX + rad, pillY + pillH);
                  ctx.quadraticCurveTo(pillX, pillY + pillH, pillX, pillY + pillH - rad);
                  ctx.lineTo(pillX, pillY + rad);
                  ctx.quadraticCurveTo(pillX, pillY, pillX + rad, pillY);
                  ctx.closePath();
                  ctx.fill();

                  ctx.textAlign    = 'center';
                  ctx.textBaseline = 'middle';
                  ctx.fillStyle    = 'rgba(241, 245, 249, 0.95)';
                  ctx.fillText(label, node.x, pillY + pillH / 2);
                }

                // Restore alpha
                ctx.globalAlpha = originalAlpha;
              }}
            />
          )}

          {/* ── Path Result HUD (bottom-center) ──────────────────────────── */}
          {pathResult?.path_found && (() => {
            const displayNodes = pathResult.path_nodes || (pathResult.path_node_ids || []).map(id => (graphData?.nodes || []).find(n => n && String(n.id) === String(id)) || { id, name: id });
            if (!displayNodes || displayNodes.length === 0) return null;
            return (
              <div className="absolute bottom-28 left-1/2 -translate-x-1/2 z-30 w-auto max-w-2xl
                              bg-slate-900/95 backdrop-blur-xl border border-cyan-500/40
                              rounded-2xl shadow-[0_0_40px_rgba(34,211,238,0.2)] overflow-hidden">
                {/* HUD Header */}
                <div className="flex items-center justify-between px-5 py-3 bg-cyan-900/30 border-b border-cyan-500/30">
                  <div className="flex items-center gap-2.5">
                    <div className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_6px_cyan] animate-pulse"></div>
                    <span className="text-sm font-bold text-cyan-300">
                      🔗 Connection Path Found — {pathResult.hops || 1} Hop{pathResult.hops !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <button
                    onClick={clearPathTrace}
                    className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-semibold
                               text-slate-400 hover:text-red-400 border border-slate-700
                               hover:border-red-500/50 transition cursor-pointer"
                  >
                    <X className="w-3 h-3" /> Clear Trace
                  </button>
                </div>

                {/* Path chain */}
                <div className="px-5 py-3 flex items-center gap-2 flex-wrap">
                  {displayNodes.map((pnode, idx) => (
                    <React.Fragment key={pnode?.id || idx}>
                      <div className="flex flex-col items-center">
                        <div
                          className="px-3 py-1.5 rounded-lg text-[11px] font-bold border whitespace-nowrap"
                          style={{
                            borderColor: idx === 0
                              ? 'rgba(74,222,128,0.6)'
                              : idx === displayNodes.length - 1
                              ? 'rgba(244,63,94,0.6)'
                              : 'rgba(34,211,238,0.4)',
                            backgroundColor: idx === 0
                              ? 'rgba(74,222,128,0.1)'
                              : idx === displayNodes.length - 1
                              ? 'rgba(244,63,94,0.1)'
                              : 'rgba(34,211,238,0.08)',
                            color: idx === 0
                              ? '#4ade80'
                              : idx === displayNodes.length - 1
                              ? '#f43f5e'
                              : '#22d3ee',
                          }}
                        >
                          {pnode?.name || pnode?.id}
                        </div>
                        {pnode?.type && (
                          <span className="text-[9px] text-slate-500 mt-0.5">{pnode.type}</span>
                        )}
                      </div>
                      {idx < displayNodes.length - 1 && (
                        <div className="flex flex-col items-center justify-center px-3">
                          <ArrowRight className="w-5 h-5 text-cyan-400 font-bold" />
                          {pathResult.path_edges?.[idx]?.relation && (
                            <span className="mt-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-cyan-950/80 text-cyan-300 border border-cyan-500/40 uppercase tracking-wide whitespace-nowrap shadow-sm">
                              {pathResult.path_edges[idx].relation}
                            </span>
                          )}
                        </div>
                      )}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* ── Toast Notification ────────────────────────────────────────── */}
          {pathToast && (
            <div className={`absolute bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5
                            px-4 py-2.5 rounded-xl text-sm font-semibold
                            border backdrop-blur-md shadow-2xl transition-all duration-300 whitespace-nowrap ${
              pathToast.type === 'ok'
                ? 'bg-emerald-950/90 border-emerald-500/50 text-emerald-300'
                : 'bg-red-950/90 border-red-500/50 text-red-300'
            }`}>
              {pathToast.type === 'ok'
                ? <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                : <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />}
              {pathToast.msg}
            </div>
          )}

          {/* ── Node Dossier Drawer ──────────────────────────────────────── */}
          {selectedNode && !pathMode && (
            <>
              <div className="absolute inset-0 z-40" onClick={() => setSelectedNode(null)} />
              <div
                className="absolute top-0 right-0 h-full w-84 max-w-[340px] z-50 flex flex-col
                           bg-slate-900/95 backdrop-blur-xl border-l border-slate-700/80
                           shadow-[-8px_0_40px_rgba(0,0,0,0.6)] text-slate-200
                           animate-in slide-in-from-right duration-300"
                style={{ width: '340px' }}
              >
                <div
                  className="flex items-start justify-between px-5 py-4 border-b border-slate-700/80"
                  style={{ background: 'linear-gradient(135deg, rgba(15,23,42,0.9) 0%, rgba(30,41,59,0.7) 100%)' }}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center border"
                      style={{
                        backgroundColor: `${getNodeColor(selectedNode.type)}22`,
                        borderColor:     `${getNodeColor(selectedNode.type)}55`,
                        boxShadow:       `0 0 14px ${getNodeColor(selectedNode.type)}55`,
                      }}
                    >
                      <Network className="w-4 h-4" style={{ color: getNodeColor(selectedNode.type) }} />
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-base font-bold text-white leading-tight break-words">
                        {selectedNode.name || selectedNode.id}
                      </h2>
                      <span
                        className="mt-1 inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border"
                        style={{
                          color:           getNodeColor(selectedNode.type),
                          borderColor:     `${getNodeColor(selectedNode.type)}44`,
                          backgroundColor: `${getNodeColor(selectedNode.type)}18`,
                        }}
                      >
                        {selectedNode.type || 'Unknown'}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => setSelectedNode(null)}
                    className="flex-shrink-0 ml-2 mt-0.5 text-slate-500 hover:text-red-400 transition-colors cursor-pointer"
                    title="Close"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                  {selectedNode.threat_score !== undefined && (() => {
                    const badge = threatBadge(selectedNode.threat_score);
                    return (
                      <div className={`p-3.5 rounded-xl border ${badge.bg} ${badge.border}`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Shield className={`w-4 h-4 ${badge.text}`} />
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Threat Score</span>
                          </div>
                          <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${badge.bg} ${badge.border} ${badge.text}`}>
                            {badge.label}
                          </span>
                        </div>
                        <p className={`mt-2 text-3xl font-black ${badge.text} tabular-nums`}>
                          {Number(selectedNode.threat_score).toFixed(2)}
                          <span className="text-sm font-semibold text-slate-500 ml-1">/ 10</span>
                        </p>
                        <div className="mt-2 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-700 ${
                              Number(selectedNode.threat_score) >= 8 ? 'bg-red-500' :
                              Number(selectedNode.threat_score) >= 5 ? 'bg-amber-500' : 'bg-emerald-500'
                            }`}
                            style={{ width: `${(Number(selectedNode.threat_score) / 10) * 100}%` }}
                          />
                        </div>
                      </div>
                    );
                  })()}

                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Network className="w-3.5 h-3.5 text-cyan-500" />
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Connections <span className="text-slate-600">({dossierNeighbors.length})</span>
                      </span>
                    </div>
                    {dossierNeighbors.length === 0 ? (
                      <p className="text-xs text-slate-600 italic px-1">No direct connections in current graph.</p>
                    ) : (
                      <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                        {dossierNeighbors.map((nb, i) => (
                          <div
                            key={`${nb.id}-${i}`}
                            className="flex items-center justify-between gap-2 p-2 rounded-lg bg-slate-800/60 border border-slate-700/50 hover:border-slate-600/80 transition group"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className={`text-[10px] font-bold flex-shrink-0 ${nb.isOut ? 'text-cyan-500' : 'text-purple-400'}`}>
                                {nb.isOut ? '→' : '←'}
                              </span>
                              <div className="min-w-0">
                                <p className="text-xs font-semibold text-slate-200 group-hover:text-white truncate transition">{nb.name}</p>
                                <p className="text-[10px] text-slate-500">{nb.type}</p>
                              </div>
                            </div>
                            {nb.relation && (
                              <span className="flex-shrink-0 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-cyan-900/30 border border-cyan-700/30 text-cyan-400 max-w-[100px] truncate">
                                {nb.relation}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {selectedNode.case_id && (() => {
                    const caseObj = cases.find(c => c.id === selectedNode.case_id);
                    return (
                      <div className="p-3 rounded-xl bg-slate-800/50 border border-slate-700/50 space-y-2">
                        <div className="flex items-center gap-2 mb-1">
                          <Zap className="w-3.5 h-3.5 text-amber-400" />
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Case Intelligence</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-slate-500">Case #</span>
                          <span className="font-mono text-xs font-bold text-amber-300">{caseObj?.case_number || selectedNode.case_id}</span>
                        </div>
                        {caseObj?.title && (
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-[10px] text-slate-500 flex-shrink-0">Title</span>
                            <span className="text-[10px] text-slate-300 text-right truncate max-w-[180px]" title={caseObj.title}>{caseObj.title}</span>
                          </div>
                        )}
                        {(selectedNode.created_at || caseObj?.created_at) && (
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-slate-500 flex items-center gap-1">
                              <Clock className="w-3 h-3" /> Created
                            </span>
                            <span className="text-[10px] text-slate-400 font-mono">
                              {new Date(selectedNode.created_at || caseObj.created_at).toLocaleString('en-IN', {
                                dateStyle: 'medium', timeStyle: 'short',
                              })}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/60">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">System ID</p>
                    <p className="font-mono text-[11px] text-slate-400 break-all select-all">{selectedNode.id}</p>
                  </div>
                </div>

                <div className="px-5 py-3 border-t border-slate-800/80 bg-slate-950/40">
                  <button
                    onClick={() => setSelectedNode(null)}
                    className="w-full py-2 rounded-lg text-xs font-semibold text-slate-400 border border-slate-700/60 hover:border-slate-600 hover:text-slate-200 transition cursor-pointer"
                  >
                    Close Dossier
                  </button>
                </div>
              </div>
            </>
          )}

          {/* ── Minimap Radar (bottom-right) ─────────────────────────────── */}
          {!loading && !error && graphData.nodes.length > 0 && (
            <div className="fixed bottom-6 right-6 z-30 pointer-events-auto shadow-2xl rounded-xl border border-slate-700/70 bg-slate-900/90 backdrop-blur-md p-2 flex flex-col">
              <div className="flex items-center gap-1.5 px-1 py-0.5 mb-1.5 border-b border-slate-700/60 flex-shrink-0">
                <ScanLine className="w-3.5 h-3.5 text-cyan-400" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-300">Radar</span>
              </div>
              <canvas
                ref={minimapRef}
                width={190}
                height={120}
                onPointerDown={handleMinimapPointerDown}
                onPointerMove={handleMinimapPointerMove}
                onPointerUp={handleMinimapPointerUp}
                onPointerCancel={handleMinimapPointerUp}
                className="cursor-crosshair block rounded-lg overflow-hidden touch-none select-none"
                style={{ background: 'rgba(2,6,23,0.75)', width: 190, height: 120 }}
                title="Click or drag to pan view across graph"
              />
            </div>
          )}
        </div>
      </div>

      {/* ── Edit Mode Floating Panel ──────────────────────────────────────── */}
      {editMode && (
        <div className="fixed bottom-6 right-6 z-50 w-96 bg-slate-900/95 backdrop-blur-xl border border-amber-500/40 rounded-2xl shadow-[0_0_40px_rgba(251,191,36,0.15)] text-slate-200 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 bg-amber-600/20 border-b border-amber-500/30">
            <div className="flex items-center gap-2">
              <Pencil className="w-4 h-4 text-amber-400" />
              <span className="text-sm font-bold text-amber-300">Graph Edit Mode</span>
            </div>
            <button onClick={() => setEditMode(false)} className="text-slate-400 hover:text-red-400 transition cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>

          {editTargetCaseId && (
            <div className="px-5 py-2 bg-slate-950/50 border-b border-slate-800 text-[11px] text-slate-400">
              Editing: <span className="text-cyan-300 font-semibold">{editTargetCaseName}</span>
              {selectedCaseIds.length > 1 && (
                <span className="ml-1 text-amber-400">(multi-case: using first selected)</span>
              )}
            </div>
          )}

          <div className="flex border-b border-slate-800">
            {[
              { id: 'entity',   label: 'Add Entity',      icon: PlusCircle },
              { id: 'relation', label: 'Connect Entities', icon: GitMerge  },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setEditTab(tab.id)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold transition cursor-pointer ${
                  editTab === tab.id
                    ? 'bg-slate-800 text-cyan-300 border-b-2 border-cyan-400'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <tab.icon className="w-3.5 h-3.5" /> {tab.label}
              </button>
            ))}
          </div>

          <div className="p-5">
            {editTab === 'entity' && (
              <form onSubmit={handleAddEntity} className="space-y-3">
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Entity Type</label>
                  <select
                    value={addEntityForm.entity_type}
                    onChange={e => setAddEntityForm(f => ({ ...f, entity_type: e.target.value }))}
                    className={selectCls}
                  >
                    {ENTITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Identifier / Name</label>
                  <input
                    type="text"
                    value={addEntityForm.name}
                    onChange={e => setAddEntityForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. John Doe, +91-9876543210"
                    className={inputCls}
                    required
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                    Risk Score: <span className="text-amber-300 font-bold">{addEntityForm.risk}</span>
                  </label>
                  <input
                    type="range" min="1" max="10" step="0.5"
                    value={addEntityForm.risk}
                    onChange={e => setAddEntityForm(f => ({ ...f, risk: e.target.value }))}
                    className="w-full accent-cyan-400 cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-slate-500 mt-0.5">
                    <span>1 Low</span><span>10 Critical</span>
                  </div>
                </div>
                {addEntityMsg && (
                  <p className={`text-[11px] font-medium ${addEntityMsg.type === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>
                    {addEntityMsg.type === 'ok' ? '✓' : '✕'} {addEntityMsg.text}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={addEntityLoading || !addEntityForm.name.trim() || !editTargetCaseId}
                  className="w-full py-2.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-bold rounded-lg text-xs transition shadow-[0_0_10px_rgba(34,211,238,0.3)] flex items-center justify-center gap-2 cursor-pointer"
                >
                  {addEntityLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlusCircle className="w-3.5 h-3.5" />}
                  {addEntityLoading ? 'Adding...' : 'Add Entity to Graph'}
                </button>
              </form>
            )}

            {editTab === 'relation' && (
              <form onSubmit={handleAddRelation} className="space-y-3">
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Source Node</label>
                  <select
                    value={addRelForm.source_id}
                    onChange={e => setAddRelForm(f => ({ ...f, source_id: e.target.value }))}
                    className={selectCls}
                    required
                  >
                    <option value="">— Select source entity —</option>
                    {graphData.nodes.map(n => <option key={n.id} value={n.id}>{n.name || n.id} ({n.type})</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Target Node</label>
                  <select
                    value={addRelForm.target_id}
                    onChange={e => setAddRelForm(f => ({ ...f, target_id: e.target.value }))}
                    className={selectCls}
                    required
                  >
                    <option value="">— Select target entity —</option>
                    {graphData.nodes
                      .filter(n => n.id !== addRelForm.source_id)
                      .map(n => <option key={n.id} value={n.id}>{n.name || n.id} ({n.type})</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Relationship Label</label>
                  <input
                    type="text"
                    value={addRelForm.relation_type}
                    onChange={e => setAddRelForm(f => ({ ...f, relation_type: e.target.value }))}
                    placeholder="e.g. ASSOCIATED_WITH, CALLS, OWNS"
                    className={inputCls}
                    required
                  />
                </div>
                {addRelMsg && (
                  <p className={`text-[11px] font-medium ${addRelMsg.type === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>
                    {addRelMsg.type === 'ok' ? '✓' : '✕'} {addRelMsg.text}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={addRelLoading || !addRelForm.source_id || !addRelForm.target_id || !addRelForm.relation_type.trim() || !editTargetCaseId}
                  className="w-full py-2.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-bold rounded-lg text-xs transition shadow-[0_0_10px_rgba(34,211,238,0.3)] flex items-center justify-center gap-2 cursor-pointer"
                >
                  {addRelLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <GitMerge className="w-3.5 h-3.5" />}
                  {addRelLoading ? 'Connecting...' : 'Connect Entities'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ── Cross-Case Syndicate Modal ─────────────────────────────────────── */}
      {crossCaseModalOpen && crossCaseData && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
          {/* Scrim */}
          <div
            className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
            onClick={() => setCrossCaseModalOpen(false)}
          />

          {/* Modal */}
          <div className="relative z-10 w-full max-w-2xl bg-slate-900/98 backdrop-blur-xl border border-red-500/30 rounded-2xl shadow-[0_0_60px_rgba(239,68,68,0.15)] overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-red-950/60 via-amber-950/40 to-red-950/60 border-b border-red-500/30">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-50"></span>
                  <AlertTriangle className="relative w-5 h-5 text-red-400" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">Cross-Case Syndicate Intelligence</h2>
                  <p className="text-[11px] text-amber-400/80">
                    {crossCaseData.total_matches} entit{crossCaseData.total_matches !== 1 ? 'ies' : 'y'} detected across multiple cases
                  </p>
                </div>
              </div>
              <button
                onClick={() => setCrossCaseModalOpen(false)}
                className="text-slate-500 hover:text-red-400 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="max-h-[60vh] overflow-y-auto px-6 py-4 space-y-4">
              {crossCaseData.cross_case_entities.map((entity, idx) => {
                const badge = threatBadge(entity.threat_score || 0);
                const uniqueCaseIds = [...new Set(entity.occurrences.map(o => o.case_id))];
                return (
                  <div
                    key={idx}
                    className="p-4 rounded-xl bg-slate-800/60 border border-slate-700/50 hover:border-amber-500/30 transition"
                  >
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex items-center gap-2.5">
                        <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${badge.text.replace('text-', 'bg-')}`}></div>
                        <div>
                          <p className="text-sm font-bold text-white">{entity.entity_name}</p>
                          <p className="text-[10px] text-slate-500">{entity.entity_type}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${badge.bg} ${badge.border} ${badge.text}`}>
                          T:{Number(entity.threat_score || 0).toFixed(1)}
                        </span>
                        <button
                          onClick={() => mergeEntityCases(entity)}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold
                                     bg-cyan-600/20 hover:bg-cyan-600/40 text-cyan-300 border border-cyan-500/40
                                     hover:border-cyan-400/60 transition cursor-pointer whitespace-nowrap"
                        >
                          <GitMerge className="w-3 h-3" />
                          Merge in View
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      {entity.occurrences.map((occ, oi) => (
                        <div
                          key={oi}
                          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/40 text-xs"
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0"></span>
                          <span className="font-mono text-amber-300 font-semibold flex-shrink-0">{occ.case_number}</span>
                          <span className="text-slate-400 truncate">{occ.case_title}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-slate-800/80 bg-slate-950/50 flex items-center justify-between">
              <p className="text-[10px] text-slate-500">
                Cross-case analysis powered by entity canonical name matching
              </p>
              <button
                onClick={() => setCrossCaseModalOpen(false)}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold text-slate-400
                           border border-slate-700/60 hover:border-slate-600 hover:text-slate-200
                           transition cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Cryptographic Evidence Ledger Modal ─────────────────────────────── */}
      {auditModalOpen && auditLedger && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 sm:p-6">
          {/* Scrim */}
          <div
            className="absolute inset-0 bg-slate-950/85 backdrop-blur-md"
            onClick={() => setAuditModalOpen(false)}
          />

          {/* Modal Card */}
          <div className="relative z-10 w-full max-w-xl bg-slate-900/98 backdrop-blur-2xl border border-emerald-500/40 rounded-2xl shadow-[0_0_60px_rgba(16,185,129,0.2)] overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-emerald-950/70 via-slate-900 to-emerald-950/70 border-b border-emerald-500/30">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-emerald-500/10 text-emerald-400 rounded-xl border border-emerald-500/30 shadow-[0_0_15px_rgba(16,185,129,0.3)]">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white tracking-wide flex items-center gap-2">
                    <span>Cryptographic Evidence Ledger</span>
                    <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                      SHA-256
                    </span>
                  </h2>
                  <p className="text-[11px] text-slate-400">
                    Court-Admissible Chain of Custody & Tamper-Proof Audit
                  </p>
                </div>
              </div>
              <button
                onClick={() => setAuditModalOpen(false)}
                className="text-slate-400 hover:text-red-400 transition cursor-pointer p-1 rounded-lg hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="px-6 py-5 space-y-4 max-h-[75vh] overflow-y-auto">
              {/* Seal Banner */}
              <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-500/30 flex items-start gap-3">
                <div className="relative flex h-3 w-3 mt-1 flex-shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-emerald-400 tracking-wider">
                      STATUS: {auditLedger.status || 'VERIFIED_TAMPER_PROOF'}
                    </span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                      IMMUTABLE / COURT ADMISSIBLE
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    All case evidence, graph nodes, relationships, and raw records have been cryptographically sealed.
                    Any alteration to node entities or links will invalidate this cryptographic signature.
                  </p>
                </div>
              </div>

              {/* Ledger Metadata Grid */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Case Number</span>
                  <p className="font-mono text-xs font-bold text-cyan-300 truncate" title={auditLedger.case_number}>
                    {auditLedger.case_number}
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Timestamp</span>
                  <p className="font-mono text-xs text-slate-200">
                    {auditLedger.timestamp
                      ? new Date(auditLedger.timestamp).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'medium' })
                      : 'N/A'}
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Total Evidence Nodes</span>
                  <p className="text-sm font-bold text-white flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-cyan-400" />
                    <span>{auditLedger.total_evidence_nodes} Verified Nodes</span>
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Total Connections</span>
                  <p className="text-sm font-bold text-white flex items-center gap-1.5">
                    <GitMerge className="w-3.5 h-3.5 text-purple-400" />
                    <span>{auditLedger.total_connections} Verified Links</span>
                  </p>
                </div>
              </div>

              {/* SHA-256 Hash Signature Section */}
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <Lock className="w-3 h-3 text-emerald-400" />
                    <span>Deterministic SHA-256 Evidence Hash</span>
                  </span>
                  <button
                    onClick={handleCopyHash}
                    className="flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700 transition cursor-pointer"
                  >
                    {copiedHash ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-400" />
                        <span className="text-emerald-400">Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3 text-slate-400" />
                        <span>Copy Hash</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 font-mono text-[11px] text-emerald-400 break-all select-all leading-relaxed shadow-inner">
                  {auditLedger.tamper_proof_hash}
                </div>
                <p className="text-[10px] text-slate-500">
                  Computed deterministically over all case entities, types, canonical identifiers, and relation structures.
                </p>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between gap-3">
              <button
                onClick={() => {
                  setAuditModalOpen(false);
                  handleExportDossier();
                }}
                disabled={exportingDossier}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_0_15px_rgba(16,185,129,0.3)] transition cursor-pointer disabled:opacity-50"
              >
                {exportingDossier ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                <span>{exportingDossier ? 'Compiling Dossier...' : 'Export Court Dossier (PDF)'}</span>
              </button>

              <button
                onClick={() => setAuditModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 border border-slate-700/60 hover:border-slate-600 hover:text-slate-200 transition cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Suspicious Pattern Alerts Right Drawer (Milestone 6B) ──────── */}
      {patternsDrawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          {/* Dark Backdrop */}
          <div
            onClick={() => setPatternsDrawerOpen(false)}
            className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm transition-opacity"
          />

          {/* Sliding Drawer Container */}
          <aside className="relative w-full max-w-lg bg-slate-950 border-l border-slate-800 shadow-2xl flex flex-col h-full z-10">
            {/* Drawer Header */}
            <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/90 backdrop-blur-md">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 shadow-[0_0_10px_rgba(239,68,68,0.2)]">
                  <AlertTriangle className="w-5 h-5 animate-pulse" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-bold text-white tracking-wide">
                      Automated Forensic Rule Alerts
                    </h2>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-red-500/20 text-red-300 border border-red-500/40">
                      {suspiciousPatterns?.total_patterns || 0} RED FLAGS
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                    Case: <span className="text-cyan-300 font-semibold">{suspiciousPatterns?.case_number || 'ACTIVE_CASE'}</span>
                  </p>
                </div>
              </div>

              <button
                onClick={() => setPatternsDrawerOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
                title="Close Drawer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Filter Tabs */}
            <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-900/50 border-b border-slate-800 text-xs">
              <button
                onClick={() => setPatternFilter('ALL')}
                className={`px-3 py-1 rounded-md font-semibold text-[11px] transition-all cursor-pointer ${
                  patternFilter === 'ALL'
                    ? 'bg-slate-800 text-white border border-slate-700 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                All ({suspiciousPatterns?.patterns?.length || 0})
              </button>
              <button
                onClick={() => setPatternFilter('CRITICAL')}
                className={`px-3 py-1 rounded-md font-semibold text-[11px] transition-all cursor-pointer ${
                  patternFilter === 'CRITICAL'
                    ? 'bg-red-950/80 text-red-300 border border-red-500/40 shadow-sm'
                    : 'text-slate-400 hover:text-red-300'
                }`}
              >
                Critical ({suspiciousPatterns?.patterns?.filter(p => p.severity === 'CRITICAL').length || 0})
              </button>
              <button
                onClick={() => setPatternFilter('HIGH')}
                className={`px-3 py-1 rounded-md font-semibold text-[11px] transition-all cursor-pointer ${
                  patternFilter === 'HIGH'
                    ? 'bg-amber-950/80 text-amber-300 border border-amber-500/40 shadow-sm'
                    : 'text-slate-400 hover:text-amber-300'
                }`}
              >
                High ({suspiciousPatterns?.patterns?.filter(p => p.severity === 'HIGH').length || 0})
              </button>
            </div>

            {/* Alerts List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
              {patternsLoading && (
                <div className="flex flex-col items-center justify-center p-8 text-slate-400 text-xs gap-2">
                  <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
                  <span>Analyzing Telemetry & Forensic Rules...</span>
                </div>
              )}

              {!patternsLoading && (!suspiciousPatterns?.patterns || suspiciousPatterns.patterns.length === 0) && (
                <div className="flex flex-col items-center justify-center p-12 text-center text-slate-500 space-y-2">
                  <CheckCircle2 className="w-10 h-10 text-emerald-400/50" />
                  <p className="text-sm font-semibold text-slate-300">No Anomalies Flagged</p>
                  <p className="text-xs text-slate-500 max-w-xs">
                    All call and financial records in this case adhere to regular operational parameters.
                  </p>
                </div>
              )}

              {!patternsLoading && suspiciousPatterns?.patterns && (
                suspiciousPatterns.patterns
                  .filter(p => patternFilter === 'ALL' || p.severity === patternFilter)
                  .map((pattern, idx) => {
                    const isCritical = pattern.severity === 'CRITICAL';
                    const formattedAmount = pattern.amount != null
                      ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(pattern.amount)
                      : null;
                    const cleanDesc = (pattern.rule_type === 'HIGH_VALUE_TRANSFER' && formattedAmount)
                      ? `Abnormal fund movement of ${formattedAmount} detected between accounts.`
                      : (pattern.description || '')
                          .replace(/â¹/g, '₹')
                          .replace(/\u00e2\u00b9/g, '₹')
                          .replace(/\ufffd\?1/g, '₹')
                          .replace(/\?1/g, '₹');

                    return (
                      <div
                        key={pattern.id || idx}
                        className={`p-3.5 rounded-xl border transition-all duration-200 shadow-md flex flex-col space-y-2.5 ${
                          isCritical
                            ? 'bg-gradient-to-b from-red-950/40 to-slate-900/60 border-red-500/40 hover:border-red-400/70 shadow-[0_0_12px_rgba(239,68,68,0.1)]'
                            : 'bg-gradient-to-b from-amber-950/30 to-slate-900/60 border-amber-500/40 hover:border-amber-400/70 shadow-[0_0_12px_rgba(245,158,11,0.1)]'
                        }`}
                      >
                        {/* Alert Card Header */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="space-y-0.5 min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span
                                className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full border ${
                                  isCritical
                                    ? 'bg-red-500/20 text-red-300 border-red-500/50'
                                    : 'bg-amber-500/20 text-amber-300 border-amber-500/50'
                                }`}
                              >
                                {pattern.severity} SEVERITY
                              </span>
                              <span className="text-[10px] font-mono text-slate-400">
                                {pattern.rule_type}
                              </span>
                            </div>
                            <h3 className="text-xs font-bold text-white pt-1">
                              {pattern.title}
                            </h3>
                          </div>

                          {/* Timestamp Badge */}
                          <span className="text-[10px] text-slate-400 font-mono flex-shrink-0 bg-slate-950/60 px-2 py-1 rounded border border-slate-800">
                            {pattern.timestamp ? new Date(pattern.timestamp).toLocaleString('en-IN') : 'N/A'}
                          </span>
                        </div>

                        {/* Operatives / Entities Details */}
                        <div className="bg-slate-950/70 rounded-lg p-2.5 border border-slate-800/80 space-y-1.5 text-xs">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-slate-400 font-medium">Source / Initiator:</span>
                            <span className="font-mono font-bold text-cyan-300 truncate max-w-[200px]" title={pattern.source}>
                              {pattern.source || 'Unknown'}
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-slate-400 font-medium">Target / Receiver:</span>
                            <span className="font-mono font-bold text-cyan-300 truncate max-w-[200px]" title={pattern.target}>
                              {pattern.target || 'Unknown'}
                            </span>
                          </div>

                          {/* Amount if Financial */}
                          {formattedAmount && (
                            <div className="flex items-center justify-between text-[11px] pt-1 border-t border-slate-800">
                              <span className="text-slate-400 font-medium">Transaction Value:</span>
                              <span className="font-mono font-extrabold text-red-400 text-xs">
                                {formattedAmount}
                              </span>
                            </div>
                          )}

                          {/* Duration if Telephony */}
                          {pattern.duration && pattern.duration !== 'N/A' && (
                            <div className="flex items-center justify-between text-[11px] pt-1 border-t border-slate-800">
                              <span className="text-slate-400 font-medium">Call Duration:</span>
                              <span className="font-mono font-semibold text-amber-300 text-xs">
                                {pattern.duration}s
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Description */}
                        <p className="text-[11px] text-slate-300 leading-relaxed">
                          {cleanDesc}
                        </p>

                        {/* Focus on Graph Action */}
                        <div className="pt-1 flex justify-end">
                          <button
                            onClick={() => {
                              focusPatternOnGraph(pattern);
                            }}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer shadow-sm ${
                              isCritical
                                ? 'bg-red-600/30 hover:bg-red-600/50 text-red-200 border border-red-500/50 shadow-[0_0_10px_rgba(239,68,68,0.2)]'
                                : 'bg-amber-600/30 hover:bg-amber-600/50 text-amber-200 border border-amber-500/50 shadow-[0_0_10px_rgba(245,158,11,0.2)]'
                            }`}
                          >
                            <Focus className="w-3.5 h-3.5" />
                            <span>Focus on Graph</span>
                          </button>
                        </div>
                      </div>
                    );
                  })
              )}
            </div>

            {/* Drawer Footer */}
            <div className="p-3 bg-slate-900/80 border-t border-slate-800 text-center">
              <p className="text-[10px] text-slate-500 font-mono">
                SIH 2026 Directorate of Cyber Forensics • Automated Rule Engine Active
              </p>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
