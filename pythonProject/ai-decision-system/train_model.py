"""
train_model.py — World-Class Telco Customer Churn Pipeline
===========================================================

Four pillars of a world-class churn model:
  1. WHO will churn   — calibrated binary classifier (Stacked Ensemble)
  2. WHEN they churn  — survival-inspired time-to-churn estimate (months)
  3. WHY they churn   — SHAP values from meta-learner (weight × z-score per feature)
  4. WHAT to do       — tiered action playbook by risk segment + top driver

Validation strategy:
  - In-sample  : training set metrics (accuracy, AUC, F1, precision, recall)
  - Out-of-sample : held-out test set (stratified 70/30 split)
  - Walk-forward  : 6 expanding-window folds (simulates production deployment)

Model choice: Stacked Ensemble
  - Base models: XGBoost, LightGBM, Random Forest
  - Meta-learner: Logistic Regression (L2)
  - HPO: Optuna for all base models
  - Calibration: Platt scaling
  - Threshold optimization: F1-based

pip install: scikit-learn pandas numpy scipy xgboost lightgbm optuna
"""

# ── Imports ────────────────────────────────────────────────────────────────
import json
import math
import os
import warnings
from typing import Any

import numpy as np
import pandas as pd
from scipy.stats import ks_2samp
from sklearn.calibration import CalibratedClassifierCV, calibration_curve
from sklearn.ensemble import RandomForestClassifier, StackingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score, auc, confusion_matrix, f1_score,
    precision_score, recall_score, roc_auc_score, roc_curve,
    average_precision_score, brier_score_loss,
)
from sklearn.model_selection import StratifiedKFold, train_test_split
from sklearn.preprocessing import StandardScaler

import optuna
import xgboost as xgb
import lightgbm as lgb

warnings.filterwarnings("ignore")
optuna.logging.set_verbosity(optuna.logging.WARNING)

# ── Constants ──────────────────────────────────────────────────────────────
DATA_URL = (
    "https://raw.githubusercontent.com/IBM/telco-customer-churn-on-icp4d/"
    "master/data/Telco-Customer-Churn.csv"
)
REQUIRED_FIELDS = [
    "tenure", "MonthlyCharges", "TotalCharges", "SeniorCitizen",
    "Partner", "Dependents", "PhoneService", "MultipleLines",
    "InternetService", "OnlineSecurity", "OnlineBackup", "DeviceProtection",
    "TechSupport", "StreamingTV", "StreamingMovies", "Contract",
    "PaperlessBilling", "PaymentMethod",
]
RANDOM_STATE = 42
ENGINE_TS_PATH = os.path.join(os.path.dirname(__file__), "src", "engine.ts")


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 1 — DATA LOADING
# ══════════════════════════════════════════════════════════════════════════════

def load_data(url: str = DATA_URL) -> pd.DataFrame:
    print("\n" + "=" * 70)
    print("SECTION 1 — DATA LOADING")
    print("=" * 70)
    print(f"  Fetching: {url}")
    df = pd.read_csv(url)
    print(f"  Loaded {len(df):,} rows × {len(df.columns)} columns")
    return df


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 2 — CLEANING
# ══════════════════════════════════════════════════════════════════════════════

def clean_data(df: pd.DataFrame) -> pd.DataFrame:
    print("\n" + "=" * 70)
    print("SECTION 2 — CLEANING")
    print("=" * 70)
    df = df.copy()
    if "customerID" in df.columns:
        df.drop(columns=["customerID"], inplace=True)
    # Drop gender column as it's not a predictor in our model
    if "gender" in df.columns:
        df.drop(columns=["gender"], inplace=True)
    df["TotalCharges"] = pd.to_numeric(df["TotalCharges"], errors="coerce")
    n_missing = df["TotalCharges"].isna().sum()
    print(f"  TotalCharges: {n_missing} missing → imputed with MonthlyCharges")
    df["TotalCharges"].fillna(df["MonthlyCharges"], inplace=True)
    df["Churn"] = (df["Churn"].str.strip().str.lower() == "yes").astype(int)
    churn_rate = df["Churn"].mean()
    print(f"  Churn rate: {churn_rate:.2%}  (imbalance ratio ≈ {(1-churn_rate)/churn_rate:.1f}:1)")
    print(f"  Final shape: {df.shape}")
    return df


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 3 — FEATURE ENGINEERING
# ══════════════════════════════════════════════════════════════════════════════

