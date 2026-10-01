// Aplica o tema salvo antes da renderização, evitando "piscar" o tema errado.
// (Arquivo separado porque a política de segurança da página não permite scripts embutidos no HTML.)
try {
  const t = localStorage.getItem('kb-theme');
  if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t;
} catch {
  /* sem armazenamento local */
}
