# Racha Criativo — lista do vôlei

Site da lista do vôlei de domingo. HTML + JavaScript puro no GitHub Pages, dados no Supabase (grátis).

## Como funciona

- **Conta:** cada pessoa cria usuário e senha. O site avisa para **não usar uma senha de verdade**.
- **Aprovação:** contas novas ficam "aguardando aprovação" até um organizador aprovar.
- **Listas:** só organizadores criam listas (data, horário, vagas, valor, Pix e a hora em que a lista abre). Dá para ter mais de uma lista ao mesmo tempo e repetir a da semana passada com um toque.
- **Ordem justa:** a hora de cada inscrição é marcada pelo servidor, com microssegundos. Antes da hora de abertura o servidor recusa inscrições.
- **Espera e convidados:** quem passa das vagas vai para a espera e sobe sozinho quando alguém sai. Convidados ficam depois dos membros.
- **Pagamento:** chave Pix com botão de copiar. A pessoa toca em **Já paguei** e o organizador confirma.
- **Copiar p/ WhatsApp:** texto no formato do grupo, com ✅ para quem pagou.
- **Organizador:** aprova e bloqueia pessoas, torna outras pessoas admin, confirma pagamentos e remove gente da lista.

## Configurar o Supabase (uma vez, uns 10 minutos)

1. Entre em https://supabase.com, crie uma conta e um **New project**. Região: **South America (São Paulo)**.
2. **SQL Editor** > New query > cole todo o arquivo `supabase.sql` > **Run**.
3. **Authentication** > **Sign In / Providers** > **Email** > desligue **Confirm email** > Save.
   (Os usuários entram com apelido. Nenhum e-mail é enviado.)
4. **Authentication** > **Users** > **Add user** > **Create new user**: seu e-mail e uma senha forte, marque **Auto Confirm User**.
5. **SQL Editor** de novo, rode (com seu e-mail e nome):
   ```sql
   update public.profiles set is_admin = true, status = 'approved', name = 'SEU NOME'
     where id = (select id from auth.users where email = 'SEU-EMAIL');
   ```
6. **Project Settings** > **API**: copie a **Project URL** e a chave **anon public** para o `config.js`.
7. Envie para o GitHub. Em 1 minuto o site atualiza.

Organizadores entram com o **e-mail** no campo "Usuário". As outras pessoas usam o apelido que criaram.

## Testar no computador

```bash
npx serve .
```