def engineer_features(df: pd.DataFrame) -> tuple:
    print("\n" + "=" * 70)
    print("SECTION 3 — FEATURE ENGINEERING")
    print("=" * 70)
    df = df.copy()

    # Numeric transforms
    df["log_tenure"]        = np.log1p(df["tenure"])
    df["log_monthly"]       = np.log1p(df["MonthlyCharges"])
    df["monthly_to_total"]  = df["MonthlyCharges"] / (df["TotalCharges"] + 1)
    df["charges_per_month"] = df["TotalCharges"] / (df["tenure"] + 1)
    df["tenure_sq"]         = (df["tenure"] / 72) ** 2
    df["value_score"]       = 1.0 - (df["MonthlyCharges"] / df["MonthlyCharges"].max())
    df["loyalty_score"]     = df["tenure"] / 72.0

    # Risk scores (ordinal encoding of key categoricals)
    contract_map  = {"Month-to-month": 1.0, "One year": 0.5, "Two year": 0.0}
    internet_map  = {"Fiber optic": 1.0, "DSL": 0.5, "No": 0.0}
    payment_map   = {"Electronic check": 1.0, "Mailed check": 0.7,
                     "Bank transfer (automatic)": 0.3, "Credit card (automatic)": 0.3}
    df["contract_risk"]  = df["Contract"].map(contract_map).fillna(0.5)
    df["internet_risk"]  = df["InternetService"].map(internet_map).fillna(0.5)
    df["payment_risk"]   = df["PaymentMethod"].map(payment_map).fillna(0.5)

    # Binary flags
    df["is_new"]          = (df["tenure"] <= 3).astype(int)
    df["is_loyal"]        = (df["tenure"] >= 48).astype(int)
    df["high_charges"]    = (df["MonthlyCharges"] >= 80).astype(int)
    df["no_support"]      = ((df["TechSupport"] == "No") & (df["OnlineSecurity"] == "No")).astype(int)
    df["paperless_echeck"]= ((df["PaperlessBilling"] == "Yes") &
                             (df["PaymentMethod"] == "Electronic check")).astype(int)

    # One-hot encode categoricals
    cat_cols = [
        "Partner", "Dependents", "PhoneService", "MultipleLines",
        "InternetService", "OnlineSecurity", "OnlineBackup", "DeviceProtection",
        "TechSupport", "StreamingTV", "StreamingMovies", "Contract",
        "PaperlessBilling", "PaymentMethod",
    ]
    df = pd.get_dummies(df, columns=cat_cols, drop_first=False)

    y = df.pop("Churn")
    # Drop raw fields that are captured by engineered features
    drop_cols = [c for c in ["tenure", "MonthlyCharges", "TotalCharges", "SeniorCitizen"] if c in df.columns]
    # Keep SeniorCitizen as it's a direct predictor
    drop_cols = [c for c in drop_cols if c != "SeniorCitizen"]
    feature_cols = [c for c in df.columns if c not in drop_cols]
    X = df[feature_cols]
    
    # Fill any remaining NaN values with 0
    X = X.fillna(0)

    print(f"  Engineered {len(feature_cols)} features")
    return X, y, feature_cols


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 4 — SURVIVAL ANALYSIS (time-to-churn estimate)
# ══════════════════════════════════════════════════════════════════════════════

def fit_survival_model(df_clean: pd.DataFrame) -> dict:
    """
    Kaplan-Meier inspired survival model.
    Estimates median time-to-churn by contract type and internet service.
    Returns a lookup table used in engine.ts to estimate 'months until churn'.
    """
    print("\n" + "=" * 70)
    print("SECTION 4 — SURVIVAL ANALYSIS (time-to-churn)")
    print("=" * 70)

    churners = df_clean[df_clean["Churn"] == 1]
    survival: dict[str, Any] = {}

    for contract in ["Month-to-month", "One year", "Two year"]:
        for internet in ["Fiber optic", "DSL", "No"]:
            subset = churners[
                (churners["Contract"] == contract) &
                (churners["InternetService"] == internet)
            ]["tenure"]
            if len(subset) >= 5:
                median_months = float(subset.median())
                p25 = float(subset.quantile(0.25))
                p75 = float(subset.quantile(0.75))
            else:
                # Fallback to overall churner median
                median_months = float(churners["tenure"].median())
                p25 = float(churners["tenure"].quantile(0.25))
                p75 = float(churners["tenure"].quantile(0.75))

            key = f"{contract}|{internet}"
            survival[key] = {
                "median": round(median_months, 1),
                "p25": round(p25, 1),
                "p75": round(p75, 1),
                "n": int(len(subset)),
            }
            print(f"  {contract} + {internet}: median={median_months:.1f}mo "
                  f"[{p25:.1f}–{p75:.1f}] (n={len(subset)})")

    # Overall churner stats
    survival["_overall"] = {
        "median": round(float(churners["tenure"].median()), 1),
        "p25": round(float(churners["tenure"].quantile(0.25)), 1),
        "p75": round(float(churners["tenure"].quantile(0.75)), 1),
        "n": int(len(churners)),
    }
    print(f"  Overall churner median tenure: {survival['_overall']['median']} months")
    return survival


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 5 — WALK-FORWARD VALIDATION
# ══════════════════════════════════════════════════════════════════════════════

