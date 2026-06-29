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
from models import SessionLocal

 
load_dotenv()
 
 

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
    hcp_name: Optional[str] = Field(None, description="The standardized name of the healthcare professional")
    specialty: Optional[str] = Field(None, description="The medical specialty of the HCP")
    hospital: Optional[str] = Field(None, description="The hospital or clinic name where HCP works")
    thread_id: Optional[str] = Field(None, description="The unique thread ID for this HCP conversation session")
    meeting_notes: Optional[str] = Field(None, description="The raw or summarized discussion context extracted from the interaction")
    product_discussed: Optional[str] = Field("General", description="The therapeutic drug or portfolio name discussed during the meeting")
    sentiment: Optional[str] = Field("Neutral", description="The clinician's perceived response: Positive, Neutral, or Negative")
    interaction_outcome: Optional[str] = Field(None, description="Next steps or core decisions reached during the meeting")
    follow_up_date: Optional[str] = Field(None, description="The targeted next touchpoint date formatted as YYYY-MM-DD")
    date_and_time: Optional[str] = Field(None, description="The specific date and time of the interaction event (e.g., '2026-05-21 15:45')")
    meeting_type: Literal['Meeting','Call','Email','Webinar','None']

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
            f"Current context: Working with HCP: '{active_hcp}' under Session Thread ID: '{active_thread_id}'.\n"
            f"Reference Current Date: {current_date_ref}\n"
            f"Reference Current Time: {current_time_ref}\n\n"
            "CRITICAL AUTOMATION & ZERO-INTERRUPTION RULES:\n"
            "1. DO NOT ask the user to confirm dates, times, formats, or follow-ups. Never ask questions like 'Can you confirm the date?' or 'What time?'.\n"
            "2. AUTOMATICALLY INFER MISSING VALUES: If the user says 'today', 'yesterday', 'just now', or describes an interaction without explicitly specifying a exact time/date, you MUST automatically assume it happened today at the current time.\n"
            "   - Use the 'Reference Current Date' value for the date field.\n"
            "   - Use the 'Reference Current Time' value for the time field.\n"
            "3. ZERO DELAY: Proceed directly to triggering `log_interaction_tool`  immediately on the very first turn. Never stall the user by listing requirements.\n"
            "4. STAGE ALL COMPONENT FIELDS:\n"
            "   - interaction_type: MUST match one of choices exactly: 'Meeting', 'Call', 'Email', 'Webinar'. (Default to 'Meeting' if unclear).\n"
            "   - date & follow_up_date: MUST be formatted as standard 'YYYY-MM-DD'.\n"
            "   - time: MUST be formatted as 24-hour military text string 'HH:MM'.\n"
            "   - sentiment: Infer the tone from the user's report and map to exactly: 'Positive', 'Neutral', or 'Negative'. Do not leave it blank.\n"
            f"   - chat_thread_id: You MUST pass the active session value: '{active_thread_id}' directly."
        )
    )
    messages = [system_prompt] + state["messages"]
    response = llm_with_tool.invoke(messages)
    return {"messages": [response]}
 


try:
    graph_builder = StateGraph(AgentState)
    graph_builder.add_node("chatbot", chatbot)
    graph_builder.add_node("tools", ToolNode(tools=tools_list))

    graph_builder.add_edge(START, "chatbot")
    graph_builder.add_conditional_edges(
            "chatbot",
            lambda state: "tools" if state["messages"][-1].tool_calls else END,
        )
    graph_builder.add_edge("tools", "chatbot")
except Exception as e:
    graph_builder_error = str(e)

    
