#!/bin/bash
set -e

echo "==> Removing old .git folder..."
rm -rf .git

echo "==> Initializing fresh git repo..."
git init

echo "==> Staging all files..."
git add .

echo "==> Creating initial commit..."
git commit -m "Initial commit"

echo "==> Setting remote origin..."
git remote add origin https://github.com/elmar-adam-leech/CRMWorkerD1

echo "==> Pushing to GitHub..."
git push origin main --force

echo "==> Done! Code pushed to https://github.com/elmar-adam-leech/CRMWorkerD1"
