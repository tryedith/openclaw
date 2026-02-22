# OpenClaw Hosted Platform — operational commands
# Usage: make -C hosted <target>

AWS_REGION       ?= us-west-2
AWS_ACCOUNT_ID   := $(shell aws sts get-caller-identity --query Account --output text 2>/dev/null)
ECR_REPO         := $(AWS_ACCOUNT_ID).dkr.ecr.$(AWS_REGION).amazonaws.com/openclaw
TAG              := $(shell date +%Y%m%d%H%M%S)
DOCKERFILE       := infrastructure/Dockerfile
BUILD_CONTEXT    := ..
PLATFORM         := linux/amd64
LAUNCH_TEMPLATE  := $(shell aws ec2 describe-launch-templates --region $(AWS_REGION) \
                       --query 'LaunchTemplates[?starts_with(LaunchTemplateName,`openclaw-user`)].LaunchTemplateId | [0]' \
                       --output text 2>/dev/null)

LOCAL_WEB_DIR            ?= apps/web
LOCAL_ENV_FILE           ?= $(LOCAL_WEB_DIR)/.env
LOCAL_TMP_DIR            ?= .tmp
LOCAL_WEB_PORT           ?= 3000
LOCAL_WEB_URL            ?= http://localhost:$(LOCAL_WEB_PORT)
LOCAL_GATEWAY_CONTAINER  ?= openclaw-local-gateway
LOCAL_GATEWAY_PORT       ?= 8080
LOCAL_GATEWAY_TOKEN      ?= local-dev-gateway-token
LOCAL_GATEWAY_IMAGE      ?= openclaw-hosted-local:dev
LOCAL_GATEWAY_URL        ?= http://localhost:$(LOCAL_GATEWAY_PORT)
LOCAL_USAGE_REPORT_URL   ?= http://host.docker.internal:$(LOCAL_WEB_PORT)/api/usage/events
LOCAL_SMOKE_MODEL_ID     ?= claude-sonnet-4-20250514
LOCAL_GATEWAY_CACHE_TRACE_FILE ?= /tmp/.openclaw/logs/cache-trace.jsonl
LOCAL_GATEWAY_ANTHROPIC_PAYLOAD_LOG_FILE ?= /tmp/.openclaw/logs/anthropic-payload.jsonl

# ── Docker / ECR ─────────────────────────────────────────────

.PHONY: ecr-login build push deploy

ecr-login: ## Login Docker to ECR
	aws ecr get-login-password --region $(AWS_REGION) | \
		docker login --username AWS --password-stdin $(AWS_ACCOUNT_ID).dkr.ecr.$(AWS_REGION).amazonaws.com

build: ecr-login ## Build the gateway image for amd64
	docker buildx build --platform $(PLATFORM) \
		-f $(DOCKERFILE) \
		-t $(ECR_REPO):$(TAG) \
		-t $(ECR_REPO):latest \
		$(BUILD_CONTEXT)

push: ecr-login ## Build and push the gateway image to ECR
	docker buildx build --platform $(PLATFORM) \
		-f $(DOCKERFILE) \
		-t $(ECR_REPO):$(TAG) \
		-t $(ECR_REPO):latest \
		--push \
		$(BUILD_CONTEXT)
	@echo ""
	@echo "Pushed: $(ECR_REPO):$(TAG)"
	@echo "Pushed: $(ECR_REPO):latest"

deploy: push rolling-restart-assigned rotate-spares ## Build, push, restart assigned instances, and refresh spare pool
	@echo "Deploy complete."

# ── Instance Pool ────────────────────────────────────────────

.PHONY: pool-status rotate-pool rotate-spares rolling-restart-assigned terminate-pool

pool-status: ## Show all OpenClaw EC2 instances and their status
	@aws ec2 describe-instances --region $(AWS_REGION) \
		--filters "Name=tag:Name,Values=openclaw-user-instance" \
		         "Name=instance-state-name,Values=pending,running" \
		--query 'Reservations[*].Instances[*].[InstanceId,PublicIpAddress,Tags[?Key==`Status`].Value|[0],Tags[?Key==`UserId`].Value|[0],LaunchTime]' \
		--output table

