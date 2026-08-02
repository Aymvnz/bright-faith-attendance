import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { readRoster, type RosterResult, type Student } from "./roster-core.server";

export type { RosterResult, Student };

export const getRoster = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RosterResult> => readRoster(context.supabase));