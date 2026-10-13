import { SearchX } from "lucide-react";
import { Card, EmptyState, LinkButton } from "@/components/ui";

export default function NotFound() {
  return (
    <Card className="mx-auto mt-10 max-w-lg">
      <EmptyState icon={<SearchX />} title="Not found" description="This page or record does not exist, or it belongs to another account." action={<LinkButton href="/" variant="primary">Command Center</LinkButton>} />
    </Card>
  );
}
