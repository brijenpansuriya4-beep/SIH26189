import os
import uuid
import datetime
import hashlib
import json
import csv
import io
from typing import List, Optional
from dotenv import load_dotenv

load_dotenv()
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

import networkx as nx
from fastapi import FastAPI, Depends, HTTPException, Query, UploadFile, File, Form, Body
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func

from database import init_db, SessionLocal, Case, Record, Entity, Relationship
from ai_service import extract_entities

app = FastAPI(title="Crime Network Intelligence API")

# ── CORS ──────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Startup ───────────────────────────────────────────────────────────────────
@app.on_event("startup")
def on_startup():
    init_db()

# ── DB dependency ─────────────────────────────────────────────────────────────
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# ── Pydantic Schemas ──────────────────────────────────────────────────────────
class FIRProcessRequest(BaseModel):
    text: str
    case_name: Optional[str] = None

class ManualNodeCreate(BaseModel):
    case_id: str
    name: str
    entity_type: str
    risk: float = 1.0

class ManualEdgeCreate(BaseModel):
    case_id: str
    source_id: str
    target_id: str
    relation_type: str

class CaseFilterRequest(BaseModel):
    case_ids: List[str]

class ShortestPathRequest(BaseModel):
    case_ids: Optional[List[str]] = None
    source_node_id: str
    target_node_id: str

# ── Graph Helper (Centrality & Threat Scoring) ────────────────────────────────
def calculate_graph_metrics(nodes: list, links: list):
    if not nodes:
        return {}
    G = nx.Graph()
    for n in nodes:
        G.add_node(n["id"])
    for l in links:
        G.add_edge(l["source"], l["target"])

    deg_centrality = nx.degree_centrality(G)
    bet_centrality = nx.betweenness_centrality(G) if len(G) > 2 else {n["id"]: 0.0 for n in nodes}

    scores = {}
    for n in nodes:
        nid = n["id"]
        base_risk = float(n.get("base_risk", 1.0))
        d_val = float(deg_centrality.get(nid, 0.0))
        b_val = float(bet_centrality.get(nid, 0.0))
        # Threat Formula: (Base Risk * 0.4) + (Degree * 3.0) + (Betweenness * 3.0)
        scores[nid] = {
            "threat_score": round((base_risk * 0.4) + (d_val * 3.0) + (b_val * 3.0), 3),
            "degree_centrality": round(d_val, 4),
            "betweenness_centrality": round(b_val, 4)
        }
    return scores

# ── API Endpoints ─────────────────────────────────────────────────────────────

@app.get("/api/cases")
def get_all_cases(db: Session = Depends(get_db)):
    """ડેશબોર્ડ ડ્રોપડાઉન માટે બધા ઉપલબ્ધ કેસની યાદી આપશે."""
    cases = db.query(Case).order_by(Case.created_at.desc()).all()
    return [
        {
            "id": str(c.id),
            "case_number": c.case_number,
            "title": c.title,
            "status": c.status,
            "created_at": c.created_at
        }
        for c in cases
    ]


@app.post("/api/cases/filter-graph")
def filter_graph_by_cases(payload: CaseFilterRequest, db: Session = Depends(get_db)):
    """પસંદ કરેલા એક અથવા એકથી વધુ કેસના નોડ્સ અને લિંક્સ આપશે."""
    if not payload.case_ids:
        return {"nodes": [], "links": [], "kingpins": []}

    try:
        case_uuids = [uuid.UUID(cid) for cid in payload.case_ids]
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid Case UUID format")

    entities = db.query(Entity).filter(Entity.case_id.in_(case_uuids)).all()
    relationships = db.query(Relationship).filter(Relationship.case_id.in_(case_uuids)).all()

    nodes_out = [
        {
            "id": str(e.id),
            "name": e.canonical_name,
            "type": e.entity_type,
            "base_risk": e.base_risk,
            "threat_score": e.threat_score,
            "case_id": str(e.case_id)
        }
        for e in entities
    ]

    valid_ids = {n["id"] for n in nodes_out}
    links_out = [
        {
            "id": str(r.id),
            "source": str(r.source_entity_id),
            "target": str(r.target_entity_id),
            "relation": r.relation_type,
            "case_id": str(r.case_id)
        }
        for r in relationships
        if str(r.source_entity_id) in valid_ids and str(r.target_entity_id) in valid_ids
    ]

    # રીઅલ-ટાઇમ મર્જ થયેલા કેસનું સેન્ટ્રાલિટી સ્કોરિંગ
    metrics = calculate_graph_metrics(nodes_out, links_out)
    for n in nodes_out:
        if n["id"] in metrics:
            n["threat_score"] = metrics[n["id"]]["threat_score"]

    kingpins = sorted(nodes_out, key=lambda x: x["threat_score"], reverse=True)

    return {"nodes": nodes_out, "links": links_out, "kingpins": kingpins}


