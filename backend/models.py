import os
from datetime import datetime
from zoneinfo import ZoneInfo
from sqlalchemy import create_engine, Column, Integer, String, Text, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import declarative_base, sessionmaker, relationship
from sqlalchemy.dialects.postgresql import UUID 

IST = ZoneInfo("Asia/Kolkata")
DATABASE_URL = os.getenv("SUPABASE_DB_URL")

engine = create_engine(DATABASE_URL, pool_pre_ping=True, pool_recycle=300, pool_size=5, max_overflow=2)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class HCP(Base):
    __tablename__ = "hcps"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(UUID(as_uuid=True), nullable=False, index=True) 
    name = Column(String(255), nullable=False, index=True)
    specialty = Column(String(255), nullable=False, default="General Medicine")
    hospital = Column(String(255), nullable=False, default="Unknown Hospital")
    chat_thread_id = Column(String(255), unique=True, nullable=False, index=True)
    created_at = Column(DateTime, default=lambda: datetime.now(IST).replace(tzinfo=None))
    
    
    __table_args__ = (UniqueConstraint('tenant_id', 'name', 'specialty', 'hospital', name='_hcp_tenant_unique_combo'),)
    
    interactions = relationship("Interaction", back_populates="hcp")

class Interaction(Base):
    __tablename__ = "interactions"
    
    id = Column(Integer, primary_key=True, index=True)
    hcp_id = Column(Integer, ForeignKey("hcps.id"), nullable=False)
    tenant_id = Column(UUID(as_uuid=True), nullable=False, index=True) 
    product_discussed = Column(String(100))
    meeting_notes = Column(Text, nullable=False)
    sentiment = Column(String(50))
    interaction_outcome = Column(Text)
    follow_up_date = Column(DateTime)
    created_at = Column(DateTime, default=lambda: datetime.now(IST).replace(tzinfo=None))
    
    hcp = relationship("HCP", back_populates="interactions")