import { Suspense } from "react";
import { ProspectsClient } from "./client";

export const maxDuration = 120;

export default function ProspectsPage() {
  return (
    <Suspense>
      <ProspectsClient />
    </Suspense>
  );
}