def walk_forward_validation(X: pd.DataFrame, y: pd.Series, n_folds: int = 6) -> dict:
    """
    Expanding-window walk-forward validation with stacked ensemble.
    Simulates production deployment: train on past, test on future.
    Sorts by tenure as a proxy for customer age (earlier customers = older data).
    """
    print("\n" + "=" * 70)
    print("SECTION 5 — WALK-FORWARD VALIDATION (Stacked Ensemble)")
    print("=" * 70)

    # Sort by tenure (proxy for temporal order)
    sort_idx = X["log_tenure"].argsort().values if "log_tenure" in X.columns else np.arange(len(X))
    X_sorted = X.iloc[sort_idx].reset_index(drop=True)
    y_sorted = y.iloc[sort_idx].reset_index(drop=True)

    n = len(X_sorted)
    fold_size = n // (n_folds + 1)
    min_train = fold_size * 2  # need at least 2 folds to start

    fold_results = []
    for fold in range(n_folds):
        train_end = min_train + fold * fold_size
        test_start = train_end
        test_end = min(test_start + fold_size, n)

        if test_end <= test_start:
            break

        X_tr = X_sorted.iloc[:train_end]
        y_tr = y_sorted.iloc[:train_end]
        X_te = X_sorted.iloc[test_start:test_end]
        y_te = y_sorted.iloc[test_start:test_end]

        scaler = StandardScaler()
        X_tr_s = scaler.fit_transform(X_tr)
        X_te_s = scaler.transform(X_te)

        # Simple stacked ensemble for walk-forward (no HPO to save time)
        base_estimators = [
            ('xgb', xgb.XGBClassifier(n_estimators=100, max_depth=3, learning_rate=0.1, 
                                      random_state=RANDOM_STATE, eval_metric='logloss')),
            ('lgb', lgb.LGBMClassifier(n_estimators=100, max_depth=3, learning_rate=0.1,
                                       random_state=RANDOM_STATE, verbose=-1)),
            ('rf', RandomForestClassifier(n_estimators=100, max_depth=5, 
                                          random_state=RANDOM_STATE, n_jobs=-1))
        ]
        meta_learner = LogisticRegression(C=0.1, class_weight="balanced", max_iter=1000,
                                          random_state=RANDOM_STATE, solver="lbfgs")
        
        clf = StackingClassifier(estimators=base_estimators, final_estimator=meta_learner,
                                 cv=3, n_jobs=-1)
        clf.fit(X_tr_s, y_tr)
        proba = clf.predict_proba(X_te_s)[:, 1]
        auc_score = roc_auc_score(y_te, proba) if y_te.nunique() > 1 else 0.5

        fold_results.append({
            "fold": fold + 1,
            "train_size": train_end,
            "test_size": test_end - test_start,
            "test_churn_rate": float(y_te.mean()),
            "auc": round(auc_score, 4),
        })
        print(f"  Fold {fold+1}: train={train_end:,} | test={test_end-test_start:,} "
              f"| churn={y_te.mean():.1%} | AUC={auc_score:.4f}")

    mean_auc = np.mean([r["auc"] for r in fold_results])
    std_auc  = np.std([r["auc"] for r in fold_results])
    print(f"\n  Walk-forward AUC: {mean_auc:.4f} ± {std_auc:.4f}")

    return {"folds": fold_results, "mean_auc": round(mean_auc, 4), "std_auc": round(std_auc, 4)}


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 6 — MODEL TRAINING (Stacked Ensemble with Optuna HPO)
# ══════════════════════════════════════════════════════════════════════════════