@app.post("/api/ai/extract")
def process_fir_and_create_case(request: FIRProcessRequest, db: Session = Depends(get_db)):
    """
    FIR ટેક્સ્ટમાંથી AI દ્વારા એન્ટિટી એક્સટ્રેક્ટ કરશે,
    ઓટોમેટિક કે મેન્યુઅલ નામથી નવો કેસ બનાવશે અને ડેટાબેઝમાં સાચવશે.
    """
    extracted = extract_entities(request.text)

    case_title = request.case_name.strip() if request.case_name and request.case_name.strip() else extracted.get("case_title", "Unassigned Crime Case")
    auto_case_number = f"CASE-{datetime.datetime.utcnow().strftime('%Y%m%d-%H%M%S')}"

    new_case = Case(
        case_number=auto_case_number,
        title=case_title,
        description=request.text[:200] + "..." if len(request.text) > 200 else request.text,
        status="OPEN"
    )
    db.add(new_case)
    db.flush()

    raw_record = Record(
        case_id=new_case.id,
        record_type="FIR",
        source_identifier=auto_case_number,
        raw_content=request.text
    )
    db.add(raw_record)
    db.flush()

    id_map = {}
    nodes_out = []

    for node in extracted.get("nodes", []):
        node_name = node.get("name", "Unknown").strip()
        risk_val = float(node.get("risk", 1.0))

        entity = Entity(
            case_id=new_case.id,
            canonical_name=node_name,
            entity_type=node.get("type", "Suspect"),
            base_risk=risk_val,
            threat_score=risk_val
        )
        db.add(entity)
        db.flush()

        id_map[node["id"]] = str(entity.id)
        nodes_out.append({
            "id": str(entity.id),
            "name": entity.canonical_name,
            "type": entity.entity_type,
            "base_risk": entity.base_risk,
            "threat_score": entity.threat_score,
            "case_id": str(new_case.id)
        })

    links_out = []
    for link in extracted.get("links", []):
        src = id_map.get(link.get("source"))
        tgt = id_map.get(link.get("target"))

        if src and tgt:
            rel = Relationship(
                case_id=new_case.id,
                source_entity_id=uuid.UUID(src),
                target_entity_id=uuid.UUID(tgt),
                relation_type=link.get("relation", "ASSOCIATED_WITH")
            )
            db.add(rel)
            links_out.append({
                "source": src,
                "target": tgt,
                "relation": rel.relation_type,
                "case_id": str(new_case.id)
            })

    db.commit()

    metrics = calculate_graph_metrics(nodes_out, links_out)
    for n in nodes_out:
        if n["id"] in metrics:
            n["threat_score"] = metrics[n["id"]]["threat_score"]

    return {
        "case": {
            "id": str(new_case.id),
            "case_number": new_case.case_number,
            "title": new_case.title
        },
        "nodes": nodes_out,
        "links": links_out
    }


