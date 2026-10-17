import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ScannerDialog } from "@/components/ScannerDialog";

type ScanResponse = {
  ok: boolean;
  error?: string;
  name?: string;
  status?: string;
  already?: boolean;
  sheetSynced?: boolean;
};

async function callScan(body: Record<string, unknown>): Promise<ScanResponse> {
  try {
    const res = await fetch("/api/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await res.json()) as ScanResponse;
  } catch {
    return { ok: false, error: "Could not reach the server. Check your connection." };
  }
}

export function PublicScan() {
  const [pinOpen, setPinOpen] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pin, setPin] = useState("");
  const [checking, setChecking] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [pending, setPending] = useState<{ code: string; name: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const lockRef = useRef(false);

  const openScanner = () => {
    if (pin) setScannerOpen(true);
    else setPinOpen(true);
  };

  const submitPin = async () => {
    setChecking(true);
    const result = await callScan({ action: "check", pin: pinInput });
    setChecking(false);
    if (!result.ok) {
      toast.error(result.error ?? "Incorrect PIN.");
      return;
    }
    setPin(pinInput);
    setPinInput("");
    setPinOpen(false);
    setScannerOpen(true);
  };

  // lockRef (not state) keeps this function's identity stable, so the
  // camera isn't restarted every time a scan comes in.
  const handleScan = useCallback(
    async (text: string) => {
      if (lockRef.current) return;
      lockRef.current = true;
      const result = await callScan({ action: "lookup", pin, code: text });
      if (!result.ok || !result.name) {
        toast.error(result.error ?? "That code isn't recognized.");
        lockRef.current = false;
        return;
      }
      setPending({ code: text, name: result.name });
    },
    [pin],
  );

  const closePending = () => {
    setPending(null);
    lockRef.current = false;
  };

  const confirm = async () => {
    if (!pending) return;
    setSaving(true);
    const result = await callScan({ action: "mark", pin, code: pending.code });
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error ?? "Could not save attendance.");
    } else if (result.already) {
      toast.info(`${result.name} is already marked ${result.status}.`);
    } else {
      toast.success(`${result.name} marked ${result.status}.`);
    }
    closePending();
  };

  return (
    <>
      <Button className="w-full" variant="outline" size="lg" onClick={openScanner}>
        <ScanLine className="size-5" /> Scan attendance (no sign-in)
      </Button>

      <Dialog open={pinOpen} onOpenChange={setPinOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Enter scanner PIN</DialogTitle>
            <DialogDescription>Ask the program admin for the scanner PIN.</DialogDescription>
          </DialogHeader>
          <Input
            type="password"
            autoComplete="off"
            placeholder="PIN"
            value={pinInput}
            onChange={(e) => setPinInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submitPin();
            }}
          />
          <Button size="lg" onClick={() => void submitPin()} disabled={checking || !pinInput}>
            {checking ? "Checking…" : "Continue"}
          </Button>
        </DialogContent>
      </Dialog>

      <ScannerDialog
        open={scannerOpen}
        onOpenChange={(open) => {
          setScannerOpen(open);
          if (!open) lockRef.current = false;
        }}
        onScan={handleScan}
      />

      <Dialog
        open={!!pending}
        onOpenChange={(open) => {
          if (!open) closePending();
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirm attendance</DialogTitle>
            <DialogDescription>
              Would you like to update attendance for {pending?.name}?
            </DialogDescription>
          </DialogHeader>
          <Button size="lg" onClick={() => void confirm()} disabled={saving}>
            {saving ? "Saving…" : "Confirm"}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}