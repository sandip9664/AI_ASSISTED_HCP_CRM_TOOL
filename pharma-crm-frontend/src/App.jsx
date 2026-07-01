import React, { useState, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { updateField, syncEntireForm, resetForm } from './store';
import { Send, MessageSquare, Paperclip, CheckCircle, LogOut, Bot, Shield, BarChart3, Users, Sparkles, ArrowRight, Stethoscope, BrainCircuit, ClipboardCheck } from 'lucide-react';
import { createClient } from '@supabase/supabase-js';

// 1. INITIALIZE SUPABASE CLIENT
// Ensure you have a .env.local file with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

const API_BASE = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000';

function App() {
  const dispatch = useDispatch();
  const formData = useSelector((state) => state.crm);
  
  // Auth State
  const [session, setSession] = useState(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);

  // App State
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isFormSubmitting, setIsFormSubmitting] = useState(false);
  const [hcpList, setHcpList] = useState([]);
  
  // Local HCP Context State
  const [localHcpInput, setLocalHcpInput] = useState('');
  const [localSpecialtyInput, setLocalSpecialtyInput] = useState('');
  const [localHospitalInput, setLocalHospitalInput] = useState('');
  const [isContextLocked, setIsContextLocked] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState(null);

  const hasHcpContext = isContextLocked && formData.hcpName && formData.hcpName.trim();

  // 2. AUTHENTICATION LISTENER
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setIsAuthLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      setSession(currentSession);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleGoogleLogin = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin }
    });
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setIsContextLocked(false);
    setChatMessages([]);
    setActiveThreadId(null);
    dispatch(resetForm());
  };

  const handleFormChange = (field, value) => {
    dispatch(updateField({ field, value }));
  };

  const handleSetHcpContext = (e) => {
    e.preventDefault();
    if (!localHcpInput.trim() || !localSpecialtyInput.trim() || !localHospitalInput.trim()) return;

    dispatch(updateField({ field: 'hcpName', value: localHcpInput.trim() }));
    setIsContextLocked(true);
    setActiveThreadId(null);
    
    setChatMessages([
      { sender: 'user', text: `Context Locked: Dr. ${localHcpInput.trim()} (${localSpecialtyInput.trim()} at ${localHospitalInput.trim()})` },
      { sender: 'ai', text: `Perfect! Context securely locked for Dr. ${localHcpInput.trim()}.\n\nTell me about your interaction. I will automatically read history using your compound criteria, extract relevant variables, and sync the form parameters on the left.` }
    ]);
  };

  // 3. SECURE API CALLS (Injecting Bearer Token)
  const fetchHistory = async (threadIdParam) => {
    let threadId = threadIdParam || activeThreadId;
    if (!threadId) return;

    try {
      const res = await fetch(`${API_BASE}/api/chat/history/${threadId}`, {
        headers: { 'Authorization': `Bearer ${session.access_token}` }
      });
      const data = await res.json();
      const raw = Array.isArray(data.messages) ? data.messages : [];
      
      setHcpList([]);

      if (!raw.length) {
        setChatMessages(prev => [...prev, { sender: 'ai', text: 'No prior conversation history found for this HCP.' }]);
        return;
      }
      setChatMessages(raw);
    } catch (err) {
      console.error('Failed to load history', err);
      setChatMessages(prev => [...prev, { sender: 'ai', text: 'Failed to load history from server.' }]);
    }
  };

  const handleChatSubmit = async (e) => {
    e.preventDefault();
    if (!formData.hcpName || !chatInput.trim() || isAiLoading) return;

    const userText = chatInput;
    setChatInput('');
    setChatMessages(prev => [...prev, { sender: 'user', text: userText }]);
    setIsAiLoading(true);

    try {
      const response = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ 
          message: userText,
          hcp_name: formData.hcpName,
          specialty: localSpecialtyInput.trim(),
          hospital: localHospitalInput.trim()
        }),
      });
      
      const data = await response.json();
      
      if (response.ok) {
        setChatMessages(prev => [...prev, { sender: 'ai', text: data.response || data.reply }]);
        if (data.chat_thread_id) {
          setActiveThreadId(data.chat_thread_id);
        }
        if (data.extracted_fields) {
          dispatch(syncEntireForm(data.extracted_fields));
        }
      } else {
        setChatMessages(prev => [...prev, { sender: 'ai', text: `Error: ${data.detail}` }]);
      }
    } catch (error) {
      setChatMessages(prev => [...prev, { sender: 'ai', text: 'Connection lost. Please make sure your FastAPI backend is running.' }]);
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleManualFormSubmit = async (e) => {
    e.preventDefault();
    if (!formData.hcpName.trim()) {
      alert("Please specify an HCP Name before manual submission.");
      return;
    }

    setIsFormSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/api/log-manual`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          ...formData,
          specialty: localSpecialtyInput.trim(),
          hospital: localHospitalInput.trim()
        }),
      });

      const data = await response.json();

      if (response.ok) {
        alert("Interaction logged successfully via secure manual form submission!");
        dispatch(resetForm());
        setLocalHcpInput('');
        setLocalSpecialtyInput('');
        setLocalHospitalInput('');
        setIsContextLocked(false);
        setChatMessages([]);
      } else {
        alert(`Submission Failed: ${data.detail || 'Internal database processing error.'}`);
      }
    } catch (error) {
      alert("Network error connecting to backend API.");
    } finally {
      setIsFormSubmitting(false);
    }
  };

  // 4. RENDER LOGIN SCREEN IF UNAUTHENTICATED
  if (isAuthLoading) {
    return <div className="flex h-screen items-center justify-center text-xs text-slate-500 font-medium bg-slate-50">Verifying secure session...</div>;
  }

  if (!session) {
    return (
      <div className="flex h-screen bg-slate-50 overflow-hidden">
        {/* Left: Brand / Features Panel */}
        <div className="hidden lg:flex lg:w-3/5 h-full bg-gradient-to-br from-sky-900 via-sky-800 to-sky-950 relative overflow-hidden">
          <div className="absolute inset-0 opacity-10">
            <div className="absolute top-20 left-10 w-72 h-72 bg-sky-300 rounded-full blur-3xl" />
            <div className="absolute bottom-20 right-10 w-96 h-96 bg-indigo-300 rounded-full blur-3xl" />
          </div>
          <div className="relative z-10 flex flex-col justify-between p-12 w-full">
            <div>
              <div className="flex items-center space-x-2.5">
                <div className="bg-white/15 backdrop-blur-sm p-2 rounded-xl">
                  <Stethoscope className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h1 className="text-xl font-bold text-white tracking-tight">PharmaCRM</h1>
                  <p className="text-[11px] text-sky-200/80 font-medium">AI-Powered HCP Intelligence</p>
                </div>
              </div>
            </div>

            <div className="space-y-8 max-w-lg">
              <div className="space-y-3">
                <h2 className="text-3xl font-bold text-white leading-tight">
                  Transform Your HCP Interactions<br />
                  <span className="text-sky-300">with AI-Driven Precision</span>
                </h2>
                <p className="text-sm text-sky-100/80 leading-relaxed">
                  PharmaCRM is an intelligent platform that captures, analyzes, and optimizes 
                  your Healthcare Professional engagement workflows. Powered by AI, built for compliance.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {[
                  { icon: BrainCircuit, title: "AI Assistant", desc: "Natural language logging with smart form auto-fill" },
                  { icon: Shield, title: "Secure & Compliant", desc: "HIPAA-ready, encrypted multi-tenant architecture" },
                  { icon: BarChart3, title: "Smart Insights", desc: "Real-time analytics on engagement patterns" },
                  { icon: Users, title: "HCP Roster", desc: "Centralized HCP profiles with interaction history" },
                  { icon: ClipboardCheck, title: "Auto Forms", desc: "AI extracts & syncs form fields from conversation" },
                  { icon: Sparkles, title: "Seamless Workflow", desc: "From context lock to submission in seconds" }
                ].map(({ icon: Icon, title, desc }, idx) => (
                  <div
                    key={idx}
                    className="group bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl p-4 hover:bg-white/10 hover:border-white/20 transition-all duration-300"
                  >
                    <div className="flex items-center space-x-2.5 mb-1.5">
                      <Icon className="w-4 h-4 text-sky-300" />
                      <h3 className="text-sm font-semibold text-white">{title}</h3>
                    </div>
                    <p className="text-[11px] text-sky-100/60 leading-relaxed">{desc}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="text-[11px] text-sky-200/40">
              &copy; 2026 PharmaCRM. All rights reserved.
            </div>
          </div>
        </div>

        {/* Right: Login Panel */}
        <div className="flex-1 h-full flex items-center justify-center p-6">
          <div className="w-full max-w-sm space-y-8">
            {/* Mobile Logo (visible only on small screens) */}
            <div className="lg:hidden flex flex-col items-center space-y-2">
              <div className="bg-sky-100 p-3 rounded-2xl">
                <Stethoscope className="w-8 h-8 text-sky-700" />
              </div>
              <h1 className="text-2xl font-bold text-slate-800">PharmaCRM</h1>
              <p className="text-xs text-slate-400">AI-Powered HCP Intelligence</p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
              <div className="text-center mb-8">
                <h2 className="text-lg font-bold text-slate-800">Welcome Back</h2>
                <p className="text-xs text-slate-400 mt-1">Sign in to manage your HCP engagements</p>
              </div>
              
              <button
                onClick={handleGoogleLogin}
                className="group flex w-full items-center justify-center space-x-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-300 shadow-sm hover:shadow-md transition-all duration-200"
              >
                <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24">
                  <path fill="#EA4335" d="M12 5.04c1.64 0 3.12.56 4.28 1.67l3.2-3.2C17.52 1.58 14.97 1 12 1 7.35 1 3.37 3.67 1.39 7.56l3.78 2.93c.88-2.64 3.38-4.45 6.83-4.45z"/>
                  <path fill="#4285F4" d="M23.49 12.27c0-.81-.07-1.59-.2-2.36H12v4.51h6.46c-.29 1.48-1.14 2.73-2.42 3.57l3.74 2.9c2.19-2.02 3.46-5 3.46-8.62z"/>
                  <path fill="#FBBC05" d="M5.17 14.89c-.23-.69-.37-1.43-.37-2.2s.14-1.51.37-2.2L1.39 7.56C.5 9.35 0 11.35 0 12.5s.5 3.15 1.39 4.94l3.78-2.55z"/>
                  <path fill="#34A853" d="M12 23c3.24 0 5.97-1.07 7.96-2.91l-3.74-2.9c-1.1.74-2.51 1.18-4.22 1.18-3.45 0-5.95-1.81-6.83-4.45L1.39 16.82C3.37 20.33 7.35 23 12 23z"/>
                </svg>
                <span>Continue with Google</span>
                <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 transition-colors -ml-1" />
              </button>
            </div>

            <p className="text-center text-[11px] text-slate-400">
              By signing in, you agree to our Terms of Service and Privacy Policy.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // 5. MAIN APPLICATION UI
  return (
    <div className="flex h-screen w-screen bg-slate-50 overflow-hidden font-sans antialiased text-slate-800 flex-col">
      
      {/* Top Navigation Bar */}
      <header className="h-14 border-b border-slate-200 bg-white flex items-center justify-between px-6 shrink-0 z-10 shadow-sm">
        <div className="font-bold text-sky-700 tracking-tight text-lg">PharmaCRM</div>
        <div className="flex items-center space-x-4">
          <span className="text-xs font-medium text-slate-500 bg-slate-100 px-3 py-1 rounded-full">
            {session.user.email}
          </span>
          <button 
            onClick={handleLogout}
            className="flex items-center space-x-1 text-xs font-bold text-red-500 hover:text-red-700 transition"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out</span>
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* LEFT COLUMN: FORM */}
        <form onSubmit={handleManualFormSubmit} className="w-3/5 h-full overflow-y-auto p-8 border-r border-slate-200 bg-white shadow-sm flex flex-col justify-between">
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">Log HCP Interaction</h1>
              <span className="text-[11px] bg-sky-50 text-sky-600 border border-sky-100 px-2 py-1 rounded font-mono font-bold tracking-wide">Secure Context</span>
            </div>
            
            <div className="space-y-6">
              <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-100 pb-2">Interaction Details</h2>
              
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">HCP Name</label>
                  <input
                    type="text"
                    required
                    value={formData.hcpName || ''}
                    onChange={(e) => {
                      handleFormChange('hcpName', e.target.value);
                      setLocalHcpInput(e.target.value);
                    }}
                    placeholder="Set via assistant or type here..."
                    className="w-full border border-slate-200 rounded-lg p-2.5 text-sm shadow-sm focus:ring-2 focus:ring-sky-100 focus:border-sky-500 outline-none transition"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Interaction Type</label>
                  <select
                    value={formData.interactionType || 'Meeting'}
                    onChange={(e) => handleFormChange('interactionType', e.target.value)}
                    className="w-full border border-slate-200 rounded-lg p-2.5 text-sm shadow-sm focus:ring-2 focus:ring-sky-100 focus:border-sky-500 outline-none bg-white transition"
                  >
                    <option>Meeting</option>
                    <option>Call</option>
                    <option>Email</option>
                    <option>Webinar</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Date</label>
                  <input
                    type="date"
                    value={formData.date || ''}
                    onChange={(e) => handleFormChange('date', e.target.value)}
                    className="w-full border border-slate-200 rounded-lg p-2.5 text-sm shadow-sm focus:ring-2 focus:ring-sky-100 focus:border-sky-500 outline-none transition"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Time</label>
                  <input
                    type="time"
                    value={formData.time || ''}
                    onChange={(e) => handleFormChange('time', e.target.value)}
                    className="w-full border border-slate-200 rounded-lg p-2.5 text-sm shadow-sm focus:ring-2 focus:ring-sky-100 focus:border-sky-500 outline-none transition"
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Topics Discussed</label>
                <textarea
                  rows={3}
                  value={formData.topicsDiscussed || ''}
                  onChange={(e) => handleFormChange('topicsDiscussed', e.target.value)}
                  placeholder="Enter key discussion points..."
                  className="w-full border border-slate-200 rounded-lg p-2.5 text-sm shadow-sm focus:ring-2 focus:ring-sky-100 focus:border-sky-500 outline-none transition resize-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Observed/Inferred Sentiment</label>
                <div className="flex space-x-6">
                  {['Positive', 'Neutral', 'Negative'].map((mode) => (
                    <label key={mode} className="flex items-center space-x-2 text-sm text-slate-600 cursor-pointer">
                      <input
                        type="radio"
                        name="sentiment"
                        value={mode}
                        checked={formData.sentiment === mode}
                        onChange={() => handleFormChange('sentiment', mode)}
                        className="h-4 w-4 text-sky-600 border-slate-300 focus:ring-sky-500"
                      />
                      <span>{mode}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Outcomes</label>
                <textarea
                  rows={2}
                  value={formData.outcomes || ''}
                  onChange={(e) => handleFormChange('outcomes', e.target.value)}
                  placeholder="Key outcomes or agreements..."
                  className="w-full border border-slate-200 rounded-lg p-2.5 text-sm shadow-sm focus:ring-2 focus:ring-sky-100 focus:border-sky-500 outline-none transition resize-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Follow-up Date</label>
                <input
                  type="date"
                  value={formData.followUpActions || ''}
                  onChange={(e) => handleFormChange('followUpActions', e.target.value)}
                  className="w-full border border-slate-200 rounded-lg p-2.5 text-sm shadow-sm focus:ring-2 focus:ring-sky-100 focus:border-sky-500 outline-none transition"
                />
              </div>
            </div>
          </div>

          <div className="mt-8 pt-4 border-t border-slate-100">
            <button
              type="submit"
              disabled={isFormSubmitting}
              className="w-full bg-sky-600 hover:bg-sky-700 disabled:bg-slate-200 text-white font-semibold text-sm py-3 px-4 rounded-xl shadow-md transition flex items-center justify-center space-x-2"
            >
              <CheckCircle className="w-4 h-4" />
              <span>{isFormSubmitting ? "Saving Transaction..." : "Save Structured Form Entry Manually"}</span>
            </button>
          </div>
        </form>

        {/* RIGHT COLUMN: AI CHAT */}
        <div className="flex-1 h-full flex flex-col justify-between bg-slate-100/50">
          
          <div className="h-16 border-b border-slate-200 bg-white flex items-center px-6 justify-between shadow-sm">
            <div className="flex items-center space-x-2.5">
              <div className="p-1.5 bg-sky-50 text-sky-600 rounded-md">
                <MessageSquare className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-xs font-bold text-slate-800">AI Assistant</h2>
                <p className="text-[10px] text-slate-400 font-medium">
                  {hasHcpContext ? `Active Context: ${formData.hcpName}` : "Awaiting Context Setup"}
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => fetchHistory(null)}
                disabled={!hasHcpContext}
                className="text-xs bg-sky-600 text-white px-3 py-1.5 rounded-md hover:bg-sky-700 disabled:opacity-40 transition"
              >
                History
              </button>
              <button
                onClick={async () => {
                  if (!hasHcpContext || !activeThreadId) return;
                  try {
                    const res = await fetch(`${API_BASE}/api/chat/summary/${activeThreadId}`, {
                      headers: { 'Authorization': `Bearer ${session.access_token}` }
                    });
                    const data = await res.json();
                    setChatMessages([{ sender: 'ai', text: data.summary || 'No summary available.' }]);
                  } catch (err) {
                    setChatMessages(prev => [...prev, { sender: 'ai', text: 'Failed to load summary.' }]);
                  }
                }}
                disabled={!hasHcpContext}
                className="text-xs bg-white text-sky-600 px-3 py-1.5 rounded-md border border-sky-600 hover:bg-sky-50 disabled:opacity-40 transition"
              >
                Summary
              </button>
              <button
                onClick={async () => {
                  try {
                    const res = await fetch(`${API_BASE}/api/hcps`, {
                      headers: { 'Authorization': `Bearer ${session.access_token}` }
                    });
                    const data = await res.json();
                    if (data.hcps && data.hcps.length > 0) {
                      setHcpList(data.hcps);
                      setChatMessages([{ sender: 'ai', text: 'Known HCPs in your Secure Roster:' }]);
                    } else {
                      setChatMessages(prev => [...prev, { sender: 'ai', text: 'No HCPs found in your roster.' }]);
                    }
                  } catch (err) {
                    setChatMessages(prev => [...prev, { sender: 'ai', text: 'Failed to fetch HCPs.' }]);
                  }
                }}
                className="text-xs bg-white text-sky-600 px-3 py-1.5 rounded-md border border-sky-600 hover:bg-sky-50 transition"
              >
                My HCPs
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {(!hasHcpContext && hcpList.length === 0 && chatMessages.length === 0) && (
              <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-sm max-w-sm mx-auto mt-2 space-y-4">
                <div>
                  <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">Context Initialization</h3>
                  <p className="text-[11px] text-slate-400 font-medium">Provide demographics to lock session.</p>
                </div>
                <form onSubmit={handleSetHcpContext} className="space-y-3">
                  <input
                    type="text"
                    required
                    value={localHcpInput}
                    onChange={(e) => setLocalHcpInput(e.target.value)}
                    placeholder="Name (e.g. Dr. Naresh)"
                    className="w-full bg-slate-50 border border-slate-200 focus:border-sky-500 rounded-lg px-3 py-2 text-xs outline-none"
                  />
                  <input
                    type="text"
                    required
                    value={localSpecialtyInput}
                    onChange={(e) => setLocalSpecialtyInput(e.target.value)}
                    placeholder="Specialty (e.g. Cardiology)"
                    className="w-full bg-slate-50 border border-slate-200 focus:border-sky-500 rounded-lg px-3 py-2 text-xs outline-none"
                  />
                  <input
                    type="text"
                    required
                    value={localHospitalInput}
                    onChange={(e) => setLocalHospitalInput(e.target.value)}
                    placeholder="Hospital (e.g. Apex Hospital)"
                    className="w-full bg-slate-50 border border-slate-200 focus:border-sky-500 rounded-lg px-3 py-2 text-xs outline-none"
                  />
                  <button type="submit" className="w-full mt-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold py-2.5 rounded-lg transition shadow-sm">
                    Lock Session Context
                  </button>
                </form>
              </div>
            )}

            {hcpList.length > 0 && (
              <div className="space-y-2">
                {hcpList.map((h, idx) => (
                  <div key={idx} className="bg-white border border-slate-200 p-3 rounded-xl flex items-center justify-between shadow-sm">
                    <div className="text-xs font-semibold text-slate-700">
                      Dr. {h.name} <span className="text-slate-400">({h.specialty})</span>
                    </div>
                    <button
                      onClick={() => {
                        dispatch(updateField({ field: 'hcpName', value: h.name }));
                        setLocalHcpInput(h.name);
                        setLocalSpecialtyInput(h.specialty || '');
                        setLocalHospitalInput(h.hospital || '');
                        setIsContextLocked(true);
                        setActiveThreadId(h.chat_thread_id);
                        setHcpList([]);
                        setChatMessages([]);
                      }}
                      className="text-[11px] bg-sky-600 text-white font-medium px-2.5 py-1 rounded hover:bg-sky-700 transition"
                    >
                      Load context
                    </button>
                  </div>
                ))}
              </div>
            )}

            {hcpList.length === 0 && chatMessages.map((msg, index) => (
              <div key={index} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] p-3.5 rounded-xl text-xs leading-relaxed shadow-sm font-medium tracking-wide ${
                  msg.sender === 'user' ? 'bg-slate-800 text-white rounded-tr-none' : 'bg-white text-slate-700 border border-slate-200/60 rounded-tl-none whitespace-pre-wrap'
                }`}>
                  {msg.text}
                </div>
              </div>
            ))}

            {isAiLoading && (
              <div className="flex justify-start">
                <div className="bg-white border border-slate-200 text-slate-400 text-[11px] p-3.5 rounded-xl rounded-tl-none animate-pulse">
                  Processing...
                </div>
              </div>
            )}
          </div>

          <div className="p-4 bg-white border-t border-slate-200 shrink-0">
            <form onSubmit={handleChatSubmit} className="flex items-center space-x-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                disabled={isAiLoading || !hasHcpContext} 
                placeholder={hasHcpContext ? "Describe interaction..." : "Complete setup above..."} 
                className="flex-1 bg-slate-50 border border-slate-200 focus:border-sky-500 rounded-lg px-3 py-2.5 text-xs text-slate-800 outline-none disabled:bg-slate-100 disabled:cursor-not-allowed font-medium"
              />
              <button
                type="submit"
                disabled={isAiLoading || !chatInput.trim() || !hasHcpContext}
                className="bg-slate-800 hover:bg-slate-900 text-white disabled:bg-slate-100 disabled:text-slate-400 transition font-semibold text-xs px-4 py-2.5 rounded-lg shadow-sm flex items-center space-x-1"
              >
                <span>Log</span>
                <Send className="w-3 h-3" />
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;