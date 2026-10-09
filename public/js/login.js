// Página de login (sem outros scripts): leva junto a tela em que a pessoa estava (#/item/12…),
// que o navegador não envia ao servidor, para voltar a ela depois de entrar.
const volta = document.querySelector('input[name="volta"]');
if (volta && location.hash.startsWith('#/') && !volta.value.includes('#')) volta.value += location.hash;
