import { useEffect, useMemo, useState } from "react";
import { RadialBarChart, RadialBar, Legend } from "recharts";

const API_BASE = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";

function Pill({ risk }) {
  const r = (risk || "low").toLowerCase();
  return <span className={`pill ${r}`}>{r.toUpperCase()}</span>;
}

function Gauge({ prob }) {
  const pct = Math.round((prob || 0) * 100);
  const data = [{ name: "PCOS", value: pct }];
  return (
    <div style={{ width: 240, height: 190 }}>
      <RadialBarChart
        width={240}
        height={190}
        innerRadius="60%"
        outerRadius="100%"
        data={data}
        startAngle={180}
        endAngle={-180}
      >
        <RadialBar minAngle={8} clockWise dataKey="value" />
        <Legend layout="vertical" verticalAlign="middle" wrapperStyle={{ top: "30%", left: "60%" }} />
      </RadialBarChart>
      <div style={{ textAlign: "center", marginTop: -20 }}>
        <div style={{ fontSize: 22, fontWeight: 700 }}>{pct}%</div>
        <div className="muted">probability</div>
      </div>
    </div>
  );
}

const CORE_FIELDS = [
  "Age (yrs)",
  "BMI",
  "Cycle length(days)",
  "AMH(ng/mL)",
  "Cycle(R/I)",
  "Pregnant(Y/N)",
  "LH(mIU/mL)",
  "FSH(mIU/mL)",
  "FSH/LH",
  "Follicle No. (L)",
  "Follicle No. (R)",
  "hair growth(Y/N)",
  "Pimples(Y/N)",
  "Skin darkening (Y/N)"
];

const PRESETS = {
  low: {
    "BMI": 22, "Age (yrs)": 24, "Cycle length(days)": 29, "AMH(ng/mL)": 3.0,
    "Cycle(R/I)": "R", "Pregnant(Y/N)": "N", "hair growth(Y/N)": "N", "Pimples(Y/N)": "N",
    "Reg.Exercise(Y/N)": "Y", "Fast food (Y/N)": "N"
  },
  borderline: {
    "BMI": 26, "Age (yrs)": 28, "Cycle length(days)": 35, "AMH(ng/mL)": 4.5,
    "Cycle(R/I)": "I", "Pregnant(Y/N)": "N", "hair growth(Y/N)": "N", "Pimples(Y/N)": "Y",
    "Reg.Exercise(Y/N)": "Y", "Fast food (Y/N)": "N"
  },
  pcos_like: {
    "Age (yrs)": 23, "BMI": 32, "Cycle length(days)": 50, "AMH(ng/mL)": 7.5,
    "Cycle(R/I)": "I", "Pregnant(Y/N)": "N", "hair growth(Y/N)": "Y", "Pimples(Y/N)": "Y",
    "Skin darkening (Y/N)": "Y", "Reg.Exercise(Y/N)": "N", "Fast food (Y/N)": "Y",
    "Follicle No. (L)": 15, "Follicle No. (R)": 16, "LH(mIU/mL)": 12, "FSH(mIU/mL)": 5, "FSH/LH": 0.42
  }
};

function useLocalStorage(key, initial) {
  const [state, setState] = useState(() => {
    try { return JSON.parse(localStorage.getItem(key) || "null") ?? initial; }
    catch { return initial; }
  });
  useEffect(() => { localStorage.setItem(key, JSON.stringify(state)); }, [key, state]);
  return [state, setState];
}

