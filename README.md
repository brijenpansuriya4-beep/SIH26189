# Crime Intelligence & Network Analytics Platform

> **Live Deployment:** [https://sih-26189-brown.vercel.app](https://sih-26189-brown.vercel.app)  
> **Backend API:** [https://syncore-backend-g63t.onrender.com](https://syncore-backend-g63t.onrender.com)  
> **API Docs (Swagger):** [https://syncore-backend-g63t.onrender.com/docs](https://syncore-backend-g63t.onrender.com/docs)

An AI-driven investigative command dashboard engineered for law enforcement agencies to ingest unstructured FIRs, cross-analyze financial/CDR communications, detect syndicate kingpins, and visualize complex criminal relationship topologies in real time.

---

## Key Features

- **Automated FIR Ingestion & NLP Extraction:** Uses Gemini / Groq LLM pipelines to extract entities (Suspects, Vehicles, Bank Accounts, Phone Numbers, Locations) with zero manual tagging.
- **Interactive Intelligence Graph:** Physics-driven interactive network showing links, relationships, and cross-case criminal nodes.
- **Cross-Case Syndicate Detection:** Automatically flags cross-case shared entities (e.g., same phone number or mule bank account appearing across different jurisdictions).
- **Structured Evidence Engine:** Supports direct ingestion of **CDR (Call Detail Records)** and **Financial Transaction Records** via CSV format.
- **Centrality & Kingpin Scoring:** Uses Graph Theory algorithms (Degree Centrality, Betweenness) to mathematically pinpoint top syndicate leaders.
- **Tamper-Proof Audit Chain:** Cryptographic state verification ensuring intelligence and evidence lineage integrity.

---

## Pre-Loaded Demonstration Cases (For Evaluators / Judges)

The system is pre-populated with 3 inter-connected syndicate cases:

1. **CASE-20260909-135253**: *Illegal Arms Supply Network Surat*
2. **CASE-20260909-081852**: *Inter-city Contraband Smuggling Network*
3. **CASE-20260908-231128**: *Interstate Extortion & Hawala Ring*

> **Testing Cross-Case Analytics:** Selecting Case 1 and Case 2 displays cross-case syndicate node linkages (e.g., shared hawala accounts and burner phone numbers).

---

## Tech Stack

- **Frontend:** React 18, Vite, Tailwind CSS, Lucide Icons, Force-directed Graph
- **Backend:** FastAPI (Python), Uvicorn, SQLAlchemy, Pydantic, NetworkX
- **Database:** Cloud PostgreSQL (Supabase / Render) via `pg8000` driver
- **AI / LLM Ingestion:** Google Gemini (`google-genai`), Groq API
- **Deployment:** Vercel (Frontend Client), Render (FastAPI Cloud Service)

---

## Evaluator Quick-Start Guide (Step-by-Step)

1. Open [Live Dashboard](https://sih-26189-brown.vercel.app).
2. **Active Investigation Cases:** Toggle between the preloaded cases on the left sidebar to render different networks.
3. **Inspect Entity Topology:** Click any node to inspect risk scores, centrality metrics, and connected phone numbers or bank accounts.
4. **Structured Evidence Ingestion:**
   - Under **Structured Evidence Ingestion**, select **CDR Logs** or **Financial Logs**.
   - Upload sample CSV files (see sample data schemas below) to append dynamic nodes into the active graph.
5. **AI FIR Analysis:** Paste any raw unstructured police report into the FIR text box and hit analyze to extract entities dynamically.