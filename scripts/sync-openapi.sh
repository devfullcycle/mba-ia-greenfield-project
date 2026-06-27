#!/usr/bin/env bash
# scripts/sync-openapi.sh — repo-root, runs on HOST (not in any container)
set -euo pipefail
cp nestjs-project/openapi.json next-frontend/openapi.json
echo "synced: nestjs-project/openapi.json → next-frontend/openapi.json"
