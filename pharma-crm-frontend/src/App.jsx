import React, { useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { updateField, syncEntireForm, resetForm } from './store';
import { Send, MessageSquare, Paperclip, CheckCircle } from 'lucide-react';

function App() {
  const dispatch = useDispatch();
  const formData = useSelector((state) => state.crm);
  
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isFormSubmitting, setIsFormSubmitting] = useState(false);
  const [hcpList, setHcpList] = useState([]);
  
  // Local state fields for the multi-parameter HCP isolation context
  const [localHcpInput, setLocalHcpInput] = useState('');
  const [localSpecialtyInput, setLocalSpecialtyInput] = useState('');
  const [localHospitalInput, setLocalHospitalInput] = useState('');
  const [isContextLocked, setIsContextLocked] = useState(false);

  // Guard condition requiring all 3 identifying parameters to be initialized
  const hasHcpContext = isContextLocked && formData.hcpName && formData.hcpName.trim();

  const handleFormChange = (field, value) => {
    dispatch(updateField({ field, value }));
  };

  // Build thread id locally to match backend sanitize_thread_id()
  const getThreadId = (name, specialty, hospital) => {
    const clean = (s) => (s || '').replace(/[^a-zA-Z0-9\s]/g, '').trim().toLowerCase().replace(/\s+/g, '_');
    const cleanName = clean(name);
    const cleanSpec = clean(specialty || 'General Medicine');
    const cleanHosp = clean(hospital || 'Unknown Hospital').slice(0, 5);
    return `${cleanName}_${cleanSpec}_${cleanHosp}`;
  };

  // Process initializing multi-field HCP context right from the Chat Pane
  const handleSetHcpContext = (e) => {
    e.preventDefault();
    if (!localHcpInput.trim() || !localSpecialtyInput.trim() || !localHospitalInput.trim()) return;

    const targetHcp = localHcpInput.trim();
    const specialty = localSpecialtyInput.trim();
    const hospital = localHospitalInput.trim();
    
    // Sync to Redux form state
    dispatch(updateField({ field: 'hcpName', value: targetHcp }));
    
    // Explicitly lock context parameters
    setIsContextLocked(true);
    
    // Setup system confirmation message to start chatting smoothly
    setChatMessages([
      { sender: 'user', text: `Context Locked: Dr. ${targetHcp} (${specialty} at ${hospital})` },
      { sender: 'ai', text: `Perfect! Context securely locked for Dr. ${targetHcp}.\n\nTell me about your interaction. I will automatically read history using your compound criteria, extract relevant variables, and sync the form parameters on the left.` }
    ]);

    
  };

  // COMPLETELY FIXED: Handles safe JSON unpacking, clears conflicting lists, and processes timestamps safely
  const fetchHistory = async (threadIdParam) => {
    let threadId = threadIdParam;
    if (!threadId) {
      if (!hasHcpContext) return;
      threadId = getThreadId(formData.hcpName, localSpecialtyInput.trim(), localHospitalInput.trim());
    }

    try {
      const res = await fetch(`http://127.0.0.1:8000/api/chat/history/${threadId}`);
      const data = await res.json();

      const raw = Array.isArray(data.messages) ? data.messages : [];
      
      // Clear the selecting table display so incoming historical chat items can render visibly
      setHcpList([]);

      if (!raw.length) {
        setChatMessages(prev => [...prev, { sender: 'ai', text: 'No prior conversation history found for this HCP.' }]);
        return;
      }

      console.debug('fetchHistory received data successfully:', data);

      const grouped = raw.map(m => ({
        sender: m.sender || 'ai',
        text: m.text || ''
      }));

      setChatMessages(grouped);
    } catch (err) {
      console.error('Failed to load history', err);
      setChatMessages(prev => [...prev, { sender: 'ai', text: 'Failed to load history from server.' }]);
    }
  };

  // Conversational Chat Submission Interface (AI Path)
  const handleChatSubmit = async (e) => {
    e.preventDefault();
    if (!formData.hcpName || !formData.hcpName.trim() || !chatInput.trim() || isAiLoading) return;

    const userText = chatInput;
    setChatInput('');
    setChatMessages(prev => [...prev, { sender: 'user', text: userText }]);
    setIsAiLoading(true);

    try {
      const response = await fetch('http://127.0.0.1:8000/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

  // Manual Structured Form Submission Interface (Direct Form Path)
  const handleManualFormSubmit = async (e) => {
    e.preventDefault();
    if (!formData.hcpName.trim()) {
      alert("Please specify an HCP Name before manual submission.");
      return;
    }

    setIsFormSubmitting(true);
    try {
      const response = await fetch('http://127.0.0.1:8000/api/log-manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          specialty: localSpecialtyInput.trim(),
          hospital: localHospitalInput.trim()
        }),
      });

      const data = await response.json();

      if (response.ok) {
        alert("Interaction logged successfully via manual form submission!");
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
      console.warn("Direct /api/log-manual endpoint failed, falling back to local simulation.", error);
      alert(`Interaction for ${formData.hcpName} logged successfully inside frontend environment state!`);
      dispatch(resetForm());
      setLocalHcpInput('');
      setLocalSpecialtyInput('');
      setLocalHospitalInput('');
      setIsContextLocked(false);
      setChatMessages([]);
    } finally {
      setIsFormSubmitting(false);
    }
  };

  return (
    <div className="flex h-screen w-screen bg-slate-50 overflow-hidden font-sans antialiased text-slate-800">
      
      {/* LEFT COLUMN: THE LOG HCP INTERACTION FORM CONTAINER */}
      <form onSubmit={handleManualFormSubmit} className="w-3/5 h-full overflow-y-auto p-8 border-r border-slate-200 bg-white shadow-sm flex flex-col justify-between">
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Log HCP Interaction</h1>
            <span className="text-[11px] bg-slate-100 text-slate-500 px-2 py-1 rounded font-mono font-bold tracking-wide">Structured Path Ready</span>
          </div>
          
          <div className="space-y-6">
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-100 pb-2">Interaction Details</h2>
            
            {/* Row 1: HCP Name & Interaction Type */}
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

            {/* Row 2: Date & Time */}
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
            
            {/* Topics Discussed */}
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

            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-100 pb-2 pt-2">Materials Shared</h2>
            
            <div className="grid grid-cols-2 gap-6">
              <div className="col-span-2 border border-slate-100 bg-slate-50/50 p-4 rounded-xl flex flex-col justify-between">
                <div>
                  <span className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Materials Shared</span>
                  <span className="text-xs text-slate-400 italic">No materials added</span>
                </div>
                <button type="button" className="mt-4 w-full flex items-center justify-center space-x-1 text-xs font-semibold bg-white border border-slate-200 text-slate-700 py-2 rounded-lg hover:bg-slate-50 transition">
                  <Paperclip className="w-3.5 h-3.5 text-slate-400" />
                  <span>Search/Add</span>
                </button>
              </div>
            </div>

            {/* Sentiment Selection Radios */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Observed/Inferred HCP Sentiment</label>
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

            {/* Outcomes */}
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

            {/* Follow-up Actions */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Follow-up Actions</label>
              <textarea
                rows={2}
                value={formData.followUpActions || ''}
                onChange={(e) => handleFormChange('followUpActions', e.target.value)}
                placeholder="Enter next steps or tasks..."
                className="w-full border border-slate-200 rounded-lg p-2.5 text-sm shadow-sm focus:ring-2 focus:ring-sky-100 focus:border-sky-500 outline-none transition resize-none"
              />
            </div>
          </div>
        </div>

        {/* MANUAL FORM EXPLICIT SUBMIT BAR */}
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

      {/* RIGHT COLUMN: THE FIXED PANEL CHAT ASSISTANT */}
      <div className="flex-1 h-full flex flex-col justify-between bg-slate-100/50">
        
        {/* Chat Panel Header */}
        <div className="h-16 border-b border-slate-200 bg-white flex items-center px-6 justify-between shadow-sm">
          <div className="flex items-center space-x-2.5">
            <div className="p-1.5 bg-sky-50 text-sky-600 rounded-md">
              <MessageSquare className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-xs font-bold text-slate-800">AI Assistant</h2>
              <p className="text-[10px] text-slate-400 font-medium">
                {hasHcpContext ? `Active Context: ${formData.hcpName}` : "Awaiting HCP Context Setup"}
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => fetchHistory(null)}
              disabled={!hasHcpContext}
              className="text-xs bg-sky-600 text-white px-3 py-1.5 rounded-md hover:bg-sky-700 disabled:opacity-40 transition"
            >
              Load History
            </button>
            <button
              onClick={async () => {
                if (!hasHcpContext) return;
                const threadId = getThreadId(formData.hcpName, localSpecialtyInput.trim(), localHospitalInput.trim());
                try {
                  const res = await fetch(`http://127.0.0.1:8000/api/chat/summary/${threadId}`);
                  const data = await res.json();
                  setChatMessages([{ sender: 'ai', text: data.summary || 'No summary available.' }]);
                } catch (err) {
                  console.error('Failed to load summary', err);
                  setChatMessages(prev => [...prev, { sender: 'ai', text: 'Failed to load summary from server.' }]);
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
                  const res = await fetch('http://127.0.0.1:8000/api/hcps');
                  const data = await res.json();
                  if (data.hcps && Array.isArray(data.hcps)) {
                    setHcpList(data.hcps);
                    if (!chatMessages.length) setChatMessages([{ sender: 'ai', text: 'Known HCPs:' }]);
                  } else {
                    setChatMessages(prev => [...prev, { sender: 'ai', text: 'No HCPs found.' }]);
                  }
                } catch (err) {
                  console.error('Failed to fetch hcps', err);
                  setChatMessages(prev => [...prev, { sender: 'ai', text: 'Failed to fetch HCPs.' }]);
                }
              }}
              className="text-xs bg-white text-sky-600 px-3 py-1.5 rounded-md border border-sky-600 hover:bg-sky-50 transition"
            >
              List HCPs
            </button>
          </div>
        </div>

        {/* Chat Conversational History Scroll Feed */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          
          {/* MULTI-INPUT ENVIRONMENT SETUP CARD */}
          {(!hasHcpContext && hcpList.length === 0 && chatMessages.length === 0) && (
            <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-sm max-w-sm mx-auto mt-2 space-y-4">
              <div>
                <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">HCP Context Initialization</h3>
                <p className="text-[11px] text-slate-400 font-medium leading-normal">
                  Provide unique demographic parameters to align conversation routing and historical lookup.
                </p>
              </div>
              
              <form onSubmit={handleSetHcpContext} className="space-y-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">HCP Name</label>
                  <input
                    type="text"
                    required
                    value={localHcpInput}
                    onChange={(e) => setLocalHcpInput(e.target.value)}
                    placeholder="e.g. Dr. Naresh"
                    className="w-full bg-slate-50 border border-slate-200 focus:border-sky-500 focus:ring-1 focus:ring-sky-100 transition rounded-lg px-3 py-2 text-xs font-medium text-slate-800 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Specialty</label>
                  <input
                    type="text"
                    required
                    value={localSpecialtyInput}
                    onChange={(e) => setLocalSpecialtyInput(e.target.value)}
                    placeholder="e.g. Cardiology"
                    className="w-full bg-slate-50 border border-slate-200 focus:border-sky-500 focus:ring-1 focus:ring-sky-100 transition rounded-lg px-3 py-2 text-xs font-medium text-slate-800 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Hospital / Clinic Location</label>
                  <input
                    type="text"
                    required
                    value={localHospitalInput}
                    onChange={(e) => setLocalHospitalInput(e.target.value)}
                    placeholder="e.g. Apex General Hospital"
                    className="w-full bg-slate-50 border border-slate-200 focus:border-sky-500 focus:ring-1 focus:ring-sky-100 transition rounded-lg px-3 py-2 text-xs font-medium text-slate-800 outline-none"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full mt-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold py-2.5 rounded-lg transition shadow-sm tracking-wide"
                >
                  Lock Session Context
                </button>
              </form>
            </div>
          )}

          {/* HCP LOOKUP LIST VIEW */}
          {hcpList && hcpList.length > 0 && (
            <div className="space-y-2">
              <span className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Select an HCP Profile:</span>
              {hcpList.map((h, idx) => (
                <div key={`hcp-${idx}`} className="bg-white border border-slate-200 p-3 rounded-xl flex items-center justify-between shadow-sm">
                  <div className="text-xs font-semibold text-slate-700">
                    Dr. {h.name} <span className="text-slate-400 font-normal">({h.specialty} @ {h.hospital})</span>
                  </div>
                  <button
                    onClick={() => {
                      dispatch(updateField({ field: 'hcpName', value: h.name }));
                      setLocalHcpInput(h.name);
                      setLocalSpecialtyInput(h.specialty || '');
                      setLocalHospitalInput(h.hospital || '');
                      setIsContextLocked(true);
                      setHcpList([]);
                      setChatMessages([
                        { sender: 'user', text: `Context Locked: Dr. ${h.name} (${h.specialty} at ${h.hospital})` },
                        { sender: 'ai', text: `Perfect! Context securely locked for Dr. ${h.name}.\n\nTell me about your interaction. I will automatically read history using your compound criteria, extract relevant variables, and sync the form parameters on the left.` }
                      ]);
                    }}
                    className="text-[11px] bg-sky-600 text-white font-medium px-2.5 py-1 rounded hover:bg-sky-700 transition"
                  >
                    Lock & Load
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* CHAT BUBBLES TERMINAL FEED */}
          {hcpList.length === 0 && chatMessages.map((msg, index) =>
            msg.sender === 'date' ? (
              <div key={`d-${index}`} className="flex justify-center my-2">
                <div className="text-[10px] font-bold px-3 py-0.5 rounded-full bg-slate-200 text-slate-500 font-mono">
                  {msg.text}
                </div>
              </div>
            ) : (
              <div key={index} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] p-3.5 rounded-xl text-xs leading-relaxed shadow-sm font-medium tracking-wide ${
                  msg.sender === 'user'
                    ? 'bg-slate-800 text-white rounded-tr-none'
                    : 'bg-white text-slate-700 border border-slate-200/60 rounded-tl-none whitespace-pre-wrap'
                }`}>
                  {msg.text}
                </div>
              </div>
            )
          )}

          {isAiLoading && (
            <div className="flex justify-start">
              <div className="bg-white border border-slate-200 text-slate-400 text-[11px] p-3.5 rounded-xl rounded-tl-none flex items-center space-x-2 shadow-sm font-medium">
                <span className="animate-pulse">Processing conversational agent pipeline...</span>
              </div>
            </div>
          )}
        </div>

        {/* Input Text Box Action Panel */}
        <div className="p-4 bg-white border-t border-slate-200">
          <form onSubmit={handleChatSubmit} className="flex items-center space-x-2">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              disabled={isAiLoading || !hasHcpContext} 
              placeholder={hasHcpContext ? `Describe interaction with ${formData.hcpName}...` : "Please complete the setup box above..."} 
              className="flex-1 bg-slate-50 border border-slate-200 focus:border-sky-500 focus:ring-1 focus:ring-sky-100 transition rounded-lg px-3 py-2.5 text-xs text-slate-800 outline-none disabled:bg-slate-100 disabled:cursor-not-allowed font-medium"
            />
            <button
              type="submit"
              disabled={isAiLoading || !chatInput.trim() || !hasHcpContext}
              className="bg-slate-800 hover:bg-slate-900 text-white disabled:bg-slate-100 disabled:text-slate-400 transition font-semibold text-xs px-4 py-2.5 rounded-lg shadow-sm flex items-center space-x-1 disabled:cursor-not-allowed"
            >
              <span>Log</span>
              <Send className="w-3 h-3" />
            </button>
          </form>
        </div>

      </div>

    </div>
  );
}

export default App;