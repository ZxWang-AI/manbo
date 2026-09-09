import Link from "next/link";
import { CaseDetail } from "@/components/case/case-detail";

export default async function CasePage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  return (
    <main className="workspace workspace--conversation">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Manbo 首页">
          <span className="brand__mark" aria-hidden="true">M</span>
          <span>Manbo</span>
        </Link>
        <span className="privacy-state"><span className="privacy-state__dot" aria-hidden="true" />私密工作区</span>
      </header>
      <CaseDetail caseId={caseId} />
    </main>
  );
}
