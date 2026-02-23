import { requireAdmin } from "@/lib/admin/require-admin";
import { logAdminAction } from "@/lib/admin/audit";
import { getEC2PoolManager } from "@/lib/aws/ec2-pool";
import { NextResponse } from "next/server";

// GET /api/admin/infra/pool - EC2 pool status
export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) {return auth.error;}

  try {
    const pool = getEC2PoolManager();
    const instances = await pool.getPoolInstances();
    const stats = {
      total: instances.length,
      available: instances.filter((i) => i.status === "available").length,
      assigned: instances.filter((i) => i.status === "assigned").length,
      initializing: instances.filter((i) => i.status === "initializing").length,
    };

    return NextResponse.json({ stats, instances });
  } catch (err) {
    console.error("[admin/infra/pool] Error:", err);
    return NextResponse.json(
      { error: "Failed to fetch pool status: " + (err instanceof Error ? err.message : "Unknown error") },
      { status: 500 }
    );
  }
}

// POST /api/admin/infra/pool - Replenish pool
export async function POST() {
  const auth = await requireAdmin();
  if (auth.error) {return auth.error;}

  try {
    const pool = getEC2PoolManager();
    await pool.maintainPool();

    await logAdminAction(auth.user.id, "infra.pool_replenish");

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[admin/infra/pool] Replenish error:", err);
    return NextResponse.json(
      { error: "Failed to replenish pool: " + (err instanceof Error ? err.message : "Unknown error") },
      { status: 500 }
    );
  }
}
