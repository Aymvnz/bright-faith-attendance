import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { syncAttendanceForDate, type SheetSyncResult } from "./attendance-sync.server";

export type { SheetSyncResult };

export const syncAttendanceToSheet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { sessionDate: string }) => input)
  .handler(async ({ data, context }): Promise<SheetSyncResult> => {
    return syncAttendanceForDate(context.supabase, data.sessionDate);
  });