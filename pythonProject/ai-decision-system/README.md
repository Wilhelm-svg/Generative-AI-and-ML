# AI Decision System

Customer churn prediction with real ML, SHAP-style explainability, actionable recommendations, and an interactive dashboard.

## Model

Logistic Regression trained on **7,032 real Telco customers** with:
- 5-fold cross-validation (AUC-ROC reported per fold)
- F1-optimized decision threshold
- 4 engineered features (interaction terms, binning)
- **80% accuracy** on training data

Re-train anytime:
```bash
python3 train_model.py
```

## Architecture

```
POST /predict { fields }
  │
  ├─ Validation (14 required Telco fields)
  ├─ Logistic Regression (trained weights, standardized features)
  ├─ SHAP-style explainer (top 3 features by |weight × z-score|)
  ├─ Recommendation engine (label + top feature → actionable advice)
  ├─ Store in PostgreSQL predictions table
  └─ Async evaluation (groundedness, relevance) → eval_results table

GET /predictions        → list with label filter
GET /predictions/:id    → single record
GET /insights           → plain-language patterns (requires ≥10 records)
```

## Stack

| Layer | Technology |
|---|---|
| Model | Logistic Regression (trained from scratch, no sklearn) |
| Explainability | SHAP-style: weight × (value − mean) / std |
| Storage | PostgreSQL `predictions` table |
| Dashboard | Chart.js doughnut chart + filterable table + insights panel |

## Quick Start

```bash
# Start infrastructure
docker compose up postgres -d

# Install and build
npm install && npm run build

# Run (no API key needed)
node dist/ai-decision-system/src/index.js
```

Open `frontend/index.html` in your browser.

## API

### Submit a prediction
```bash
curl -X POST http://localhost:4000/predict \
  -H "Content-Type: application/json" \
  -d '{
    "fields": {
      "tenure": 1,
      "MonthlyCharges": 95,
      "TotalCharges": 95,
      "SeniorCitizen": 0,
      "Partner": 0,
      "Dependents": 0,
      "PhoneService": 1,
      "PaperlessBilling": 1,
      "Contract_Month-to-month": 1,
      "Contract_One year": 0,
      "Contract_Two year": 0,
      "InternetService_Fiber optic": 1,
      "InternetService_No": 0,
      "PaymentMethod_Electronic check": 1
    }
  }'
```

### Get insights (after 10+ predictions)
```bash
curl http://localhost:4000/insights
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | No | PostgreSQL (falls back to in-memory) |
| `PORT` | No | Server port (default: 4000) |

## Tests

```bash
npm test   # 39 tests — engine, store, insights, server integration
```
