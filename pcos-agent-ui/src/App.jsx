import { useEffect, useMemo, useRef, useState } from "react";
import { RadialBarChart, RadialBar, Legend } from "recharts";

const API_BASE = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";

/* ---------- Small UI parts ---------- */
function MedicalLogo() {
  return (
    <svg viewBox="0 0 48 48" className="nurse" aria-hidden="true">
      <defs>
        <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#2563eb"/><stop offset="1" stopColor="#22c55e"/>
        </linearGradient>
      </defs>
      <rect x="1" y="6" width="46" height="36" rx="8" fill="url(#g)"/>
      <rect x="6" y="11" width="36" height="26" rx="6" fill="#fff" />
      <path d="M24 14 l0 20 M14 24 l20 0" stroke="#2563eb" strokeWidth="3" strokeLinecap="round"/>
    </svg>
  );
}
function NurseAvatar() {
  return (
    <div className="avatar" title="Nurse">
      <svg viewBox="0 0 48 48" className="nurse" aria-hidden="true">
        <circle cx="24" cy="24" r="22" fill="#e5f0ff" stroke="#cfe0ff"/>
        <path d="M14 30c3-3 7-4 10-4s7 1 10 4v6H14v-6z" fill="#fff" stroke="#cfe0ff"/>
        <circle cx="24" cy="22" r="6" fill="#fff" stroke="#cfe0ff"/>
        <rect x="16" y="10" width="16" height="8" rx="2" fill="#2563eb"/>
        <path d="M24 12 v4 M22 14 h4" stroke="#fff" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    </div>
  );
}
function Pill({ risk }) {
  const r = (risk || "low").toLowerCase();
  return <span className={`pill ${r}`}>{r.toUpperCase()}</span>;
}
function Gauge({ prob }) {
  const pct = Math.round((prob || 0) * 100);
  const data = [{ name: "PCOS", value: pct }];
  return (
    <div style={{ width: 260, height: 200 }}>
      <RadialBarChart width={260} height={200} innerRadius="60%" outerRadius="100%" data={data} startAngle={180} endAngle={-180}>
        <RadialBar minAngle={8} clockWise dataKey="value" />
        <Legend layout="vertical" verticalAlign="middle" wrapperStyle={{ top: "30%", left: "62%" }} />
      </RadialBarChart>
      <div style={{ textAlign: "center", marginTop: -20 }}>
        <div style={{ fontSize: 24, fontWeight: 800 }}>{pct}%</div>
        <div style={{ color: "var(--muted)" }}>probability</div>
      </div>
    </div>
  );
}

