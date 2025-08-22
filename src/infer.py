# src/infer.py
import json, joblib
import numpy as np, pandas as pd
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = ROOT / "models"

MODEL  = joblib.load(MODEL_DIR / "pcos_model.pkl")
SCALER = joblib.load(MODEL_DIR / "scaler.pkl")
FEATS  = joblib.load(MODEL_DIR / "features.pkl")

def risk_band(p):
    if p < 0.33: return "low"
    if p < 0.66: return "medium"
    return "high"

def predict_one(patient: dict):
    df = pd.DataFrame([patient])
    # ensure all features exist
    for c in FEATS:
        if c not in df.columns:
            df[c] = 0
    df = df[FEATS].copy()
    # simple numeric-only handling
    df = df.astype(float)
    df = df.fillna(df.median(numeric_only=True))
    Xs = SCALER.transform(df)
    p1 = float(MODEL.predict_proba(Xs)[:,1][0])
    y  = int(p1 >= 0.5)
    return {"pred": y, "prob_pcos": p1, "risk": risk_band(p1)}

if __name__ == "__main__":
    # Example usage:
    demo = {
        "Age (yrs)": 25,
        "BMI": 28,
        "Cycle length(days)": 40,
        "AMH(ng/mL)": 6.2,
        # ... any other numeric features you want to supply ...
    }
    out = predict_one(demo)
    print(json.dumps(out, indent=2))
