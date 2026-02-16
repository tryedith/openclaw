# Fix: Use WebSocket connection as gateway readiness signal

## Problem

When a new instance is created (no pre-warmed pool), the frontend navigates to the dashboard immediately. The dashboard fires `fetchModels()` and `fetchHistory()` when `instance.status === "running"`, but the ALB hasn't marked the target healthy yet, so these calls fail with 502/404. The user sees "Failed to load models" and empty history permanently.

The WebSocket connection (`connectLiveSocket`) already retries every 3s via `scheduleReconnect()`. Once the WebSocket `connect` response succeeds, `liveConnected` is set to `true` (line 620 of `use-dashboard-chat.ts`). This is a confirmed signal that the gateway is reachable — REST API calls will work too.

## Changes

### 1. `hosted/apps/web/src/app/dashboard/use-dashboard-chat.ts`

#### Gate `fetchModels` on `liveConnected`

Current (line 464-468):
```typescript
useEffect(() => {
  if (instance?.status === "running" && instance?.id) {
    void fetchModels(instance.id);
  }
}, [instance?.status, instance?.id]);
```

Change to:
```typescript
useEffect(() => {
  if (instance?.status === "running" && instance?.id && liveConnected) {
    void fetchModels(instance.id);
  }
}, [instance?.status, instance?.id, liveConnected]);
```

#### Gate initial `fetchHistory` on `liveConnected`

Current (line 458-462):
```typescript
useEffect(() => {
  if (instance?.status === "running" && instance?.id && !historyLoaded) {
    void fetchHistory(instance.id, { showLoader: true });
  }
}, [instance?.status, instance?.id, historyLoaded]);
```

Change to:
```typescript
useEffect(() => {
  if (instance?.status === "running" && instance?.id && liveConnected && !historyLoaded) {
    void fetchHistory(instance.id, { showLoader: true });
  }
}, [instance?.status, instance?.id, liveConnected, historyLoaded]);
```

### 2. `hosted/apps/web/src/lib/aws/instance-client.ts` — faster ALB health check

In `createTargetGroup()` (lines 178-181):

```typescript
// Before:
HealthCheckIntervalSeconds: 30,
HealthCheckTimeoutSeconds: 5,
HealthyThresholdCount: 2,

// After:
HealthCheckIntervalSeconds: 5,
HealthCheckTimeoutSeconds: 3,
HealthyThresholdCount: 1,
```

This makes the ALB mark the target as healthy in ~5s instead of ~60s.

## How it works end-to-end

1. User clicks "Create Bot" → instance created, status = "running"
2. Dashboard mounts, WebSocket `connectLiveSocket()` starts
3. WebSocket retries every 3s until ALB routes traffic to healthy target
4. Gateway responds to WebSocket `connect` → `liveConnected = true`
5. Effects fire: `fetchModels()` and `fetchHistory()` called — gateway is confirmed reachable, calls succeed
6. Dashboard populates with models and history

No hardcoded timeouts. No polling. A real signal from the actual gateway.

## Verification

1. Terminate all pre-warmed instances, click "Create Bot"
2. Dashboard shows "Reconnecting to gateway" for ~10-15s
3. Once WebSocket connects → models and history load immediately, no errors
4. With pre-warmed instance → same flow, just faster (~5s)
