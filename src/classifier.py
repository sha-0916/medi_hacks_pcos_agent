"""
PCOS Risk Analysis Demo
Author: Shubhi Sharma (github.com/sha-0916)
License: MIT

Description:
    Train a quick baseline (logistic regression) classifier on the Kaggle PCOS dataset.
    Cleans columns, merges infertility file's II beta-HCG column, and prints metrics.
    Also generates exploratory plots.

Credits:
    - Dataset: "Polycystic Ovary Syndrome (PCOS)" by Prasoon Kottarathil, Kaggle.
    - Diagnostic criteria references: Rotterdam 2003; International PCOS Guideline 2023.
"""

import warnings
warnings.filterwarnings("ignore", category=FutureWarning)

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns

from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split
from sklearn.metrics import (
    confusion_matrix as sk_confusion_matrix,
    classification_report,
    accuracy_score,
)
from sklearn.preprocessing import StandardScaler


# -----------------------------
# Utility functions
# -----------------------------
def _maybe_drop(df: pd.DataFrame, col: str) -> None:
    """Drop a column if it exists (inplace)."""
    if col in df.columns:
        df.drop(columns=[col], inplace=True)


def load_data(xlsx_path: str, csv_path: str, sheet_name: str = "Full_new") -> pd.DataFrame:
    """Load and minimally clean/merge the two PCOS files."""
    pcos_data = pd.read_excel(xlsx_path, sheet_name=sheet_name)
    pcos_inf = pd.read_csv(csv_path)

    # Clean column names
    pcos_data.rename(columns=lambda x: x.strip() if isinstance(x, str) else x, inplace=True)
    pcos_inf.rename(columns=lambda x: x.strip() if isinstance(x, str) else x, inplace=True)

    # Drop empty Excel artifact column
    _maybe_drop(pcos_data, "Unnamed: 44")

    # Fill some missing values
    for col in ["Marraige Status (Yrs)", "Fast food (Y/N)"]:
        if col in pcos_data.columns:
            pcos_data[col].fillna(pcos_data[col].median(), inplace=True)

    # Convert AMH to numeric and fill missing
    if "AMH(ng/mL)" in pcos_data.columns:
        pcos_data["AMH(ng/mL)"] = pd.to_numeric(pcos_data["AMH(ng/mL)"], errors="coerce")
        pcos_data["AMH(ng/mL)"].fillna(pcos_data["AMH(ng/mL)"].median(), inplace=True)

    # Remove duplicate beta-HCG column and add from infertility file
    _maybe_drop(pcos_data, "II    beta-HCG(mIU/mL)")
    if "II    beta-HCG(mIU/mL)" in pcos_inf.columns:
        pcos_data = pd.concat(
            [pcos_data.reset_index(drop=True), pcos_inf[["II    beta-HCG(mIU/mL)"]].reset_index(drop=True)],
            axis=1,
        )

    return pcos_data


def prepare_xy(df: pd.DataFrame):
    """Split dataset into features and target."""
    y = df["PCOS (Y/N)"].copy()
    drop_cols = [c for c in ["PCOS (Y/N)", "Sl. No", "Patient File No."] if c in df.columns]
    X = df.drop(columns=drop_cols).copy()
    X = X.select_dtypes(include=[np.number])
    X = X.fillna(X.median(numeric_only=True))
    return X, y


def train_and_eval(X: pd.DataFrame, y: pd.Series, test_size=0.2, random_state=42):
    """Train logistic regression and evaluate with metrics and plots."""
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=test_size, random_state=random_state, stratify=y
    )

    scaler = StandardScaler()
    X_train_s = scaler.fit_transform(X_train)
    X_test_s = scaler.transform(X_test)

    model = LogisticRegression(max_iter=200)
    model.fit(X_train_s, y_train)

    train_acc = accuracy_score(y_train, model.predict(X_train_s))
    test_acc = accuracy_score(y_test, model.predict(X_test_s))

    print(f"\n=== Baseline Logistic Regression ===")
    print(f"Train accuracy: {train_acc:.3f}")
    print(f"Test  accuracy: {test_acc:.3f}")

    y_pred = model.predict(X_test_s)
    cm = sk_confusion_matrix(y_test, y_pred)
    print("\nConfusion matrix (rows=true, cols=pred):")
    print(cm)

    print("\nClassification report:")
    print(classification_report(y_test, y_pred, digits=3))

    # --- Plot Confusion Matrix ---
    plt.figure(figsize=(5, 4))
    sns.heatmap(cm, annot=True, fmt="d", cmap="Blues",
                xticklabels=["No PCOS", "PCOS"], yticklabels=["No PCOS", "PCOS"])
    plt.xlabel("Predicted")
    plt.ylabel("True")
    plt.title("Confusion Matrix")
    plt.tight_layout()
    plt.show()

    return model, scaler


def plot_exploratory(df: pd.DataFrame):
    """Quick exploratory plots for class balance and BMI distribution."""
    if "PCOS (Y/N)" in df.columns:
        plt.figure(figsize=(6, 4))
        sns.countplot(x="PCOS (Y/N)", data=df)
        plt.title("Class Balance (PCOS vs Non-PCOS)")
        plt.tight_layout()
        plt.show()

    if "BMI" in df.columns:
        plt.figure(figsize=(6, 4))
        sns.histplot(df, x="BMI", hue="PCOS (Y/N)", bins=20, kde=True, palette="Set2")
        plt.title("BMI distribution by PCOS status")
        plt.tight_layout()
        plt.show()


# -----------------------------
# Main
# -----------------------------
def main():
    # Hardcoded file names — keep them in the same folder as this script
    xlsx_path = "PCOS_data_without_infertility.xlsx"
    csv_path = "PCOS_infertility.csv"
    sheet_name = "Full_new"

    print("Loading data...")
    df = load_data(xlsx_path, csv_path, sheet_name=sheet_name)
    print(f"Loaded shape: {df.shape}")

    # Exploratory plots
    plot_exploratory(df)

    print("Preparing features/labels...")
    X, y = prepare_xy(df)
    print(f"Features: {X.shape[1]}  |  Samples: {X.shape[0]}")

    _ = train_and_eval(X, y)


if __name__ == "__main__":
    main()