rotate-pool: ## Terminate ALL pool instances (assigned + available) so fresh ones launch with new image
	@echo "Terminating all pool instances..."
	@INSTANCE_IDS=$$(aws ec2 describe-instances --region $(AWS_REGION) \
		--filters "Name=tag:Name,Values=openclaw-user-instance" \
		         "Name=instance-state-name,Values=pending,running" \
		--query 'Reservations[*].Instances[*].InstanceId' \
		--output text); \
	if [ -z "$$INSTANCE_IDS" ]; then \
		echo "No instances to terminate."; \
	else \
		echo "Terminating: $$INSTANCE_IDS"; \
		aws ec2 terminate-instances --region $(AWS_REGION) --instance-ids $$INSTANCE_IDS --output text; \
		echo "Done. New instances will launch from the pool manager on next request."; \
	fi

rotate-spares: ## Terminate only spare (unassigned) pool instances so replacements boot on latest image
	@echo "Terminating spare pool instances (Status=available|initializing)..."
	@INSTANCE_IDS=$$(aws ec2 describe-instances --region $(AWS_REGION) \
		--filters "Name=tag:Name,Values=openclaw-user-instance" \
		         "Name=tag:Status,Values=available,initializing" \
		         "Name=instance-state-name,Values=pending,running" \
		--query 'Reservations[*].Instances[*].InstanceId' \
		--output text); \
	if [ -z "$$INSTANCE_IDS" ]; then \
		echo "No spare instances to terminate."; \
	else \
		echo "Terminating spares: $$INSTANCE_IDS"; \
		aws ec2 terminate-instances --region $(AWS_REGION) --instance-ids $$INSTANCE_IDS --output text; \
		echo "Done. Spare pool will repopulate with latest image."; \
	fi

rolling-restart-assigned: ## Restart gateway container on assigned instances (preserves /tmp/.openclaw via host mount)
	@set -e; \
	INSTANCE_IDS=$$(aws ec2 describe-instances --region $(AWS_REGION) \
		--filters "Name=tag:Name,Values=openclaw-user-instance" \
		         "Name=tag:Status,Values=assigned" \
		         "Name=instance-state-name,Values=running" \
		--query 'Reservations[*].Instances[*].InstanceId' \
		--output text); \
	if [ -z "$$INSTANCE_IDS" ]; then \
		echo "No assigned instances to restart."; \
	else \
		for INSTANCE_ID in $$INSTANCE_IDS; do \
			echo "Rolling restart on $$INSTANCE_ID"; \
			$(MAKE) --no-print-directory container-restart INSTANCE=$$INSTANCE_ID; \
		done; \
	fi

terminate-pool: rotate-pool ## Alias for rotate-pool

# ── Instance Debugging ───────────────────────────────────────

.PHONY: logs ssm container-restart

INSTANCE ?= $(shell aws ec2 describe-instances --region $(AWS_REGION) \
		--filters "Name=tag:Name,Values=openclaw-user-instance" \
		         "Name=tag:Status,Values=assigned" \
		         "Name=instance-state-name,Values=running" \
		--query 'Reservations[0].Instances[0].InstanceId' \
		--output text 2>/dev/null)

logs: ## Tail gateway container logs (INSTANCE=i-xxx or auto-picks assigned)
	@echo "Instance: $(INSTANCE)"
	@aws ssm send-command --instance-ids $(INSTANCE) \
		--document-name "AWS-RunShellScript" \
		--parameters 'commands=["docker logs openclaw-gateway --tail 300 2>&1"]' \
		--region $(AWS_REGION) --output json --query 'Command.CommandId' | \
	xargs -I{} sh -c 'sleep 5 && aws ssm get-command-invocation \
		--command-id {} --instance-id $(INSTANCE) \
		--region $(AWS_REGION) --query StandardOutputContent --output text'

ssm: ## Open an SSM session to the instance (INSTANCE=i-xxx or auto-picks assigned)
	aws ssm start-session --target $(INSTANCE) --region $(AWS_REGION)

