# Racha Criativo — lista do vôlei

Site para a lista do vôlei de domingo. Feito em HTML + JavaScript puro, publicado no GitHub Pages.

## Como funciona

- **Pedir acesso:** na primeira vez a pessoa manda o nome. Um organizador aprova.
- **Lista:** quem foi aprovado toca em **Entrar**. A ordem é a hora em que o **servidor** recebe a inscrição, então não tem bagunça quando todo mundo entra junto.
- **Abertura:** o organizador define a hora em que a lista abre. Antes disso aparece uma contagem regressiva, e o servidor recusa inscrições adiantadas.
- **Espera:** passou do número de vagas, vai para a espera. Se alguém sair, o primeiro da espera sobe sozinho.
- **Convidados:** cada membro pode levar convidado. Convidados ficam depois de todos os membros.
- **Pagamento:** chave Pix com botão de copiar. A pessoa toca em **Já paguei** e o organizador confirma.
- **Copiar lista:** gera o texto no formato do grupo do WhatsApp, com ✅ para quem pagou.
- **Organizador:** link "Sou o organizador" no rodapé, com PIN. Aprova pessoas, confirma pagamentos, remove gente, muda data, vagas, valor, Pix e abre a semana nova.

Sem configurar o Firebase o site roda em **modo teste** (dados só no seu navegador, PIN `1234`).

## Ligar o modo online (Firebase, grátis) — uns 10 minutos

1. Entre em https://console.firebase.google.com e crie um projeto (pode desligar o Google Analytics).
2. **Authentication** > Começar > aba **Método de login** > ative **Anônimo**.
3. **Authentication** > **Configurações** > **Domínios autorizados** > adicione `SEU-USUARIO.github.io`.
4. **Firestore Database** > Criar banco de dados > modo de produção > região `southamerica-east1` (São Paulo).
5. **Firestore** > aba **Regras** > apague tudo, cole o conteúdo de `firestore.rules` e clique **Publicar**.
6. **Firestore** > aba **Dados** > crie a coleção `secret`, documento com ID `admin`, campo `pin` (tipo string) com o PIN dos organizadores. Esse PIN nunca aparece no site.
7. Engrenagem > **Configurações do projeto** > "Seus apps" > ícone `</>` (Web) > registre o app. Copie o objeto `firebaseConfig` e cole em `config.js` no lugar de `firebase: null`.
8. Envie a mudança para o GitHub (`git add . && git commit -m "Liga Firebase" && git push`). Em 1 minuto o site atualiza.
9. Abra o site, toque em **Sou o organizador**, digite o PIN e configure data, vagas, Pix e hora de abertura. Depois peça acesso com seu próprio nome e aprove a si mesmo.

## Bom saber

- O acesso fica ligado ao **aparelho/navegador**. Se alguém trocar de celular ou limpar os dados do navegador, precisa pedir acesso de novo.
- Trocar o PIN em `secret/admin` desconecta todos os organizadores.
- Mudar a data do jogo começa uma lista vazia. As listas antigas ficam guardadas no Firestore em `weeks/`.

## Testar no computador

```bash
npx serve .
```
