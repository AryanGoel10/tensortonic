import { Suspense } from "react";
import { SettingsClient } from "./client";

export const maxDuration = 120;

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsClient />
    </Suspense>
  );
}
