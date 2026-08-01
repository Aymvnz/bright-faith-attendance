import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type ProgramSettings = {
  id: string;
  spreadsheet_id: string | null;
  sheet_range: string;
  tardy_after: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: ProgramSettings | null;
  onSaved: () => void;
};

function extractSheetId(input: string) {
  const match = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1]! : input.trim();
}

export function SettingsDialog({ open, onOpenChange, settings, onSaved }: Props) {
  const [sheet, setSheet] = useState("");
  const [range, setRange] = useState("Sheet1!A1:D500");
  const [tardy, setTardy] = useState("10:30");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setSheet(settings.spreadsheet_id ?? "");
    setRange(settings.sheet_range);
    setTardy(settings.tardy_after.slice(0, 5));
  }, [settings, open]);

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    const { error } = await supabase
      .from("program_settings")
      .update({
        spreadsheet_id: extractSheetId(sheet) || null,
        sheet_range: range.trim() || "Sheet1!A1:D500",
        tardy_after: tardy,
        updated_at: new Date().toISOString(),
      })
      .eq("id", settings.id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Settings saved");
    onSaved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Program settings</DialogTitle>
          <DialogDescription>
            Point the app at the Google Sheet holding your roster and set the tardy cutoff.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="sheet">Google Sheet link or ID</Label>
            <Input
              id="sheet"
              value={sheet}
              onChange={(e) => setSheet(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/..."
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="range">Roster range</Label>
            <Input id="range" value={range} onChange={(e) => setRange(e.target.value)} />
            <p className="text-xs text-muted-foreground">
              Include the header row. Columns are matched by name: ID, Name, Class/Group.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="tardy">Tardy after</Label>
            <Input id="tardy" type="time" value={tardy} onChange={(e) => setTardy(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save settings"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
