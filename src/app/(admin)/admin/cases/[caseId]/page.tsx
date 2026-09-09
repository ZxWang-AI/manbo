import { AdminCaseReviewWorkbench } from "@/components/admin/admin-case-review";
import { makeUnavailableAdminCaseView } from "@/server/admin/unavailable-case-view";

export default async function AdminCasePage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  return <AdminCaseReviewWorkbench caseView={makeUnavailableAdminCaseView(caseId)} />;
}
