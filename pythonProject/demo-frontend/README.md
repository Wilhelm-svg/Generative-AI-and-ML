# Generative AI Platform - Interactive API Demo

A clean, interactive single-page application to demo all 30 API endpoints across the 5 microservices.

## Features

- **All 30 Endpoints**: Every endpoint from all 5 services in one place
- **Pre-filled Requests**: Working curl commands and request bodies ready to go
- **Editable Inputs**: Modify URLs, headers, and request bodies as needed
- **Live Execution**: Run requests directly from the browser
- **Syntax Highlighting**: Beautiful JSON and bash syntax highlighting
- **Response Display**: Formatted JSON responses with proper indentation
- **Organized by Service**: Clear grouping by the 5 microservices

## How to Use

1. **Start all services** (if not already running):
   ```bash
   wsl docker compose up -d
   ```

2. **Open the demo**:
   - Simply open `index.html` in your browser
   - Or use a local server:
     ```bash
     # Python
     python -m http.server 8080
     
     # Node.js
     npx http-server -p 8080
     ```
   - Then navigate to `http://localhost:8080`

3. **Test endpoints**:
   - Each endpoint card shows the HTTP method, URL, and pre-filled request
   - Click "Run Request" to execute
   - View the response in the formatted JSON box below
   - Edit any field and re-run as needed
   - Click "Reset" to restore defaults

## Services Included

### Project 1: Enterprise AI Copilot (Port 4002)
- Health check, token generation, document ingestion, RAG chat, status, telemetry, evaluation

### Project 2: AI Planning Agent (Port 4003)
- Health check, agent task execution, run history, status, telemetry

### Project 3: AI Automation System (Port 4001)
- Health check, job creation, job status, job list, status, telemetry

### Project 4: Multimodal Intelligence App (Port 8000)
- Health check, video processing, Q&A, telemetry

### Project 5: AI Decision System (Port 4000)
- Health check, churn prediction, prediction retrieval, insights, telemetry

## Tips

- **Token-based endpoints**: First run "Generate Token" (endpoint #2), then copy the token to the Authorization header in endpoints #3 and #4
- **Job-based endpoints**: Run "Create Invoice Extraction Job" (endpoint #14), wait 5 seconds, then copy the job_id to endpoint #15
- **Video processing**: Endpoint #20 may take 30-60 seconds to process the video
- **Session-based Q&A**: Run endpoint #20 first to get a session_id, then use it in endpoint #21

## Technology Stack

- React 18 (via CDN)
- Prism.js for syntax highlighting
- Pure CSS for styling
- Fetch API for HTTP requests

## Browser Compatibility

Works in all modern browsers (Chrome, Firefox, Safari, Edge).