container-restart: ## Pull latest image and restart the container on a single instance
	@echo "Restarting container on $(INSTANCE)..."
	@aws ssm send-command --instance-ids $(INSTANCE) \
		--document-name "AWS-RunShellScript" \
		--parameters 'commands=["aws ecr get-login-password --region $(AWS_REGION) | docker login --username AWS --password-stdin $(AWS_ACCOUNT_ID).dkr.ecr.$(AWS_REGION).amazonaws.com && docker pull $(ECR_REPO):latest && STATE_DIR=/var/lib/openclaw/state && WORKSPACE_DIR=/var/lib/openclaw/workspace && mkdir -p $$STATE_DIR $$WORKSPACE_DIR && chown -R 1000:1000 /var/lib/openclaw && docker stop openclaw-gateway >/dev/null 2>&1 || true && docker rm openclaw-gateway >/dev/null 2>&1 || true && IMDS_TOKEN=$$(curl -s -X PUT \"http://169.254.169.254/latest/api/token\" -H \"X-aws-ec2-metadata-token-ttl-seconds: 300\") && INSTANCE_ID=$$(curl -s -H \"X-aws-ec2-metadata-token: $$IMDS_TOKEN\" http://169.254.169.254/latest/meta-data/instance-id) && GATEWAY_TOKEN=$$(aws secretsmanager get-secret-value --region $(AWS_REGION) --secret-id openclaw/instance/$$INSTANCE_ID/gateway-token --query SecretString --output text) && SECRETS=$$(aws secretsmanager get-secret-value --region $(AWS_REGION) --secret-id openclaw/platform-credentials --query SecretString --output text) && ANTHROPIC_API_KEY=$$(echo $$SECRETS | jq -r \".ANTHROPIC_API_KEY // empty\") && OPENAI_API_KEY=$$(echo $$SECRETS | jq -r \".OPENAI_API_KEY // empty\") && GEMINI_API_KEY=$$(echo $$SECRETS | jq -r \".GEMINI_API_KEY // empty\") && HOSTED_USAGE_REPORT_URL=$$(echo $$SECRETS | jq -r \".HOSTED_USAGE_REPORT_URL // empty\") && USAGE_SERVICE_KEY=$$(echo $$SECRETS | jq -r \".USAGE_SERVICE_KEY // empty\") && docker run -d --name openclaw-gateway --restart=always -p 8080:8080 -v $$STATE_DIR:/tmp/.openclaw -v $$WORKSPACE_DIR:/home/node/.openclaw/workspace -e OPENCLAW_GATEWAY_TOKEN=$$GATEWAY_TOKEN -e ANTHROPIC_API_KEY=$$ANTHROPIC_API_KEY -e OPENAI_API_KEY=$$OPENAI_API_KEY -e GEMINI_API_KEY=$$GEMINI_API_KEY -e HOSTED_USAGE_REPORT_URL=$$HOSTED_USAGE_REPORT_URL -e USAGE_SERVICE_KEY=$$USAGE_SERVICE_KEY -e OPENCLAW_CONFIG_PATH=/app/hosted-config.json -e OPENCLAW_STATE_DIR=/tmp/.openclaw -e PORT=8080 -e NODE_ENV=production $(ECR_REPO):latest"]' \
		--region $(AWS_REGION) --output json --query 'Command.CommandId' | \
	xargs -I{} sh -c 'sleep 15 && aws ssm get-command-invocation \
		--command-id {} --instance-id $(INSTANCE) \
		--region $(AWS_REGION) --query "[Status,StandardOutputContent]" --output json'

# ── Terraform ────────────────────────────────────────────────

.PHONY: tf-plan tf-apply

tf-plan: ## Terraform plan
	terraform -chdir=infrastructure/terraform plan

tf-apply: ## Terraform apply
	terraform -chdir=infrastructure/terraform apply

# ── Session Logs ─────────────────────────────────────────────

.PHONY: session-logs

session-logs: ## Dump agent session logs from the assigned instance
	@echo "Instance: $(INSTANCE)"
	@aws ssm send-command --instance-ids $(INSTANCE) \
		--document-name "AWS-RunShellScript" \
		--parameters 'commands=["docker exec openclaw-gateway sh -c \"find /tmp/.openclaw/agents -name *.jsonl -exec echo === {} === \\; -exec tail -50 {} \\; 2>/dev/null || echo no sessions\""]' \
		--region $(AWS_REGION) --output json --query 'Command.CommandId' | \
	xargs -I{} sh -c 'sleep 5 && aws ssm get-command-invocation \
		--command-id {} --instance-id $(INSTANCE) \
		--region $(AWS_REGION) --query StandardOutputContent --output text'


