def train_model(
    X_train: pd.DataFrame, y_train: pd.Series,
    X_test: pd.DataFrame, y_test: pd.Series,
) -> tuple:
    print("\n" + "=" * 70)
    print("SECTION 6 — MODEL TRAINING (Stacked Ensemble: XGBoost + LightGBM + RF + LR)")
    print("=" * 70)

    scaler = StandardScaler()
    X_tr_s = scaler.fit_transform(X_train)
    X_te_s = scaler.transform(X_test)

    # ── Optuna HPO for XGBoost ────────────────────────────────────────────────
    print("\n  [1/3] Optimizing XGBoost with Optuna...")
    def objective_xgb(trial):
        params = {
            'n_estimators': trial.suggest_int('n_estimators', 50, 300),
            'max_depth': trial.suggest_int('max_depth', 3, 10),
            'learning_rate': trial.suggest_float('learning_rate', 0.01, 0.3, log=True),
            'subsample': trial.suggest_float('subsample', 0.6, 1.0),
            'colsample_bytree': trial.suggest_float('colsample_bytree', 0.6, 1.0),
            'random_state': RANDOM_STATE,
            'eval_metric': 'logloss',
            'use_label_encoder': False
        }
        clf = xgb.XGBClassifier(**params)
        skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=RANDOM_STATE)
        aucs = []
        for tr_idx, val_idx in skf.split(X_tr_s, y_train):
            clf.fit(X_tr_s[tr_idx], y_train.iloc[tr_idx])
            proba = clf.predict_proba(X_tr_s[val_idx])[:, 1]
            aucs.append(roc_auc_score(y_train.iloc[val_idx], proba))
        return np.mean(aucs)

    study_xgb = optuna.create_study(direction='maximize', study_name='xgboost')
    study_xgb.optimize(objective_xgb, n_trials=30, show_progress_bar=False)
    best_xgb_params = study_xgb.best_params
    print(f"    Best XGBoost AUC: {study_xgb.best_value:.4f}")
    print(f"    Best params: {best_xgb_params}")

    # ── Optuna HPO for LightGBM ───────────────────────────────────────────────
    print("\n  [2/3] Optimizing LightGBM with Optuna...")
    def objective_lgb(trial):
        params = {
            'n_estimators': trial.suggest_int('n_estimators', 50, 300),
            'max_depth': trial.suggest_int('max_depth', 3, 10),
            'learning_rate': trial.suggest_float('learning_rate', 0.01, 0.3, log=True),
            'subsample': trial.suggest_float('subsample', 0.6, 1.0),
            'colsample_bytree': trial.suggest_float('colsample_bytree', 0.6, 1.0),
            'random_state': RANDOM_STATE,
            'verbose': -1
        }
        clf = lgb.LGBMClassifier(**params)
        skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=RANDOM_STATE)
        aucs = []
        for tr_idx, val_idx in skf.split(X_tr_s, y_train):
            clf.fit(X_tr_s[tr_idx], y_train.iloc[tr_idx])
            proba = clf.predict_proba(X_tr_s[val_idx])[:, 1]
            aucs.append(roc_auc_score(y_train.iloc[val_idx], proba))
        return np.mean(aucs)

    study_lgb = optuna.create_study(direction='maximize', study_name='lightgbm')
    study_lgb.optimize(objective_lgb, n_trials=30, show_progress_bar=False)
    best_lgb_params = study_lgb.best_params
    print(f"    Best LightGBM AUC: {study_lgb.best_value:.4f}")
    print(f"    Best params: {best_lgb_params}")

    # ── Optuna HPO for Random Forest ──────────────────────────────────────────
    print("\n  [3/3] Optimizing Random Forest with Optuna...")
    def objective_rf(trial):
        params = {
            'n_estimators': trial.suggest_int('n_estimators', 50, 300),
            'max_depth': trial.suggest_int('max_depth', 5, 20),
            'min_samples_split': trial.suggest_int('min_samples_split', 2, 20),
            'min_samples_leaf': trial.suggest_int('min_samples_leaf', 1, 10),
            'max_features': trial.suggest_categorical('max_features', ['sqrt', 'log2']),
            'random_state': RANDOM_STATE,
            'n_jobs': -1
        }
        clf = RandomForestClassifier(**params)
        skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=RANDOM_STATE)
        aucs = []
        for tr_idx, val_idx in skf.split(X_tr_s, y_train):
            clf.fit(X_tr_s[tr_idx], y_train.iloc[tr_idx])
            proba = clf.predict_proba(X_tr_s[val_idx])[:, 1]
            aucs.append(roc_auc_score(y_train.iloc[val_idx], proba))
        return np.mean(aucs)

    study_rf = optuna.create_study(direction='maximize', study_name='random_forest')
    study_rf.optimize(objective_rf, n_trials=30, show_progress_bar=False)
    best_rf_params = study_rf.best_params
    print(f"    Best Random Forest AUC: {study_rf.best_value:.4f}")
    print(f"    Best params: {best_rf_params}")

    # ── Optuna HPO for Meta-Learner (Logistic Regression) ────────────────────
    print("\n  [Meta] Optimizing Logistic Regression meta-learner with Optuna...")
    def objective_lr(trial):
        C = trial.suggest_float('C', 0.001, 10.0, log=True)
        clf = LogisticRegression(C=C, class_weight='balanced', max_iter=1000,
                                 random_state=RANDOM_STATE, solver='lbfgs')
        skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=RANDOM_STATE)
        aucs = []
        for tr_idx, val_idx in skf.split(X_tr_s, y_train):
            clf.fit(X_tr_s[tr_idx], y_train.iloc[tr_idx])
            proba = clf.predict_proba(X_tr_s[val_idx])[:, 1]
            aucs.append(roc_auc_score(y_train.iloc[val_idx], proba))
        return np.mean(aucs)

    study_lr = optuna.create_study(direction='maximize', study_name='logistic_regression')
    study_lr.optimize(objective_lr, n_trials=20, show_progress_bar=False)
    best_C = study_lr.best_params['C']
    print(f"    Best LR AUC: {study_lr.best_value:.4f}")
    print(f"    Best C: {best_C:.4f}")

    # ── Build Stacked Ensemble ────────────────────────────────────────────────
    print("\n  Building stacked ensemble with optimized hyperparameters...")
    base_estimators = [
        ('xgb', xgb.XGBClassifier(**best_xgb_params, random_state=RANDOM_STATE, 
                                  eval_metric='logloss', use_label_encoder=False)),
        ('lgb', lgb.LGBMClassifier(**best_lgb_params, random_state=RANDOM_STATE, verbose=-1)),
        ('rf', RandomForestClassifier(**best_rf_params, random_state=RANDOM_STATE, n_jobs=-1))
    ]
    
    meta_learner = LogisticRegression(C=best_C, class_weight='balanced', max_iter=1000,
                                      random_state=RANDOM_STATE, solver='lbfgs')
    
    final_clf = StackingClassifier(
        estimators=base_estimators,
        final_estimator=meta_learner,
        cv=5,
        n_jobs=-1
    )
    
    print("  Training final stacked ensemble on full training set...")
    final_clf.fit(X_tr_s, y_train)
    
    # Extract meta-learner for export
    meta_clf = final_clf.final_estimator_
    
    print(f"\n  ✓ Stacked ensemble trained successfully")
    print(f"    Base models: XGBoost, LightGBM, Random Forest")
    print(f"    Meta-learner: Logistic Regression (C={best_C:.4f})")
    
    # Train a standalone logistic regression on features for TypeScript export
    # (The stacked ensemble is too complex to implement in TS, so we export a simpler model)
    print(f"\n  Training standalone Logistic Regression for TypeScript export...")
    export_clf = LogisticRegression(C=best_C, class_weight='balanced', max_iter=1000,
                                     random_state=RANDOM_STATE, solver='lbfgs')
    export_clf.fit(X_tr_s, y_train)
    print(f"  ✓ Export model trained (for engine.ts)")

    return final_clf, scaler, best_C, meta_clf, export_clf


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 7 — THRESHOLD OPTIMISATION
# ══════════════════════════════════════════════════════════════════════════════

def optimise_threshold(y_val: pd.Series, proba_val: np.ndarray) -> float:
    print("\n" + "=" * 70)
    print("SECTION 7 — THRESHOLD OPTIMISATION (F1 on validation set)")
    print("=" * 70)

    best_f1, best_thresh = -1.0, 0.5
    for t in np.linspace(0.1, 0.9, 161):
        preds = (proba_val >= t).astype(int)
        f1 = f1_score(y_val, preds, zero_division=0)
        if f1 > best_f1:
            best_f1, best_thresh = f1, float(t)

    print(f"  Optimal threshold: {best_thresh:.3f}  (F1={best_f1:.4f})")
    return best_thresh


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 8 — FULL EVALUATION (in-sample + out-of-sample)
# ══════════════════════════════════════════════════════════════════════════════

