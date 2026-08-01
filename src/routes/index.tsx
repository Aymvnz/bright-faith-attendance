import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { format } from "date-fns";
import { QrCode, RefreshCw, Settings, LogOut, ScanLine, CalendarIcon } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { getRoster } from "@/lib/roster.functions";
import { syncAttendanceToSheet } from "@/lib/sheet-sync.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScannerDialog } from "@/components/ScannerDialog";
import { SettingsDialog, type ProgramSettings } from "@/components/SettingsDialog";


export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Chicago Downtown REC Attendance Dashboard" },
      {
        name: "description",
        content:
          "Scan student QR codes to mark attendance, with the roster synced live from your program's Google Sheet.",
      },
      { property: "og:title", content: "Chicago Downtown REC Attendance Dashboard" },
      {
        property: "og:description",
        content: "QR-code attendance tracking with a roster synced from Google Sheets.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

const todayKey = () => new Date().toLocaleDateString("en-CA");
function LiveClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return <span>{now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })}</span>;
}
type AttendanceRow = {
  id: string;
  student_id: string;
  student_name: string;
  status: string;
  scanned_at: string;
};

function SignIn() {
  const [busy, setBusy] = useState(false);
  const signIn = async () => {
    setBusy(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin,
      },
    });
    if (error) {
      setBusy(false);
      toast.error("Sign-in failed. Please try again.");
    }
    // On success, Supabase redirects the browser to Google, so no further
    // action is needed here — useAuth() picks up the session on return.
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-secondary px-4">
      <Card className="w-full max-w-md shadow-[var(--shadow-card)]">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <QrCode className="size-7" />
          </div>
          <CardTitle className="text-2xl">Chicago Downtown REC Attendance</CardTitle>
          <p className="text-sm text-muted-foreground">
            Sign in with your Google account to manage the religious education roster.
          </p>
        </CardHeader>
        <CardContent>
          <Button className="w-full" size="lg" onClick={signIn} disabled={busy}>
            {busy ? "Opening Google…" : "Continue with Google"}
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}

function statusFor(cutoff: string) {
  const now = new Date();
  const [h, m] = cutoff.split(":");
  const limit = new Date(now);
  limit.setHours(Number(h ?? 10), Number(m ?? 30), 0, 0);
  return now > limit ? "tardy" : "present";
}