export default function App() {
  const [features, setFeatures] = useState([]);
  const [template, setTemplate] = useState({});
  const [values, setValues] = useLocalStorage("pcos.values", {});
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(false);

  const [result, setResult] = useState(null);
  const [answers, setAnswers] = useState([]);
  const [profileName, setProfileName] = useState("");
  const [savedProfiles, setSavedProfiles] = useLocalStorage("pcos.profiles", {}); // name -> values

  // load features once
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/features`);
        const j = await r.json();
        setFeatures(j.features || []);
        const tmpl = j.template || Object.fromEntries((j.features || []).map((f) => [f, 0]));
        setTemplate(tmpl);
        if (!Object.keys(values || {}).length) setValues(tmpl);
      } catch (e) {
        console.error("Failed to load features", e);
        alert("Could not load /features. Is Flask running on 127.0.0.1:8000?");
      }
    })();
  }, []);

  const filteredCore = useMemo(() => CORE_FIELDS.filter(f => features.includes(f)), [features]);
  const filteredAll = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const rest = features.filter(f => !filteredCore.includes(f));
    return q ? rest.filter(f => f.toLowerCase().includes(q)) : rest;
  }, [filter, features, filteredCore]);

  function setVal(field, v) { setValues(prev => ({ ...prev, [field]: v })); }

  function parsePayload() {
    const data = {};
    for (const k of features) {
      const raw = values[k];
      if (raw === "" || raw === undefined || raw === null) continue;
      const num = Number(raw);
      data[k] = Number.isFinite(num) && raw !== true && raw !== false ? num : raw;
    }
    return { data };
  }

  async function predictCounselInteractive(reset=true) {
    setLoading(true);
    try {
      const body = parsePayload();
      const payload = reset ? body : { ...body, answered: answers };
      const r = await fetch(`${API_BASE}/counsel-interactive`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const j = await r.json();
      setResult(j);
      if (reset) setAnswers([]);
    } catch (e) {
      console.error(e);
      alert("Request failed. Check console.");
    } finally { setLoading(false); }
  }

  async function answerFollowup(ans) {
    if (!result?.next_questions?.length) return;
    const q = result.next_questions[0];
    const newAnswers = [...answers, { question_id: q.question_id, answer: ans }];
    setAnswers(newAnswers);
    await predictCounselInteractive(false);
  }

  function resetAll() {
    setValues(template);
    setFilter("");
    setResult(null);
    setAnswers([]);
  }

  function loadPreset(name) {
    const preset = PRESETS[name] || {};
    const merged = { ...template, ...values, ...preset };
    setValues(merged);
  }

  function saveProfile() {
    if (!profileName.trim()) { alert("Enter a profile name."); return; }
    const next = { ...savedProfiles, [profileName.trim()]: values };
    setSavedProfiles(next);
    setProfileName("");
  }

  function loadProfile(name) {
    const v = savedProfiles[name];
    if (!v) return;
    setValues({ ...template, ...v });
  }

  function deleteProfile(name) {
    const next = { ...savedProfiles };
    delete next[name];
    setSavedProfiles(next);
  }

  function printCounseling() { window.print(); }

  return (
    <div className="container">
      <div className="header">
        <h1 style={{ margin: 0 }}>PCOS Assistant</h1>
        <div className="muted">Screening demo — not a diagnosis. © {new Date().getFullYear()} Shubhi Sharma</div>
      </div>

      <div className="row">
        {/* LEFT: Input Form */}
        <section className="card">
          {/* Presets / Profiles */}
          <div className="actions" style={{ marginBottom: 10 }}>
            <span className="badge">Presets:</span>
            <button className="btn secondary" onClick={() => loadPreset("low")}>Low</button>
            <button className="btn secondary" onClick={() => loadPreset("borderline")}>Borderline</button>
            <button className="btn secondary" onClick={() => loadPreset("pcos_like")}>PCOS-like</button>
            <span style={{ flex: 1 }} />
            <span className="badge">Profiles:</span>
            <input className="input" placeholder="Profile name…" style={{ width: 180 }}
                   value={profileName} onChange={e=>setProfileName(e.target.value)} />
            <button className="btn secondary" onClick={saveProfile}>Save</button>
          </div>

          {Object.keys(savedProfiles).length ? (
            <div className="actions" style={{ marginBottom: 10 }}>
              {Object.keys(savedProfiles).map(name => (
                <span key={name} className="badge" style={{ display:"inline-flex", alignItems:"center", gap:8 }}>
                  {name}
                  <button className="btn secondary" onClick={() => loadProfile(name)}>Load</button>
                  <button className="btn secondary" onClick={() => deleteProfile(name)}>×</button>
                </span>
              ))}
            </div>
          ) : null}

          {/* Core fields */}
          <h3 style={{ marginTop: 6 }}>Core inputs</h3>
          <div className="grid">
            {filteredCore.map((f) => (
              <div key={f}>
                <label className="label">{f}</label>
                <input className="input" value={values[f] ?? ""} onChange={e=>setVal(f, e.target.value)}
                  placeholder='e.g. 28 or "Y"/"N" or "R"/"I"' />
              </div>
            ))}
          </div>

          <hr className="sep" />

          {/* More fields */}
          <div className="kv" style={{ marginBottom: 10 }}>
            <h3 style={{ margin: 0 }}>More inputs</h3>
            <input className="input" style={{ marginLeft: "auto", width: 260 }} placeholder="Search features…"
                   value={filter} onChange={e=>setFilter(e.target.value)} />
          </div>
          <div className="grid">
            {filteredAll.map((f) => (
              <div key={f}>
                <label className="label">{f}</label>
                <input className="input" value={values[f] ?? ""} onChange={e=>setVal(f, e.target.value)}
                  placeholder="value" />
              </div>
            ))}
          </div>

          <div className="actions" style={{ marginTop: 14 }}>
            <button className="btn" disabled={loading} onClick={() => predictCounselInteractive(true)}>
              {loading ? "Thinking…" : "Get Counseling"}
            </button>
            <button className="btn secondary" disabled={loading || !answers.length} onClick={() => predictCounselInteractive(false)}>
              Update with Answers
            </button>
            <button className="btn secondary" onClick={resetAll}>Reset</button>
          </div>
        </section>

        {/* RIGHT: Summary */}
        <aside className="card">
          <h3 style={{ marginTop: 0 }}>Result</h3>
          {result ? (
            <>
              <div className="kv">
                <Pill risk={result.risk} />
                <span className="muted">Probability: {(result.prob_pcos * 100).toFixed(1)}%</span>
              </div>
              <div style={{ marginTop: 8 }}><Gauge prob={result.prob_pcos} /></div>
              <div className="actions" style={{ marginTop: 8 }}>
                <button className="btn secondary" onClick={printCounseling}>Print counseling</button>
              </div>
            </>
          ) : (
            <div className="muted">No result yet.</div>
          )}
        </aside>
      </div>

      {/* Counseling + Evidence */}
      {result && (
        <div className="row" style={{ marginTop: 16 }}>
          <section className="card">
            <h3 style={{ marginTop: 0 }}>Counseling</h3>
            <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
              {result.counseling ||
                "(LLM unavailable) Screening result only. Please review with a clinician. If severe pain, rapid virilization, or pregnancy with acute symptoms, seek urgent care. (Guideline 2023)"}
            </p>
          </section>
          <section className="card">
            <h3 style={{ marginTop: 0 }}>Evidence used</h3>
            <ul style={{ paddingLeft: 18, margin: 0 }}>
              {(result.evidence_used || []).map((it, i) => (
                <li key={i} style={{ marginBottom: 6 }}>
                  {it.suggestion ? it.suggestion : JSON.stringify(it)}
                  {it.source ? <span className="muted"> ({it.source})</span> : null}
                </li>
              ))}
              {(!result.evidence_used || !result.evidence_used.length) && (
                <li className="muted">No evidence items returned.</li>
              )}
            </ul>
          </section>
        </div>
      )}

      {/* Follow-up modal */}
      {result?.next_questions?.length ? (
        <div className="modal-backdrop">
          <div className="modal">
            <div className="muted">Follow-up</div>
            <h3 style={{ marginTop: 6 }}>{result.next_questions[0].question_text}</h3>
            <div className="actions" style={{ marginTop: 12 }}>
              <button className="btn" disabled={loading} onClick={() => answerFollowup("yes")}>Yes</button>
              <button className="btn secondary" disabled={loading} onClick={() => answerFollowup("no")}>No</button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="footer">
        MIT License · Data credits in README · Screening tool only (not a diagnosis).
      </div>
    </div>
  );
}
