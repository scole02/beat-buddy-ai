"""Production entry point: uv run gunicorn app:app."""
import os

bind = f"0.0.0.0:{os.environ.get('PORT', '8000')}"
# Keep memory bounded on a small host; threads allow health checks during analysis.
workers = 1
worker_class = "gthread"
threads = 4
timeout = 120
accesslog = "-"
errorlog = "-"
