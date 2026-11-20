import { Suspense } from "react";
import { ReviewClient } from "./client";

// Regenerate runs a Claude call inline.
export const maxDuration = 300;

export default function ReviewPage() {
  return (
    <Suspense>
      <ReviewClient />
    </Suspense>
  );
}
