import Link from "next/link";

import { ResumeConversation } from "@/components/chat/resume-conversation";

export default async function CaseConversationPage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  return (
    <main className="workspace workspace--conversation">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Manbo 首页">
          <span className="brand__mark" aria-hidden="true">M</span>
          <span>Manbo</span>
        </Link>
        <div className="topbar__actions">
          <Link className="text-link" href="/cases">我的档案</Link>
          <span className="privacy-state"><span className="privacy-state__dot" aria-hidden="true" />私密工作区</span>
        </div>
      </header>
      <ResumeConversation caseId={caseId} />
    </main>
  );
}
