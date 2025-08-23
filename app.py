from __future__ import annotations
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

import joblib
import pandas as pd
import requests
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

# local modules
from src.rag import retrieve as retrieve_guidance
from src.followup import next_questions, apply_answer
from src.assistant import build_prompt, bullets, call_llm

# -----------------------------
# Paths & artifacts
# -----------------------------
ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
MODEL_DIR = ROOT / "models"
TOOLS_DIR = ROOT / "tools"  # will try to serve tools/tester.html at "/"

MODEL  = joblib.load(MODEL_DIR / "pcos_model.pkl")
SCALER = joblib.load(MODEL_DIR / "scaler.pkl")
FEATS  = joblib.load(MODEL_DIR / "features.pkl")

DF_FUP = pd.read_csv(DATA_DIR / "followups.csv")  # for interactive lookup

# -----------------------------
# Flask app
# -----------------------------
app = Flask(__name__)
CORS(app)

# -----------------------------
# Option B normalization
# -----------------------------
YN_FIELDS = {
    "Pregnant(Y/N)", "Weight gain(Y/N)", "hair growth(Y/N)", "Skin darkening (Y/N)",
    "Hair loss(Y/N)", "Pimples(Y/N)", "Fast food (Y/N)", "Reg.Exercise(Y/N)"
}
CYCLE_FIELD = "Cycle(R/I)"
DROP_FIELDS = {"Blood Group"}

def _yn_to01(v):
    s = str(v).strip().lower()
    if s in {"y", "yes", "true", "1"}:  return 1.0
    if s in {"n", "no", "false", "0"}:  return 0.0
    try:
        return float(v)
    except:
        return None

