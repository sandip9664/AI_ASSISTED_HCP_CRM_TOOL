# 🩺 AI-Assisted HCP CRM Tool

An AI-powered, multi-tenant CRM built for pharmaceutical sales representatives to log Healthcare Professional (HCP) interactions using **natural conversation** instead of manual forms. Describe a meeting in plain English — the AI agent extracts structured data (date, sentiment, outcomes, follow-ups) and auto-fills the form in real time.

> Built as part of an independent product exploration into AI-assisted sales workflows for the pharma industry.

---

## 📸 Screenshots

> Replace the placeholders below with real screenshots before publishing. Save your images inside a `/screenshots` folder in the repo root and update the paths.

| Login | Chat + Auto-Fill Form |
|---|---|
| ![Login Screen](./screenshots/login.png) | ![Main Dashboard](./screenshots/dashboard.png) |

| HCP Roster | Interaction Summary |
|---|---|
| ![HCP Roster](./screenshots/hcp-roster.png) | ![AI Summary](./screenshots/summary.png) |

---

## ✨ Features

- **Conversational logging** — describe an HCP interaction in plain text; the AI extracts structured fields (interaction type, sentiment, outcomes, follow-up date) automatically.
- **Live form auto-fill** — extracted data syncs instantly to a structured form on screen for review before saving.
- **Manual entry fallback** — full structured form available for reps who prefer typing directly.
- **Persistent chat memory** — each HCP thread retains full conversational history via LangGraph's Postgres checkpointer, so context carries across sessions.
- **AI-generated interaction summaries** — one-click executive summary of a full HCP conversation history.
- **Multi-tenant architecture** — every rep's data (HCPs, interactions, chat threads) is isolated by `tenant_id`, enforced at the database and API layer.
- **Secure authentication** — Google OAuth via Supabase Auth, with JWT-verified API access.
- **HCP roster management** — reps can browse previously logged HCPs and reload conversational context for any of them.

---

## 🏗️ Architecture

```
┌─────────────────────┐         ┌──────────────────────┐         ┌─────────────────────┐
│   React Frontend     │  HTTPS  │   FastAPI Backend     │         │   Supabase / Postgres│
│  (Vite + Redux)      │◄───────►│   (main.py)            │◄───────►│   - Auth              │
│                       │  Bearer │                        │         │   - HCPs table         │
│  - Chat UI            │  JWT    │  - REST endpoints      │         │   - Interactions table │
│  - Structured form    │         │  - Tenant isolation    │         │   - LangGraph checkpts │
│  - Supabase Auth SDK  │         │                        │         └─────────────────────┘
└─────────────────────┘         └──────────┬────────────┘
                                              │
                                              ▼
                                  ┌──────────────────────┐
                                  │   LangGraph Agent      │
                                  │   (agent.py)            │
                                  │  - Groq LLM (Llama 4)  │
                                  │  - Tool-based extraction│
                                  │  - Postgres memory      │
                                  └──────────────────────┘
```

