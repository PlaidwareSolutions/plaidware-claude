import Link from "next/link";
import { notFound } from "next/navigation";
import { SquareKanban } from "lucide-react";
import { requireOpsPage } from "@/policy";
import { ProductDetailsForm } from "@/modules/catalog/components/product-details-form";
import { boardSummaryForProduct } from "@/modules/work/queries";
import { sprintTiming } from "@/modules/work/components/sprint-progress";
import { WORK } from "@/lib/routes";
import { Section } from "@/components/section";
import { StatTile } from "@/components/stat-tile";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { loadProduct, productMetadata } from "./load";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return productMetadata(params);
}

export default async function ProductDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOpsPage("support");
  const { id } = await params;
  const data = await loadProduct(id);
  if (!data) notFound();
  const work = await boardSummaryForProduct(data.product.id);
  const boardHref = WORK.board(data.product.slug);
  const sprint = work?.activeSprint ?? null;

  return (
    <div className="flex flex-col gap-8">
      <Section
        title="Development"
        icon={SquareKanban}
        description={work ? `board ${work.keyPrefix}` : undefined}
        actions={<Link href={boardHref} className="text-sm text-primary hover:underline">Open board →</Link>}
      >
        {work ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <StatTile label="Open items" value={work.open} href={boardHref} sub="to do, in progress, in review" />
            <StatTile label="In progress" value={work.inProgress} href={boardHref} />
            <StatTile
              label={work.mode === "sprints" ? "Sprint" : "Mode"}
              value={work.mode === "sprints" ? (sprint?.name ?? "none active") : "Kanban"}
              href={work.mode === "sprints" ? WORK.sprints(data.product.slug) : boardHref}
              sub={sprint ? `${sprint.done}/${sprint.total} done · ${sprintTiming(sprint)}` : work.mode === "sprints" ? "plan one from the backlog" : "continuous flow"}
              tone={sprint?.isOverdue ? "warning" : "default"}
            />
          </div>
        ) : (
          <EmptyState
            compact
            title="No board yet"
            description="The board is created the first time someone opens it."
            action={
              <Button asChild size="sm" variant="outline">
                <Link href={boardHref}>Open board</Link>
              </Button>
            }
          />
        )}
      </Section>
      <ProductDetailsForm product={data.product} />
    </div>
  );
}
