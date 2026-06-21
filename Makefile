# ═══════════════════════════════════════════════════════════════
# Rufaqaa Platform — Development Makefile
# ═══════════════════════════════════════════════════════════════
# Common commands for local development
# Usage: make <command>
# ═══════════════════════════════════════════════════════════════

.DEFAULT_GOAL := help
.PHONY: help up down restart status logs clean psql redis-cli backend-shell test lint format

# ─── Colors ──────────────────────────────────────────────────
COLOR_RESET   := \033[0m
COLOR_GREEN   := \033[32m
COLOR_YELLOW  := \033[33m
COLOR_CYAN    := \033[36m
COLOR_BOLD    := \033[1m

# ═══════════════════════════════════════════════════════════════
# Help
# ═══════════════════════════════════════════════════════════════

help: ## عرض هذه القائمة
	@echo ""
	@echo "$(COLOR_BOLD)🕌 Rufaqaa Platform — Development Commands$(COLOR_RESET)"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  $(COLOR_CYAN)%-20s$(COLOR_RESET) %s\n", $$1, $$2}'
	@echo ""

# ═══════════════════════════════════════════════════════════════
# Infrastructure (Docker)
# ═══════════════════════════════════════════════════════════════

up: ## 🚀 تشغيل كل خدمات التطوير
	@echo "$(COLOR_GREEN)→ Starting development stack...$(COLOR_RESET)"
	@docker compose up -d
	@echo ""
	@echo "$(COLOR_BOLD)✅ Services started:$(COLOR_RESET)"
	@echo "  📊 Adminer (DB GUI):   http://localhost:8080"
	@echo "  💾 MinIO Console:      http://localhost:9001"
	@echo "  ✉️  MailHog:            http://localhost:8025"
	@echo "  🐘 PostgreSQL:         localhost:5432"
	@echo "  🔴 Redis:              localhost:6379"
	@echo ""

down: ## 🛑 إيقاف كل الخدمات
	@echo "$(COLOR_YELLOW)→ Stopping development stack...$(COLOR_RESET)"
	@docker compose down

restart: down up ## 🔄 إعادة تشغيل كل الخدمات

status: ## 📊 حالة الخدمات
	@docker compose ps

logs: ## 📜 متابعة السجلات (Ctrl+C للخروج)
	@docker compose logs -f

logs-postgres: ## 📜 سجلات PostgreSQL فقط
	@docker compose logs -f postgres

logs-redis: ## 📜 سجلات Redis فقط
	@docker compose logs -f redis

# ═══════════════════════════════════════════════════════════════
# Database Access
# ═══════════════════════════════════════════════════════════════

psql: ## 🐘 الاتصال بـ PostgreSQL CLI
	@docker compose exec postgres psql -U rufaqaa -d rufaqaa

backup-db: ## 💾 نسخة احتياطية فورية من قاعدة البيانات
	@BACKUP_DIR=$${BACKUP_DIR:-./backups} \
		POSTGRES_PASSWORD=$${POSTGRES_PASSWORD:-rufaqaa_dev_password} \
		bash infrastructure/scripts/backup_postgres.sh

redis-cli: ## 🔴 الاتصال بـ Redis CLI
	@docker compose exec redis redis-cli

# ═══════════════════════════════════════════════════════════════
# Cleanup
# ═══════════════════════════════════════════════════════════════

clean: ## 🧹 مسح الـ containers والـ volumes (تحذير: يحذف كل البيانات!)
	@echo "$(COLOR_YELLOW)⚠️  This will delete ALL data!$(COLOR_RESET)"
	@read -p "Are you sure? [y/N] " confirm && [ "$$confirm" = "y" ] || exit 1
	@docker compose down -v
	@echo "$(COLOR_GREEN)✅ Cleaned$(COLOR_RESET)"

# ═══════════════════════════════════════════════════════════════
# Backend (will be active after Phase 2)
# ═══════════════════════════════════════════════════════════════

backend-install: ## 📦 تثبيت dependencies الـ Backend
	@cd backend && python -m pip install -r requirements.txt

backend-dev: ## 🐍 تشغيل Backend في وضع التطوير
	@cd backend && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

backend-shell: ## 🐍 Shell تفاعلي مع تحميل التطبيق
	@cd backend && python -m IPython

backend-test: ## 🧪 تشغيل اختبارات Backend
	@cd backend && pytest -v

backend-lint: ## 🔍 فحص الكود في Backend
	@cd backend && ruff check . && mypy .

backend-format: ## ✨ تنسيق الكود في Backend
	@cd backend && ruff format .

backend-openapi: ## 📘 توليد ملف OpenAPI من FastAPI
	@cd backend && python -m app.scripts.export_openapi

backend-seed: ## 🌱 إنشاء مؤسسة + مسؤول التطوير (إذا لم يكونا موجودين)
	@cd backend && python -m app.scripts.seed

backend-demo-seed: ## 🎭 بيانات تجريبية (6 أيتام، 5 متبرعين، 4 كفالات، 8 مدفوعات)
	@cd backend && python -m app.scripts.demo_seed

backend-staging-seed: ## 🌐 بيانات تجريبية مصغّرة لنشر العرض (staging) — منظمتان
	@cd backend && python -m app.scripts.staging_seed

worker-dev: ## ⚙️  تشغيل Celery worker للتطوير
	@cd backend && celery -A app.workers.celery_app worker --loglevel=info

beat-dev: ## ⏰ تشغيل Celery beat (المهام المجدولة)
	@cd backend && celery -A app.workers.celery_app beat --loglevel=info

# ═══════════════════════════════════════════════════════════════
# MCP Server
# ═══════════════════════════════════════════════════════════════

mcp-install: ## 📦 تثبيت dependencies الـ MCP Server
	@cd mcp-server && pip install -e ".[dev]"

mcp-run: ## 🤖 تشغيل MCP Server (stdio)
	@cd mcp-server && rufaqaa-mcp

mcp-test: ## 🧪 تشغيل اختبارات MCP Server
	@cd mcp-server && pytest -v

mcp-lint: ## 🔍 فحص الكود في MCP Server
	@cd mcp-server && ruff check rufaqaa_mcp tests

# ═══════════════════════════════════════════════════════════════
# Frontend (will be active after Phase 10)
# ═══════════════════════════════════════════════════════════════

frontend-install: ## 📦 تثبيت dependencies الـ Frontend
	@cd frontend && npm install

frontend-dev: ## ⚛️  تشغيل Frontend في وضع التطوير
	@cd frontend && npm run dev

frontend-build: ## 🏗️  بناء Frontend للإنتاج
	@cd frontend && npm run build

frontend-test: ## 🧪 تشغيل اختبارات Frontend
	@cd frontend && npm test

frontend-lint: ## 🔍 فحص الكود في Frontend
	@cd frontend && npm run lint

# ═══════════════════════════════════════════════════════════════
# General
# ═══════════════════════════════════════════════════════════════

env: ## 🔧 إنشاء ملف .env من القالب
	@if [ -f .env ]; then \
		echo "$(COLOR_YELLOW)⚠️  .env already exists$(COLOR_RESET)"; \
	else \
		cp .env.example .env; \
		echo "$(COLOR_GREEN)✅ Created .env — please review and adjust$(COLOR_RESET)"; \
	fi
