// Configuração do site.
//
// 1) Sem Firebase (firebase: null) o site roda em MODO TESTE:
//    a lista fica salva só no navegador de quem abriu. Serve para testar.
//
// 2) Para a lista ser compartilhada por todo mundo, cole aqui a configuração
//    do seu projeto Firebase (passo a passo no LEIA-ME.md). Esses valores
//    podem ficar públicos: quem protege os dados são as regras do firestore.rules.
window.VOLEI_CONFIG = {
  firebase: null,
  // firebase: {
  //   apiKey: "...",
  //   authDomain: "...firebaseapp.com",
  //   projectId: "...",
  //   appId: "..."
  // },

  // PIN do organizador SÓ no modo teste. No modo online o PIN fica guardado
  // no Firebase (documento secret/admin), e não aqui.
  demoPin: "1234"
};
