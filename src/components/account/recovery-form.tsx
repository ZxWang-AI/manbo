"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

export function RecoveryForm() {
  const router = useRouter();
  const [alias, setAlias] = useState("");
  const [recoverySecret, setRecoverySecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch("/api/accounts/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ alias: alias.trim(), recoverySecret }),
      });
      const payload = await response.json().catch(() => ({})) as { message?: unknown };
      if (!response.ok) {
        throw new Error(typeof payload.message === "string" ? payload.message : "恢复失败，请检查化名和恢复密钥。" );
      }
      router.push("/cases");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "恢复失败，请稍后重试。" );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="recovery-shell" aria-labelledby="recovery-title">
      <p className="eyebrow">PRIVATE ACCESS</p>
      <h1 id="recovery-title">恢复私密档案</h1>
      <p className="section-copy">输入创建档案时看到的化名和恢复密钥。恢复密钥不会保存到浏览器；平台也无法替你找回遗失的密钥。</p>
      <form className="recovery-form" onSubmit={(event) => { void submit(event); }}>
        <label htmlFor="recovery-alias">化名</label>
        <input
          id="recovery-alias"
          name="alias"
          type="text"
          autoComplete="username"
          maxLength={80}
          value={alias}
          onChange={(event) => setAlias(event.target.value)}
          required
        />
        <label htmlFor="recovery-secret">恢复密钥</label>
        <input
          id="recovery-secret"
          name="recoverySecret"
          type="password"
          autoComplete="current-password"
          maxLength={200}
          value={recoverySecret}
          onChange={(event) => setRecoverySecret(event.target.value)}
          required
        />
        {error ? <p className="inline-error" role="alert">{error}</p> : null}
        <button type="submit" className="primary-button" disabled={busy}>
          {busy ? "正在恢复……" : "恢复访问"}
        </button>
      </form>
      <div className="recovery-links">
        <Link href="/start">没有密钥？开始新的对话</Link>
        <Link href="/">返回首页</Link>
      </div>
    </section>
  );
}
