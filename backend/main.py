from fastapi import FastAPI, HTTPException, status, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
import re
from datetime import datetime
import os
import socket
import uvicorn
from urllib.parse import urlparse
from dotenv import load_dotenv

load_dotenv()

from supabase import create_client

from contextlib import asynccontextmanager
from pydantic import BaseModel
from typing import Optional, List
from langchain_core.messages import HumanMessage
from langchain_groq import ChatGroq

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool
from langgraph.checkpoint.postgres import PostgresSaver

from agent import graph_builder

SUPABASE_DB_URL = os.getenv("SUPABASE_DB_URL")
if SUPABASE_DB_URL:
    SUPABASE_DB_URL = SUPABASE_DB_URL.replace("+psycopg", "")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_DB_URL:
    raise ValueError("SUPABASE_DB_URL environment variable is missing!")

if not SUPABASE_URL:
    raise ValueError("SUPABASE_URL environment variable is missing!")
if not SUPABASE_SERVICE_ROLE_KEY:
    raise ValueError("SUPABASE_SERVICE_ROLE_KEY environment variable is missing!")

pool = None
compiled_graph = None

def _resolve_db_url() -> str:
    """Resolve hostname to IPv4 at runtime (when network is available)."""
    url = SUPABASE_DB_URL
    if not url:
        return url
    parsed = urlparse(url)
    if parsed.hostname:
        try:
            ipv4 = socket.getaddrinfo(parsed.hostname, None, socket.AF_INET)[0][4][0]
            url = url.replace(parsed.hostname, ipv4)
        except OSError:
            pass
    return url

@asynccontextmanager
async def lifespan(app: FastAPI):
    global compiled_graph, pool
    
    resolved_url = _resolve_db_url()
    
    with psycopg.connect(resolved_url, autocommit=True, prepare_threshold=0, row_factory=dict_row) as setup_conn:
        setup_checkpointer = PostgresSaver(setup_conn)
        setup_checkpointer.setup()
    
    pool = ConnectionPool(conninfo=resolved_url, max_size=10, open=True)
    checkpointer = PostgresSaver(pool)
    compiled_graph = graph_builder.compile(checkpointer=checkpointer)
    yield
    if pool:
        pool.close()

app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ----------------------------------------------------------------------
# SECURITY DEPENDENCY: Supabase Auth Client & Validator
# ----------------------------------------------------------------------
supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

def get_current_tenant(authorization: Optional[str] = Header(None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, 
            detail="Authorization header token is missing or malformed."
        )
    
    token = authorization.split(" ")[1]
    
    try:
        user_response = supabase.auth.get_user(token)
        return user_response.user.id
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, 
            detail="Could not validate credentials or session expired."
        )
# ----------------------------------------------------------------------
# PYDANTIC SCHEMAS
# ----------------------------------------------------------------------
class ChatRequest(BaseModel):
    message: str
    hcp_name: str
    specialty: Optional[str] = ""
    hospital: Optional[str] = ""

class ManualLogRequest(BaseModel):
    hcpName: str
    interactionType: Optional[str] = "Meeting"
    date: Optional[str] = ""
    time: Optional[str] = ""
    topicsDiscussed: Optional[str] = ""
    sentiment: Optional[str] = "Neutral"
    outcomes: Optional[str] = ""
    followUpActions: Optional[str] = ""
    specialty: Optional[str] = ""
    hospital: Optional[str] = ""

# ----------------------------------------------------------------------
# HELPER UTILITIES
# ----------------------------------------------------------------------
def sanitize_thread_id(name: str, spec: str, hosp: str) -> str:
    combined = f"{name}_{spec}_{hosp}".lower()
    return re.sub(r'[^a-z0-9_]', '', combined.replace(" ", "_"))

def get_or_create_hcp(tenant_id: str, name: str, specialty: str, hospital: str) -> dict:
    result = supabase.table("hcps").select("*").eq("tenant_id", tenant_id).eq("name", name).eq("specialty", specialty).eq("hospital", hospital).maybe_single().execute()
    hcp = result.data

    if not hcp:
        raw_slug = sanitize_thread_id(name, specialty, hospital)
        scoped_thread_id = f"{tenant_id}_{raw_slug}"

        data = {
            "tenant_id": tenant_id,
            "name": name,
            "specialty": specialty or "General Medicine",
            "hospital": hospital or "Unknown Hospital",
            "chat_thread_id": scoped_thread_id
        }
        insert_result = supabase.table("hcps").insert(data).execute()
        hcp = insert_result.data[0]

    return hcp

