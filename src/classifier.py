"""
PCOS Risk Analysis - Trainer
Author: Shubhi Sharma (github.com/sha-0916)
License: MIT

Description:
    Train a baseline (logistic regression) classifier on the Kaggle PCOS dataset.
    - Cleans and merges inputs
    - Preprocesses numerics
    - Trains LogisticRegression(class_weight='balanced')
    - Saves artifacts: model, scaler, features, medians
    - Prints metrics

Credits:
    - Dataset: "Polycystic Ovary Syndrome (PCOS)" by Prasoon Kottarathil (Kaggle)
    - Diagnostic context: Rotterdam 2003; International PCOS Guideline 2023
"""

from __future__ import annotations
import warnings
warnings.filterwarnings("ignore", category=FutureWarning)

from pathlib import Path
import joblib
import numpy as np
import pandas as pd

from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import classification_report, confusion_matrix, accuracy_score

# -----------------------------
# Paths
# -----------------------------
ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
MODEL_DIR = ROOT / "models"
MODEL_DIR.mkdir(exist_ok=True)

XLSX_PATH = DATA_DIR / "PCOS_data_without_infertility.xlsx"
CSV_PATH  = DATA_DIR / "PCOS_infertility.csv"
SHEET_NAME = "Full_new"

# -----------------------------
# Helpers
# -----------------------------
def _maybe_drop(df: pd.DataFrame, col: str) -> None:
    if col in df.columns:
        df.drop(columns=[col], inplace=True)

def load_data(xlsx_path: Path, csv_path: Path, sheet_name: str = "Full_new") -> pd.DataFrame:
    """Load and minimally clean/merge the two PCOS files."""
    pcos_data = pd.read_excel(xlsx_path, sheet_name=sheet_name)
    pcos_inf  = pd.read_csv(csv_path)

    # strip column names
    pcos_data.rename(columns=lambda x: x.strip() if isinstance(x, str) else x, inplace=True)
    pcos_inf.rename(columns=lambda x: x.strip() if isinstance(x, str) else x, inplace=True)

    # drop empty Excel artifact
    _maybe_drop(pcos_data, "Unnamed: 44")

    # fill some common missing values
    for col in ["Marraige Status (Yrs)", "Fast food (Y/N)"]:
        if col in pcos_data.columns:
            pcos_data[col].fillna(pcos_data[col].median(), inplace=True)

    # AMH to numeric
    if "AMH(ng/mL)" in pcos_data.columns:
        pcos_data["AMH(ng/mL)"] = pd.to_numeric(pcos_data["AMH(ng/mL)"], errors="coerce")
        pcos_data["AMH(ng/mL)"].fillna(pcos_data["AMH(ng/mL)"].median(), inplace=True)

    # remove duplicated beta-HCG if present and add from infertility file
    _maybe_drop(pcos_data, "II    beta-HCG(mIU/mL)")
    if "II    beta-HCG(mIU/mL)" in pcos_inf.columns:
        pcos_data = pd.concat(
            [pcos_data.reset_index(drop=True), pcos_inf[["II    beta-HCG(mIU/mL)"]].reset_index(drop=True)],
            axis=1,
        )

    return pcos_data

def prepare_xy(df: pd.DataFrame):
    """Select features/target, numeric-only, median-fill."""
    if "PCOS (Y/N)" not in df.columns:
        raise ValueError("Target column 'PCOS (Y/N)' not found in data.")

    y = df["PCOS (Y/N)"].copy()

    drop_cols = [c for c in ["PCOS (Y/N)", "Sl. No", "Patient File No.", "Blood Group"] if c in df.columns]
    X = df.drop(columns=drop_cols).copy()

    # numeric only
    X = X.select_dtypes(include=[np.number])

    # fill numerics with column medians (training-time)
    X = X.fillna(X.median(numeric_only=True))

    return X, y

# -----------------------------
# Train
# -----------------------------
def main():
    print("[trainer] Loading data…")
    df = load_data(XLSX_PATH, CSV_PATH, sheet_name=SHEET_NAME)
    print(f"[trainer] Shape after load: {df.shape}")

    print("[trainer] Preparing features/labels…")
    X, y = prepare_xy(df)
    feats = list(X.columns)
    print(f"[trainer] Features={len(feats)} Samples={len(X)} Positives={int(y.sum())}")

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    # scale numerics
    scaler = StandardScaler()
    X_train_s = scaler.fit_transform(X_train)
    X_test_s  = scaler.transform(X_test)

    # balanced logistic regression helps with class imbalance
    model = LogisticRegression(max_iter=500, class_weight="balanced")
    model.fit(X_train_s, y_train)

    # metrics
    train_acc = accuracy_score(y_train, model.predict(X_train_s))
    test_acc  = accuracy_score(y_test, model.predict(X_test_s))
    print(f"[trainer] Train accuracy: {train_acc:.3f}  |  Test accuracy: {test_acc:.3f}")

    y_pred = model.predict(X_test_s)
    print("[trainer] Confusion matrix (rows=true, cols=pred):")
    print(confusion_matrix(y_test, y_pred))
    print("[trainer] Classification report:")
    print(classification_report(y_test, y_pred, digits=3))

    # save artifacts
    medians = X.median(numeric_only=True).to_dict()

    joblib.dump(model,   MODEL_DIR / "pcos_model.pkl")
    joblib.dump(scaler,  MODEL_DIR / "scaler.pkl")
    joblib.dump(feats,   MODEL_DIR / "features.pkl")
    joblib.dump(medians, MODEL_DIR / "medians.pkl")

    print(f"[trainer] Saved artifacts to: {MODEL_DIR.resolve()}")
    print("[trainer] Done.")

if __name__ == "__main__":
    main()
