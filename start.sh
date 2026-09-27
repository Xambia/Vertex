#!/bin/bash
set -e

echo "=========================================="
echo " Starting VERTEX Unified Container on Render"
echo "=========================================="

export HOSTNAME="0.0.0.0"
export BACKEND_PORT=${BACKEND_PORT:-8000}
export PORT=${PORT:-3000}
export BACKEND_URL="http://127.0.0.1:${BACKEND_PORT}"

echo "[VERTEX] Starting FastAPI backend on port ${BACKEND_PORT}..."
cd /app/backend
python -m uvicorn main:app --host 0.0.0.0 --port ${BACKEND_PORT} &
BACKEND_PID=$!

echo "[VERTEX] Starting Next.js frontend on port ${PORT}..."
cd /app/frontend
if [ -f ".next/standalone/server.js" ]; then
    PORT=${PORT} HOSTNAME="0.0.0.0" node .next/standalone/server.js &
elif [ -f ".next/standalone/frontend/server.js" ]; then
    PORT=${PORT} HOSTNAME="0.0.0.0" node .next/standalone/frontend/server.js &
elif [ -f "server.js" ]; then
    PORT=${PORT} HOSTNAME="0.0.0.0" node server.js &
else
    npm start -- -H 0.0.0.0 -p ${PORT} &
fi
FRONTEND_PID=$!

# Trap signals for graceful shutdown
trap "kill -TERM $BACKEND_PID $FRONTEND_PID 2>/dev/null" SIGTERM SIGINT

echo "[VERTEX] Services started. Backend PID: $BACKEND_PID, Frontend PID: $FRONTEND_PID"

# Wait for either process to exit
wait -n $BACKEND_PID $FRONTEND_PID
EXIT_STATUS=$?

echo "[VERTEX] Process exited with status $EXIT_STATUS. Shutting down container..."
kill -TERM $BACKEND_PID $FRONTEND_PID 2>/dev/null || true
exit $EXIT_STATUS