**Flow:** Rep sends a message → FastAPI resolves/creates the HCP + tenant-scoped thread → LangGraph agent (backed by Groq's Llama 4 Scout model) processes the message, calls `log_interaction_tool` to extract structured fields → structured JSON is returned to the frontend → Redux store syncs the form UI automatically.

---

## 🛠️ Tech Stack

### Backend
| Technology | Purpose |
|---|---|
| **FastAPI** | REST API framework |
| **LangGraph** | Agent orchestration & stateful conversation graph |
| **LangChain** | LLM tool-calling abstractions |
| **Groq** (`llama-4-scout-17b-16e-instruct`) | LLM inference |
| **PostgreSQL** | Primary data store (via Supabase) |
| **SQLAlchemy** | ORM for HCP / Interaction models |
| **psycopg / psycopg_pool** | Postgres connection pooling |
| **LangGraph PostgresSaver** | Persistent conversation checkpointing |
| **Supabase Auth** | User authentication & JWT verification |
| **Uvicorn** | ASGI server |

### Frontend
| Technology | Purpose |
|---|---|
| **React 18** | UI framework |
| **Vite** | Build tool & dev server |
| **Redux (react-redux)** | Global form state management |
| **Tailwind CSS** | Styling |
| **Supabase JS Client** | Auth session management |
| **lucide-react** | Icons |

---

## 📁 Project Structure

```
AI_ASSISTED_HCP_CRM_TOOL/
├── backend/
│   ├── main.py          # FastAPI app, routes, auth dependency, lifespan setup
│   ├── agent.py          # LangGraph agent, system prompt, extraction tool
│   ├── models.py         # SQLAlchemy models (HCP, Interaction) + DB engine
│   ├── requirements.txt
│   └── .env               # Backend environment variables (not committed)
│
├── frontend/
│   ├── src/
│   │   ├── App.jsx        # Main UI: auth, chat, structured form
│   │   └── store.js       # Redux slice for form state
│   ├── package.json
│   └── .env.local          # Frontend environment variables (not committed)
│
└── README.md
```

> Adjust the tree above to match your actual folder layout if `frontend/` and `backend/` aren't separated yet.

---

## ⚙️ Prerequisites

- **Python** 3.10+
- **Node.js** 18+ and npm
- A **Supabase** project (for Auth + Postgres database)
- A **Groq API key** ([console.groq.com](https://console.groq.com))

---

## 🚀 Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/sandip9664/AI_ASSISTED_HCP_CRM_TOOL.git
cd AI_ASSISTED_HCP_CRM_TOOL
```

### 2. Backend setup

```bash
cd backend
python -m venv venv
source venv/bin/activate     # On Windows: venv\Scripts\activate
pip install -r requirements.txt
```

Create a `.env` file in the `backend/` folder:

```env
SUPABASE_DB_URL=postgresql://postgres:<password>@<host>:5432/postgres
SUPABASE_URL=https://<your-project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
SUPABASE_JWT_SECRET=<your-jwt-secret>
GROQ_API_KEY=<your-groq-api-key>
PORT=8000
```

Run the backend:

```bash
python main.py
```

The API will be available at `http://127.0.0.1:8000`.

### 3. Frontend setup

```bash
cd frontend
npm install
```

Create a `.env.local` file in the `frontend/` folder:

```env
VITE_SUPABASE_URL=https://<your-project>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-key>
VITE_API_URL=http://127.0.0.1:8000
```

Run the frontend:

```bash
npm run dev
```

The app will be available at `http://localhost:5173` (or whichever port Vite assigns).

### 4. Enable Google OAuth in Supabase

Go to **Supabase Dashboard → Authentication → Providers → Google**, and enable it with your OAuth client credentials. Add `http://localhost:5173` (and your production URL) to the redirect URLs.

---

## 🔌 API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/hcps` | List all HCPs for the authenticated tenant |
| `GET` | `/api/chat/history/{thread_id}` | Fetch full chat history for an HCP thread |
| `GET` | `/api/chat/summary/{thread_id}` | AI-generated summary of an HCP's interaction history |
| `POST` | `/api/chat` | Send a message to the AI agent; returns response + extracted fields |
| `POST` | `/api/log-manual` | Manually save a structured interaction record |

All endpoints (except health checks) require a `Authorization: Bearer <supabase_jwt>` header.

---

## 🗺️ Roadmap

- [ ] Follow-up reminders dashboard (pending interactions due today)
- [ ] Editable/correctable interaction logs
- [ ] Analytics dashboard (sentiment trends, product mentions, weekly activity)
- [ ] Interaction editing & soft-delete for HCP records
- [ ] Deployment guide (Render/Railway + Vercel + Supabase free tier)

---

## 🤝 Contributing

This is currently a solo project in active development. Issues and suggestions are welcome via GitHub Issues.

---

## 📄 License

Specify a license here (e.g. MIT) before publishing publicly.

---

## 👤 Author

**Sandip**
GitHub: [@sandip9664](https://github.com/sandip9664)
