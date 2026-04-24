FROM python:3.11-slim

# Install system deps for yt-dlp + ffmpeg + whisper
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ── Step 1: Install torch CPU-only FIRST (largest download, cached separately) ──
# Split into its own layer so Docker caches it — avoids re-downloading 1.8GB on every rebuild
RUN pip install --no-cache-dir --timeout=600 --retries=10 \
    --extra-index-url https://download.pytorch.org/whl/cpu \
    torch

# ── Step 2: Install whisper (depends on torch being present) ──
RUN pip install --no-cache-dir --timeout=300 --retries=5 openai-whisper

# ── Step 3: Install sentence-transformers (downloads model weights) ──
RUN pip install --no-cache-dir --timeout=300 --retries=5 sentence-transformers

# ── Step 4: Install remaining lightweight packages ──
RUN pip install --no-cache-dir --timeout=120 --retries=5 \
    fastapi \
    uvicorn \
    yt-dlp \
    openai \
    hypothesis \
    pytest \
    python-multipart \
    psycopg2-binary \
    httpx

COPY multimodal-intelligence-app/app ./app
COPY multimodal-intelligence-app/static ./static

EXPOSE 8000
HEALTHCHECK --interval=60s --timeout=15s --retries=3 \
  CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/docs')" || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
