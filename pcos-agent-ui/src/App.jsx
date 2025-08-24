import React, { useEffect, useState } from "react";
import "./index.css";

/** -------------------------------------------
 *  CONFIG
 * ------------------------------------------*/
const API_BASE = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";

/** Compute local risk band from probability in [0..1] */
function localRiskBand(p) {
  if (p < 0.33) return "low";
  if (p < 0.66) return "medium";
  return "high";
}

export default function App() {
  const [template, setTemplate] = useState({});
  const [loading, setLoading] = useState(false);

  // form fields
  const [age, setAge] = useState("");
  const [bmi, setBmi] = useState("");
  const [cycle, setCycle] = useState("");
  const [cycleLen, setCycleLen] = useState("");
  const [amh, setAmh] = useState("");
  const [lh, setLh] = useState("");
  const [fsh, setFsh] = useState("");
  const [folL, setFolL] = useState("");
  const [folR, setFolR] = useState("");
  const [preg, setPreg] = useState("");

  // assistant state
  const [prob, setProb] = useState(null);      // numeric 0..1
  const [risk, setRisk] = useState("");        // backend risk string
  const [chat, setChat] = useState([]);        // [{who:"bot"|"user", text:string, id?:string}]
  const [qaVisible, setQaVisible] = useState(false);
  const [lastQuestion, setLastQuestion] = useState(null);
  const [answered, setAnswered] = useState([]);
  const [hint, setHint] = useState("");
  const [err, setErr] = useState("");

  // debug state
  const [lastEndpoint, setLastEndpoint] = useState("");
  const [lastResponse, setLastResponse] = useState(null);
  const [showDebug, setShowDebug] = useState(true); // default ON to troubleshoot

  /** -------------------------------------------
   *  INIT: fetch features/template (training medians)
   * ------------------------------------------*/
  useEffect(() => {
    fetch(`${API_BASE}/features`)
      .then((r) => r.json())
      .then((j) => setTemplate(j.template || {}))
      .catch(() => {});
  }, []);

  /** UI helpers */
  const addBubble = (text, who = "bot", id = undefined) =>
    setChat((c) => [...c, { who, text, id }]);

  const removeBubbleById = (id) =>
    setChat((c) => c.filter((b) => b.id !== id));

  const resetConversation = () => {
    setChat([]);
    setQaVisible(false);
    setLastQuestion(null);
    setAnswered([]);
    setHint("");
    setErr("");
    setProb(null);
    setRisk("");
    setLastResponse(null);
  };

  /** Build payload.data from inputs (seeded with training medians) */
  function collectData() {
    const d = { ...template }; // start from medians to avoid zeros
    const v = (x) => (x === "" || x == null ? null : x);
    if (v(age) != null) d["Age (yrs)"] = Number(age);
    if (v(bmi) != null) d["BMI"] = Number(bmi);
    if (v(cycle)) d["Cycle(R/I)"] = cycle; // "R" or "I"
    if (v(cycleLen) != null) d["Cycle length(days)"] = Number(cycleLen);
    if (v(amh) != null) d["AMH(ng/mL)"] = Number(amh);
    if (v(lh) != null) d["LH(mIU/mL)"] = Number(lh);
    if (v(fsh) != null) d["FSH(mIU/mL)"] = Number(fsh);
    if (v(folL) != null) d["Follicle No. (L)"] = Number(folL);
    if (v(folR) != null) d["Follicle No. (R)"] = Number(folR);
    if (v(preg)) d["Pregnant(Y/N)"] = preg; // "Y"/"N"
    return d;
  }

  /** -------------------------------------------
   *  FLOW: start (predict + either counsel or first follow-up)
   * ------------------------------------------*/
  async function startFlow() {
    setLoading(true);
    resetConversation();
    addBubble("Analyzing your details…");

    const payload = { data: collectData(), answered: [] };
    setLastEndpoint(`${API_BASE}/counsel-interactive`);

    try {
      const r = await fetch(`${API_BASE}/counsel-interactive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      setLastResponse(j);
      setErr("");

      const p = typeof j.prob_pcos === "number" ? j.prob_pcos : Number(j.prob_pcos);
      setProb(isFinite(p) ? p : 0);
      setRisk((j.risk || "").trim());

      // If low risk or no next question → one-shot counseling
      if (j.counseling && (j.risk === "low" || !j.next_questions || j.next_questions.length === 0)) {
        addBubble(j.counseling, "bot");
        setHint("Low risk: one-time counseling provided.");
        setQaVisible(false);
      } else if (j.next_questions && j.next_questions.length > 0) {
        const q = j.next_questions[0];
        setLastQuestion(q);
        const qText = q.text || q.question_text || "Please answer this question.";
        addBubble(qText, "bot");
        setQaVisible(true);
        setHint("Answer follow-up to refine counseling.");
      } else {
        addBubble("No follow-ups needed.", "bot");
        setQaVisible(false);
      }
    } catch (e) {
      setErr("Could not contact backend. Check API_BASE and server logs.");
      addBubble("Sorry—something went wrong. Please try again.", "bot");
    } finally {
      setLoading(false);
    }
  }

  /** -------------------------------------------
   *  FLOW: answer follow-up
   * ------------------------------------------*/
  async function sendAnswer(ans) {
    if (!lastQuestion) return;

    // show user’s answer
    addBubble(ans, "user");

    // add a temporary “thinking…” bubble we can remove later
    const thinkingId = "thinking-" + Math.random().toString(36).slice(2);
    addBubble("Fetching Possibilities... ", "bot", thinkingId);

    const newAnswered = [...answered, { question_id: lastQuestion.question_id, answer: ans }];
    setAnswered(newAnswered);

    const payload = { data: collectData(), answered: newAnswered };
    setLoading(true);
    setLastEndpoint(`${API_BASE}/counsel-interactive`);

    try {
      const r = await fetch(`${API_BASE}/counsel-interactive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      // remove “thinking…” bubble now that we have a response
      removeBubbleById(thinkingId);

      const j = await r.json();
      setLastResponse(j);
      setErr("");

      const p = typeof j.prob_pcos === "number" ? j.prob_pcos : Number(j.prob_pcos);
      setProb(isFinite(p) ? p : 0);
      setRisk((j.risk || "").trim());

      if (j.counseling) {
        addBubble(j.counseling, "bot");
      }

      if (j.next_questions && j.next_questions.length > 0) {
        const q = j.next_questions[0];
        setLastQuestion(q);
        const qText = q.text || q.question_text || "Next question:";
        addBubble(qText, "bot");
        setQaVisible(true);
        setHint("Keep answering to refine advice.");
      } else {
        setLastQuestion(null);
        setQaVisible(false);
        setHint("Follow-ups complete.");
      }
    } catch (e) {
      // remove “thinking…” bubble if fetch threw
      removeBubbleById(thinkingId);
      setErr("Answer submit failed. See console/Debug for details.");
      addBubble("Sorry—couldn't process that. Try again.", "bot");
    } finally {
      setLoading(false);
    }
  }

  /** UI helpers */
  const riskClass = risk ? `risk ${risk}` : "risk";

  const loadSample = () => {
    setAge(33);
    setBmi(25.27);
    setCycle("I");
    setCycleLen(40);
    setAmh(6.63);
    setLh(6.3);
    setFsh(5.54);
    setFolL(13);
    setFolR(15);
    setPreg("N");
  };

  /** Debug numbers */
  const probRaw = prob == null ? "—" : prob.toFixed(4);
  const probPct = prob == null ? "—" : `${(prob * 100).toFixed(1)}%`;
  const localBand = prob == null ? "—" : localRiskBand(prob);

  return (
    <div className="wrap">
      <header>
        <div className="logo"><span>🩺</span></div>
        <div>
          <h1>PCOS Assistant</h1>
          <div className="sub"><em>Your AI-powered personal assistant</em> — risk, follow-up, counseling</div>
        </div>
      </header>

      <div className="grid">
        {/* LEFT: DATA ENTRY */}
        <div className="card">
          <h3>Enter Patient Details</h3>
          <div className="row">
            <span className="pill">Minimum fields work — more improves accuracy</span>
          </div>

          <label>Age (yrs)</label>
          <input value={age} onChange={(e)=>setAge(e.target.value)} type="number" min="10" max="60" placeholder="e.g., 33"/>

          <label>BMI</label>
          <input value={bmi} onChange={(e)=>setBmi(e.target.value)} type="number" step="0.01" placeholder="e.g., 25.3"/>

          <label>Cycle (R/I)</label>
          <select value={cycle} onChange={(e)=>setCycle(e.target.value)}>
            <option value="">Select</option>
            <option value="R">Regular</option>
            <option value="I">Irregular</option>
          </select>

          <label>Cycle length (days)</label>
          <input value={cycleLen} onChange={(e)=>setCycleLen(e.target.value)} type="number" min="10" max="120" placeholder="e.g., 40"/>

          <label>AMH (ng/mL)</label>
          <input value={amh} onChange={(e)=>setAmh(e.target.value)} type="number" step="0.01" placeholder="e.g., 6.6"/>

          <label>LH (mIU/mL)</label>
          <input value={lh} onChange={(e)=>setLh(e.target.value)} type="number" step="0.01" placeholder="optional"/>

          <label>FSH (mIU/mL)</label>
          <input value={fsh} onChange={(e)=>setFsh(e.target.value)} type="number" step="0.01" placeholder="optional"/>

          <label>Follicle No. (L)</label>
          <input value={folL} onChange={(e)=>setFolL(e.target.value)} type="number" step="1" placeholder="optional"/>

          <label>Follicle No. (R)</label>
          <input value={folR} onChange={(e)=>setFolR(e.target.value)} type="number" step="1" placeholder="optional"/>

          <label>Pregnant (Y/N)</label>
          <select value={preg} onChange={(e)=>setPreg(e.target.value)}>
            <option value="">Select</option>
            <option value="N">No</option>
            <option value="Y">Yes</option>
          </select>

          <div className="row" style={{marginTop:12}}>
            <button className="btn" onClick={startFlow} disabled={loading}>{loading ? "Working…" : "Get Result"}</button>
            <button className="btn secondary" onClick={loadSample}>Load Sample</button>
          </div>
          <div className="muted" style={{marginTop:8}}>{hint}</div>
          {err && <div className="bubble" style={{borderColor:"#6b1f1f", background:"#251319"}}>{err}</div>}
        </div>

        {/* RIGHT: RESULT & CHAT */}
        <div className="card">
          <h3>Result & Counseling</h3>
          <div className="result">
            <div>Probability:</div>
            <div title={`raw=${probRaw}`}>{probPct}</div>
            <div className="pill" title={`local=${localBand} · backend=${risk}`}>
              Risk: <span className={riskClass} style={{marginLeft:6}}>{risk || "—"}</span>
            </div>
          </div>

          <div className="chat" id="chat">
            {chat.map((m, i)=>(
              <div key={m.id || i} className={`bubble ${m.who==="user" ? "user": ""}`}>{m.text}</div>
            ))}
          </div>

          {qaVisible && (
            <div className="qa">
              <button className="btn" onClick={()=>sendAnswer("yes")} disabled={loading}>Yes</button>
              <button className="btn secondary" onClick={()=>sendAnswer("no")} disabled={loading}>No</button>
            </div>
          )}
        </div>
      </div>

      {/* DEBUG PANEL */}
      <div className="card" style={{marginTop:16}}>
        <div className="row" style={{justifyContent:"space-between"}}>
          <h3 style={{margin:0}}>Debug</h3>
          <label style={{display:"flex",alignItems:"center",gap:8}}>
            <input type="checkbox" checked={showDebug} onChange={(e)=>setShowDebug(e.target.checked)} />
            <span className="muted">show raw backend payload</span>
          </label>
        </div>
        <div className="muted" style={{marginTop:6}}>
          API_BASE: {API_BASE} · Last endpoint: {lastEndpoint || "—"}
        </div>
        {showDebug && (
          <pre style={{
            background:"#0e1627",border:"1px solid #24324d",borderRadius:10,padding:12,overflow:"auto",maxHeight:280,marginTop:10
          }}>{lastResponse ? JSON.stringify(lastResponse, null, 2) : "// run Get Result to see payload here"}</pre>
        )}
        <div className="muted" style={{marginTop:6}}>
          Raw prob: <b>{probRaw}</b> · Local band: <b>{localBand}</b> · Backend band: <b>{risk || "—"}</b>
        </div>
      </div>

      <p className="muted" style={{marginTop:14}}>
        Backend: {API_BASE} · Make sure Flask is running.
      </p>

      <footer className="footer">
        © 2025 Shubhi Sharma. All rights reserved.
      </footer>

    </div>
  );
}
