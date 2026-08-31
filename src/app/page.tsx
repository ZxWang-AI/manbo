const aiMessage = (
  <article className="message message--assistant" data-message-role="assistant">
    <div className="avatar avatar--ai" data-avatar-position="left" aria-hidden="true">
      M
    </div>
    <div className="message__content">
      <p className="message__author">Manbo AI</p>
      <p>
        我可以先听你描述发生了什么，再把时间、地点、相关方和已有材料整理成可复核的档案草稿。
      </p>
    </div>
  </article>
);

const userMessage = (
  <article className="message message--user" data-message-role="user">
    <div className="message__content">
      <p className="message__author">你</p>
      <p>我想先梳理事情经过，还不确定现有资料是否完整。</p>
    </div>
    <div className="avatar avatar--user" data-avatar-position="right" aria-hidden="true">
      你
    </div>
  </article>
);

export default function HomePage() {
  return (
    <main className="workspace">
      <header className="topbar">
        <a className="brand" href="#workspace" aria-label="Manbo 首页">
          <span className="brand__mark" aria-hidden="true">
            M
          </span>
          <span>Manbo</span>
        </a>
        <span className="privacy-state">
          <span className="privacy-state__dot" aria-hidden="true" />
          私密工作区
        </span>
      </header>

      <section className="conversation" id="workspace" aria-labelledby="workspace-title">
        <div className="intro">
          <p className="eyebrow">PRIVATE CASE PREPARATION</p>
          <h1 id="workspace-title">私密举报材料准备工具</h1>
          <p className="intro__copy">
            通过自然对话逐步整理事实与材料。内容默认不会公开发布，AI
            的初步整理也不构成法律判断。
          </p>
        </div>

        <div className="messages" aria-label="对话示例">
          {aiMessage}
          {userMessage}
        </div>

        <form className="composer" aria-label="消息输入" action="#">
          <label className="sr-only" htmlFor="message">
            描述你希望整理的情况
          </label>
          <textarea id="message" name="message" rows={2} placeholder="从你愿意分享的部分开始……" />
          <div className="composer__footer">
            <span>Enter 发送 · Shift + Enter 换行</span>
            <button type="submit" aria-label="发送消息">
              <span aria-hidden="true">↑</span>
            </button>
          </div>
        </form>

        <p className="boundary-note">你可以随时停下、修改或删除内容；未经确认，不会替你对外提交。</p>
      </section>
    </main>
  );
}