def verify_thread_ownership(tenant_id: str, thread_id: str) -> dict:
    result = supabase.table("hcps").select("*").eq("chat_thread_id", thread_id).eq("tenant_id", tenant_id).maybe_single().execute()
    hcp = result.data
    if not hcp:
        raise HTTPException(status_code=404, detail="HCP Context not found or access denied.")
    return hcp

# ----------------------------------------------------------------------
# ENDPOINTS
# ----------------------------------------------------------------------

@app.get("/api/hcps")
async def get_my_hcp_registry(tenant_id: str = Depends(get_current_tenant)):
    try:
        result = supabase.table("hcps").select("*").eq("tenant_id", tenant_id).order("created_at", desc=True).execute()
        return {"hcps": [
            {
                "id": hcp["id"],
                "name": hcp["name"],
                "specialty": hcp["specialty"],
                "hospital": hcp["hospital"],
                "chat_thread_id": hcp["chat_thread_id"]
            } for hcp in result.data
        ]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/chat/history/{thread_id}")
async def get_chat_history(thread_id: str, tenant_id: str = Depends(get_current_tenant)):
    try:
        hcp = verify_thread_ownership(tenant_id, thread_id)
        config = {"configurable": {"thread_id": hcp["chat_thread_id"]}}
        state = compiled_graph.get_state(config)

        history_messages = []
        if state and state.values and "messages" in state.values:
            for msg in state.values["messages"]:
                if msg.type in ["human", "ai"] and msg.content:
                    history_messages.append({
                        "sender": "user" if msg.type == "human" else "ai",
                        "text": msg.content
                    })
        return {"messages": history_messages}
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/chat/summary/{thread_id}")
async def get_transcript_summary(thread_id: str, tenant_id: str = Depends(get_current_tenant)):
    try:
        hcp = verify_thread_ownership(tenant_id, thread_id)
        config = {"configurable": {"thread_id": hcp["chat_thread_id"]}}
        state = compiled_graph.get_state(config)

        formatted_logs = []
        if state and state.values and "messages" in state.values:
            for msg in state.values["messages"]:
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
            "Review the following pharmaceutical interaction transcript.\n"
            "Generate a clear, high-impact bulleted executive summary covering:\n"
            "- Key Discussion Topics\n"
            "- Observed Sentiment\n"
            "- Outcomes & Follow-ups\n\n"
            f"Transcript Data:\n{transcript_block}"
        )

        response = summary_llm.invoke([HumanMessage(content=prompt)])
        return {"summary": response.content.strip()}
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/chat")
async def chat_with_agent(request: ChatRequest, tenant_id: str = Depends(get_current_tenant)):
    try:
        hcp = get_or_create_hcp(tenant_id, request.hcp_name, request.specialty, request.hospital)
        config = {
            "configurable": {
                "thread_id": hcp["chat_thread_id"],
                "tenant_id": tenant_id,
                "hcp_name": hcp["name"]
            }
        }
        result = compiled_graph.invoke({"messages": [HumanMessage(content=request.message)]}, config=config)
        final_message = result["messages"][-1].content if result["messages"] else "Processing complete."

        extracted_fields = result.get("extracted_log_data") or {}

        return {"response": final_message, "extracted_fields": extracted_fields, "chat_thread_id": hcp["chat_thread_id"]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/log-manual")
async def log_manual_interaction(data: ManualLogRequest, tenant_id: str = Depends(get_current_tenant)):
    try:
        hcp = get_or_create_hcp(tenant_id, data.hcpName, data.specialty, data.hospital)

        follow_up = None
        if data.followUpActions:
            try:
                follow_up = datetime.strptime(data.followUpActions, "%Y-%m-%d")
            except ValueError:
                pass

        interaction_data = {
            "hcp_id": hcp["id"],
            "tenant_id": tenant_id,
            "meeting_notes": data.topicsDiscussed,
            "sentiment": data.sentiment,
            "interaction_outcome": data.outcomes,
            "follow_up_date": follow_up.isoformat() if follow_up else None
        }
        supabase.table("interactions").insert(interaction_data).execute()
        return {"status": "success", "message": "Interaction saved to database securely."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
