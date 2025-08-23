from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Dict, Any, List, Optional
import joblib, pandas as pd
from pathlib import Path

# RAG (already built in your project)
from src.rag import retrieve as retrieve_guidance
# Follow-up questions
from src.followup import next_questions, apply_answer
# LLM glue
from src.assistant import build_prompt, bullets, call_llm

ROOT   = Path(__file__).resolve().parents[1]
MODEL  = joblib.load(ROOT / "models/pcos_model.pkl")
SCALER = joblib.load(ROOT / "models/scaler.pkl")
FEATS  = joblib.load(ROOT / "models/features.pkl")

app = FastAPI(title="PCOS Risk API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

class Patient(BaseModel):
    data: Dict[str, Any]
    symptoms: Optional[List[str]] = None

def risk_band(p: float) -> str:
    if p < 0.33: return "low"
    if p < 0.66: return "medium"
    return "high"

@app.get("/")
def home():
    return {"ok": True, "service": "PCOS Risk API", "endpoints": ["/features", "/predict", "/suggest", "/counsel", "/next-question", "/counsel-interactive", "/docs"]}

@app.get("/features")
def features():
    return {"features": FEATS}

@app.post("/predict")
def predict(payload: Patient):
    df = pd.DataFrame([payload.data])
    for c in FEATS:
        if c not in df.columns:
            df[c] = 0
    df = df[FEATS].astype(float).fillna(df.median(numeric_only=True))
    Xs = SCALER.transform(df)
    p1 = float(MODEL.predict_proba(Xs)[:, 1][0])
    return {"pred": int(p1 >= 0.5), "prob_pcos": p1, "risk": risk_band(p1)}

# --- One-shot counseling (classifier + RAG + LLM) ---
class SuggestBody(BaseModel):
    risk: str
    symptoms: Optional[List[str]] = None
    k: int = 5

@app.post("/suggest")
def suggest(body: SuggestBody):
    items = retrieve_guidance(risk=body.risk, symptoms=body.symptoms or [], k=body.k)
    return {"items": items}

class CounselBody(BaseModel):
    data: Dict[str, Any]
    symptoms: Optional[List[str]] = None

@app.post("/counsel")
def counsel(body: CounselBody):
    # predict
    df = pd.DataFrame([body.data])
    for c in FEATS:
        if c not in df.columns: df[c] = 0
    df = df[FEATS].astype(float).fillna(df.median(numeric_only=True))
    Xs = SCALER.transform(df)
    p1 = float(MODEL.predict_proba(Xs)[:, 1][0])
    band = risk_band(p1)

    # RAG + LLM
    items = retrieve_guidance(risk=band, symptoms=body.symptoms or [], k=5)
    ev_text = bullets(items)
    prompt = build_prompt(risk=band, prob_pcos=p1, symptoms=body.symptoms or [], evidence_text=ev_text)
    text = call_llm(prompt)

    return {"risk": band, "prob_pcos": p1, "counseling": text, "evidence_used": items}

# --- Interactive flow ---
class NextQBody(BaseModel):
    risk: str
    asked_ids: Optional[List[str]] = None
    k: int = 1

@app.post("/next-question")
def next_question(body: NextQBody):
    qs = next_questions(risk=body.risk, asked_ids=body.asked_ids or [], k=body.k)
    # returns question(s) to ask the user
    return {"questions": qs}

class CounselInteractiveBody(BaseModel):
    data: Dict[str, Any]
    risk: Optional[str] = None          # optional: you can send a precomputed risk band
    answered: Optional[List[Dict[str, str]]] = None
    # answered format: [{"question_id":"q1","answer":"yes"}, ...]

@app.post("/counsel-interactive")
def counsel_interactive(body: CounselInteractiveBody):
    # step 1: compute risk unless provided
    if body.risk is None:
        df = pd.DataFrame([body.data])
        for c in FEATS:
            if c not in df.columns: df[c] = 0
        df = df[FEATS].astype(float).fillna(df.median(numeric_only=True))
        Xs = SCALER.transform(df)
        p1 = float(MODEL.predict_proba(Xs)[:, 1][0])
        band = risk_band(p1)
    else:
        # you can optionally trust the client-provided band; safer to recompute
        df = pd.DataFrame([body.data])
        for c in FEATS:
            if c not in df.columns: df[c] = 0
        df = df[FEATS].astype(float).fillna(df.median(numeric_only=True))
        Xs = SCALER.transform(df)
        p1 = float(MODEL.predict_proba(Xs)[:, 1][0])
        band = body.risk

    # step 2: if medium/high risk and no answers yet, return first question(s)
    answered = body.answered or []
    if band in ["medium", "high"] and len(answered) == 0:
        qs = next_questions(risk=band, asked_ids=[], k=1)
        return {"risk": band, "prob_pcos": p1, "next_questions": qs, "evidence_used": []}

    # step 3: aggregate follow-up tags/suggestions from answers
    tags, extras = [], []
    for a in answered:
        # find the question row and apply answer
        qs = next_questions(risk=band, asked_ids=[], k=10)  # fetch a pool for this risk
        row = next((q for q in qs if q["question_id"] == a["question_id"]), None)
        if row:
            out = apply_answer(row, a.get("answer",""))
            if out["tag"]: tags.append(out["tag"])
            extras.append({"tag": out["tag"], "suggestion": out["suggestion"], "source": out["source"]})

    # step 4: base RAG suggestions + extras from the follow-ups
    items = retrieve_guidance(risk=band, symptoms=tags, k=5)
    items = extras + items  # prioritize immediate suggestions from answers
    ev_text = bullets(items)

    # step 5: LLM counsel using band + evidence + tags from answers
    prompt = build_prompt(risk=band, prob_pcos=p1, symptoms=tags, evidence_text=ev_text)
    text = call_llm(prompt)

    # step 6: if there are still unanswered questions, return the next one as well
    asked_ids = [a["question_id"] for a in answered]
    nxt = next_questions(risk=band, asked_ids=asked_ids, k=1)

    return {
        "risk": band,
        "prob_pcos": p1,
        "counseling": text,
        "evidence_used": items,
        "next_questions": nxt
    }
