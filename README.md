<div align="center">

# 🧠 PharmaCRM — AI-Assisted HCP CRM Tool

**A production-grade, multi-tenant CRM platform built for pharmaceutical sales representatives.**  
Log doctor interactions in plain English — the AI extracts, structures, and remembers everything.

[![Python](https://img.shields.io/badge/Python-3.10+-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-Latest-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev)
[![Supabase](https://img.shields.io/badge/Supabase-Auth%20%2B%20DB-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white)](https://supabase.com)
[![LangGraph](https://img.shields.io/badge/LangGraph-Stateful%20Agent-1C3C3C?style=for-the-badge)](https://langchain-ai.github.io/langgraph)
[![Groq](https://img.shields.io/badge/Groq-LLaMA%204%20Scout-F55036?style=for-the-badge)](https://groq.com)
[![Live Demo](https://img.shields.io/badge/Live%20Demo-Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white)](https://ai-assisted-hcp-crm-tool.vercel.app)

### 🌐 [Live Demo → ai-assisted-hcp-crm-tool.vercel.app](https://ai-assisted-hcp-crm-tool.vercel.app/#)

</div>

---

## 📌 What Is This?

Pharma field reps visit dozens of doctors daily. Traditional CRMs demand rigid data entry — they slow reps down and get abandoned. This tool flips that model:

> *"Describe your meeting in plain English. The AI extracts every field, populates the form, remembers previous visits, and generates a boardroom-ready summary — automatically."*

Built with a **stateful LangGraph agent**, **Supabase Auth (Google OAuth)**, and a fully **multi-tenant architecture** where every rep's data is scoped and isolated by their authenticated user ID.

---

## 🖥️ Screenshots

### 1. Login Page — Google OAuth
Clean landing page with feature highlights and one-click Google Sign-In. No passwords to manage.

![Login Page](screenshots/screen_login.png)

---

### 2. Context Initialization — Lock Session to an HCP
After login, enter the doctor's **Name + Specialty + Hospital** to lock the AI session context. This generates a deterministic compound thread ID used for persistent memory.

![Context Initialization](screenshots/screen_first_page.png)

---

### 3. My HCPs Roster — Quick Context Switching
Click **My HCPs** to view your full doctor roster. One click on "Load context" instantly switches the AI assistant and form to that doctor's history.

![HCP Roster](screenshots/screen_hcp_list.png)

---

### 4. AI Executive Summary — Auto-Generated Interaction Report
Click **Summary** to generate a structured executive briefing from the full conversation history — covering key discussion topics, observed sentiment, outcomes, and follow-up actions.

![AI Summary](screenshots/screen_summary.png)

---

## ✨ Feature Breakdown

### 🔐 Authentication & Multi-Tenancy
- **Google OAuth via Supabase Auth** — one-click sign-in, zero password management
- Every API request validated via **Bearer JWT token** extracted from Supabase session
- All data (HCPs, interactions, chat threads) is **scoped by `tenant_id`** (the authenticated user's Supabase UID)
- Reps can only ever see and modify their own data — enforced at the backend query level

### 🤖 Stateful LangGraph AI Agent
- Powered by **LLaMA 4 Scout (17B)** via Groq's inference API
- **Persistent conversation memory per HCP** — the agent remembers every prior visit across sessions using a PostgreSQL-backed LangGraph checkpointer
- **Dynamic intent routing**: the agent automatically decides whether to call a logging tool or answer a question — no mode switching
- **Silent date/time inference** — relative terms like "today", "just now", "yesterday" are resolved to exact values without prompting the user
- Tool response auto-**populates the Redux form** on the frontend in real-time via `syncEntireForm`

### 📋 Interaction Logging (Two Paths)
- **AI-assisted**: describe a meeting in chat; `log_interaction_tool` extracts and returns structured JSON which syncs to the left form instantly
- **Manual form entry**: fill the structured form directly and submit — both paths write to the same database
- Fields: HCP name, specialty, hospital, interaction type (Meeting / Call / Email / Webinar), date, time, topics discussed, products discussed, sentiment (Positive / Neutral / Negative), outcomes, follow-up date

### 🏥 HCP Profile & Context Management
- **Three-field compound HCP identification**: Name + Specialty + Hospital generates a unique, tenant-scoped `chat_thread_id`
- "**Lock Session Context**" — locks the AI and form to one doctor, preventing cross-contamination
- **My HCPs roster** — lists all your known HCPs with one-click context switching and immediate history restoration

### 📊 History & Executive Summaries
- **History** — restores the full LangGraph conversation checkpoint for the active HCP from any prior session
- **Summary** — fires a second LLM call that reads the full transcript and generates a structured executive summary with topics, sentiment, outcomes, and follow-up dates inferred from context

---

## 🏗️ Architecture

```
AI_ASSISTED_HCP_CRM_TOOL/
├── backend/
│   ├── main.py              # FastAPI app — REST endpoints, Supabase auth middleware, lifespan DB pool
│   ├── agent.py             # LangGraph agent — StateGraph, log_interaction_tool, chatbot node
│   └── .env                 # Environment variables (not committed)
│
├── pharma-crm-frontend/
│   ├── src/
│   │   ├── App.jsx          # Full UI — landing/auth gate, interaction form, AI chat panel
│   │   ├── store.js         # Redux Toolkit — form state, syncEntireForm action
│   │   └── main.jsx         # React entry point
│   ├── .env.local           # Frontend env variables (not committed)
│   └── package.json
│
└── .gitignore
```

### Request Flow

```
Browser
  │
  ├─ [Login] ──► Supabase Auth (Google OAuth) ──► JWT Token stored in session
  │
  ├─ [Chat] ──► POST /api/chat  { Bearer JWT }
  │                │
  │           Validate JWT → extract tenant_id
  │                │
  │           get_or_create_hcp() → Supabase hcps table
  │                │
  │           LangGraph invoke() with PostgreSQL checkpointer
  │                │
  │           log_interaction_tool (if logging intent detected)
  │                │
  │           Returns { response, extracted_fields, chat_thread_id }
  │                │
  └─ Redux syncEntireForm() ──► auto-populates left-side form
```

---

## 🛠️ Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Backend Framework** | FastAPI (Python) | REST API, async lifespan, dependency injection |
| **AI Orchestration** | LangGraph | Stateful agent graph with conditional routing |
| **LLM** | Groq — LLaMA 4 Scout 17B | Chat completions + summary generation |
| **Agent Memory** | LangGraph PostgreSQL Checkpointer | Per-HCP persistent conversation state across sessions |
| **Auth** | Supabase Auth (Google OAuth) | JWT-based authentication, session management |
| **Database** | Supabase (PostgreSQL) | HCP profiles, interaction logs, tenant isolation |
| **Frontend** | React 18 + Vite | Single-page application |
| **State Management** | Redux Toolkit | Form state + AI field auto-sync |
| **Styling** | Tailwind CSS | Utility-first responsive UI |
| **HTTP** | Native Fetch API | Bearer token injection on all requests |
| **Hosting** | Vercel (frontend) + Render (backend) | Free-tier production deployment |

---

## ⚙️ Setup & Installation

### Prerequisites

- Python 3.10+
- Node.js 18+
- A [Supabase](https://supabase.com) project (free tier)
- A [Groq](https://console.groq.com) API key (free tier)

---

### Step 1 — Supabase Project Setup

In your Supabase project SQL editor, run:

```sql
-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- HCP profiles table
create table hcps (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  specialty text not null default 'General Medicine',
  hospital text not null default 'Unknown Hospital',
  chat_thread_id text unique not null,
  created_at timestamptz default now()
);

-- Interactions table
create table interactions (
  id uuid primary key default uuid_generate_v4(),
  hcp_id uuid not null references hcps(id) on delete cascade,
  tenant_id uuid not null references auth.users(id) on delete cascade,
  meeting_notes text,
  sentiment text check (sentiment in ('Positive', 'Neutral', 'Negative')) default 'Neutral',
  interaction_outcome text,
  follow_up_date date,
  created_at timestamptz default now()
);

-- Performance indexes
create index on hcps(tenant_id);
create index on interactions(tenant_id);
create index on interactions(hcp_id);
```

Then in Supabase Dashboard:
- **Authentication → Providers → Google** — enable and add your Google OAuth Client ID + Secret
- Copy your **Project URL**, **Anon Key**, **Service Role Key** from Project Settings → API
- Copy your **Database URI** from Project Settings → Database → Connection string (URI)

---

### Step 2 — Backend Setup

```bash
cd backend

# Create and activate virtual environment
python -m venv venv
source venv/bin/activate        # Linux / macOS
venv\Scripts\activate           # Windows

# Install dependencies
pip install fastapi uvicorn python-dotenv supabase langchain langchain-groq \
            langgraph langgraph-checkpoint-postgres psycopg psycopg-pool
```

Create `backend/.env`:

```env
GROQ_API_KEY=your_groq_api_key_here

SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here

# Replace [YOUR-PASSWORD] with your DB password
SUPABASE_DB_URL=postgresql://postgres:[YOUR-PASSWORD]@db.your-project-ref.supabase.co:5432/postgres
```

Start the server:

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Swagger docs available at: `http://localhost:8000/docs`

---

### Step 3 — Frontend Setup

```bash
cd pharma-crm-frontend
npm install
```

Create `pharma-crm-frontend/.env.local`:

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key_here
VITE_API_URL=http://localhost:8000
```

Start the dev server:

```bash
npm run dev
```

App available at: `http://localhost:5173`

---

## 🔌 API Reference

All endpoints require `Authorization: Bearer <supabase_jwt>`.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/hcps` | Fetch all HCPs for the authenticated rep |
| `POST` | `/api/chat` | Send a message to the LangGraph agent |
| `GET` | `/api/chat/history/{thread_id}` | Load full conversation history for an HCP |
| `GET` | `/api/chat/summary/{thread_id}` | Generate executive summary from full transcript |
| `POST` | `/api/log-manual` | Log a structured interaction directly (no AI) |

---

## 🧪 Usage Walkthrough

1. **Sign In** — Click "Continue with Google" on the landing page.

2. **Initialize HCP Context** — Enter the doctor's Name, Specialty, and Hospital, then click "Lock Session Context".

3. **Describe Your Meeting** — Type naturally in the chat:
   > *"Met Dr. Naaz today. She ordered 1000 more Nebicard 5mg. Very positive about the last delivery. Follow up call in 2 days."*
   The AI extracts all fields and auto-populates the form on the left.

4. **Review & Save** — Check the auto-filled form, adjust if needed, then click "Save Structured Form Entry Manually".

5. **History / Summary** — Click **History** to restore a past conversation, or **Summary** for an executive briefing.

6. **Switch Doctors** — Click **My HCPs** → "Load context" on any doctor to instantly switch sessions.

---

## 🚀 Deployment (Free Tier)

| Component | Platform | Notes |
|---|---|---|
| **Frontend** | [Vercel](https://vercel.com) | Connect GitHub repo; add `VITE_*` env vars in dashboard |
| **Backend** | [Render](https://render.com) or [Railway](https://railway.app) | Deploy as web service; add `.env` vars in dashboard |
| **Database + Auth** | [Supabase](https://supabase.com) | Already configured above |

> After deploying, set `VITE_API_URL` to your Render/Railway backend URL in Vercel, and restrict CORS in `main.py` from `["*"]` to your frontend domain.

---

## 🗺️ Roadmap

- [ ] Role-based access: `admin` (sees full org) vs `rep` (sees only own HCPs)
- [ ] Supabase Row-Level Security policies as a DB-level enforcement layer
- [ ] Analytics dashboard — visit frequency, sentiment trends per HCP over time
- [ ] Voice-to-text interaction logging (Whisper API)
- [ ] Email / WhatsApp follow-up reminders
- [ ] Docker Compose for self-hosted deployment
- [ ] Export interactions to PDF / Excel reports

---

## 👤 Author

**Sandip** — AI enthusiastic  



## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

<div align="center">
<i>Built to eliminate manual CRM entry in pharma field sales — replacing clipboard forms with an AI-first, conversation-driven interaction management system.</i>
</div>