# ── Local E2E (Web + Gateway + Usage/Supabase checks) ───────────────────────

.PHONY: local-check-env local-web-up local-web-down local-web-logs \
	local-image-build local-gateway-up local-gateway-down local-gateway-logs \
	local-gateway-debug-logs local-debug \
	local-up local-down local-usage-smoke local-usage-smoke-from-container \
	local-supabase-tail local-verify

local-check-env: ## Validate required local env vars and inputs
	@zsh -lc '\
		if [ ! -f "$(LOCAL_ENV_FILE)" ]; then \
			echo "Missing env file: $(LOCAL_ENV_FILE)"; \
			exit 1; \
		fi; \
		set -a; source "$(LOCAL_ENV_FILE)"; set +a; \
		: "$${USAGE_SERVICE_KEY:?USAGE_SERVICE_KEY missing in $(LOCAL_ENV_FILE)}"; \
		: "$${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY missing in $(LOCAL_ENV_FILE)}"; \
		: "$${NEXT_PUBLIC_SUPABASE_URL:?NEXT_PUBLIC_SUPABASE_URL missing in $(LOCAL_ENV_FILE)}"; \
		if [ -z "$(LOCAL_INSTANCE_ID)" ]; then \
			echo "Set LOCAL_INSTANCE_ID=<instances.id UUID> when invoking make"; \
			exit 1; \
		fi; \
		echo "Local env looks good."; \
	'

local-web-up: ## Start Next.js web app in background on LOCAL_WEB_PORT
	@mkdir -p "$(LOCAL_TMP_DIR)"
	@zsh -lc '\
		if [ -f "$(LOCAL_TMP_DIR)/local-web.pid" ] && kill -0 $$(cat "$(LOCAL_TMP_DIR)/local-web.pid") 2>/dev/null; then \
			echo "Web already running (pid $$(cat "$(LOCAL_TMP_DIR)/local-web.pid"))"; \
			exit 0; \
		fi; \
		if ! node -e "const m=parseInt(process.versions.node.split(\".\")[0],10);process.exit(m>=20?0:1)"; then \
			echo "Next.js requires Node >=20. Current: $$(node -v 2>/dev/null || echo missing) at $$(which node 2>/dev/null || echo node-not-found)"; \
			exit 1; \
		fi; \
		cd "$(LOCAL_WEB_DIR)"; \
		LOCAL_GATEWAY_URL="$(LOCAL_GATEWAY_URL)" \
		LOCAL_GATEWAY_INSTANCE_ID="$(LOCAL_INSTANCE_ID)" \
		LOCAL_GATEWAY_TOKEN="$(LOCAL_GATEWAY_TOKEN)" \
		nohup npm run dev -- --hostname 127.0.0.1 --port $(LOCAL_WEB_PORT) > "../../$(LOCAL_TMP_DIR)/local-web.log" 2>&1 & \
		WEB_PID=$$!; \
		echo $$WEB_PID > "../../$(LOCAL_TMP_DIR)/local-web.pid"; \
		sleep 2; \
		if ! kill -0 $$WEB_PID 2>/dev/null; then \
			echo "Web failed to start. Recent logs:"; \
			tail -n 80 "../../$(LOCAL_TMP_DIR)/local-web.log" || true; \
			rm -f "../../$(LOCAL_TMP_DIR)/local-web.pid"; \
			exit 1; \
		fi; \
		echo "Started web on $(LOCAL_WEB_URL) (pid $$WEB_PID) with $$(node -v)"; \
		echo "Gateway override for local web API: LOCAL_GATEWAY_URL=$(LOCAL_GATEWAY_URL)"; \
	'

local-web-down: ## Stop background Next.js web app
	@zsh -lc '\
		if [ -f "$(LOCAL_TMP_DIR)/local-web.pid" ]; then \
			kill $$(cat "$(LOCAL_TMP_DIR)/local-web.pid") 2>/dev/null || true; \
			rm -f "$(LOCAL_TMP_DIR)/local-web.pid"; \
			echo "Stopped web"; \
		else \
			echo "Web pid file not found"; \
		fi; \
	'