def normalize_features(d: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(d)
    for k in YN_FIELDS:
        if k in out:
            out[k] = _yn_to01(out[k])
    if CYCLE_FIELD in out:
        s = str(out[CYCLE_FIELD]).strip().lower()
        if s in {"r", "regular", "1"}:
            out[CYCLE_FIELD] = 1.0
        elif s in {"i", "irregular", "0"}:
            out[CYCLE_FIELD] = 0.0
        else:
            try:
                out[CYCLE_FIELD] = float(out[CYCLE_FIELD])
            except:
                out[CYCLE_FIELD] = None
    for k in DROP_FIELDS:
        out.pop(k, None)
    return out

def risk_band(p: float) -> str:
    if p < 0.33: return "low"
    if p < 0.66: return "medium"
    return "high"

# -----------------------------
# Homepage
# -----------------------------
@app.route("/")
def home():
    tester = TOOLS_DIR / "tester.html"
    if tester.exists():
        # Serve your nice tester UI if present
        return send_from_directory(TOOLS_DIR, "tester.html")
    # Fallback minimal homepage
    return """
    <!doctype html>
    <html>
      <head><meta charset="utf-8"/><title>PCOS Risk API</title>
        <style>
          body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;margin:40px;max-width:800px}
          a,button{display:inline-block;margin:6px 8px 6px 0;padding:10px 14px;border-radius:10px;background:#111827;color:#fff;text-decoration:none}
          button{border:0;cursor:pointer}
          .muted{color:#6b7280;font-size:12px}
          pre{background:#f3f4f6;padding:12px;border-radius:10px;overflow:auto}
        </style>
      </head>
      <body>
        <h1>PCOS Risk API</h1>
        <p class="muted">Screening demo — not a diagnosis.</p>
        <div>
          <a href="/health">GET /health</a>
          <a href="/features">GET /features</a>
        </div>
        <h3>Quick test: /predict</h3>
        <pre id="out">{ "click": "Run test" }</pre>
        <button onclick="run()">POST /predict</button>
        <script>
          async function run(){
            const r = await fetch("/predict",{
              method:"POST",
              headers:{ "Content-Type":"application/json" },
              body: JSON.stringify({ data:{
                "BMI":28, "Age (yrs)":25, "Cycle length(days)":40,
                "AMH(ng/mL)":6.2, "Cycle(R/I)":"I", "Pregnant(Y/N)":"N"
              }})
            });
            const j = await r.json().catch(async()=>({raw: await r.text()}));
            document.getElementById("out").textContent = JSON.stringify(j,null,2);
          }
        </script>
        <p class="muted">Tip: add <code>tools/tester.html</code> for a full tester UI.</p>
      </body>
    </html>
    """

# -----------------------------
# Core routes
# -----------------------------
@app.get("/health")
def health():
    ok = all([MODEL is not None, SCALER is not None, FEATS is not None])
    return jsonify({"ok": ok, "num_features": len(FEATS) if FEATS else 0})

@app.get("/features")
def features():
    return jsonify({"features": FEATS})

@app.post("/predict")
def predict():
    try:
        payload = request.get_json(force=True) or {}
        data = normalize_features(payload.get("data", {}))
        df = pd.DataFrame([data])
        # ensure all FEATS
        for c in FEATS:
            if c not in df.columns:
                df[c] = 0
        try:
            df = df[FEATS].astype(float)
        except Exception as e:
            return jsonify({"error": "Non-numeric value in features", "detail": str(e)}), 400
        df = df.fillna(df.median(numeric_only=True))
        Xs = SCALER.transform(df)
        p1 = float(MODEL.predict_proba(Xs)[:, 1][0])
        return jsonify({"pred": int(p1 >= 0.5), "prob_pcos": p1, "risk": risk_band(p1)})
    except Exception as e:
        return jsonify({"error": "/predict failed", "detail": repr(e)}), 500

@app.post("/suggest")
def suggest():
    try:
        payload = request.get_json(force=True) or {}
        items = retrieve_guidance(
            risk=payload.get("risk", "low"),
            symptoms=payload.get("symptoms") or [],
            k=int(payload.get("k", 5)),
        )
        return jsonify({"items": items})
    except Exception as e:
        return jsonify({"error": "guidelines retrieval failed", "detail": repr(e)}), 500

@app.post("/counsel")
def counsel():
    try:
        payload = request.get_json(force=True) or {}
        data = normalize_features(payload.get("data", {}))
        symptoms = payload.get("symptoms") or []

        df = pd.DataFrame([data])
        for c in FEATS:
            if c not in df.columns:
                df[c] = 0
        try:
            df = df[FEATS].astype(float)
        except Exception as e:
            return jsonify({"error": "Non-numeric value in features", "detail": str(e)}), 400

        df = df.fillna(df.median(numeric_only=True))
        Xs = SCALER.transform(df)
        p1 = float(MODEL.predict_proba(Xs)[:, 1][0])
        band = risk_band(p1)

        items = retrieve_guidance(risk=band, symptoms=symptoms, k=5)
        prompt = build_prompt(risk=band, prob_pcos=p1, symptoms=symptoms, evidence_text=bullets(items))
        text = call_llm(prompt)

        return jsonify({"risk": band, "prob_pcos": p1, "counseling": text, "evidence_used": items})
    except Exception as e:
        return jsonify({"error": "/counsel failed", "detail": repr(e)}), 500

@app.post("/next-question")
def next_question():
    try:
        payload = request.get_json(force=True) or {}
        qs = next_questions(
            risk=payload.get("risk", "medium"),
            asked_ids=payload.get("asked_ids") or [],
            k=int(payload.get("k", 1)),
        )
        return jsonify({"questions": qs})
    except Exception as e:
        return jsonify({"error": "/next-question failed", "detail": repr(e)}), 500

@app.post("/counsel-interactive")
def counsel_interactive():
    try:
        payload = request.get_json(force=True) or {}
        data = normalize_features(payload.get("data", {}))
        answered = payload.get("answered") or []

        df = pd.DataFrame([data])
        for c in FEATS:
            if c not in df.columns:
                df[c] = 0
        try:
            df = df[FEATS].astype(float)
        except Exception as e:
            return jsonify({"error": "Non-numeric value in features", "detail": str(e)}), 400

        df = df.fillna(df.median(numeric_only=True))
        Xs = SCALER.transform(df)
        p1 = float(MODEL.predict_proba(Xs)[:, 1][0])
        band = risk_band(p1)

        # First question if medium/high and nothing answered yet
        if band in {"medium", "high"} and not answered:
            qs = next_questions(risk=band, asked_ids=[], k=1)
            return jsonify({"risk": band, "prob_pcos": p1, "next_questions": qs, "evidence_used": []})

        # Apply answers → tags + extras
        tags: List[str] = []
        extras: List[Dict[str, Any]] = []
        pool = DF_FUP[DF_FUP["risk"].str.lower() == band.lower()]
        for a in answered:
            row = pool[pool["question_id"] == a.get("question_id")]
            if not row.empty:
                out = apply_answer(row.iloc[0].to_dict(), a.get("answer", ""))
                if out["tag"]:
                    tags.append(out["tag"])
                extras.append({"tag": out["tag"], "suggestion": out["suggestion"], "source": out["source"]})

        items = retrieve_guidance(risk=band, symptoms=tags, k=5)
        items = extras + items
        prompt = build_prompt(risk=band, prob_pcos=p1, symptoms=tags, evidence_text=bullets(items))
        text = call_llm(prompt)

        asked_ids = [a.get("question_id") for a in answered]
        nxt = next_questions(risk=band, asked_ids=asked_ids, k=1)

        return jsonify({
            "risk": band,
            "prob_pcos": p1,
            "counseling": text,
            "evidence_used": items,
            "next_questions": nxt
        })
    except Exception as e:
        return jsonify({"error": "/counsel-interactive failed", "detail": repr(e)}), 500

# -----------------------------
# Optional LLM diagnostics
# -----------------------------
@app.get("/llm/models")
def llm_models():
    try:
        r = requests.get("http://127.0.0.1:11434/api/tags", timeout=10)
        return r.json(), r.status_code
    except Exception as e:
        return {"error": f"Ollama unreachable: {repr(e)}"}, 502

@app.post("/llm/test")
def llm_test():
    try:
        r = requests.post(
            "http://127.0.0.1:11434/api/generate",
            json={"model": "llama3.1:8b", "prompt": "hello", "stream": False, "keep_alive": "10m"},
            timeout=180,
        )
        return r.json(), r.status_code
    except Exception as e:
        return {"error": f"Ollama generate failed: {repr(e)}"}, 502

# -----------------------------
# Entrypoint
# -----------------------------
if __name__ == "__main__":
    print(f"[flask] Loaded {len(FEATS)} features. Model & scaler ready.")
    # optional: print routes to confirm "/" is registered
    try:
        print("[flask] Routes loaded:")
        for r in app.url_map.iter_rules():
            print(" ", r)
    except Exception:
        pass
    app.run(host="127.0.0.1", port=8000, debug=True)
