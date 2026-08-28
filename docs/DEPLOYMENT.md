# Deploy e Ambientes

Este documento descreve a infraestrutura de staging/production e o pipeline de CI/CD do middleware Maison Decants.

## Visao geral

| Ambiente | Branch | Worker | Banco D1 | Queue principal | Dead-letter queue |
| --- | --- | --- | --- | --- | --- |
| `staging` | `staging` | `maison-decants-automation-staging` | `maison-decants-automation-staging` | `maison-decants-webhooks-staging` | `maison-decants-webhooks-staging-dlq` |
| `production` | `main` | `maison-decants-automation` | `maison-decants-automation` | `maison-decants-webhooks` | `maison-decants-webhooks-dlq` |

O fluxo de promocao e sempre `feature -> staging -> main`:

1. Abra o PR da branch de trabalho para `staging`. O workflow **CI** roda `typecheck` e testes.
2. Ao mesclar em `staging`, o workflow **Deploy** aplica migracoes D1 remotas e publica o Worker de staging.
3. Depois da validacao funcional em staging, promova `staging` para `main` para publicar production.

## Estado atual do deploy (2026-08-28)

Ambos os ambientes ja foram publicados com sucesso pelo pipeline:

| Ambiente | Worker publicado | URL publica | Deploy |
| --- | --- | --- | --- |
| staging | `maison-decants-automation-staging` | https://maison-decants-automation-staging.victorhugoteixeirasimon6.workers.dev | verde |
| production | `maison-decants-automation` | https://maison-decants-automation.victorhugoteixeirasimon6.workers.dev | verde |

Em cada deploy o pipeline aplicou a migracao `0001_init.sql` no D1, garantiu as filas de webhook (producer + consumer) e publicou o Worker. Os secrets `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID` ja estao configurados no GitHub.

Redirect URIs OAuth de cada ambiente (usar em `NUVEMSHOP_REDIRECT_URI` e no cadastro do app na Nuvemshop):

- staging: `https://maison-decants-automation-staging.victorhugoteixeirasimon6.workers.dev/oauth/callback`
- production: `https://maison-decants-automation.victorhugoteixeirasimon6.workers.dev/oauth/callback`

## Recursos Cloudflare ja provisionados

Os bancos D1 ja foram criados e seus IDs reais estao configurados no `wrangler.toml`:

- staging: `maison-decants-automation-staging` — `a60e8c1d-7f97-41a1-99c4-619266a556b6`
- production: `maison-decants-automation` — `837fb810-c0cf-4942-88f0-ceadc90d8381`

Os bindings de Queue estao declarados por ambiente no `wrangler.toml`.

Antes do primeiro deploy, as filas principais precisam existir na mesma conta Cloudflare. As DLQs tambem devem ser criadas explicitamente para manter o provisionamento previsivel.

Criacao manual, se necessario:

```bash
npx wrangler queues create maison-decants-webhooks-staging
npx wrangler queues create maison-decants-webhooks-staging-dlq
npx wrangler queues create maison-decants-webhooks
npx wrangler queues create maison-decants-webhooks-dlq
```

## Arquitetura de webhooks

O endpoint HTTP `/webhooks/nuvemshop` executa apenas o caminho rapido:

1. valida a assinatura HMAC da Nuvemshop;
2. valida o payload;
3. calcula uma chave SHA-256 deterministica do corpo para idempotencia;
4. persiste o evento no D1;
5. publica a mensagem na `WEBHOOK_QUEUE`;
6. responde HTTP `202`.

O consumidor da Queue processa o evento fora da requisicao HTTP, com:

- claim condicional no D1 para impedir processamento concorrente duplicado;
- ate 5 tentativas;
- atraso padrao de 30 segundos entre retries;
- DLQ por ambiente para mensagens que excederem o limite de tentativas;
- trilha de auditoria e status de processamento no D1.

## Pipelines GitHub Actions

### CI — `.github/workflows/ci.yml`

Dispara em `push` para `main`/`staging` e em pull requests para `main`/`staging`.

Passos:

- `npm install`
- `npm run typecheck`
- `npm test`

### Deploy — `.github/workflows/deploy.yml`

Dispara em `push` para `staging` e `main`.

- `staging` -> ambiente Wrangler `staging`
- `main` -> ambiente Wrangler `production`

Passos:

1. checkout;
2. Node.js;
3. dependencias;
4. typecheck;
5. testes;
6. migrations D1 remotas;
7. deploy do Worker.

O workflow usa `concurrency` por branch e nao cancela um deploy que ja iniciou.

## Segredos necessarios no GitHub

Configure em **Settings > Secrets and variables > Actions** ou, preferencialmente, nos GitHub Environments `staging` e `production`:

| Segredo | Uso |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | deploy de Workers, D1 e recursos associados |
| `CLOUDFLARE_ACCOUNT_ID` | identifica a conta Cloudflare exclusiva da Maison Decants |

O token deve possuir apenas as permissoes necessarias ao deploy deste projeto.

## Segredos runtime do Worker

Nunca grave estes valores no repositorio:

```bash
wrangler secret put NUVEMSHOP_CLIENT_ID       --env staging
wrangler secret put NUVEMSHOP_CLIENT_SECRET   --env staging
wrangler secret put NUVEMSHOP_REDIRECT_URI    --env staging
wrangler secret put TOKEN_ENCRYPTION_KEY      --env staging
wrangler secret put ADMIN_SESSION_SECRET      --env staging
```

Repita para `--env production` somente depois da homologacao de staging.

## Migracoes D1

As migracoes ficam em `migrations/` e o pipeline as aplica remotamente antes do deploy.

Aplicacao manual de staging:

```bash
npx wrangler d1 migrations apply DB --env staging --remote
```

## Deploy manual de fallback

```bash
npm run check
npx wrangler d1 migrations apply DB --env staging --remote
npx wrangler deploy --env staging
```

Depois do deploy, validar obrigatoriamente:

- `GET /health` retorna `200`;
- URL publica `workers.dev` registrada;
- D1 acessivel;
- Queue e consumidor ativos;
- nenhuma credencial aparece em logs;
- somente entao configurar `NUVEMSHOP_REDIRECT_URI` e iniciar o OAuth real.

## Checklist pendente (pos-deploy)

A infraestrutura e os deploys estao concluidos. Faltam apenas as credenciais de runtime, que nunca sao versionadas:

- [ ] Definir os 5 secrets de runtime em **staging** (`wrangler secret put ... --env staging`): `NUVEMSHOP_CLIENT_ID`, `NUVEMSHOP_CLIENT_SECRET`, `NUVEMSHOP_REDIRECT_URI`, `TOKEN_ENCRYPTION_KEY`, `ADMIN_SESSION_SECRET`.
- [ ] Repetir os mesmos 5 secrets em **production** (`--env production`).
- [ ] Cadastrar o Redirect URI de cada ambiente no app **Maison Decants Automacao** no Portal de Parceiros Nuvemshop.
- [ ] Validar `GET /health` (200) e o fluxo OAuth `/oauth/install` em staging antes de liberar production.

> `TOKEN_ENCRYPTION_KEY` e `ADMIN_SESSION_SECRET` sao chaves proprias — gere com `openssl rand -base64 32`. A verificacao HMAC dos webhooks usa `NUVEMSHOP_CLIENT_SECRET` (nao ha secret separado). Depois de `wrangler secret put`, o Worker recarrega os valores sozinho, sem novo deploy.
