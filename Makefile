.PHONY: help install up down reset dev lint typecheck test format

help:
	@echo "Targets:"
	@echo "  install   - pnpm install"
	@echo "  up        - start local infra (postgres, redis, minio)"
	@echo "  down      - stop local infra"
	@echo "  reset     - stop and wipe local infra volumes"
	@echo "  dev       - run all apps in parallel"
	@echo "  lint      - eslint"
	@echo "  typecheck - tsc noEmit across workspaces"
	@echo "  test      - vitest across workspaces"
	@echo "  format    - prettier write"

install:
	pnpm install

up:
	docker compose up -d

down:
	docker compose down

reset:
	docker compose down -v

dev:
	pnpm dev

lint:
	pnpm lint

typecheck:
	pnpm typecheck

test:
	pnpm test

format:
	pnpm format