/* ---------- Chat Pane ---------- */
function ChatPane() {
  const [messages, setMessages] = useState([
    { role: "assistant", text: "Hi! I’m your PCOS Assistant. How can I help you today?" }
  ]);
  const [text, setText] = useState("");
  const [thinking, setThinking] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, thinking]);

  async function send() {
    const prompt = text.trim();
    if (!prompt) return;
    setText("");
    setMessages((m) => [...m, { role: "user", text: prompt }]);
    setThinking(true);

    // Try backend /chat. If missing or slow, return a friendly fallback quickly.
    try {
      const r = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          // simple chat history; backend may ignore if it wants
          history: messages.map(({ role, text }) => ({ role, text })),
        }),
        signal: AbortSignal.timeout(60000),
      });
      if (!r.ok) throw new Error(`status ${r.status}`);
      const j = await r.json();
      const reply = j.reply || j.text || "(No reply)";
      setMessages((m) => [...m, { role: "assistant", text: reply }]);
    } catch (e) {
      setMessages((m) => [...m, {
        role: "assistant",
        text:
          "I’m here to help with PCOS education and next steps. " +
          "Ask about symptoms, testing, lifestyle measures, or guidelines. " +
          "(Chat backend not available; showing a safe fallback.)"
      }]);
    } finally {
      setThinking(false);
    }
  }

  function onKey(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="card">
      <h3 className="section-title" style={{ display:"flex", alignItems:"center", gap:10 }}>
        <NurseAvatar /> Chat
      </h3>
      <div className="chat-wrap">
        <div className="chat-box" ref={boxRef}>
          {messages.map((m, i) => (
            <div key={i} className={`msg ${m.role === "user" ? "user" : ""}`}>
              {m.role !== "user" ? <NurseAvatar /> : null}
              <div className="bubble">{m.text}</div>
            </div>
          ))}
          {thinking ? (
            <div className="msg">
              <NurseAvatar />
              <div className="bubble"><span className="spinner dark"></span> Thinking…</div>
            </div>
          ) : null}
        </div>

        <div className="chat-input">
          <input
            className="input"
            placeholder="Type a message… (e.g., What do irregular cycles mean?)"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
          />
          <button className="btn" onClick={send} disabled={thinking || !text.trim()}>
            {thinking ? (<><span className="spinner" />&nbsp;Sending…</>) : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Details / Results Pane ---------- */
const CORE_FIELDS = [
  "Age (yrs)", "BMI", "Cycle length(days)", "AMH(ng/mL)", "Cycle(R/I)", "Pregnant(Y/N)",
  "LH(mIU/mL)", "FSH(mIU/mL)", "FSH/LH", "Follicle No. (L)", "Follicle No. (R)",
  "hair growth(Y/N)", "Pimples(Y/N)", "Skin darkening (Y/N)"
];

function DetailsPane() {
  const [features, setFeatures] = useState([]);
  const [template, setTemplate] = useState({});
  const [values, setValues] = useState({});
  const [filter, setFilter] = useState("");
  const [result, setResult] = useState(null);
  const [thinking, setThinking] = useState(false);
  const [answers, setAnswers] = useState([]);

  useEffect(() => {
    (async () => {
      const r = await fetch(`${API_BASE}/features`);
      const j = await r.json();
      setFeatures(j.features || []);
      setTemplate(j.template || {});
      setValues(j.template || {});
    })();
  }, []);

  const core = useMemo(() => CORE_FIELDS.filter((f) => features.includes(f)), [features]);
  const more = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const rest = features.filter((f) => !core.includes(f));
    return q ? rest.filter((f) => f.toLowerCase().includes(q)) : rest;
  }, [filter, features, core]);

  function setVal(field, v) { setValues((prev) => ({ ...prev, [field]: v })); }

  function payload() {
    const data = {};
    for (const k of features) {
      const raw = values[k];
      if (raw === "" || raw === undefined || raw === null) continue;
      const num = Number(raw);
      data[k] = Number.isFinite(num) && raw !== true && raw !== false ? num : raw;
    }
    return { data };
  }

  async function getResult(reset=true) {
    setThinking(true);
    try {
      const body = payload();
      const r = await fetch(`${API_BASE}/counsel-interactive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reset ? body : { ...body, answered: answers })
      });
      const j = await r.json();
      setResult(j);
      if (reset) setAnswers([]);
    } finally {
      setThinking(false);
    }
  }

  async function answerFollowup(ans) {
    if (!result?.next_questions?.length) return;
    const q = result.next_questions[0];
    const newAnswers = [...answers, { question_id: q.question_id, answer: ans }];
    setAnswers(newAnswers);
    await getResult(false);
  }

  return (
    <>
      <div className="card">
        <h3 className="section-title">Enter details</h3>

        {/* Core inputs */}
        <div className="row">
          {core.map((f) => (
            <div key={f}>
              <label className="label">{f}</label>
              <input className="input" value={values[f] ?? ""} onChange={(e)=>setVal(f, e.target.value)}
                     placeholder='e.g. 28 or "Y"/"N" or "R"/"I"' />
            </div>
          ))}
        </div>

        {/* More inputs */}
        <div style={{ display:"flex", alignItems:"center", gap:10, marginTop: 10 }}>
          <div style={{ fontWeight: 700 }}>More inputs</div>
          <input className="input" style={{ maxWidth: 280 }} placeholder="Search…" value={filter} onChange={(e)=>setFilter(e.target.value)} />
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          {more.map((f) => (
            <div key={f}>
              <label className="label">{f}</label>
              <input className="input" value={values[f] ?? ""} onChange={(e)=>setVal(f, e.target.value)} placeholder="value" />
            </div>
          ))}
        </div>

        <div style={{ display:"flex", gap:10, marginTop: 14 }}>
          <button className="btn" onClick={() => getResult(true)} disabled={thinking}>
            {thinking ? (<><span className="spinner" />&nbsp;Getting result…</>) : "Get Result"}
          </button>
          <button className="btn secondary" onClick={() => { setValues(template); setResult(null); setAnswers([]); }} disabled={thinking}>
            Reset
          </button>
        </div>
      </div>

      {result && (
        <div className="grid" style={{ marginTop: 16 }}>
          <div className="card">
            <h3 className="section-title">Counseling</h3>
            <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
              {result.counseling ||
                "(LLM unavailable) Screening result only. Please review with a clinician. If severe pain, rapid virilization, or pregnancy with acute symptoms, seek urgent care. (Guideline 2023)"}
            </p>
          </div>
          <div className="card">
            <h3 className="section-title">Summary</h3>
            <div className="kv" style={{ marginBottom: 6 }}>
              <Pill risk={result.risk} />
              <span style={{ color:"var(--muted)" }}>Probability: {(result.prob_pcos * 100).toFixed(1)}%</span>
            </div>
            <Gauge prob={result.prob_pcos} />
          </div>

          <div className="card" style={{ gridColumn: "1 / -1" }}>
            <h3 className="section-title">Evidence used</h3>
            <ul style={{ paddingLeft: 18, margin: 0 }}>
              {(result.evidence_used || []).map((it, i) => (
                <li key={i} style={{ marginBottom: 6 }}>
                  {it.suggestion ? it.suggestion : JSON.stringify(it)}
                  {it.source ? <span style={{ color:"var(--muted)" }}> ({it.source})</span> : null}
                </li>
              ))}
              {(!result.evidence_used || !result.evidence_used.length) && (
                <li style={{ color:"var(--muted)" }}>No evidence items returned.</li>
              )}
            </ul>
          </div>

          {/* Follow-up modal */}
          {result?.next_questions?.length ? (
            <div className="modal-backdrop">
              <div className="modal">
                <div className="brand-sub">Follow-up question</div>
                <h3 style={{ marginTop: 6 }}>{result.next_questions[0].question_text}</h3>
                <div style={{ display:"flex", gap:10, marginTop: 12, alignItems:"center" }}>
                  <button className="btn" onClick={() => answerFollowup("yes")} disabled={thinking}>
                    {thinking ? (<><span className="spinner" />&nbsp;Thinking…</>) : "Yes"}
                  </button>
                  <button className="btn secondary" onClick={() => answerFollowup("no")} disabled={thinking}>
                    {thinking ? "…" : "No"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}

/* ---------- Root App with Tabs ---------- */
export default function App() {
  const [tab, setTab] = useState("chat"); // "chat" | "details"

  return (
    <div className="container">
      {/* Header */}
      <div className="header">
        <div className="brand">
          <div className="logo"><MedicalLogo /></div>
          <div>
            <div className="brand-title">PCOS Assistant</div>
            <div className="brand-sub">Your AI-powered personal assistant</div>
          </div>
        </div>
        <div className="tabs">
          <button className={`tab ${tab === "chat" ? "active" : ""}`} onClick={() => setTab("chat")}>Chat</button>
          <button className={`tab ${tab === "details" ? "active" : ""}`} onClick={() => setTab("details")}>Enter details</button>
        </div>
      </div>

      {/* Body */}
      {tab === "chat" ? (
        <div className="grid">
          <ChatPane />
          <div className="card">
            <h3 className="section-title">About</h3>
            <p className="brand-sub" style={{ fontStyle: "italic" }}>
              Educational assistant. Not a diagnosis. If you have severe pain, fainting,
              pregnancy complications, or rapidly worsening symptoms, seek urgent care.
            </p>
            <p style={{ color: "var(--muted)" }}>
              Tip: Switch to <strong>Enter details</strong> to get a personalized risk estimate and guidance.
            </p>
          </div>
        </div>
      ) : (
        <DetailsPane />
      )}

      <div className="brand-sub" style={{ textAlign: "center", marginTop: 18 }}>
        © {new Date().getFullYear()} Shubhi Sharma · MIT · Data credits in README · Screening tool only.
      </div>
    </div>
  );
}
