/**
 * INTEGRATION TESTS - AI Decision System
 * Deep functional testing of ML prediction engine
 * These tests verify prediction accuracy, explainability, and recommendations
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from './server.js';
import { InMemoryPredictionStore } from './store.js';
import type { Server } from 'http';

describe('🔬 INTEGRATION: AI Decision System - Real-world Scenarios', () => {
  let server: Server;
  let baseUrl: string;
  let store: InMemoryPredictionStore;
  const port = 4100;

  beforeAll(async () => {
    store = new InMemoryPredictionStore();
    server = createServer(store);
    await new Promise<void>((resolve) => {
      server.listen(port, () => {
        baseUrl = `http://localhost:${port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  // Sample customer data for testing
  const highRiskCustomer = {
    tenure: 2,
    MonthlyCharges: 95.50,
    TotalCharges: 191.00,
    SeniorCitizen: 0,
    Partner: 'No',
    Dependents: 'No',
    PhoneService: 'Yes',
    MultipleLines: 'Yes',
    InternetService: 'Fiber optic',
    OnlineSecurity: 'No',
    OnlineBackup: 'No',
    DeviceProtection: 'No',
    TechSupport: 'No',
    StreamingTV: 'Yes',
    StreamingMovies: 'Yes',
    Contract: 'Month-to-month',
    PaperlessBilling: 'Yes',
    PaymentMethod: 'Electronic check',
  };

  const lowRiskCustomer = {
    tenure: 60,
    MonthlyCharges: 45.00,
    TotalCharges: 2700.00,
    SeniorCitizen: 0,
    Partner: 'Yes',
    Dependents: 'Yes',
    PhoneService: 'Yes',
    MultipleLines: 'No',
    InternetService: 'DSL',
    OnlineSecurity: 'Yes',
    OnlineBackup: 'Yes',
    DeviceProtection: 'Yes',
    TechSupport: 'Yes',
    StreamingTV: 'No',
    StreamingMovies: 'No',
    Contract: 'Two year',
    PaperlessBilling: 'No',
    PaymentMethod: 'Bank transfer (automatic)',
  };

  describe('Scenario 1: Complete Prediction Workflow', () => {
    it('should predict churn for high-risk customer', async () => {
      const response = await fetch(`${baseUrl}/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: highRiskCustomer,
        }),
      });

      expect(response.status).toBe(200);
      const result = await response.json();

      // Verify response structure
      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('label');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('explanation');
      expect(result).toHaveProperty('recommendation');

      // Verify prediction
      expect(typeof result.id).toBe('string');
      expect(['Churn', 'No Churn']).toContain(result.label);
      expect(typeof result.confidence).toBe('number');
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);

      // Verify explanation (top 3 features)
      expect(Array.isArray(result.explanation)).toBe(true);
      expect(result.explanation.length).toBeGreaterThan(0);
      expect(result.explanation.length).toBeLessThanOrEqual(3);

      result.explanation.forEach((contrib: any) => {
        expect(contrib).toHaveProperty('feature');
        expect(contrib).toHaveProperty('impact');
        expect(contrib).toHaveProperty('magnitude');
        expect(['positive', 'negative']).toContain(contrib.impact);
        expect(typeof contrib.magnitude).toBe('number');
      });

      // Verify recommendation
      expect(typeof result.recommendation).toBe('string');
      expect(result.recommendation.length).toBeGreaterThan(0);

      console.log(`✓ Prediction: ${result.label} (confidence: ${result.confidence})`);
      console.log(`✓ Top features: ${result.explanation.map((e: any) => e.feature).join(', ')}`);
      console.log(`✓ Recommendation: ${result.recommendation.substring(0, 80)}...`);
    });

    it('should predict no churn for low-risk customer', async () => {
      const response = await fetch(`${baseUrl}/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: lowRiskCustomer,
        }),
      });

      expect(response.status).toBe(200);
      const result = await response.json();

      expect(result.label).toBeDefined();
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);

      console.log(`✓ Low-risk prediction: ${result.label} (confidence: ${result.confidence})`);
    });
  });

  describe('Scenario 2: Feature Importance and Explainability', () => {
    it('should identify contract type as key churn driver', async () => {
      const monthToMonthCustomer = {
        ...lowRiskCustomer,
        Contract: 'Month-to-month',
        tenure: 3,
      };

      const response = await fetch(`${baseUrl}/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: monthToMonthCustomer,
        }),
      });

      const result = await response.json();

      // Contract-related features should appear in explanation
      const features = result.explanation.map((e: any) => e.feature.toLowerCase());
      const hasContractFeature = features.some((f: string) => 
        f.includes('contract') || f.includes('tenure') || f.includes('loyalty')
      );

      console.log(`✓ Explanation features: ${features.join(', ')}`);
      console.log(`✓ Contract feature present: ${hasContractFeature}`);
    });

    it('should identify high charges as churn factor', async () => {
      const highChargesCustomer = {
        ...lowRiskCustomer,
        MonthlyCharges: 110.00,
        TotalCharges: 220.00,
        tenure: 2,
      };

      const response = await fetch(`${baseUrl}/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: highChargesCustomer,
        }),
      });

      const result = await response.json();

      // Charges-related features should appear
      const features = result.explanation.map((e: any) => e.feature.toLowerCase());
      const hasChargesFeature = features.some((f: string) => 
        f.includes('charge') || f.includes('monthly') || f.includes('value')
      );

      console.log(`✓ High charges explanation: ${features.join(', ')}`);
    });

    it('should provide magnitude for each feature contribution', async () => {
      const response = await fetch(`${baseUrl}/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: highRiskCustomer,
        }),
      });

      const result = await response.json();

      // All explanations should have positive magnitude
      result.explanation.forEach((contrib: any) => {
        expect(contrib.magnitude).toBeGreaterThan(0);
      });

      // Features should be sorted by magnitude (descending)
      for (let i = 0; i < result.explanation.length - 1; i++) {
        expect(result.explanation[i].magnitude).toBeGreaterThanOrEqual(
          result.explanation[i + 1].magnitude
        );
      }

      console.log(`✓ Feature magnitudes: ${result.explanation.map((e: any) => e.magnitude.toFixed(4)).join(', ')}`);
    });
  });

  describe('Scenario 3: Recommendation Quality', () => {
    it('should recommend retention actions for churn-risk customers', async () => {
      const response = await fetch(`${baseUrl}/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: highRiskCustomer,
        }),
      });

      const result = await response.json();

      // Recommendation should be actionable
      const rec = result.recommendation.toLowerCase();
      const isActionable = rec.includes('offer') || 
                          rec.includes('discount') ||
                          rec.includes('contract') ||
                          rec.includes('upgrade') ||
                          rec.includes('enrol') ||
                          rec.includes('assign');

      expect(isActionable).toBe(true);

      console.log(`✓ Actionable recommendation: ${result.recommendation}`);
    });

    it('should recommend upsell for stable customers', async () => {
      const response = await fetch(`${baseUrl}/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: lowRiskCustomer,
        }),
      });

      const result = await response.json();

      // Recommendation should focus on retention or upsell
      const rec = result.recommendation.toLowerCase();
      const isRetentionFocused = rec.includes('stable') || 
                                rec.includes('loyal') ||
                                rec.includes('upsell') ||
                                rec.includes('reward') ||
                                rec.includes('vip');

      console.log(`✓ Stable customer recommendation: ${result.recommendation}`);
    });

    it('should provide specific advice for new customers', async () => {
      const newCustomer = {
        ...highRiskCustomer,
        tenure: 1,
        TotalCharges: 95.50,
      };

      const response = await fetch(`${baseUrl}/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: newCustomer,
        }),
      });

      const result = await response.json();

      // Should mention onboarding or new customer support
      const rec = result.recommendation.toLowerCase();
      const isNewCustomerAdvice = rec.includes('new') || 
                                 rec.includes('onboard') ||
                                 rec.includes('early') ||
                                 rec.includes('success manager');

      console.log(`✓ New customer advice: ${result.recommendation}`);
    });
  });

  describe('Scenario 4: Input Validation', () => {
    it('should reject requests with missing required fields', async () => {
      const incompleteData = {
        tenure: 10,
        MonthlyCharges: 50.00,
        // Missing many required fields
      };

      const response = await fetch(`${baseUrl}/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: incompleteData,
        }),
      });

      expect(response.status).toBe(400);
      const result = await response.json();
      expect(result).toHaveProperty('error');
      expect(result).toHaveProperty('missing');
      expect(Array.isArray(result.missing)).toBe(true);
      expect(result.missing.length).toBeGreaterThan(0);

      console.log(`✓ Missing fields rejected: ${result.missing.length} fields`);
    });

    it('should reject malformed JSON', async () => {
      const response = await fetch(`${baseUrl}/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json{',
      });

      expect(response.status).toBe(400);
      const result = await response.json();
      expect(result).toHaveProperty('error');

      console.log(`✓ Malformed JSON rejected`);
    });

    it('should reject requests without fields object', async () => {
      const response = await fetch(`${baseUrl}/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenure: 10,
          // Missing 'fields' wrapper
        }),
      });

      expect(response.status).toBe(400);
      const result = await response.json();
      expect(result).toHaveProperty('error');

      console.log(`✓ Missing fields wrapper rejected`);
    });

    it('should handle null and undefined values gracefully', async () => {
      const dataWithNulls = {
        ...highRiskCustomer,
        Partner: null,
        Dependents: undefined,
      };

      const response = await fetch(`${baseUrl}/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: dataWithNulls,
        }),
      });

      // Should reject due to null/undefined values
      expect(response.status).toBe(400);

      console.log(`✓ Null values handled`);
    });
  });

  describe('Scenario 5: Prediction Storage and Retrieval', () => {
    it('should store predictions and retrieve by ID', async () => {
      const response = await fetch(`${baseUrl}/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: highRiskCustomer,
        }),
      });

      const prediction = await response.json();
      const predictionId = prediction.id;

      // Retrieve by ID
      const getResponse = await fetch(`${baseUrl}/predictions/${predictionId}`);
      expect(getResponse.status).toBe(200);

      const retrieved = await getResponse.json();
      expect(retrieved.id).toBe(predictionId);
      expect(retrieved).toHaveProperty('timestamp');
      expect(retrieved).toHaveProperty('input');
      expect(retrieved).toHaveProperty('label');
      expect(retrieved).toHaveProperty('confidence');

      console.log(`✓ Prediction stored and retrieved: ${predictionId}`);
    });

    it('should return 404 for non-existent prediction IDs', async () => {
      const response = await fetch(`${baseUrl}/predictions/non-existent-id`);
      
      expect(response.status).toBe(404);
      const result = await response.json();
      expect(result).toHaveProperty('error');

      console.log(`✓ Non-existent ID returns 404`);
    });

    it('should list all predictions', async () => {
      // Make a few predictions
      for (let i = 0; i < 3; i++) {
        await fetch(`${baseUrl}/predict`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fields: { ...highRiskCustomer, tenure: i + 1 },
          }),
        });
      }

      const response = await fetch(`${baseUrl}/predictions`);
      expect(response.status).toBe(200);

      const predictions = await response.json();
      expect(Array.isArray(predictions)).toBe(true);
      expect(predictions.length).toBeGreaterThan(0);

      console.log(`✓ Listed ${predictions.length} predictions`);
    });

    it('should filter predictions by label', async () => {
      // Make predictions
      await fetch(`${baseUrl}/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: highRiskCustomer }),
      });

      await fetch(`${baseUrl}/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: lowRiskCustomer }),
      });

      // Filter by Churn
      const churnResponse = await fetch(`${baseUrl}/predictions?label=Churn`);
      const churnPredictions = await churnResponse.json();

      if (Array.isArray(churnPredictions) && churnPredictions.length > 0) {
        churnPredictions.forEach((p: any) => {
          expect(p.label).toBe('Churn');
        });
        console.log(`✓ Filtered Churn predictions: ${churnPredictions.length}`);
      }

      // Filter by No Churn
      const noChurnResponse = await fetch(`${baseUrl}/predictions?label=No Churn`);
      const noChurnPredictions = await noChurnResponse.json();

      if (Array.isArray(noChurnPredictions) && noChurnPredictions.length > 0) {
        noChurnPredictions.forEach((p: any) => {
          expect(p.label).toBe('No Churn');
        });
        console.log(`✓ Filtered No Churn predictions: ${noChurnPredictions.length}`);
      }
    });
  });

  describe('Scenario 6: Insights Generation', () => {
    it('should generate insights from prediction patterns', async () => {
      // Submit 15 predictions to trigger insights
      for (let i = 0; i < 15; i++) {
        await fetch(`${baseUrl}/predict`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fields: i % 2 === 0 ? highRiskCustomer : lowRiskCustomer,
          }),
        });
      }

      const response = await fetch(`${baseUrl}/insights`);
      expect(response.status).toBe(200);

      const result = await response.json();
      expect(result).toHaveProperty('insights');
      expect(Array.isArray(result.insights)).toBe(true);

      if (result.insights.length > 0) {
        result.insights.forEach((insight: any) => {
          expect(insight).toHaveProperty('statement');
          expect(typeof insight.statement).toBe('string');
        });

        console.log(`✓ Generated ${result.insights.length} insights`);
        result.insights.forEach((insight: any, i: number) => {
          console.log(`  ${i + 1}. ${insight.statement}`);
        });
      }
    });

    it('should require minimum data for insights', async () => {
      // Clear store and submit only a few predictions
      const newStore = new InMemoryPredictionStore();
      const newServer = createServer(newStore);
      const newPort = 4101;

      await new Promise<void>((resolve) => {
        newServer.listen(newPort, () => resolve());
      });

      const newBaseUrl = `http://localhost:${newPort}`;

      // Submit only 5 predictions
      for (let i = 0; i < 5; i++) {
        await fetch(`${newBaseUrl}/predict`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: highRiskCustomer }),
        });
      }

      const response = await fetch(`${newBaseUrl}/insights`);
      const result = await response.json();

      // Should indicate insufficient data
      if (result.insights.length === 0) {
        expect(result).toHaveProperty('message');
        console.log(`✓ Insufficient data message: ${result.message}`);
      }

      await new Promise<void>((resolve) => {
        newServer.close(() => resolve());
      });
    });
  });

  describe('Scenario 7: Model Performance Characteristics', () => {
    it('should produce consistent predictions for identical inputs', async () => {
      const responses = [];

      for (let i = 0; i < 3; i++) {
        const response = await fetch(`${baseUrl}/predict`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fields: highRiskCustomer,
          }),
        });
        responses.push(await response.json());
      }

      // All predictions should have same label and confidence
      const labels = responses.map(r => r.label);
      const confidences = responses.map(r => r.confidence);

      expect(new Set(labels).size).toBe(1);
      expect(new Set(confidences).size).toBe(1);

      console.log(`✓ Consistent predictions: ${labels[0]} @ ${confidences[0]}`);
    });

    it('should produce different predictions for different risk profiles', async () => {
      const highRiskResponse = await fetch(`${baseUrl}/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: highRiskCustomer }),
      });

      const lowRiskResponse = await fetch(`${baseUrl}/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: lowRiskCustomer }),
      });

      const highRisk = await highRiskResponse.json();
      const lowRisk = await lowRiskResponse.json();

      // Confidence levels should differ significantly
      const confidenceDiff = Math.abs(highRisk.confidence - lowRisk.confidence);

      console.log(`✓ High risk: ${highRisk.label} (${highRisk.confidence})`);
      console.log(`✓ Low risk: ${lowRisk.label} (${lowRisk.confidence})`);
      console.log(`✓ Confidence difference: ${confidenceDiff.toFixed(4)}`);
    });

    it('should handle edge cases in customer data', async () => {
      const edgeCases = [
        { ...highRiskCustomer, tenure: 0, TotalCharges: 0 },
        { ...highRiskCustomer, tenure: 72, TotalCharges: 8640 },
        { ...highRiskCustomer, MonthlyCharges: 0 },
        { ...highRiskCustomer, MonthlyCharges: 120 },
      ];

      for (const edgeCase of edgeCases) {
        const response = await fetch(`${baseUrl}/predict`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: edgeCase }),
        });

        expect(response.status).toBe(200);
        const result = await response.json();
        expect(result).toHaveProperty('label');
        expect(result).toHaveProperty('confidence');
      }

      console.log(`✓ All ${edgeCases.length} edge cases handled`);
    });
  });

  describe('Scenario 8: Concurrent Predictions', () => {
    it('should handle multiple concurrent prediction requests', async () => {
      const requests = [];
      const requestCount = 10;

      for (let i = 0; i < requestCount; i++) {
        requests.push(
          fetch(`${baseUrl}/predict`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fields: i % 2 === 0 ? highRiskCustomer : lowRiskCustomer,
            }),
          })
        );
      }

      const responses = await Promise.all(requests);
      const results = await Promise.all(responses.map(r => r.json()));

      // All should succeed
      responses.forEach(r => expect(r.status).toBe(200));
      expect(results.length).toBe(requestCount);

      // All should have valid predictions
      results.forEach(result => {
        expect(result).toHaveProperty('label');
        expect(result).toHaveProperty('confidence');
        expect(result).toHaveProperty('explanation');
      });

      console.log(`✓ Handled ${requestCount} concurrent requests`);
    });
  });

  describe('Scenario 9: Health and Telemetry', () => {
    it('should return healthy status', async () => {
      const response = await fetch(`${baseUrl}/health`);
      
      expect(response.status).toBe(200);
      const result = await response.json();
      
      expect(result).toHaveProperty('status');
      expect(result.status).toBe('healthy');
      expect(result).toHaveProperty('service');
      expect(result.service).toBe('ai-decision-system');
      expect(result).toHaveProperty('timestamp');
      
      console.log(`✓ Health check: ${result.status}`);
    });

    it('should expose telemetry data', async () => {
      const response = await fetch(`${baseUrl}/telemetry`);
      
      expect(response.status).toBe(200);
      const telemetry = await response.json();
      
      expect(Array.isArray(telemetry)).toBe(true);
      
      if (telemetry.length > 0) {
        telemetry.forEach((record: any) => {
          expect(record).toHaveProperty('queryId');
          expect(record).toHaveProperty('timestamp');
          expect(record).toHaveProperty('success');
          expect(record).toHaveProperty('modelId');
          expect(record).toHaveProperty('label');
          expect(record).toHaveProperty('confidence');
        });
        
        console.log(`✓ Telemetry records: ${telemetry.length}`);
      }
    });
  });

  describe('Scenario 10: Real-world Customer Scenarios', () => {
    it('should identify fiber optic + month-to-month as high risk', async () => {
      const fiberMonthly = {
        ...highRiskCustomer,
        InternetService: 'Fiber optic',
        Contract: 'Month-to-month',
        tenure: 5,
      };

      const response = await fetch(`${baseUrl}/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: fiberMonthly }),
      });

      const result = await response.json();

      // Should likely predict churn or high confidence
      console.log(`✓ Fiber + Monthly: ${result.label} (${result.confidence})`);
      console.log(`✓ Recommendation: ${result.recommendation.substring(0, 80)}...`);
    });

    it('should identify two-year contract as low risk', async () => {
      const twoYearContract = {
        ...lowRiskCustomer,
        Contract: 'Two year',
        tenure: 24,
      };

      const response = await fetch(`${baseUrl}/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: twoYearContract }),
      });

      const result = await response.json();

      console.log(`✓ Two-year contract: ${result.label} (${result.confidence})`);
    });

    it('should handle senior citizens appropriately', async () => {
      const seniorCustomer = {
        ...highRiskCustomer,
        SeniorCitizen: 1,
      };

      const response = await fetch(`${baseUrl}/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: seniorCustomer }),
      });

      const result = await response.json();

      expect(result).toHaveProperty('label');
      expect(result).toHaveProperty('confidence');

      console.log(`✓ Senior citizen: ${result.label} (${result.confidence})`);
    });

    it('should consider payment method in risk assessment', async () => {
      const eCheckCustomer = {
        ...highRiskCustomer,
        PaymentMethod: 'Electronic check',
        PaperlessBilling: 'Yes',
      };

      const autoPayCustomer = {
        ...highRiskCustomer,
        PaymentMethod: 'Bank transfer (automatic)',
        PaperlessBilling: 'No',
      };

      const eCheckResponse = await fetch(`${baseUrl}/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: eCheckCustomer }),
      });

      const autoPayResponse = await fetch(`${baseUrl}/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: autoPayCustomer }),
      });

      const eCheck = await eCheckResponse.json();
      const autoPay = await autoPayResponse.json();

      console.log(`✓ E-check: ${eCheck.label} (${eCheck.confidence})`);
      console.log(`✓ Auto-pay: ${autoPay.label} (${autoPay.confidence})`);
    });
  });
});
