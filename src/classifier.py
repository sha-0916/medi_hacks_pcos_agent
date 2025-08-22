# src/train_baseline.py
"""
PCOS Risk Analysis Demo
Author: Shubhi Sharma (github.com/sha-0916) | MIT
"""
import warnings; warnings.filterwarnings("ignore", category=FutureWarning)

import numpy as np, pandas as pd
from pathlib import Path

from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.calibration import CalibratedClassifierCV
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, brier_score_loss, roc_auc_score
import joblib

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
MODEL_DIR = Path(__file__).resolve().parents[1] / "models"
MODEL_DIR.mkdir(parents=True, exist_ok=True)

def _maybe_drop(df, col):
    if col in df.columns: df.drop(columns=[col], inplace=True)

def load_data():
    xlsx = DATA_DIR / "PCOS_data_without_infertility.xlsx"
    csv  = DATA_DIR / "PCOS_infertility.csv"
    df_x = pd.read_excel(xlsx, sheet_name="Full_new")
    df_c = pd.read_csv(csv)

    df_x.rename(columns=lambda s: s.strip() if isinstance(s,str) else s, inplace=True)
    df_c.rename(columns=lambda s: s.strip() if isinstance(s,str) else s, inplace=True)
    _maybe_drop(df_x, "Unnamed: 44")

    for c in ["Marraige Status (Yrs)", "Fast food (Y/N)"]:
        if c in df_x.columns: df_x[c].fillna(df_x[c].median(), inplace=True)

    if "AMH(ng/mL)" in df_x.columns:
        df_x["AMH(ng/mL)"] = pd.to_numeric(df_x["AMH(ng/mL)"], errors="coerce")
        df_x["AMH(ng/mL)"].fillna(df_x["AMH(ng/mL)"].median(), inplace=True)

    _maybe_drop(df_x, "II    beta-HCG(mIU/mL)")
    if "II    beta-HCG(mIU/mL)" in df_c.columns:
        df_x = pd.concat([df_x.reset_index(drop=True),
                          df_c[["II    beta-HCG(mIU/mL)"]].reset_index(drop=True)], axis=1)
    return df_x

def prepare_xy(df: pd.DataFrame):
    y = df["PCOS (Y/N)"].astype(int)
    X = df.drop(columns=[c for c in ["PCOS (Y/N)", "Sl. No", "Patient File No."] if c in df.columns])
    X = X.select_dtypes(include=[np.number]).copy()
    X = X.fillna(X.median(numeric_only=True))
    return X, y

def main():
    df = load_data()
    X, y = prepare_xy(df)

    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.2, stratify=y, random_state=42)

    scaler = StandardScaler()
    Xtr_s, Xte_s = scaler.fit_transform(Xtr), scaler.transform(Xte)

    base = LogisticRegression(max_iter=500)
    model = CalibratedClassifierCV(estimator=base, method="isotonic", cv=5)
    model.fit(Xtr_s, ytr)

    yhat = model.predict(Xte_s)
    p1   = model.predict_proba(Xte_s)[:,1]

    print("\n=== Metrics ===")
    print("Accuracy:", round(accuracy_score(yte, yhat), 3))
    print("ROC AUC :", round(roc_auc_score(yte, p1), 3))
    print("Brier   :", round(brier_score_loss(yte, p1), 4))
    print("\nConfusion matrix:\n", confusion_matrix(yte, yhat))
    print("\nClassification report:\n", classification_report(yte, yhat, digits=3))

    # save artifacts
    joblib.dump(model,   MODEL_DIR / "pcos_model.pkl")
    joblib.dump(scaler,  MODEL_DIR / "scaler.pkl")
    joblib.dump(list(X.columns), MODEL_DIR / "features.pkl")
    print(f"\nSaved to {MODEL_DIR}")

if __name__ == "__main__":
    main()
