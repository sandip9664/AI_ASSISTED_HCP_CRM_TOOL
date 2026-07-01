import os
import json
from typing import TypedDict, Annotated,Optional,Literal
from langgraph.graph.message import add_messages

from pydantic import BaseModel, Field
import operator
from dotenv import load_dotenv
from datetime import datetime
from langchain_core.runnables import RunnableConfig
 
from langchain_core.messages import SystemMessage,BaseMessage, HumanMessage, AIMessage

from langgraph.graph import StateGraph,START, END
from langgraph.prebuilt import ToolNode
from langchain_groq import ChatGroq
from langchain_core.tools import tool
from langgraph.prebuilt import ToolNode

load_dotenv()

from models import SessionLocal
 
 

@tool
def log_interaction_tool(
    meeting_notes: str,
    interaction_type: str = "Meeting",
    date: str = "",
    time: str = "",
    chat_thread_id: str = "",
    product_discussed: str = "General",
    sentiment: str = "Neutral",
    interaction_outcome: str = "",
    follow_up_date: str = ""
) -> str:
    """Populates the active staging form workspace with new transactional interaction log data fields.
    Use this when the user describes the outcome of a meeting encounter.
    
    Args:
        meeting_notes: Summary of the discussion points.
        interaction_type: Must be exactly one of: 'Meeting', 'Call', 'Email', 'Webinar'.
        date: Must be formatted exactly as 'YYYY-MM-DD' (e.g., '2026-05-27').
        time: Must be formatted exactly as 24-hour military time 'HH:MM' (e.g., '14:30').
        chat_thread_id: The session thread identifier.
        product_discussed: The product portfolio name.
        sentiment: Must be exactly one of: 'Positive', 'Neutral', 'Negative'.
        interaction_outcome: Outcomes or next steps.
        follow_up_date: Target follow up date formatted as 'YYYY-MM-DD'.
    """
    
    if sentiment:
        sentiment = sentiment.strip().capitalize()
        if sentiment not in ["Positive", "Neutral", "Negative"]:
            sentiment = "Neutral"
    
    if interaction_type:
        interaction_type = interaction_type.strip().capitalize()
        if interaction_type not in ["Meeting", "Call", "Email", "Webinar"]:
            interaction_type = "Meeting"

    if time and ("AM" in time.upper() or "PM" in time.upper()):
        for fmt in ("%I:%M %p", "%I:%M%p", "%I %p", "%I%p"):
            try:
                time = datetime.strptime(time.strip(), fmt).strftime("%H:%M")
                break
            except ValueError:
                continue

    payload = {
        "interactionType": interaction_type,
        "date": date,
        "time": time,
        "chatThreadId": chat_thread_id,
        "productDiscussed": product_discussed,
        "topicsDiscussed": meeting_notes,
        "sentiment": sentiment,
        "outcomes": interaction_outcome,
        "followUpActions": follow_up_date
    }
    return f"EXTRACTED_LOG_DATA: {json.dumps(payload)}"



tools_map = {
    "log_interaction_tool": log_interaction_tool,
}

tools_list = [log_interaction_tool]
 
 
 
    
 
    
    
class AgentState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]
    hcp_name: Optional[str]
    specialty: Optional[str]
    hospital: Optional[str]
    thread_id: Optional[str]
    meeting_notes: Optional[str]
    product_discussed: Optional[str]
    sentiment: Optional[str]
    interaction_outcome: Optional[str]
    follow_up_date: Optional[str]
    date_and_time: Optional[str]
    meeting_type: Optional[str]
    extracted_log_data: Optional[dict]

llm = ChatGroq(
    temperature=0,
    model_name="meta-llama/llama-4-scout-17b-16e-instruct",
    api_key=os.getenv("GROQ_API_KEY")  )
 
 
 
llm_with_tool=llm.bind_tools(tools_list)


def chatbot(state: AgentState, config: RunnableConfig):
    configurable = config.get("configurable", {})
    active_thread_id = configurable.get("thread_id", "Unknown")
    active_hcp = configurable.get("hcp_name", "Unknown")

    
    now = datetime.now()
    current_date_ref = now.strftime("%Y-%m-%d")
    current_time_ref = now.strftime("%H:%M")

    system_prompt = SystemMessage(
    content=(
        f"You are an expert AI assistant helping Pharma Sales Representatives log interactions.\n"
        f"HCP: '{active_hcp}' | Session Thread ID: '{active_thread_id}'\n"
        f"Current Date: {current_date_ref} | Current Time: {current_time_ref}\n\n"
        "RULES:\n"
        "1. Never ask the user to confirm dates, times, or field formats — the tool schema defines valid formats, infer silently.\n"
        "2. If the user gives no explicit date/time (e.g. 'today', 'just now', 'yesterday'), use the Current Date/Time above.\n"
        "3. Call `log_interaction_tool` immediately on the first turn — never stall or list requirements.\n"
        f"4. Always pass chat_thread_id='{active_thread_id}' to the tool exactly as given."
    )
)
    messages = [system_prompt] + state["messages"]
    response = llm_with_tool.invoke(messages)

    extracted_log_data = None
    for msg in state["messages"]:
        text = ""
        if isinstance(msg.content, str):
            text = msg.content
        elif isinstance(msg.content, list):
            for block in msg.content:
                if isinstance(block, dict) and block.get("type") == "text":
                    text += block.get("text", "")
        if "EXTRACTED_LOG_DATA:" in text:
            try:
                json_str = text.split("EXTRACTED_LOG_DATA:", 1)[1].strip()
                extracted_log_data = json.loads(json_str)
                if isinstance(extracted_log_data, dict):
                    extracted_log_data["date"] = current_date_ref
                    extracted_log_data["time"] = current_time_ref
            except Exception:
                pass
            break

    return {"messages": [response], "extracted_log_data": extracted_log_data}
 

graph_builder = StateGraph(AgentState)
graph_builder.add_node("chatbot", chatbot)
graph_builder.add_node("tools", ToolNode(tools=tools_list))

graph_builder.add_edge(START, "chatbot")
graph_builder.add_conditional_edges(
        "chatbot",
        lambda state: "tools" if state["messages"][-1].tool_calls else END,
    )
graph_builder.add_edge("tools", "chatbot")

    
