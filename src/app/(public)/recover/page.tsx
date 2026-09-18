import Link from "next/link";

import { RecoveryForm } from "@/components/account/recovery-form";

export default function RecoverPage() {
  return (
    <main className="workspace workspace--conversation">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Manbo 首页">
          <span className="brand__mark" aria-hidden="true">M</span>
          <span>Manbo</span>
        </Link>
        <span className="privacy-state"><span className="privacy-state__dot" aria-hidden="true" />私密工作区</span>
      </header>
      <RecoveryForm />
    </main>
  );
}
