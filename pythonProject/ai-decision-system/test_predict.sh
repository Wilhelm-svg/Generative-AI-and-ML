#!/bin/bash
# High-risk: month-to-month, fiber, 1 month tenure, electronic check
curl -s -X POST http://localhost:4000/predict \
  -H "Content-Type: application/json" \
  -d '{"fields":{"tenure":1,"MonthlyCharges":95,"TotalCharges":95,"SeniorCitizen":0,"Partner":0,"Dependents":0,"PhoneService":1,"PaperlessBilling":1,"Contract_Month-to-month":1,"Contract_One year":0,"Contract_Two year":0,"InternetService_Fiber optic":1,"InternetService_No":0,"PaymentMethod_Electronic check":1}}' | python3 -m json.tool

echo ""
echo "--- Low risk: 2-year contract, 60 months tenure ---"
curl -s -X POST http://localhost:4000/predict \
  -H "Content-Type: application/json" \
  -d '{"fields":{"tenure":60,"MonthlyCharges":45,"TotalCharges":2700,"SeniorCitizen":0,"Partner":1,"Dependents":1,"PhoneService":1,"PaperlessBilling":0,"Contract_Month-to-month":0,"Contract_One year":0,"Contract_Two year":1,"InternetService_Fiber optic":0,"InternetService_No":0,"PaymentMethod_Electronic check":0}}' | python3 -m json.tool
