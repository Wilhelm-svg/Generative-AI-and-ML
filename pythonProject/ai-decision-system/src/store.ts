/**
 * In-memory prediction store — async interface matches PgPredictionStore
 */

import type { StoredPrediction } from "./types";

export class InMemoryPredictionStore {
  private predictions: StoredPrediction[] = [];

  async add(prediction: StoredPrediction): Promise<void> {
    this.predictions.push(prediction);
  }

  async getAll(): Promise<StoredPrediction[]> {
    return [...this.predictions];
  }

  async getById(id: string): Promise<StoredPrediction | undefined> {
    return this.predictions.find((p) => p.id === id);
  }

  async getByLabel(label: string): Promise<StoredPrediction[]> {
    return this.predictions.filter((p) => p.label === label);
  }

  async getLabelDistribution(): Promise<Record<string, number>> {
    const dist: Record<string, number> = {};
    for (const p of this.predictions) {
      dist[p.label] = (dist[p.label] ?? 0) + 1;
    }
    return dist;
  }
}
