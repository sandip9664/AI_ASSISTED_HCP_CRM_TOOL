from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
import re
from datetime import datetime
import json
import os
import uvicorn

from contextlib import asynccontextmanager
from pydantic import BaseModel
from typing import Optional
from langchain_core.messages import HumanMessage
from langchain_groq import ChatGroq
from sqlalchemy import text


from psycopg import Connection
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool
from langgraph.checkpoint.postgres import PostgresSaver

from agent import graph_builder
from models import SessionLocal, engine, Base, HCP  

SUPABASE_DB_URL = os.getenv("SUPABASE_DB_URL")
pool = ConnectionPool(conninfo=SUPABASE_DB_URL, max_size=10, open=False)


compiled_graph = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global compiled_graph
    
    
    Base.metadata.create_all(bind=engine)
    
    
    with Connection.connect(SUPABASE_DB_URL, autocommit=True, prepare_threshold=0, row_factory=dict_row) as setup_conn:
        setup_checkpointer = PostgresSaver(setup_conn)
        setup_checkpointer.setup()
    
    
    pool.open()
    checkpointer = PostgresSaver(pool)
    compiled_graph = graph_builder.compile(checkpointer=checkpointer)
    
    yield
    
    
    pool.close()
    engine.dispose()
    

app = FastAPI(lifespan=lifespan)


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ManualLogRequest(BaseModel):
    hcpName: str
    interactionType: str
    date: str
    time: str
    attendees: Optional[str] = ""
    topicsDiscussed: Optional[str] = ""
    sentiment: str
    outcomes: Optional[str] = ""
    followUpActions: Optional[str] = ""


class ChatRequest(BaseModel):
    message: str
    hcp_name: str
    specialty: str
    hospital: str

class ExtractedCRMFields(BaseModel):
    interactionType: Optional[str] = None
    date: Optional[str] = None
    time: Optional[str] = None
    topicsDiscussed: Optional[str] = None
    sentiment: Optional[str] = None
    outcomes: Optional[str] = None
    followUpActions: Optional[str] = None

def sanitize_thread_id(hcp_name: str, specialty: str, hospital: str) -> str:
    """Converts 'Dr. Naresh', 'Cardiology', 'Apollo Hospital' into 'dr_naresh_cardiology_apollo' for consistent thread IDs."""
    clean_name = re.sub(r'[^a-zA-Z0-9\s]', '', hcp_name).strip().lower().replace(" ", "_")
    clean_specialty = re.sub(r'[^a-zA-Z0-9\s]', '', specialty).strip().lower().replace(" ", "_")
    clean_hospital = re.sub(r'[^a-zA-Z0-9\s]', '', hospital).strip().lower().replace(" ", "_")[:5]
    return f"{clean_name}_{clean_specialty}_{clean_hospital}"
 

def get_or_create_hcp(connection, name: str, specialty: str, hospital: str) -> tuple[int, str]:
    name_str = name.strip()
    spec_str = specialty.strip() if specialty else "General Medicine"
    hosp_str = hospital.strip() if hospital else "Unknown Hospital"
    
    
    row = connection.execute(
        text("SELECT id, chat_thread_id FROM hcps WHERE name = :name AND specialty = :specialty AND hospital = :hospital;"),
        {"name": name_str, "specialty": spec_str, "hospital": hosp_str}
    ).fetchone()
    
    if row:
        return row[0], row[1]
    
    generated_thread = sanitize_thread_id(name_str, spec_str, hosp_str)
    insert_stmt = connection.execute(
        text("""
            INSERT INTO hcps (name, specialty, hospital, chat_thread_id, created_at) 
            VALUES (:name, :specialty, :hospital, :chat_thread_id, :created_at) 
            RETURNING id;
        """),
        {"name": name_str, "specialty": spec_str, "hospital": hosp_str, "chat_thread_id": generated_thread, "created_at": datetime.now()}
    )
    new_id = insert_stmt.fetchone()[0]
    return new_id, generated_thread


