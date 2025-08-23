import { useEffect, useMemo, useState } from "react";
import { RadialBarChart, RadialBar, Legend } from "recharts";
// Optional icons (if you installed lucide-react)
// import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";

const API_BASE = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";

function cls(...xs) {
  return xs.filter(Boolean).join(" ");
}

function RiskPill({ risk }) {
  const map = {
    low: { bg: "#ecfeff", color: "#155e75" },
    medium: { bg: "#fef9c3", color: "#854d0e" },
    high: { bg: "#fee2e2", color: "#7f1d1d" },
  };
  const s = map[risk] || map.low;
  return (
    <span style={{ background: s.bg, color: s.color, padding: "4px 10px", borderRadius: 999 }}>
      {(risk || "low").toUpperCase()}
    </span>
  );
}

function Gauge({ prob }) {
  const pct = Math.round((prob || 0) * 100);
  const data = [{ name: "PCOS", value: pct }];
  return (
    <div style={{ width: 220, height: 180 }}>
      <RadialBarChart
        width={220}
        height={180}
        innerRadius="60%"
        outerRadius="100%"
        data={data}
        startAngle={180}
        endAngle={-180}
      >
        <RadialBar minAngle={15} clockWise dataKey="value" />
        <Legend
          iconSize={10}
          layout="vertical"
          verticalAlign="middle"
          wrapperStyle={{ top: "30%", left: "60%" }}
        />
      </RadialBarChart>
      <div style={{ textAlign: "center", marginTop: -20 }}>
        <div style={{ fontSize: 22, fontWeight: 700 }}>{pct}%</div>
        <div style={{ fontSize: 12, color: "#6b7280" }}>probability</div>
      </div>
    </div>
  );
}