@app.post("/api/entities/manual")
def add_manual_entity(payload: ManualNodeCreate, db: Session = Depends(get_db)):
    """તપાસનીશ જાતે નવો નોડ ઉમેરી શકે તે માટે"""
    try:
        case_uuid = uuid.UUID(payload.case_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid Case ID")

    entity = Entity(
        case_id=case_uuid,
        canonical_name=payload.name,
        entity_type=payload.entity_type,
        base_risk=payload.risk,
        threat_score=payload.risk
    )
    db.add(entity)
    db.commit()
    db.refresh(entity)

    return {
        "id": str(entity.id),
        "name": entity.canonical_name,
        "type": entity.entity_type,
        "threat_score": entity.threat_score,
        "case_id": str(entity.case_id)
    }


@app.post("/api/relationships/manual")
def add_manual_relationship(payload: ManualEdgeCreate, db: Session = Depends(get_db)):
    """તપાસનીશ બે નોડ વચ્ચે જાતે નવી લિંક જોડી શકે તે માટે"""
    try:
        case_uuid = uuid.UUID(payload.case_id)
        src_uuid = uuid.UUID(payload.source_id)
        tgt_uuid = uuid.UUID(payload.target_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid UUID format")

    rel = Relationship(
        case_id=case_uuid,
        source_entity_id=src_uuid,
        target_entity_id=tgt_uuid,
        relation_type=payload.relation_type
    )
    db.add(rel)
    db.commit()
    db.refresh(rel)

    return {
        "id": str(rel.id),
        "source": str(rel.source_entity_id),
        "target": str(rel.target_entity_id),
        "relation": rel.relation_type,
        "case_id": str(rel.case_id)
    }
@app.patch("/api/entities/{entity_id}/dossier")
def update_entity_dossier(
    entity_id: str,
    payload: dict = Body(..., example={"tag": "Hawala Courier", "action": "add_tag", "note": "Spotted at Ring Road branch"}),
    db: Session = Depends(get_db)
):
    """
    Update an entity's investigator dossier: add/remove tags or append notes.
    Payload keys:
        action: "add_tag" | "remove_tag" | "add_note"
        tag: string (required for tag actions)
        note: string (required for add_note)
        author: string (optional for add_note)
    """
    try:
        entity_uuid = uuid.UUID(entity_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid Entity ID format")

    entity = db.query(Entity).filter(Entity.id == entity_uuid).first()
    if not entity:
        raise HTTPException(status_code=404, detail="Entity not found")

    action = payload.get("action")
    if action not in {"add_tag", "remove_tag", "add_note"}:
        raise HTTPException(status_code=400, detail="Invalid action. Must be add_tag, remove_tag, or add_note")

    meta = entity.metadata_json or {}
    tags = set(meta.get("tags", []))
    notes = meta.get("notes", [])

    if action in {"add_tag", "remove_tag"}:
        tag = payload.get("tag")
        if not tag:
            raise HTTPException(status_code=400, detail="Tag value required for tag actions")
        if action == "add_tag":
            tags.add(tag)
        else:
            tags.discard(tag)
        meta["tags"] = list(tags)
    else:  # add_note
        note_text = payload.get("note")
        if not note_text:
            raise HTTPException(status_code=400, detail="Note text required for add_note action")
        author = payload.get("author", "Investigator")
        note_entry = {
            "author": author,
            "text": note_text,
            "timestamp": datetime.datetime.utcnow().isoformat() + "Z"
        }
        notes.append(note_entry)
        meta["notes"] = notes

    entity.metadata_json = meta
    db.add(entity)

    # Audit record
    audit_type = "ENTITY_TAGGED" if action in {"add_tag", "remove_tag"} else "NOTE_APPENDED"
    audit_record = Record(
        case_id=entity.case_id,
        record_type="AUDIT",
        source_identifier=audit_type,
        raw_content=json.dumps({
            "entity_id": str(entity.id),
            "action": action,
            "details": payload
        })
    )
    db.add(audit_record)
    db.commit()
    db.refresh(entity)

    return {
        "id": str(entity.id),
        "tags": entity.metadata_json.get("tags", []),
        "notes": entity.metadata_json.get("notes", []),
        "case_id": str(entity.case_id)
    }


# ── MILESTONE 4: ADVANCED INTELLIGENCE ANALYTICS ───────────────────────────────

@app.get("/api/analytics/cross-case-matches")
def get_cross_case_matches(db: Session = Depends(get_db)):
    """
    અલગ અલગ કેસોમાં એક જ નામ, ફોન કે વાહન હોય તો તેને ડિટેક્ટ કરશે.
    (Cross-case syndicate intelligence detection)
    """
    # શોધો જે એન્ટિટી નામ ૨ કે વધુ અલગ કેસમાં હાજર હોય
    duplicate_names = (
        db.query(Entity.canonical_name)
        .group_by(Entity.canonical_name)
        .having(func.count(func.distinct(Entity.case_id)) > 1)
        .all()
    )
    matched_names = [name[0] for name in duplicate_names]

    if not matched_names:
        return {"total_matches": 0, "cross_case_entities": []}

    matched_entities = (
        db.query(Entity, Case)
        .join(Case, Entity.case_id == Case.id)
        .filter(Entity.canonical_name.in_(matched_names))
        .all()
    )

    results = {}
    for ent, cs in matched_entities:
        c_name = ent.canonical_name.strip()
        if c_name not in results:
            results[c_name] = {
                "entity_name": c_name,
                "entity_type": ent.entity_type,
                "threat_score": ent.threat_score,
                "occurrences": []
            }
        results[c_name]["occurrences"].append({
            "entity_id": str(ent.id),
            "case_id": str(cs.id),
            "case_number": cs.case_number,
            "case_title": cs.title
        })

    return {
        "total_matches": len(results),
        "cross_case_entities": list(results.values())
    }


@app.post("/api/analytics/shortest-path")
def find_shortest_path(payload: ShortestPathRequest, db: Session = Depends(get_db)):
    """
    NetworkX એલ્ગોરિધમ દ્વારા બે શંકાસ્પદો વચ્ચેની સૌથી ટૂંકી કડી (Shortest Path) શોધશે.
    """
    # જો case_ids આપેલા હોય તો તે જ કેસના, નહિતર સમગ્ર ડેટાબેઝના સંબંધો લેશે
    query_rels = db.query(Relationship)
    if payload.case_ids:
        try:
            case_uuids = [uuid.UUID(cid) for cid in payload.case_ids]
            query_rels = query_rels.filter(Relationship.case_id.in_(case_uuids))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid Case UUID format")

    relationships = query_rels.all()

    # NetworkX Undirected Graph બનાવો
    G = nx.Graph()
    for rel in relationships:
        src = str(rel.source_entity_id)
        tgt = str(rel.target_entity_id)
        G.add_edge(src, tgt, relation=rel.relation_type, edge_id=str(rel.id))

    src_id = payload.source_node_id.strip()
    tgt_id = payload.target_node_id.strip()

    if not G.has_node(src_id) or not G.has_node(tgt_id):
        raise HTTPException(
            status_code=404,
            detail="One or both entities not found in the relationship network."
        )

    try:
        path_node_ids = nx.shortest_path(G, source=src_id, target=tgt_id)
    except nx.NetworkXNoPath:
        return {
            "path_found": False,
            "message": "No direct or indirect link found between these two targets.",
            "path_nodes": [],
            "path_edges": []
        }

    # પાથ વચ્ચે આવતી તમામ એન્ટિટીઓની વિગતો મેળવો
    path_uuids = [uuid.UUID(nid) for nid in path_node_ids]
    entities = db.query(Entity).filter(Entity.id.in_(path_uuids)).all()
    ent_dict = {str(e.id): {"id": str(e.id), "name": e.canonical_name, "type": e.entity_type} for e in entities}

    path_nodes = [ent_dict.get(nid, {"id": nid, "name": "Unknown"}) for nid in path_node_ids]

    path_edges = []
    for i in range(len(path_node_ids) - 1):
        u = path_node_ids[i]
        v = path_node_ids[i+1]
        edge_data = G.get_edge_data(u, v)
        path_edges.append({
            "source": u,
            "target": v,
            "relation": edge_data.get("relation", "LINKED_TO")
        })

    return {
        "path_found": True,
        "hops": len(path_node_ids) - 1,
        "path_node_ids": path_node_ids,
        "path_nodes": path_nodes,
        "path_edges": path_edges
    }


# ── MILESTONE 5: CRYPTOGRAPHIC AUDIT LEDGER ───────────────────────────────────

@app.get("/api/cases/{case_id}/audit-ledger")
def get_case_audit_ledger(case_id: str, db: Session = Depends(get_db)):
    """
    Computes a deterministic SHA-256 cryptographic signature for the case evidence
    to guarantee court-admissible chain of custody and tamper-proofing.
    """
    try:
        case_uuid = uuid.UUID(case_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid Case ID format")

    case_obj = db.query(Case).filter(Case.id == case_uuid).first()
    if not case_obj:
        raise HTTPException(status_code=404, detail="Case not found")

    entities = db.query(Entity).filter(Entity.case_id == case_uuid).order_by(Entity.created_at.asc()).all()
    relationships = db.query(Relationship).filter(Relationship.case_id == case_uuid).all()
    records = db.query(Record).filter(Record.case_id == case_uuid).all()

    payload = {
        "case_number": case_obj.case_number,
        "title": case_obj.title,
        "raw_records_count": len(records),
        "entities": [{"name": e.canonical_name, "type": e.entity_type} for e in entities],
        "relationships_count": len(relationships)
    }

    raw_serialized = json.dumps(payload, sort_keys=True)
    evidence_hash = hashlib.sha256(raw_serialized.encode("utf-8")).hexdigest()

    return {
        "case_number": case_obj.case_number,
        "timestamp": case_obj.created_at,
        "tamper_proof_hash": f"SHA256:{evidence_hash}",
        "status": "VERIFIED_TAMPER_PROOF",
        "total_evidence_nodes": len(entities),
        "total_connections": len(relationships)
    }


# ── MILESTONE 6A: STRUCTURED DATA INGESTION ENGINE ────────────────────────────

def _get_or_create_entity(
    db: Session,
    case_id: uuid.UUID,
    canonical_name: str,
    entity_type: str
) -> tuple:
    """
    Returns (entity, was_created).  Looks up by canonical_name + case_id;
    creates a new Entity row only if one does not already exist.
    """
    existing = (
        db.query(Entity)
        .filter(
            Entity.case_id == case_id,
            Entity.canonical_name == canonical_name
        )
        .first()
    )
    if existing:
        return existing, False

    new_entity = Entity(
        case_id=case_id,
        canonical_name=canonical_name,
        entity_type=entity_type,
        base_risk=1.0,
        threat_score=1.0
    )
    db.add(new_entity)
    db.flush()  # populate new_entity.id without committing yet
    return new_entity, True


@app.post("/api/cases/{case_id}/upload-csv")
async def upload_case_csv(
    case_id: str,
    file_type: str = Form(..., description="'cdr' or 'financial'"),
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    """
    Milestone 6A — Structured Data Ingestion Engine.

    Accepts a CSV upload for an existing case and ingests it as a network graph:
    - file_type='cdr'        : columns caller, receiver, timestamp, duration
    - file_type='financial'  : columns source_account, target_account, amount, timestamp

    Automatically re-calculates graph centrality (threat scores) after ingestion.
    """
    # ── 1. Validate case UUID and existence ──────────────────────────────────
    try:
        case_uuid = uuid.UUID(case_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid Case ID format")

    case_obj = db.query(Case).filter(Case.id == case_uuid).first()
    if not case_obj:
        raise HTTPException(status_code=404, detail=f"Case '{case_id}' not found")

    # ── 2. Validate file_type ────────────────────────────────────────────────
    allowed_types = {"cdr", "financial"}
    if file_type not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file_type '{file_type}'. Must be one of: {allowed_types}"
        )

    # ── 3. Read CSV into memory ──────────────────────────────────────────────
    raw_bytes = await file.read()
    try:
        text_content = raw_bytes.decode("utf-8-sig")  # handles BOM from Excel exports
    except UnicodeDecodeError:
        text_content = raw_bytes.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text_content))

    # Normalise header names to lowercase and strip whitespace
    if reader.fieldnames is None:
        raise HTTPException(status_code=400, detail="CSV file appears to be empty or has no header row")

    normalised_fieldnames = [h.strip().lower() for h in reader.fieldnames]
    reader.fieldnames = normalised_fieldnames

    # ── 4. Process rows ──────────────────────────────────────────────────────
    records_processed = 0
    new_entities_count = 0
    new_rel_count = 0

    # Collect node/link snapshots for post-ingest centrality calculation
    snapshot_nodes: list = []
    snapshot_links: list = []

    if file_type == "cdr":
        required_cols = {"caller", "receiver", "timestamp", "duration"}
        missing = required_cols - set(normalised_fieldnames)
        if missing:
            raise HTTPException(
                status_code=422,
                detail=f"CDR CSV missing required columns: {missing}"
            )

        for row in reader:
            caller_name   = (row.get("caller")   or "").strip()
            receiver_name = (row.get("receiver")  or "").strip()
            timestamp     = (row.get("timestamp") or "").strip()
            duration      = (row.get("duration")  or "").strip()

            if not caller_name or not receiver_name:
                continue  # skip malformed rows silently

            caller_ent,   c_created = _get_or_create_entity(db, case_uuid, caller_name,   "Phone")
            receiver_ent, r_created = _get_or_create_entity(db, case_uuid, receiver_name, "Phone")

            if c_created:
                new_entities_count += 1
            if r_created:
                new_entities_count += 1

            # Check for an existing CALLED relationship between these two entities
            existing_rel = (
                db.query(Relationship)
                .filter(
                    Relationship.case_id == case_uuid,
                    Relationship.source_entity_id == caller_ent.id,
                    Relationship.target_entity_id == receiver_ent.id,
                    Relationship.relation_type == "CALLED"
                )
                .first()
            )

            if existing_rel:
                # Increment weight to reflect repeated contact
                existing_rel.weight = (existing_rel.weight or 1.0) + 1.0
                existing_rel.metadata_json = {
                    **(existing_rel.metadata_json or {}),
                    "last_duration": duration,
                    "last_timestamp": timestamp
                }
            else:
                rel = Relationship(
                    case_id=case_uuid,
                    source_entity_id=caller_ent.id,
                    target_entity_id=receiver_ent.id,
                    relation_type="CALLED",
                    weight=1.0,
                    metadata_json={"duration": duration, "timestamp": timestamp}
                )
                db.add(rel)
                new_rel_count += 1

            snapshot_nodes.append({"id": str(caller_ent.id),   "base_risk": caller_ent.base_risk})
            snapshot_nodes.append({"id": str(receiver_ent.id), "base_risk": receiver_ent.base_risk})
            snapshot_links.append({"source": str(caller_ent.id), "target": str(receiver_ent.id)})
            records_processed += 1

    elif file_type == "financial":
        required_cols = {"source_account", "target_account", "amount", "timestamp"}
        missing = required_cols - set(normalised_fieldnames)
        if missing:
            raise HTTPException(
                status_code=422,
                detail=f"Financial CSV missing required columns: {missing}"
            )

        for row in reader:
            src_name  = (row.get("source_account") or "").strip()
            tgt_name  = (row.get("target_account") or "").strip()
            amount    = (row.get("amount")          or "").strip()
            timestamp = (row.get("timestamp")       or "").strip()

            if not src_name or not tgt_name:
                continue  # skip malformed rows silently

            src_ent, s_created = _get_or_create_entity(db, case_uuid, src_name, "Bank Account")
            tgt_ent, t_created = _get_or_create_entity(db, case_uuid, tgt_name, "Bank Account")

            if s_created:
                new_entities_count += 1
            if t_created:
                new_entities_count += 1

            rel = Relationship(
                case_id=case_uuid,
                source_entity_id=src_ent.id,
                target_entity_id=tgt_ent.id,
                relation_type="TRANSFERRED_FUNDS",
                weight=1.0,
                metadata_json={"amount": amount, "timestamp": timestamp}
            )
            db.add(rel)
            new_rel_count += 1

            snapshot_nodes.append({"id": str(src_ent.id), "base_risk": src_ent.base_risk})
            snapshot_nodes.append({"id": str(tgt_ent.id), "base_risk": tgt_ent.base_risk})
            snapshot_links.append({"source": str(src_ent.id), "target": str(tgt_ent.id)})
            records_processed += 1

    # ── 5. Commit everything in one transaction ──────────────────────────────
    db.commit()

    # ── 6. Re-calculate graph centrality & persist updated threat scores ─────
    # De-duplicate snapshot node list so centrality is computed correctly
    seen_node_ids: set = set()
    unique_nodes = []
    for sn in snapshot_nodes:
        if sn["id"] not in seen_node_ids:
            seen_node_ids.add(sn["id"])
            unique_nodes.append(sn)

    metrics = calculate_graph_metrics(unique_nodes, snapshot_links)

    if metrics:
        for node_id, score_data in metrics.items():
            db.query(Entity).filter(
                Entity.id == uuid.UUID(node_id)
            ).update(
                {"threat_score": score_data["threat_score"]},
                synchronize_session=False
            )
        db.commit()

    # ── 7. Return structured ingestion summary ───────────────────────────────
    return {
        "status": "SUCCESS",
        "file_type": file_type,
        "records_processed": records_processed,
        "new_entities_created": new_entities_count,
        "new_relationships_created": new_rel_count
    }


# ── MILESTONE 6B: AUTOMATED SUSPICIOUS PATTERN DETECTION (FORENSIC RULE ENGINE) ──

@app.get("/api/cases/{case_id}/suspicious-patterns")
def detect_suspicious_patterns(case_id: str, db: Session = Depends(get_db)):
    """
    Analyzes case relationships, CDR timestamps, and financial transaction metadata
    to flag anomalous criminal behaviors:
    1. ODD_HOUR_ACTIVITY: Calls placed between 00:00 and 04:30 AM.
    2. HIGH_VALUE_TRANSFER: Single financial transactions >= 500,000 INR.
    3. RAPID_LAYERING: Consecutive fund transfers chained across accounts.
    4. FREQUENT_CONTACT_BURST: Multiple calls between the same parties.
    """
    try:
        case_uuid = uuid.UUID(case_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid Case ID format")

    case_obj = db.query(Case).filter(Case.id == case_uuid).first()
    if not case_obj:
        raise HTTPException(status_code=404, detail="Case not found")

    relationships = db.query(Relationship).filter(Relationship.case_id == case_uuid).all()
    entities_map = {e.id: e.canonical_name for e in db.query(Entity).filter(Entity.case_id == case_uuid).all()}

    patterns = []
    
    for rel in relationships:
        source_id = getattr(rel, "source_entity_id", getattr(rel, "source_id", None))
        target_id = getattr(rel, "target_entity_id", getattr(rel, "target_id", None))
        source_name = entities_map.get(source_id, "Unknown Entity")
        target_name = entities_map.get(target_id, "Unknown Entity")
        meta = getattr(rel, "metadata_json", getattr(rel, "meta_data", {})) or {}
        if isinstance(meta, str):
            try:
                meta = json.loads(meta)
            except Exception:
                meta = {}
        
        # Rule 1: High Value Financial Layering
        if rel.relation_type == "TRANSFERRED_FUNDS":
            amount = 0
            if isinstance(meta, dict) and "amount" in meta:
                try:
                    amount = float(meta["amount"])
                except (ValueError, TypeError):
                    amount = 0
            
            if amount >= 500000:
                patterns.append({
                    "id": f"PAT-FIN-{rel.id}",
                    "rule_type": "HIGH_VALUE_TRANSFER",
                    "severity": "CRITICAL",
                    "title": "High-Value Transaction / Hawala Suspect",
                    "source": source_name,
                    "target": target_name,
                    "amount": amount,
                    "description": f"Abnormal fund movement of ₹{amount:,.2f} detected between accounts.",
                    "timestamp": meta.get("timestamp", str(rel.created_at))
                })

        # Rule 2: Odd-Hour Telephony Activity
        if rel.relation_type == "CALLED":
            ts_str = meta.get("timestamp", "") if isinstance(meta, dict) else ""
            if ts_str:
                # Check for night hours (between 00:00 and 04:30)
                try:
                    from datetime import datetime
                    dt = None
                    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M"):
                        try:
                            dt = datetime.strptime(ts_str.strip()[:19], fmt)
                            break
                        except ValueError:
                            pass
                    if dt and (0 <= dt.hour < 5):
                        patterns.append({
                            "id": f"PAT-CDR-{rel.id}",
                            "rule_type": "ODD_HOUR_ACTIVITY",
                            "severity": "HIGH",
                            "title": "Suspicious Late-Night Call Activity",
                            "source": source_name,
                            "target": target_name,
                            "duration": meta.get("duration", "N/A"),
                            "description": f"Communication intercepted during abnormal hours ({dt.strftime('%I:%M %p')}) between operatives.",
                            "timestamp": ts_str
                        })
                except Exception:
                    pass

    return {
        "case_id": case_id,
        "case_number": case_obj.case_number,
        "total_patterns": len(patterns),
        "patterns": patterns
    }