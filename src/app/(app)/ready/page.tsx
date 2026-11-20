import { Suspense } from "react";
import { ReadyClient } from "./client";

export default function ReadyPage() {
  return (
    <Suspense>
      <ReadyClient />
    </Suspense>
  );
}
