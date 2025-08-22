import pandas as pd
from pathlib import Path
from typing import List, Optional

CSV = Path(__file__).resolve().parents[1] / "data/guidelines.csv"
DF  = pd.read_csv(CSV)

def retrieve(risk: str, symptoms: Optional[List[str]] = None, k: int = 5):
    risk = risk.lower()
    df = DF[DF["risk"].str.lower() == risk].copy()
    if symptoms:
        df["match"] = df["symptom"].apply(lambda s: sum(1 for t in symptoms if t.lower() in str(s).lower()))
        df = df.sort_values(["match"], ascending=False)
    return df.head(k).to_dict(orient="records")
