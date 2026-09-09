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
        <span className="privacy-state"><span className="privacy-state__dot" aria-hidden="true" />私密工作区</span>
      </header>
      <Conversation />
    </main>
  );
}
