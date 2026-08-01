import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScan: (text: string) => void;
};

export function ScannerDialog({ open, onOpenChange, onScan }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let stopped = false;
    let controls: { stop: () => void } | null = null;

    (async () => {
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        const reader = new BrowserMultiFormatReader();
        const result = await reader.decodeFromVideoDevice(
          undefined,
          videoRef.current ?? undefined,
          (res) => {
            if (res && !stopped) {
              stopped = true;
              onScan(res.getText());
            }
          },
        );
        controls = result;
        if (stopped) result.stop();
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Could not start the camera. Allow camera access and try again.",
        );
      }
    })();

    return () => {
      stopped = true;
      controls?.stop();
    };
  }, [open, onScan]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Scan student QR code</DialogTitle>
          <DialogDescription>
            Point the camera at a student badge. Attendance is marked automatically.
          </DialogDescription>
        </DialogHeader>
        <div className="overflow-hidden rounded-xl border bg-muted">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video ref={videoRef} className="aspect-square w-full object-cover" muted playsInline />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Close
        </Button>
      </DialogContent>
    </Dialog>
  );
}
