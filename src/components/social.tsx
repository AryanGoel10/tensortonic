"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { markSocialSent } from "@/app/actions/review";
import type { Prospect } from "@/lib/sheets/mapping";

export function httpsUrl(u: string) {
  const s = u.trim();
  if (!s) return "";
  return /^https?:\/\//i.test(s) ? s.replace(/^http:\/\//i, "https://") : `https://${s}`;
}

export function xState(p: Prospect): { url: string; blocked: string | null } {
  const url = httpsUrl(p.ai["AI Person X URL"] ?? "");
  const conf = (p.ai["AI X Confidence"] ?? "").toLowerCase();
  if (!url) return { url, blocked: "No personal X profile found. Paste one to enable." };
  if (conf === "low") return { url, blocked: "Low-confidence match. Check the profile and confirm it first." };
  return { url, blocked: null };
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Copy-and-open + mark-sent buttons for LinkedIn and X (Pratham sends these by hand). */
export function SocialButtons({ sheet, tab, p, onChange, compact }: { sheet: string; tab: string; p: Prospect; onChange: (patch: Partial<Prospect["ai"]>) => void; compact?: boolean }) {
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const li = httpsUrl(p.personLinkedin);
  const x = xState(p);
  const liSent = p.ai["AI LinkedIn Sent At"];
  const xSent = p.ai["AI X Sent At"];

  const mark = async (channel: "linkedin" | "x", undo = false) => {
    setBusy(channel);
    const r = await markSocialSent(sheet, tab, p.key, channel, undo);
    setBusy("");
    if (!r.ok) return setNote(r.error);
    onChange(channel === "linkedin" ? { "AI LinkedIn Sent At": r.at ?? "" } : { "AI X Sent At": r.at ?? "" });
  };

  const size = compact ? "sm" : "md";
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size={size}
          disabled={!li || !p.ai["AI LinkedIn Note"]}
          title={li ? "Copies the note and opens their LinkedIn profile" : "No LinkedIn URL in the sheet"}
          onClick={async () => {
            const ok = await copy(p.ai["AI LinkedIn Note"] ?? "");
            window.open(li, "_blank", "noopener");
            setNote(ok ? "LinkedIn note copied. Paste it on their profile." : "Couldn't copy automatically. Select the note and copy it.");
          }}
        >
          Copy LinkedIn note + open profile
        </Button>
        {liSent ? (
          <span className="text-xs text-accent-ink">
            LinkedIn sent {new Date(liSent).toLocaleString()} <button className="ml-1 text-muted underline" onClick={() => mark("linkedin", true)}>undo</button>
          </span>
        ) : (
          <Button size={size} variant="primary" disabled={busy === "linkedin"} onClick={() => mark("linkedin")}>Mark LinkedIn sent</Button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size={size}
          disabled={!!x.blocked || !p.ai["AI X DM"]}
          title={x.blocked ?? "Copies the DM and opens their X profile"}
          onClick={async () => {
            const ok = await copy(p.ai["AI X DM"] ?? "");
            window.open(x.url, "_blank", "noopener");
            setNote(ok ? "X DM copied. Open Message on their profile and paste." : "Couldn't copy automatically. Select the DM and copy it.");
          }}
        >
          Copy X DM + open X
        </Button>
        {xSent ? (
          <span className="text-xs text-accent-ink">
            X sent {new Date(xSent).toLocaleString()} <button className="ml-1 text-muted underline" onClick={() => mark("x", true)}>undo</button>
          </span>
        ) : (
          <Button size={size} variant="primary" disabled={!!x.blocked || busy === "x"} onClick={() => mark("x")}>Mark X sent</Button>
        )}
        {x.blocked && <span className="text-xs text-amber-700">{x.blocked}</span>}
      </div>
      {note && <p className="text-xs text-muted">{note}</p>}
    </div>
  );
}