local-web-logs: ## Tail local Next.js web logs
	@mkdir -p "$(LOCAL_TMP_DIR)"
	@touch "$(LOCAL_TMP_DIR)/local-web.log"
	@tail -f "$(LOCAL_TMP_DIR)/local-web.log"

local-image-build: ## Build local hosted gateway image
	docker build -f infrastructure/Dockerfile -t $(LOCAL_GATEWAY_IMAGE) ..

local-gateway-up: local-check-env ## Run local gateway container with billing env vars
	@zsh -lc '\
		set -a; source "$(LOCAL_ENV_FILE)"; set +a; \
		docker rm -f "$(LOCAL_GATEWAY_CONTAINER)" >/dev/null 2>&1 || true; \
		CONTAINER_ID=$$(docker run -d --name "$(LOCAL_GATEWAY_CONTAINER)" \
			--restart=unless-stopped \
			-p $(LOCAL_GATEWAY_PORT):8080 \
			-e OPENCLAW_GATEWAY_TOKEN="$(LOCAL_GATEWAY_TOKEN)" \
			-e ANTHROPIC_API_KEY="$${ANTHROPIC_API_KEY:-}" \
			-e OPENAI_API_KEY="$${OPENAI_API_KEY:-}" \
			-e GEMINI_API_KEY="$${GEMINI_API_KEY:-}" \
			-e INSTANCE_ID="$(LOCAL_INSTANCE_ID)" \
			-e HOSTED_USAGE_REPORT_URL="$(LOCAL_USAGE_REPORT_URL)" \
			-e USAGE_SERVICE_KEY="$${USAGE_SERVICE_KEY}" \
			-e OPENCLAW_CONFIG_PATH=/app/hosted-config.json \
			-e OPENCLAW_STATE_DIR=/tmp/.openclaw \
			-e OPENCLAW_CACHE_TRACE="$${OPENCLAW_CACHE_TRACE:-}" \
			-e OPENCLAW_CACHE_TRACE_FILE="$(LOCAL_GATEWAY_CACHE_TRACE_FILE)" \
			-e OPENCLAW_CACHE_TRACE_MESSAGES="$${OPENCLAW_CACHE_TRACE_MESSAGES:-}" \
			-e OPENCLAW_CACHE_TRACE_PROMPT="$${OPENCLAW_CACHE_TRACE_PROMPT:-}" \
			-e OPENCLAW_CACHE_TRACE_SYSTEM="$${OPENCLAW_CACHE_TRACE_SYSTEM:-}" \
			-e OPENCLAW_ANTHROPIC_PAYLOAD_LOG="$${OPENCLAW_ANTHROPIC_PAYLOAD_LOG:-}" \
			-e OPENCLAW_ANTHROPIC_PAYLOAD_LOG_FILE="$(LOCAL_GATEWAY_ANTHROPIC_PAYLOAD_LOG_FILE)" \
			-e PORT=8080 \
			-e NODE_ENV=production \
			"$(LOCAL_GATEWAY_IMAGE)"); \
		if [ -z "$$CONTAINER_ID" ]; then \
			echo "Failed to start gateway container"; \
			exit 1; \
		fi; \
		sleep 2; \
		if ! docker ps --format "{{.Names}}" | grep -qx "$(LOCAL_GATEWAY_CONTAINER)"; then \
			echo "Gateway container exited early. Logs:"; \
			docker logs --tail 120 "$(LOCAL_GATEWAY_CONTAINER)" || true; \
			exit 1; \
		fi; \
		HEALTH_OK=0; \
		for i in $$(seq 1 15); do \
			if curl -fsS "$(LOCAL_GATEWAY_URL)/health" >/dev/null 2>&1 || \
			   curl -fsS "$(LOCAL_GATEWAY_URL)/" >/dev/null 2>&1; then \
				HEALTH_OK=1; \
				break; \
			fi; \
			sleep 1; \
		done; \
		if [ $$HEALTH_OK -ne 1 ]; then \
			echo "Gateway health check failed at $(LOCAL_GATEWAY_URL). Logs:"; \
			docker logs --tail 120 "$(LOCAL_GATEWAY_CONTAINER)" || true; \
			exit 1; \
		fi; \
		echo "Started gateway container $(LOCAL_GATEWAY_CONTAINER) on $(LOCAL_GATEWAY_URL)"; \
	'