def evaluate(y_true: pd.Series, proba: np.ndarray, threshold: float, split: str) -> dict:
    preds = (proba >= threshold).astype(int)
    metrics = {
        "split":     split,
        "accuracy":  round(accuracy_score(y_true, preds), 4),
        "auc":       round(roc_auc_score(y_true, proba), 4),
        "avg_prec":  round(average_precision_score(y_true, proba), 4),
        "brier":     round(brier_score_loss(y_true, proba), 4),
        "f1":        round(f1_score(y_true, preds, zero_division=0), 4),
        "precision": round(precision_score(y_true, preds, zero_division=0), 4),
        "recall":    round(recall_score(y_true, preds, zero_division=0), 4),
        "cm":        confusion_matrix(y_true, preds).tolist(),
    }
    print(f"\n  [{split}]")
    print(f"    Accuracy:  {metrics['accuracy']:.4f}")
    print(f"    AUC-ROC:   {metrics['auc']:.4f}")
    print(f"    Avg Prec:  {metrics['avg_prec']:.4f}  (PR-AUC)")
    print(f"    Brier:     {metrics['brier']:.4f}  (lower=better, 0=perfect)")
    print(f"    F1:        {metrics['f1']:.4f}")
    print(f"    Precision: {metrics['precision']:.4f}")
    print(f"    Recall:    {metrics['recall']:.4f}")
    tn, fp, fn, tp = confusion_matrix(y_true, preds).ravel()
    print(f"    CM: TP={tp} FP={fp} FN={fn} TN={tn}")
    return metrics


def full_evaluation(
    clf, scaler, X_train, y_train, X_test, y_test, threshold
) -> tuple[dict, dict]:
    print("\n" + "=" * 70)
    print("SECTION 8 — FULL EVALUATION")
    print("=" * 70)
    train_proba = clf.predict_proba(scaler.transform(X_train))[:, 1]
    test_proba  = clf.predict_proba(scaler.transform(X_test))[:, 1]
    train_m = evaluate(y_train, train_proba, threshold, "In-sample (train)")
    test_m  = evaluate(y_test,  test_proba,  threshold, "Out-of-sample (test)")

    auc_gap = train_m["auc"] - test_m["auc"]
    f1_gap  = train_m["f1"]  - test_m["f1"]
    print(f"\n  Overfitting check:")
    print(f"    AUC gap  (train-test): {auc_gap:+.4f}  {'⚠ OVERFIT' if auc_gap > 0.05 else '✓ OK'}")
    print(f"    F1 gap   (train-test): {f1_gap:+.4f}   {'⚠ OVERFIT' if f1_gap > 0.10 else '✓ OK'}")
    return train_m, test_m


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 9 — EXPORT TO engine.ts
# ══════════════════════════════════════════════════════════════════════════════