function Home() {
  const { session, loading } = useAuth();
  const queryClient = useQueryClient();
  const rosterFn = useServerFn(getRoster);
  const syncSheetFn = useServerFn(syncAttendanceToSheet);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [exportDate, setExportDate] = useState<Date | undefined>();
  const [dateOpen, setDateOpen] = useState(false);
  const [search, setSearch] = useState("");


  const settingsQuery = useQuery({
    queryKey: ["settings"],
    enabled: !!session,
    queryFn: async (): Promise<ProgramSettings | null> => {
      const { data, error } = await supabase
        .from("program_settings")
        .select("id, spreadsheet_id, sheet_range, tardy_after")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const rosterQuery = useQuery({
    queryKey: ["roster", settingsQuery.data?.spreadsheet_id, settingsQuery.data?.sheet_range],
    enabled: !!session && !!settingsQuery.data,
    queryFn: () => rosterFn({}),
  });

  const attendanceQuery = useQuery({
    queryKey: ["attendance", todayKey()],
    enabled: !!session,
    queryFn: async (): Promise<AttendanceRow[]> => {
      const { data, error } = await supabase
        .from("attendance_records")
        .select("id, student_id, student_name, status, scanned_at")
        .eq("session_date", todayKey());
      if (error) throw error;
      return data ?? [];
    },
  });

  const students = rosterQuery.data?.students ?? [];
  const attendance = useMemo(() => {
    const map = new Map<string, AttendanceRow>();
    for (const row of attendanceQuery.data ?? []) map.set(row.student_id, row);
    return map;
  }, [attendanceQuery.data]);

  const pushToSheet = useCallback(
    async (announce: boolean, sessionDate: string = todayKey()) => {
      setSyncing(true);
      try {
        const result = await syncSheetFn({ data: { sessionDate } });
        if (!result.ok) {
          toast.error(result.error ?? "Could not update the sheet.");
          return;
        }
        if (announce) {
          toast.success(
            `Sheet tab "${result.tab}" updated (${result.updated} of ${result.matched} rows changed).`,
          );
        }
      } catch {
        toast.error("Could not update the Google Sheet.");
      } finally {
        setSyncing(false);
      }
    },
    [syncSheetFn],
  );


  const mark = useCallback(
    async (studentId: string, studentName: string, status: string) => {
      const { error } = await supabase.from("attendance_records").upsert(
        {
          student_id: studentId,
          student_name: studentName,
          session_date: todayKey(),
          status,
          scanned_at: new Date().toISOString(),
          recorded_by: session?.user.id ?? null,
        },
        { onConflict: "student_id,session_date" },
      );
      if (error) {
        toast.error(error.message);
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["attendance", todayKey()] });
      toast.success(`${studentName} marked ${status}`);
      void pushToSheet(false);
    },
    [queryClient, session, pushToSheet],
  );

  const handleScan = useCallback(
    (text: string) => {
      const code = text.trim();
      const student =
        students.find((s) => s.id.toLowerCase() === code.toLowerCase()) ??
        students.find((s) => s.name.toLowerCase() === code.toLowerCase());
      if (!student) {
        toast.error(`No student in the roster matches "${code}"`);
        return;
      }
      const status = statusFor(settingsQuery.data?.tardy_after?.slice(0, 5) ?? "10:30");
      setScannerOpen(false);
      void mark(student.id, student.name, status);
    },
    [students, settingsQuery.data, mark],
  );

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Loading…</div>;
  }
  if (!session) return <SignIn />;

  const filtered = students.filter((s) =>
    (s.name + s.id + s.group).toLowerCase().includes(search.toLowerCase()),
  );
  const presentCount = [...attendance.values()].filter((a) => a.status === "present").length;
  const tardyCount = [...attendance.values()].filter((a) => a.status === "tardy").length;

  return (
    <div className="min-h-screen bg-secondary">
      <header className="bg-primary text-primary-foreground">
        <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-3 px-4 py-4 sm:grid-cols-3">
          <div className="flex items-center gap-2 font-semibold">
            <QrCode className="size-5" />
            <h1 className="text-lg">Chicago Downtown REC Attendance</h1>
          </div>
          <div className="order-last text-center font-mono text-sm tabular-nums opacity-90 sm:order-none">
            <LiveClock />
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <Button asChild variant="secondary" size="sm">
              <Link to="/qr-codes">Student QR codes</Link>
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setSettingsOpen(true)}>
              <Settings className="size-4" /> Settings
            </Button>
            <Button variant="secondary" size="sm" onClick={() => supabase.auth.signOut()}>
              <LogOut className="size-4" /> Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
        <div className="grid gap-4 sm:grid-cols-3">
          <Card className="shadow-[var(--shadow-card)]">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Roster</CardTitle>
            </CardHeader>
            <CardContent className="text-3xl font-semibold">{students.length}</CardContent>
          </Card>
          <Card className="shadow-[var(--shadow-card)]">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Present today</CardTitle>
            </CardHeader>
            <CardContent className="text-3xl font-semibold text-primary">{presentCount}</CardContent>
          </Card>
          <Card className="shadow-[var(--shadow-card)]">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Tardy today</CardTitle>
            </CardHeader>
            <CardContent className="text-3xl font-semibold text-accent">{tardyCount}</CardContent>
          </Card>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button size="lg" onClick={() => setScannerOpen(true)}>
            <ScanLine className="size-5" /> Scan QR code
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              void rosterQuery.refetch();
              void attendanceQuery.refetch();
            }}
          >
            <RefreshCw className="size-4" /> Reload roster
          </Button>
          <Button variant="outline" disabled={syncing} onClick={() => void pushToSheet(true)}>
            <RefreshCw className={`size-4 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Writing to sheet…" : "Push attendance to sheet"}
          </Button>
          <Popover open={dateOpen} onOpenChange={setDateOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" disabled={syncing}>
                <CalendarIcon className="size-4" />
                {exportDate ? format(exportDate, "MMM d, yyyy") : "Export by date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={exportDate}
                onSelect={(date) => {
                  if (!date) return;
                  setExportDate(date);
                  setDateOpen(false);
                  void pushToSheet(true, date.toLocaleDateString("en-CA"));
                }}
                initialFocus
                className="p-3 pointer-events-auto"
              />
            </PopoverContent>
          </Popover>

          <Input
            className="max-w-xs bg-card"
            placeholder="Search students…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {rosterQuery.data?.error && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {rosterQuery.data.error}
          </p>
        )}
        {settingsQuery.data && !settingsQuery.data.spreadsheet_id && (
          <p className="rounded-lg border bg-card p-3 text-sm text-muted-foreground">
            No roster sheet connected yet. Open <strong>Settings</strong> and paste your Google Sheet link.
          </p>
        )}

        <Card className="overflow-hidden shadow-[var(--shadow-card)]">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Student</th>
                <th className="px-4 py-3 font-medium">Class</th>
                <th className="px-4 py-3 font-medium">Today</th>
                <th className="px-4 py-3 text-right font-medium">Mark</th>
              </tr>
            </thead>
            <tbody>
              {rosterQuery.isPending && (
                <tr>
                  <td className="px-4 py-6 text-muted-foreground" colSpan={4}>
                    Loading roster…
                  </td>
                </tr>
              )}
              {filtered.map((student) => {
                const record = attendance.get(student.id);
                return (
                  <tr key={student.id} className="border-t">
                    <td className="px-4 py-3">
                      <div className="font-medium">{student.name}</div>
                      <div className="text-xs text-muted-foreground">{student.id}</div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{student.group || "—"}</td>
                    <td className="px-4 py-3">
                      {record ? (
                        <Badge variant={record.status === "tardy" ? "destructive" : "default"}>
                          {record.status}
                          <span className="ml-1 opacity-80">
                            {new Date(record.scanned_at).toLocaleTimeString([], {
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                          </span>
                        </Badge>
                      ) : (
                        <Badge variant="outline">not scanned</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex gap-2">
                       <Button size="sm" variant="outline" onClick={() => mark(student.id, student.name, "present")}>
                          Present
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => mark(student.id, student.name, "tardy")}>
                          Tardy
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => mark(student.id, student.name, "absent")}>
                          Absent
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => mark(student.id, student.name, "excused")}>
                          Excused
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!rosterQuery.isPending && filtered.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-muted-foreground" colSpan={4}>
                    No students to show.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      </main>

      <ScannerDialog open={scannerOpen} onOpenChange={setScannerOpen} onScan={handleScan} />
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={settingsQuery.data ?? null}
        onSaved={() => {
          void settingsQuery.refetch();
          void rosterQuery.refetch();
        }}
      />
    </div>
  );
}