local-gateway-down: ## Stop and remove local gateway container
	@docker rm -f "$(LOCAL_GATEWAY_CONTAINER)" >/dev/null 2>&1 || true
	@echo "Stopped gateway container $(LOCAL_GATEWAY_CONTAINER)"

local-gateway-logs: ## Tail local gateway logs
	@docker logs -f "$(LOCAL_GATEWAY_CONTAINER)"

local-gateway-debug-logs: ## Tail cache trace + anthropic payload logs from inside gateway container
	@docker exec -it "$(LOCAL_GATEWAY_CONTAINER)" sh -lc '\
		mkdir -p /tmp/.openclaw/logs; \
		touch /tmp/.openclaw/logs/cache-trace.jsonl /tmp/.openclaw/logs/anthropic-payload.jsonl; \
		tail -n 40 -f /tmp/.openclaw/logs/cache-trace.jsonl /tmp/.openclaw/logs/anthropic-payload.jsonl \
	'

local-debug: ## Bring stack up with cache debug env and tail gateway/web/cache logs
	@OPENCLAW_CACHE_TRACE=1 \
	OPENCLAW_CACHE_TRACE_MESSAGES=1 \
	OPENCLAW_CACHE_TRACE_PROMPT=1 \
	OPENCLAW_CACHE_TRACE_SYSTEM=1 \
	OPENCLAW_ANTHROPIC_PAYLOAD_LOG=1 \
	"$(CURDIR)/scripts/local-debug.sh" "$(LOCAL_INSTANCE_ID)"

local-up: local-check-env local-web-up local-image-build local-gateway-up ## Bring up local web + gateway stack
	@echo "Local stack is up."
	@echo "Web: $(LOCAL_WEB_URL)"
	@echo "Gateway: $(LOCAL_GATEWAY_URL)"

local-down: local-gateway-down local-web-down ## Tear down local web + gateway stack
	@echo "Local stack is down."

local-usage-smoke: local-check-env ## POST one usage event to local web route
	@zsh -lc '\
		set -a; source "$(LOCAL_ENV_FILE)"; set +a; \
		curl -sS -X POST "$(LOCAL_WEB_URL)/api/usage/events" \
			-H "Authorization: Bearer $${USAGE_SERVICE_KEY}" \
			-H "Content-Type: application/json" \
			-d "{\"events\":[{\"instanceId\":\"$(LOCAL_INSTANCE_ID)\",\"provider\":\"anthropic\",\"modelId\":\"$(LOCAL_SMOKE_MODEL_ID)\",\"inputTokens\":123,\"outputTokens\":45}]}" \
			; echo ""; \
	'

local-usage-smoke-from-container: local-check-env ## POST usage event from inside gateway container
	@docker exec "$(LOCAL_GATEWAY_CONTAINER)" sh -lc '\
		curl -sS -X POST "$$HOSTED_USAGE_REPORT_URL" \
			-H "Authorization: Bearer $$USAGE_SERVICE_KEY" \
			-H "Content-Type: application/json" \
			-d "{\"events\":[{\"instanceId\":\"$$INSTANCE_ID\",\"provider\":\"anthropic\",\"modelId\":\"$(LOCAL_SMOKE_MODEL_ID)\",\"inputTokens\":321,\"outputTokens\":54}]}" \
			; echo ""; \
	'

local-supabase-tail: local-check-env ## Show recent usage_events rows for LOCAL_INSTANCE_ID
	@zsh -lc '\
		set -a; source "$(LOCAL_ENV_FILE)"; set +a; \
		curl -sS "$${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/usage_events?select=instance_id,user_id,model_id,input_tokens,output_tokens,cost_usd,created_at&instance_id=eq.$(LOCAL_INSTANCE_ID)&order=created_at.desc&limit=10" \
			-H "apikey: $${SUPABASE_SERVICE_ROLE_KEY}" \
			-H "Authorization: Bearer $${SUPABASE_SERVICE_ROLE_KEY}" \
			-H "Content-Type: application/json" \
			; echo ""; \
	'

local-verify: local-usage-smoke local-usage-smoke-from-container local-supabase-tail ## Run full local usage ingestion verification
	@echo "Local usage verification complete."

# ── Help ─────────────────────────────────────────────────────

.PHONY: help
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

.DEFAULT_GOAL := help