export default function App() {
  const [features, setFeatures] = useState([]);
  const [template, setTemplate] = useState({});
  const [values, setValues] = useState({});
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(false);

  const [result, setResult] = useState(null); // {risk, prob_pcos, counseling, evidence_used, next_questions?}
  const [answers, setAnswers] = useState([]); // [{question_id, answer}]

  // load features once
  useEffect(() => {
    (async () => {
      const r = await fetch(`${API_BASE}/features`);
      const j = await r.json();
      setFeatures(j.features || []);
      // optional template support if you implemented it on Flask; else fall back to zeros
      const tmpl = j.template || Object.fromEntries((j.features || []).map((f) => [f, 0]));
      setTemplate(tmpl);
      setValues(tmpl);
    })();
  }, []);

  const filteredFeatures = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return features;
    return features.filter((f) => f.toLowerCase().includes(q));
  }, [filter, features]);

  function setVal(field, v) {
    setValues((old) => ({ ...old, [field]: v }));
  }

  function parsePayload() {
    // Leave strings as-is for Y/N & R/I (server normalizes)
    // Try to parse numerics; keep empty strings out of payload
    const data = {};
    for (const k of features) {
      const raw = values[k];
      if (raw === "" || raw === undefined || raw === null) continue;
      // if looks like a number, parse as number
      const num = Number(raw);
      data[k] = Number.isFinite(num) && raw !== true && raw !== false ? num : raw;
    }
    return { data };
  }

  async function getCounselInteractive(reset = true) {
    setLoading(true);
    try {
      const body = parsePayload();
      const payload = reset ? body : { ...body, answered: answers };
      const r = await fetch(`${API_BASE}/counsel-interactive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      setResult(j);
      if (reset) setAnswers([]);
    } catch (e) {
      console.error(e);
      alert("Request failed. Check console.");
    } finally {
      setLoading(false);
    }
  }

  async function answerFollowup(ans) {
    if (!result?.next_questions?.length) return;
    const q = result.next_questions[0];
    const newAnswers = [...answers, { question_id: q.question_id, answer: ans }];
    setAnswers(newAnswers);

    setLoading(true);
    try {
      const body = parsePayload();
      const r = await fetch(`${API_BASE}/counsel-interactive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, answered: newAnswers }),
      });
      const j = await r.json();
      setResult(j);
    } catch (e) {
      console.error(e);
      alert("Request failed. Check console.");
    } finally {
      setLoading(false);
    }
  }

  function resetAll() {
    setValues(template);
    setFilter("");
    setResult(null);
    setAnswers([]);
  }

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: "0 auto", fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial" }}>
      {/* Header */}
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>PCOS Assistant</h1>
        <div style={{ color: "#6b7280", fontSize: 12 }}>Screening demo — not a diagnosis.</div>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
        {/* Left: form */}
        <section style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 16 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
            <input
              placeholder="Search features…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: "1px solid #d1d5db" }}
            />
            <button onClick={resetAll} style={{ padding: "8px 12px", borderRadius: 8, border: 0 }}>
              Reset
            </button>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
              gap: 12,
              maxHeight: 480,
              overflow: "auto",
              paddingRight: 6,
            }}
          >
            {filteredFeatures.map((f) => (
              <div key={f} style={{ display: "grid", gap: 6 }}>
                <label style={{ fontSize: 12, color: "#374151" }}>{f}</label>
                <input
                  value={values[f] ?? ""}
                  onChange={(e) => setVal(f, e.target.value)}
                  placeholder='e.g. 28 or "Y"/"N" or "R"/"I"'
                  style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #d1d5db" }}
                />
              </div>
            ))}
          </div>

          <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
            <button
              onClick={() => getCounselInteractive(true)}
              disabled={loading}
              style={{ padding: "10px 14px", borderRadius: 10, border: 0, background: "#111827", color: "white" }}
            >
              {loading ? "Thinking…" : "Get Counseling"}
            </button>
            <button
              onClick={() => getCounselInteractive(false)}
              disabled={loading || !answers.length}
              style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #d1d5db", background: "white" }}
              title={answers.length ? "" : "Answer a follow-up first"}
            >
              Update With Answers
            </button>
          </div>
        </section>

        {/* Right: result summary */}
        <aside style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>Result</h3>
          {result ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <RiskPill risk={result.risk} />
                <div style={{ color: "#6b7280", fontSize: 12 }}>
                  Probability: {(result.prob_pcos * 100).toFixed(1)}%
                </div>
              </div>
              <div style={{ marginTop: 8 }}>
                <Gauge prob={result.prob_pcos} />
              </div>
            </>
          ) : (
            <div style={{ color: "#6b7280" }}>No result yet.</div>
          )}
        </aside>
      </div>

      {/* Counseling & evidence */}
      {result && (
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16, marginTop: 16 }}>
          <section style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 16 }}>
            <h3 style={{ marginTop: 0 }}>Counseling</h3>
            <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
              {result.counseling ||
                "(LLM unavailable) Screening result only. Please review with a clinician. If severe pain, rapid virilization, or pregnancy with acute symptoms, seek urgent care. (Guideline 2023)"}
            </p>
          </section>

          <section style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 16 }}>
            <h3 style={{ marginTop: 0 }}>Evidence used</h3>
            <ul style={{ paddingLeft: 18 }}>
              {(result.evidence_used || []).map((it, i) => (
                <li key={i} style={{ marginBottom: 6 }}>
                  {it.suggestion ? it.suggestion : JSON.stringify(it)}
                  {it.source ? <span style={{ color: "#6b7280" }}> ({it.source})</span> : null}
                </li>
              ))}
              {(!result.evidence_used || !result.evidence_used.length) && (
                <li style={{ color: "#6b7280" }}>No evidence items returned.</li>
              )}
            </ul>
          </section>
        </div>
      )}

      {/* Follow-up question modal */}
      {result?.next_questions?.length ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div style={{ background: "white", color: "black", width: 520, maxWidth: "95vw", borderRadius: 12, padding: 18 }}>
            <div style={{ fontSize: 14, color: "#6b7280" }}>Follow-up</div>
            <h3 style={{ marginTop: 6 }}>{result.next_questions[0].question_text}</h3>
            <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
              <button
                onClick={() => answerFollowup("yes")}
                disabled={loading}
                style={{ padding: "10px 14px", borderRadius: 10, border: 0, background: "#111827", color: "white" }}
              >
                Yes
              </button>
              <button
                onClick={() => answerFollowup("no")}
                disabled={loading}
                style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #d1d5db", background: "white" }}
              >
                No
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Footer */}
      <footer style={{ marginTop: 20, color: "#6b7280", fontSize: 12 }}>
        © {new Date().getFullYear()} Shubhi Sharma · MIT License · Screening tool only (not a diagnosis).
      </footer>
    </div>
  );
}
