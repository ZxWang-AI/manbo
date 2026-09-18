import Link from "next/link";

import { Conversation } from "@/components/chat/conversation";

export default function StartPage() {
  return (
    <main className="workspace workspace--conversation">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Manbo 首页">
          <span className="brand__mark" aria-hidden="true">M</span>
          <span>Manbo</span>
        </Link>
        <div className="topbar__actions">
          <Link className="text-link" href="/cases">我的档案</Link>
          <Link className="text-link" href="/recover">恢复访问</Link>
          <span className="privacy-state"><span className="privacy-state__dot" aria-hidden="true" />私密工作区</span>
        </div>
      </header>
      <Conversation />
    </main>
  );
}
