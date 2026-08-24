import { prisma } from "./prisma";

export type ActivityOrigin = "portal" | "api";

export const logActivity = (activity: {
  tenantId: string; tenantName?: string | null; vmId?: string | null; vmName?: string | null;
  userEmail: string; origin: ActivityOrigin; action: string; status: "ok" | "error"; detail?: string;
}) => prisma.activity.create({ data: activity });

export const listActivities = (tenantIds: string[] | null, limit = 50) => prisma.activity.findMany({
  where: tenantIds === null ? undefined : { tenantId: { in: tenantIds } },
  orderBy: { createdAt: "desc" }, take: Math.min(Math.max(limit, 1), 100),
});