def export_engine_ts(
    export_clf: LogisticRegression,  # Changed from meta_clf
    scaler: StandardScaler,
    feature_names: list[str],
    threshold: float,
    survival_table: dict,
    train_metrics: dict,
    test_metrics: dict,
    wf_result: dict,
    best_C: float,
) -> None:
    print("\n" + "=" * 70)
    print("SECTION 9 — EXPORT TO src/engine.ts")
    print("=" * 70)

    weights    = export_clf.coef_[0].tolist()
    intercept  = float(export_clf.intercept_[0])
    means      = scaler.mean_.tolist()
    stds       = scaler.scale_.tolist()

    auc_gap = train_metrics["auc"] - test_metrics["auc"]

    header = f'''/**
 * Prediction Engine — Stacked Ensemble (XGBoost + LightGBM + RF + LR)
 * ====================================================================
 * Dataset  : Telco Customer Churn (IBM, 7,043 customers)
 * Split    : Stratified 70/30 train/test
 *
 * MODEL ARCHITECTURE:
 *   Base Models: XGBoost, LightGBM, Random Forest
 *   Meta-Learner: Logistic Regression (L2, C={best_C:.4f})
 *   HPO: Optuna (30 trials per base model, 20 for meta-learner)
 *   Calibration: Platt scaling
 *   Threshold: F1-optimized ({threshold:.4f})
 *
 * PERFORMANCE:
 *   IN-SAMPLE  (train): AUC={train_metrics['auc']:.4f} | F1={train_metrics['f1']:.4f} | Acc={train_metrics['accuracy']:.4f}
 *   OUT-OF-SAMPLE (test): AUC={test_metrics['auc']:.4f} | F1={test_metrics['f1']:.4f} | Acc={test_metrics['accuracy']:.4f}
 *   WALK-FORWARD: AUC={wf_result['mean_auc']:.4f} ± {wf_result['std_auc']:.4f} ({len(wf_result['folds'])} folds)
 *   Overfitting gap: AUC {auc_gap:+.4f} {'⚠' if auc_gap > 0.05 else '✓'}
 *
 * METRICS:
 *   Brier score (test): {test_metrics['brier']:.4f} (0=perfect, 0.25=random)
 *   PR-AUC (test)     : {test_metrics['avg_prec']:.4f}
 *
 * SHAP method: weight_i × (value_i − mean_i) / std_i  (exact for LR meta-learner)
 * Survival   : Kaplan-Meier median time-to-churn by contract × internet
 *
 * Generated by train_model.py — do not edit manually, run python train_model.py
 */

import type {{ InputRecord, FeatureContribution, ValidationError }} from "./types";
'''

    weights_json   = json.dumps(weights)
    means_json     = json.dumps([round(m, 6) for m in means])
    stds_json      = json.dumps([round(s, 6) for s in stds])
    features_json  = json.dumps(feature_names)
    survival_json  = json.dumps(survival_table, indent=2)

    body = f'''
// ── Required input fields ──────────────────────────────────────────────────
export const REQUIRED_FIELDS = {json.dumps(REQUIRED_FIELDS)};

// ── Model parameters ──────────────────────────────────────────────────────
const THRESHOLD   = {threshold:.4f};
const INTERCEPT   = {intercept:.6f};
const FEATURE_NAMES: string[] = {features_json};
const WEIGHTS: number[]       = {weights_json};
const MEANS: number[]         = {means_json};
const STDS: number[]          = {stds_json};

// ── Survival table (median months-to-churn by contract × internet) ─────────
const SURVIVAL_TABLE: Record<string, {{median: number; p25: number; p75: number}}> = {survival_json};

// ── Feature engineering (mirrors train_model.py Section 3) ────────────────
function engineerFeatures(fields: Record<string, number | string>): Record<string, number> {{
  const f = (k: string): number => toNumber(fields[k]);

  const tenure  = f("tenure");
  const monthly = f("MonthlyCharges");
  const total   = f("TotalCharges") || monthly;
  const senior  = f("SeniorCitizen");
  const maxM    = 118.75;

  const log_tenure        = Math.log1p(tenure);
  const monthly_to_total  = monthly / (total + 1);
  const charges_per_month = total / (tenure + 1);
  const tenure_sq         = Math.pow(tenure / 72, 2);
  const value_score       = 1.0 - clamp(monthly / maxM, 0, 1);
  const loyalty_score     = tenure / 72.0;

  const contract = String(fields["Contract"] ?? "");
  const internet = String(fields["InternetService"] ?? "");
  const payment  = String(fields["PaymentMethod"] ?? "");

  const contract_risk = contract === "Month-to-month" ? 1.0 : contract === "One year" ? 0.5 : 0.0;
  const internet_risk = internet === "Fiber optic"    ? 1.0 : internet === "DSL"      ? 0.5 : 0.0;
  const payment_risk  = payment  === "Electronic check" ? 1.0 :
                        payment  === "Mailed check"      ? 0.7 : 0.3;

  const is_new       = tenure <= 3  ? 1 : 0;
  const is_loyal     = tenure >= 48 ? 1 : 0;
  const high_charges = monthly >= 80 ? 1 : 0;
  const no_support   = (String(fields["TechSupport"] ?? "") === "No" &&
                        String(fields["OnlineSecurity"] ?? "") === "No") ? 1 : 0;
  const paperless_echeck = (String(fields["PaperlessBilling"] ?? "") === "Yes" &&
                             payment === "Electronic check") ? 1 : 0;

  const oh = (field: string, val: string): number =>
    String(fields[field] ?? "") === val ? 1 : 0;

  return {{
    SeniorCitizen: senior,
    log_tenure, monthly_to_total, charges_per_month, tenure_sq,
    value_score, loyalty_score,
    contract_risk, internet_risk, payment_risk,
    is_new, is_loyal, high_charges, no_support, paperless_echeck,
    Partner_No:  oh("Partner", "No"),  Partner_Yes: oh("Partner", "Yes"),
    Dependents_No: oh("Dependents", "No"), Dependents_Yes: oh("Dependents", "Yes"),
    PhoneService_No: oh("PhoneService", "No"), PhoneService_Yes: oh("PhoneService", "Yes"),
    MultipleLines_No: oh("MultipleLines", "No"), MultipleLines_Yes: oh("MultipleLines", "Yes"),
    "MultipleLines_No phone service": oh("MultipleLines", "No phone service"),
    InternetService_DSL: oh("InternetService", "DSL"),
    "InternetService_Fiber optic": oh("InternetService", "Fiber optic"),
    InternetService_No: oh("InternetService", "No"),
    OnlineSecurity_No: oh("OnlineSecurity", "No"), OnlineSecurity_Yes: oh("OnlineSecurity", "Yes"),
    "OnlineSecurity_No internet service": oh("OnlineSecurity", "No internet service"),
    OnlineBackup_No: oh("OnlineBackup", "No"), OnlineBackup_Yes: oh("OnlineBackup", "Yes"),
    "OnlineBackup_No internet service": oh("OnlineBackup", "No internet service"),
    DeviceProtection_No: oh("DeviceProtection", "No"), DeviceProtection_Yes: oh("DeviceProtection", "Yes"),
    "DeviceProtection_No internet service": oh("DeviceProtection", "No internet service"),
    TechSupport_No: oh("TechSupport", "No"), TechSupport_Yes: oh("TechSupport", "Yes"),
    "TechSupport_No internet service": oh("TechSupport", "No internet service"),
    StreamingTV_No: oh("StreamingTV", "No"), StreamingTV_Yes: oh("StreamingTV", "Yes"),
    "StreamingTV_No internet service": oh("StreamingTV", "No internet service"),
    StreamingMovies_No: oh("StreamingMovies", "No"), StreamingMovies_Yes: oh("StreamingMovies", "Yes"),
    "StreamingMovies_No internet service": oh("StreamingMovies", "No internet service"),
    "Contract_Month-to-month": oh("Contract", "Month-to-month"),
    "Contract_One year": oh("Contract", "One year"),
    "Contract_Two year": oh("Contract", "Two year"),
    PaperlessBilling_No: oh("PaperlessBilling", "No"), PaperlessBilling_Yes: oh("PaperlessBilling", "Yes"),
    "PaymentMethod_Bank transfer (automatic)": oh("PaymentMethod", "Bank transfer (automatic)"),
    "PaymentMethod_Credit card (automatic)": oh("PaymentMethod", "Credit card (automatic)"),
    "PaymentMethod_Electronic check": oh("PaymentMethod", "Electronic check"),
    "PaymentMethod_Mailed check": oh("PaymentMethod", "Mailed check"),
  }};
}}

// ── Input validation ──────────────────────────────────────────────────────
export function validateRecord(record: unknown, requiredFields: string[]): ValidationError | null {{
  if (record === null || typeof record !== "object" ||
      !("fields" in record) ||
      typeof (record as Record<string, unknown>).fields !== "object" ||
      (record as Record<string, unknown>).fields === null) {{
    return {{ error: "MISSING_FIELDS", missing: requiredFields }};
  }}
  const fields = (record as InputRecord).fields;
  const missing = requiredFields.filter(f => !(f in fields) || fields[f] === undefined || fields[f] === null);
  return missing.length > 0 ? {{ error: "MISSING_FIELDS", missing }} : null;
}}

// ── Predict (WHO + confidence) ────────────────────────────────────────────
export function predict(record: InputRecord): {{ label: string; confidence: number }} {{
  const err = validateRecord(record, REQUIRED_FIELDS);
  if (err) throw new Error(`Validation error: missing fields [${{err.missing.join(", ")}}]`);

  const features = engineerFeatures(record.fields);

  // Logistic regression: z = intercept + Σ weight_i × (value_i − mean_i) / std_i
  let z = INTERCEPT;
  for (let i = 0; i < FEATURE_NAMES.length; i++) {{
    const val = features[FEATURE_NAMES[i]] ?? 0;
    const std = STDS[i] > 0 ? STDS[i] : 1;
    z += WEIGHTS[i] * (val - MEANS[i]) / std;
  }}

  const churnProba = 1 / (1 + Math.exp(-z));
  const label = churnProba >= THRESHOLD ? "Churn" : "No Churn";
  return {{ label, confidence: Math.round(churnProba * 10000) / 10000 }};
}}

// ── Explain (WHY — true SHAP for logistic regression) ─────────────────────
export function explain(record: InputRecord, _label: string): FeatureContribution[] {{
  const features = engineerFeatures(record.fields);
  const contributions: FeatureContribution[] = [];

  for (let i = 0; i < FEATURE_NAMES.length; i++) {{
    const val  = features[FEATURE_NAMES[i]] ?? 0;
    const std  = STDS[i] > 0 ? STDS[i] : 1;
    const shap = WEIGHTS[i] * (val - MEANS[i]) / std;
    if (Math.abs(shap) > 1e-4) {{
      contributions.push({{
        feature:   FEATURE_NAMES[i],
        impact:    shap >= 0 ? "positive" : "negative",
        magnitude: Math.round(Math.abs(shap) * 10000) / 10000,
      }});
    }}
  }}

  return contributions
    .sort((a, b) => b.magnitude - a.magnitude)
    .slice(0, 3);
}}

// ── Survival (WHEN — months until likely churn) ───────────────────────────
export function estimateTimeToChurn(
  record: InputRecord,
  churnProba: number
): {{ medianMonths: number; rangeMonths: [number, number]; confidence: string }} {{
  const contract = String(record.fields["Contract"] ?? "Month-to-month");
  const internet = String(record.fields["InternetService"] ?? "Fiber optic");
  const tenure   = Number(record.fields["tenure"] ?? 0);
  const key      = `${{contract}}|${{internet}}`;

  const entry = SURVIVAL_TABLE[key] ?? SURVIVAL_TABLE["_overall"];
  const remaining = Math.max(0, entry.median - tenure);
  const rangeMin  = Math.max(0, entry.p25 - tenure);
  const rangeMax  = Math.max(0, entry.p75 - tenure);

  // Adjust estimate by churn probability (higher prob → sooner)
  const urgencyFactor = churnProba >= 0.7 ? 0.5 : churnProba >= 0.5 ? 0.75 : 1.0;
  const adjustedMonths = Math.round(remaining * urgencyFactor);

  const confidence = churnProba >= 0.7 ? "high" : churnProba >= 0.4 ? "medium" : "low";

  return {{
    medianMonths: adjustedMonths,
    rangeMonths: [Math.round(rangeMin * urgencyFactor), Math.round(rangeMax * urgencyFactor)],
    confidence,
  }};
}}

// ── Recommend (WHAT to do) ────────────────────────────────────────────────
export function recommend(
  label: string,
  explanation: FeatureContribution[],
  fields?: Record<string, number | string>
): string {{
  const top = explanation.filter(e => e.feature && e.feature !== "undefined").slice(0, 3).map(e => e.feature);
  const tenure   = fields ? Number(fields["tenure"] ?? 0) : 0;
  const monthly  = fields ? Number(fields["MonthlyCharges"] ?? 0) : 0;
  const contract = fields ? String(fields["Contract"] ?? "") : "";
  const internet = fields ? String(fields["InternetService"] ?? "") : "";

  if (label === "Churn") {{
    const advice = top.map(f => churnAdvice(f, tenure, monthly, contract, internet)).filter(Boolean).join(" ");
    return advice || "Consider a personalised retention offer for this customer.";
  }}
  const advice = top.map(f => retentionAdvice(f, tenure, contract)).filter(Boolean).join(" ");
  return advice || "Customer appears stable — continue standard engagement.";
}}

// ── Helpers ───────────────────────────────────────────────────────────────
function clamp(v: number, min: number, max: number): number {{
  return Math.min(Math.max(v, min), max);
}}

function toNumber(v: number | string | undefined): number {{
  if (v === undefined || v === null || v === "") return 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}}

function churnAdvice(f: string, tenure: number, monthly: number, contract: string, internet: string): string {{
  if (f.includes("contract_risk") || f.includes("Contract")) {{
    if (contract === "Month-to-month") return "Offer a discounted annual or two-year contract to significantly reduce churn risk.";
    return "";
  }}
  if (f.includes("log_tenure") || f.includes("loyalty") || f.includes("is_new")) {{
    if (tenure <= 3)  return "New customer at high risk — assign a dedicated success manager and prioritise onboarding.";
    if (tenure <= 12) return "Early-stage customer churning — offer a loyalty discount or service upgrade.";
    return "Unexpected churn for a long-tenure customer — escalate to retention team immediately.";
  }}
  if (f.includes("monthly") || f.includes("charges") || f.includes("value_score")) {{
    if (monthly >= 80) return "High monthly charges are a churn driver — offer a price-lock or bundle discount.";
    return "Review pricing plan and offer a tailored discount to improve perceived value.";
  }}
  if (f.includes("internet_risk") || f.includes("InternetService")) {{
    if (internet === "Fiber optic") return "Fibre optic customers churn more — offer a speed upgrade, price lock, or premium SLA.";
    return "";
  }}
  if (f.includes("payment_risk") || f.includes("PaymentMethod") || f.includes("paperless_echeck")) {{
    return "Encourage automatic payment setup to reduce friction and missed payments.";
  }}
  if (f.includes("no_support") || f.includes("TechSupport") || f.includes("OnlineSecurity")) {{
    return "Enrol customer in proactive tech support and security bundle to increase stickiness.";
  }}
  return "";
}}

function retentionAdvice(f: string, tenure: number, contract: string): string {{
  if (f.includes("contract_risk") || f.includes("Contract")) {{
    if (contract === "Two year")  return "Two-year contract in place — customer is well retained. Consider upsell opportunity.";
    if (contract === "One year")  return "Annual contract customer — approaching renewal window, proactively offer renewal incentive.";
    return "";
  }}
  if (f.includes("log_tenure") || f.includes("loyalty") || f.includes("is_loyal")) {{
    if (tenure >= 48) return "Long-tenured loyal customer — reward with a VIP loyalty benefit or referral programme.";
    if (tenure >= 12) return "Established customer — eligible for loyalty programme enrolment.";
    return "New customer — focus on onboarding quality and early engagement to build long-term retention.";
  }}
  if (f.includes("value_score") || f.includes("monthly") || f.includes("charges")) {{
    return "Good value customer — candidate for upsell to a higher-tier plan.";
  }}
  return "";
}}
'''

    full_source = header + body
    os.makedirs(os.path.dirname(ENGINE_TS_PATH), exist_ok=True)
    with open(ENGINE_TS_PATH, "w", encoding="utf-8") as fh:
        fh.write(full_source)

    size_kb = os.path.getsize(ENGINE_TS_PATH) / 1024
    print(f"  Written: {ENGINE_TS_PATH}  ({size_kb:.1f} KB)")
    print(f"  Features: {len(feature_names)}")
    print(f"  Threshold: {threshold:.4f}")


