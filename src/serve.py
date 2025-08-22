# src/serve.py
from fastapi import FastAPI
from pydantic import BaseModel
from typing import Dict, Any
import joblib, pandas as pd
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODEL  = joblib.load(ROOT / "models/pcos_model.pkl")
SCALER = joblib.load(ROOT / "models/scaler.pkl")
FEATS  = joblib.load(ROOT / "models/features.pkl")

app = FastAPI(title="PCOS Risk API")

class Patient(BaseModel):
    data: Dict[str, Any]   # key=value dict of features

def risk_band(p):
    if p < 0.33: return "low"
    if p < 0.66: return "medium"
    return "high"

@app.post("/predict")
def predict(payload: Patient):
    df = pd.DataFrame([payload.data])
    for c in FEATS:
        if c not in df.columns: df[c] = 0
    df = df[FEATS].astype(float).fillna(df.median(numeric_only=True))
    Xs = SCALER.transform(df)
    p1 = float(MODEL.predict_proba(Xs)[:,1][0])
    pred = int(p1 >= 0.5)
    return {"pred": pred, "prob_pcos": p1, "risk": risk_band(p1)}

# Run: uvicorn src.serve:app --reload
