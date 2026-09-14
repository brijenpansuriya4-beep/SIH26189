import os
import uuid
import datetime
from dotenv import load_dotenv
from sqlalchemy import (
    create_engine, Column, String, Text,
    Float, DateTime, ForeignKey
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import declarative_base, sessionmaker, relationship

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

# Configure connection string for pure-python pg8000 driver
if DATABASE_URL:
    if "://" in DATABASE_URL:
        DATABASE_URL = "postgresql+pg8000://" + DATABASE_URL.split("://", 1)[1]

engine = create_engine(
    DATABASE_URL,
    pool_size=10,
    max_overflow=20
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


class Case(Base):
    """Investigation case container for isolating incidents."""
    __tablename__ = "cases"

    id          = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    case_number = Column(String(100), unique=True, nullable=False)
    title       = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    status      = Column(String(50), default="OPEN")
    created_at  = Column(DateTime(timezone=True), default=datetime.datetime.utcnow, nullable=False)

    records       = relationship("Record", back_populates="case", cascade="all, delete-orphan")
    entities      = relationship("Entity", back_populates="case", cascade="all, delete-orphan")
    relationships = relationship("Relationship", back_populates="case", cascade="all, delete-orphan")


class Record(Base):
    """Source records such as raw FIR intel or imported data dumps."""
    __tablename__ = "records"

    id                = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    case_id           = Column(UUID(as_uuid=True), ForeignKey("cases.id", ondelete="CASCADE"), nullable=False)
    record_type       = Column(String(50), default="FIR")
    source_identifier = Column(String(255), nullable=True)
    raw_content       = Column(Text, nullable=False)
    created_at        = Column(DateTime(timezone=True), default=datetime.datetime.utcnow, nullable=False)

    case = relationship("Case", back_populates="records")


class Entity(Base):
    """Network nodes extracted from intelligence reports."""
    __tablename__ = "entities"

    id                 = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    case_id            = Column(UUID(as_uuid=True), ForeignKey("cases.id", ondelete="CASCADE"), nullable=False)
    entity_type        = Column(String(64), nullable=False)
    canonical_name     = Column(String(256), nullable=False)
    threat_score       = Column(Float, default=0.0, nullable=False)
    base_risk          = Column(Float, default=1.0, nullable=False)
    centrality_metrics = Column(JSONB, default=lambda: {"degree": 0.0, "betweenness": 0.0})
    metadata_json      = Column("metadata", JSONB, default=dict)
    created_at         = Column(DateTime(timezone=True), default=datetime.datetime.utcnow, nullable=False)

    case = relationship("Case", back_populates="entities")


class Relationship(Base):
    """Directed edges linking entities within a case."""
    __tablename__ = "relationships"

    id               = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    case_id          = Column(UUID(as_uuid=True), ForeignKey("cases.id", ondelete="CASCADE"), nullable=False)
    source_entity_id = Column(UUID(as_uuid=True), ForeignKey("entities.id", ondelete="CASCADE"), nullable=False)
    target_entity_id = Column(UUID(as_uuid=True), ForeignKey("entities.id", ondelete="CASCADE"), nullable=False)
    relation_type    = Column(String(128), nullable=False, default="related_to")
    weight           = Column(Float, default=1.0, nullable=False)
    metadata_json    = Column("metadata", JSONB, default=dict)
    created_at       = Column(DateTime(timezone=True), default=datetime.datetime.utcnow, nullable=False)

    case = relationship("Case", back_populates="relationships")

    @property
    def source_id(self):
        return self.source_entity_id

    @property
    def target_id(self):
        return self.target_entity_id

    @property
    def meta_data(self):
        return self.metadata_json


def init_db():
    pass