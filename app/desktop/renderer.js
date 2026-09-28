const list = document.querySelector('#cases');

async function refresh() {
  const cases = await window.manbo.listCases();
  list.replaceChildren(...cases.map((item) => {
    const row = document.createElement('li');
    const title = document.createElement('div');
    title.textContent = `案件 ${item.id}`;
    const meta = document.createElement('div');
    meta.className = 'muted';
    meta.textContent = `${item.evidence.length} 份材料 · 创建于 ${new Date(item.createdAt).toLocaleString()}`;
    const button = document.createElement('button');
    button.textContent = '导入材料';
    button.addEventListener('click', async () => {
      await window.manbo.importEvidence(item.id);
      await refresh();
    });
    row.append(title, meta, button);
    return row;
  }));
}

document.querySelector('#create').addEventListener('click', async () => {
  await window.manbo.createCase();
  await refresh();
});
document.querySelector('#refresh').addEventListener('click', refresh);
refresh();