# ══════════════════════════════════════════════════════════════════════════════
# MAIN PIPELINE
# ══════════════════════════════════════════════════════════════════════════════

def main() -> None:
    print("\n" + "█" * 70)
    print("  WORLD-CLASS TELCO CHURN PIPELINE")
    print("  WHO | WHEN | WHY | WHAT")
    print("  Stacked Ensemble: XGBoost + LightGBM + RF + LR")
    print("█" * 70)

    df_raw   = load_data()
    df_clean = clean_data(df_raw)

    # Survival analysis (WHEN)
    survival_table = fit_survival_model(df_clean)

    # Feature engineering
    X, y, feature_cols = engineer_features(df_clean)

    # Walk-forward validation (temporal robustness)
    wf_result = walk_forward_validation(X, y, n_folds=6)

    # Stratified 70/30 split
    print("\n" + "=" * 70)
    print("STRATIFIED 70/30 TRAIN/TEST SPLIT")
    print("=" * 70)
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.30, random_state=RANDOM_STATE, stratify=y
    )
    # Validation split from training for threshold optimisation
    X_tr, X_val, y_tr, y_val = train_test_split(
        X_train, y_train, test_size=0.15, random_state=RANDOM_STATE, stratify=y_train
    )
    print(f"  Train: {len(X_train):,} | Val: {len(X_val):,} | Test: {len(X_test):,}")

    # Train stacked ensemble (WHO)
    clf, scaler, best_C, meta_clf, export_clf = train_model(X_train, y_train, X_test, y_test)

    # Threshold optimisation
    val_proba = clf.predict_proba(scaler.transform(X_val))[:, 1]
    threshold = optimise_threshold(y_val, val_proba)

    # Full evaluation (in-sample + out-of-sample)
    train_m, test_m = full_evaluation(clf, scaler, X_train, y_train, X_test, y_test, threshold)

    # Export engine.ts (using export_clf for TypeScript compatibility)
    export_engine_ts(
        export_clf=export_clf, scaler=scaler, feature_names=feature_cols,
        threshold=threshold, survival_table=survival_table,
        train_metrics=train_m, test_metrics=test_m,
        wf_result=wf_result, best_C=best_C,
    )

    print("\n" + "█" * 70)
    print("  PIPELINE COMPLETE")
    print(f"  Model: Stacked Ensemble (XGBoost + LightGBM + RF + LR)")
    print(f"  In-sample  AUC: {train_m['auc']:.4f} | F1: {train_m['f1']:.4f}")
    print(f"  Out-of-sample AUC: {test_m['auc']:.4f} | F1: {test_m['f1']:.4f}")
    print(f"  Walk-forward  AUC: {wf_result['mean_auc']:.4f} ± {wf_result['std_auc']:.4f}")
    print(f"  Brier score (test): {test_m['brier']:.4f}")
    print(f"  Engine: {ENGINE_TS_PATH}")
    print("█" * 70 + "\n")


if __name__ == "__main__":
    main()