@app.get("/")
def read_root():
    return {"status": "online", "message": "Pharma CRM Backend API with Supabase Postgres Persistence running."}


@app.post("/api/log-manual", status_code=status.HTTP_201_CREATED)
async def log_manual_endpoint(payload: ManualLogRequest):
    print(f"Direct Database Write triggered for HCP: {payload.hcpName}")
    
    with engine.connect() as connection:
        try:
            hcp_lookup = connection.execute(
                text("SELECT id FROM hcps WHERE name = :name;"), 
                {"name": payload.hcpName}
            ).fetchone()
            
            if hcp_lookup:
                hcp_id = hcp_lookup[0]
            else:
                hcp_insert = connection.execute(
                    text("INSERT INTO hcps (name, created_at) VALUES (:name, :created_at) RETURNING id;"),
                    {"name": payload.hcpName, "created_at": datetime.now()}
                )
                hcp_id = hcp_insert.fetchone()[0]

            query = text("""
                INSERT INTO interactions (
                    hcp_id, 
                    product_discussed,
                    meeting_notes, 
                    sentiment, 
                    interaction_outcome, 
                    follow_up_date,
                    created_at
                ) 
                VALUES (:hcp_id, :product_discussed, :meeting_notes, :sentiment, :interaction_outcome, :follow_up_date, :created_at)
                RETURNING id;
            """)
            
            combined_notes = f"Type: {payload.interactionType}. Notes: {payload.topicsDiscussed}."
            
            parsed_date = None
            if payload.date and payload.date.strip():
                try:
                    parsed_date = datetime.strptime(payload.date.strip(), "%Y-%m-%d")
                except ValueError:
                    parsed_date = None

            result = connection.execute(query, {
                "hcp_id": hcp_id,
                "product_discussed": "General",  
                "meeting_notes": combined_notes,
                "sentiment": payload.sentiment,
                "interaction_outcome": payload.outcomes if payload.outcomes else payload.followUpActions,
                "follow_up_date": parsed_date,
                "created_at": datetime.now()
            })
            
            connection.commit()
            inserted_id = result.fetchone()[0]
            
            return {
                "status": "success",
                "message": f"Successfully committed log for {payload.hcpName}",
                "record_id": inserted_id
            }
            
        except Exception as e:
            connection.rollback()
            print(f"Database write operation exception: {str(e)}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to record manual log entry into central ledger: {str(e)}"
            )


