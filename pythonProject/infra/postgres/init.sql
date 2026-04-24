-- AI Platform Database Schema
-- PostgreSQL with pgvector extension

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- ══════════════════════════════════════════════════════════════════════════
-- SHARED INFRASTRUCTURE TABLES
-- ══════════════════════════════════════════════════════════════════════════

-- Request logs for observability (all projects)
CREATE TABLE IF NOT EXISTS request_logs (
  id SERIAL PRIMARY KEY,
  project TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  user_id TEXT,
  latency_ms INTEGER NOT NULL,
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  cost_usd NUMERIC(10,6) DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('success', 'error')),
  error_msg TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_request_logs_project_created ON request_logs(project, created_at DESC);
CREATE INDEX idx_request_logs_user ON request_logs(user_id);

-- Prompt versions for LLMOps
CREATE TABLE IF NOT EXISTS prompt_versions (
  id SERIAL PRIMARY KEY,
  project TEXT NOT NULL,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  model TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project, name, version)
);

CREATE INDEX idx_prompt_versions_active ON prompt_versions(project, name, is_active);

-- Evaluation results (RAG metrics)
CREATE TABLE IF NOT EXISTS eval_results (
  id SERIAL PRIMARY KEY,
  project TEXT NOT NULL,
  eval_type TEXT NOT NULL,
  query_id TEXT,
  query TEXT NOT NULL,
  response TEXT NOT NULL,
  groundedness NUMERIC(4,3),
  groundedness_score NUMERIC(4,3),
  answer_relevance NUMERIC(4,3),
  hallucination BOOLEAN,
  judge_reasoning JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_eval_results_project ON eval_results(project, created_at DESC);

-- Security events
CREATE TABLE IF NOT EXISTS security_events (
  id SERIAL PRIMARY KEY,
  project TEXT NOT NULL,
  event_type TEXT NOT NULL,
  user_id TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  reason TEXT NOT NULL,
  severity TEXT DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_security_events_project ON security_events(project, created_at DESC);
CREATE INDEX idx_security_events_severity ON security_events(severity, created_at DESC);

-- ══════════════════════════════════════════════════════════════════════════
-- PROJECT 1: ENTERPRISE AI COPILOT
-- ══════════════════════════════════════════════════════════════════════════

-- Document chunks with embeddings (pgvector)
CREATE TABLE IF NOT EXISTS document_chunks (
  id SERIAL PRIMARY KEY,
  document_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  embedding vector(768),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(document_id, chunk_index)
);

CREATE INDEX idx_document_chunks_doc ON document_chunks(document_id);
CREATE INDEX idx_document_chunks_embedding ON document_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- User memory (key-value store for last 10 interactions)
CREATE TABLE IF NOT EXISTS user_memory_kv (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, key)
);

CREATE INDEX idx_user_memory_user ON user_memory_kv(user_id);

-- ══════════════════════════════════════════════════════════════════════════
-- PROJECT 2: AI PLANNING AGENT
-- ══════════════════════════════════════════════════════════════════════════

-- Agent execution runs
CREATE TABLE IF NOT EXISTS agent_runs (
  id SERIAL PRIMARY KEY,
  run_id TEXT UNIQUE NOT NULL,
  task TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  steps JSONB DEFAULT '[]',
  result JSONB,
  error_msg TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_agent_runs_status ON agent_runs(status, created_at DESC);
CREATE INDEX idx_agent_runs_run_id ON agent_runs(run_id);

-- ══════════════════════════════════════════════════════════════════════════
-- PROJECT 3: AI AUTOMATION SYSTEM
-- ══════════════════════════════════════════════════════════════════════════

-- Job queue and processing
CREATE TABLE IF NOT EXISTS jobs (
  id SERIAL PRIMARY KEY,
  job_id TEXT UNIQUE NOT NULL,
  pipeline TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  result JSONB,
  error_msg TEXT,
  attempts INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_jobs_status ON jobs(status, created_at);
CREATE INDEX idx_jobs_pipeline ON jobs(pipeline, created_at DESC);
CREATE INDEX idx_jobs_job_id ON jobs(job_id);

-- ══════════════════════════════════════════════════════════════════════════
-- PROJECT 4: MULTIMODAL INTELLIGENCE APP
-- ══════════════════════════════════════════════════════════════════════════

-- Video processing sessions
CREATE TABLE IF NOT EXISTS video_sessions (
  id SERIAL PRIMARY KEY,
  session_id TEXT UNIQUE NOT NULL,
  video_url TEXT NOT NULL,
  transcript TEXT,
  summary TEXT,
  embeddings vector(768)[],
  metadata JSONB DEFAULT '{}',
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error_msg TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_video_sessions_session_id ON video_sessions(session_id);
CREATE INDEX idx_video_sessions_status ON video_sessions(status, created_at DESC);

-- ══════════════════════════════════════════════════════════════════════════
-- PROJECT 5: AI DECISION SYSTEM
-- ══════════════════════════════════════════════════════════════════════════

-- ML predictions
CREATE TABLE IF NOT EXISTS predictions (
  id SERIAL PRIMARY KEY,
  prediction_id TEXT UNIQUE NOT NULL,
  input_features JSONB NOT NULL,
  prediction TEXT NOT NULL,
  confidence NUMERIC(5,4) NOT NULL,
  top_features JSONB,
  recommendation TEXT,
  model_version TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_predictions_prediction_id ON predictions(prediction_id);
CREATE INDEX idx_predictions_created ON predictions(created_at DESC);

-- ══════════════════════════════════════════════════════════════════════════
-- INITIAL DATA / SEED
-- ══════════════════════════════════════════════════════════════════════════

-- Insert a test prompt version for each project
INSERT INTO prompt_versions (project, name, version, content, model, is_active) VALUES
  ('enterprise-ai-copilot', 'system', 1, 'You are a helpful AI assistant with access to a knowledge base. Always cite your sources.', 'llama-3.3-70b-versatile', TRUE),
  ('ai-planning-agent', 'planner', 1, 'You are a planning agent. Break down complex tasks into 2-4 executable steps. Return JSON only.', 'llama-3.3-70b-versatile', TRUE),
  ('ai-automation-system', 'classifier', 1, 'You are a classification agent. Analyze the input and return structured JSON with category and confidence.', 'llama-3.3-70b-versatile', TRUE)
ON CONFLICT (project, name, version) DO NOTHING;

-- Log successful initialization
DO $$
BEGIN
  RAISE NOTICE 'AI Platform database initialized successfully';
  RAISE NOTICE 'Tables created: request_logs, prompt_versions, eval_results, security_events, document_chunks, user_memory_kv, agent_runs, jobs, video_sessions, predictions';
END $$;
