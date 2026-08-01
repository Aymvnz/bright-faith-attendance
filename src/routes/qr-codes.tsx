import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import QRCode from "qrcode";

import { useAuth } from "@/hooks/useAuth";
import { getRoster, type Student } from "@/lib/roster.functions";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/qr-codes")({
  head: () => ({
    meta: [
      { title: "Student QR Codes | Chicago Downtown REC Attendance" },
      {
        name: "description",
        content: "Generate and print a QR code badge for every student on your Google Sheets roster.",
      },
      { property: "og:title", content: "Student QR Codes | Chicago Downtown REC Attendance" },
      {
        property: "og:description",
        content: "Print a QR badge for every student so attendance can be scanned at the door.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: QrCodesPage,
});

function StudentBadge({ student }: { student: Student }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    QRCode.toDataURL(student.id, { margin: 1, width: 240 }).then(setSrc).catch(() => setSrc(""));
  }, [student.id]);

  return (
    <div className="flex break-inside-avoid flex-col items-center gap-2 rounded-xl border bg-card p-4 text-center">
      {src && <img src={src} alt={`QR code for ${student.name}`} className="size-36" />}
      <div className="font-medium">{student.name}</div>
      <div className="text-xs text-muted-foreground">{student.id}</div>
      {student.group && <div className="text-xs text-muted-foreground">{student.group}</div>}
    </div>
  );
}

function QrCodesPage() {
  const { session, loading } = useAuth();
  const rosterFn = useServerFn(getRoster);
  const rosterQuery = useQuery({
    queryKey: ["roster-print"],
    enabled: !!session,
    queryFn: () => rosterFn({}),
  });

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Loading…</div>;
  }
  if (!session) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Please sign in to view student QR codes.</p>
        <Button asChild>
          <Link to="/">Go to sign in</Link>
        </Button>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-secondary">
      <header className="bg-primary text-primary-foreground print:hidden">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-4">
          <h1 className="text-lg font-semibold">Student QR codes</h1>
          <div className="ml-auto flex gap-2">
            <Button asChild variant="secondary" size="sm">
              <Link to="/">Back to dashboard</Link>
            </Button>
            <Button variant="secondary" size="sm" onClick={() => window.print()}>
              Print
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        {rosterQuery.isPending && <p className="text-muted-foreground">Loading roster…</p>}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {(rosterQuery.data?.students ?? []).map((s) => (
            <StudentBadge key={s.id} student={s} />
          ))}
        </div>
      </main>
    </div>
  );
}