@app.post("/api/chat")
async def chat_with_agent(request: ChatRequest):
    try:
        if compiled_graph is None:
            raise HTTPException(status_code=500, detail="Graph structure is uninitialized.")

        with engine.connect() as connection:
            hcp_id, thread_id = get_or_create_hcp(connection, request.hcp_name, request.specialty, request.hospital)
            connection.commit()

        config = {
            "configurable": {
                "thread_id": thread_id,
                "hcp_name": request.hcp_name,
                "specialty": request.specialty,
                "hospital": request.hospital
            }
        }

        
        events = compiled_graph.stream(
            {"messages": [HumanMessage(content=request.message)]},
            config,
            stream_mode="values",
        )

        final_state = None
        for event in events:
            final_state = event

        final_response = final_state["messages"][-1]
        
        extracted_fields = {}
        messages_list = final_state.get("messages", [])

        for msg in messages_list:
            content_str = ""
            if hasattr(msg, "content") and isinstance(msg.content, str):
                content_str = msg.content

            if "EXTRACTED_LOG_DATA:" in content_str:
                try:
                    raw_json = content_str.split("EXTRACTED_LOG_DATA:")[1].strip()
                    extracted_fields.update(json.loads(raw_json))
                except Exception:
                    pass
            elif "EXTRACTED_EDIT_DATA:" in content_str:
                try:
                    raw_json = content_str.split("EXTRACTED_EDIT_DATA:")[1].strip()
                    extracted_fields.update(json.loads(raw_json))
                except Exception:
                    pass

        validated_fields = ExtractedCRMFields(**extracted_fields).model_dump(exclude_none=True)

        return {
            "thread_id": thread_id,
            "hcp_name": request.hcp_name,
            "response": getattr(final_response, 'content', None),
            "extracted_fields": validated_fields
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
    
@app.get("/api/chat/history/{thread_id}")
async def get_chat_history(thread_id: str):
    try:
        if compiled_graph is None:
            raise HTTPException(status_code=500, detail="Graph structure is uninitialized.")

        config = {"configurable": {"thread_id": thread_id}}

        state_history = list(compiled_graph.get_state_history(config))
        state_history.reverse()

        formatted_messages = []
        seen_ids = set()

        for state in state_history:
            if not state or not state.values:
                continue
            messages = state.values.get("messages", [])
            ts = None
            try:
                
                if hasattr(state, 'metadata') and state.metadata and state.metadata.get("timestamp"):
                    ts = state.metadata.get("timestamp")
            except Exception:
                pass

            for msg in messages:
                msg_id = getattr(msg, 'id', None)
                if msg_id and msg_id in seen_ids:
                    continue
                if msg_id:
                    seen_ids.add(msg_id)

                mtype = getattr(msg, 'type', None)
                content = getattr(msg, 'content', None)
                
                if mtype == "human":
                    formatted_messages.append({"sender": "user", "text": content, "timestamp": ts})
                elif mtype == "ai" and content:
                    formatted_messages.append({"sender": "ai", "text": content, "timestamp": ts})
                elif mtype == "system":
                    formatted_messages.append({"sender": "system", "text": content, "timestamp": ts})

        return {"thread_id": thread_id, "messages": formatted_messages}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to extract chat state: {str(e)}")


@app.get('/api/hcps')
def get_hcps():
    try:
        db = SessionLocal()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB session failed: {str(e)}")

    try:
        rows = db.query(HCP).all()
        result = []
        for r in rows:
            result.append({
                'id': r.id,
                'name': r.name,
                'specialty': r.specialty,
                'hospital': r.hospital,
                'chat_thread_id': r.chat_thread_id,
                'created_at': r.created_at.isoformat() if getattr(r, 'created_at', None) else None,
            })
        return {'hcps': result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            db.close()
        except Exception:
            pass
    

@app.get("/api/chat/summary/{thread_id}")
async def get_chat_summary(thread_id: str):
    try:
        if compiled_graph is None:
            raise HTTPException(status_code=500, detail="Graph structure is uninitialized.")

        config = {"configurable": {"thread_id": thread_id}}
        state_history = list(compiled_graph.get_state_history(config))
        
        formatted_logs = []
        if state_history:
            latest_state = state_history[0]
            messages = latest_state.values.get("messages", [])
            for msg in messages:
                if msg.type == "human":
                    formatted_logs.append(f"Rep: {msg.content}")
                elif msg.type == "ai" and msg.content:
                    formatted_logs.append(f"AI: {msg.content}")
                    
        if not formatted_logs:
            return {"summary": "No historical chat transcript exists for this HCP context yet."}
            
        transcript_block = "\n".join(formatted_logs)
        
        summary_llm = ChatGroq(
            temperature=0.1,
            model_name="meta-llama/llama-4-scout-17b-16e-instruct",
            api_key=os.getenv("GROQ_API_KEY")
        )
        
        prompt = (
            "You are an expert pharmaceutical CRM data specialist. Review the following conversational interaction "
            "history transcript between a Pharma Sales Representative and an AI Assistant regarding an HCP.\n"
            "Generate a clear, high-impact bulleted executive summary covering:\n"
            "- Key Therapeutic/Product Discussion Topics\n"
            "- Observed Doctor Posture & Sentiment\n"
            "- Main Outcomes & Planned Follow-up Touchpoints\n\n"
            f"Transcript Data:\n{transcript_block}"
        )
        
        response = summary_llm.invoke([HumanMessage(content=prompt)])
        return {"summary": response.content.strip()}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to compile conversational summary: {str(e)}")
    
if __name__ == "__main__":
    
    port = int(os.environ.get("PORT", 10000))
    uvicorn.run("main:app", host="0.0.0.0", port=port)