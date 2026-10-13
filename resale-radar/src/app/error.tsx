"use client";

import { TriangleAlert } from "lucide-react";
import { Button, Card, EmptyState } from "@/components/ui";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Card className="mx-auto mt-10 max-w-lg">
      <EmptyState
        icon={<TriangleAlert />}
        title="Something went wrong loading this page"
        description={`Your data is safe. ${error.digest ? `Reference ${error.digest}.` : ""}`}
        action={<Button variant="primary" onClick={reset}>Try again</Button>}
      />
    </Card>
  );
}
