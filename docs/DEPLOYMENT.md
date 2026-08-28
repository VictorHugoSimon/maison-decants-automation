# Deploy e Ambientes

Este documento descreve a infraestrutura de staging/production e o pipeline de
CI/CD do middleware Maison Decants.

## Visao geral

| Ambiente     | Branch    | Worker                                 | Banco D1                                 |
| ------------ | --------- | -------------------------------------- | ---------------------------------------- |
| `staging`    | `staging` | `maison-decants-automation-staging`    | `maison-decants-automation-staging`      |
| `production` | `main`    | `maison-decants-automation`            | `maison-decants-automation`              |

O fluxo de promocao e sempre `feature -> staging -> main`:

1. Abra o PR da sua branch de trabalho para `staging`. O workflow **CI**
   (`.github/workflows/ci.yml`) roda `typecheck` e `test`.
2. Ao mesclar em `staging`, o workflow **Deploy** publica no ambiente de staging
   e aplica as migracoes D1 remotas.
3. Depois de validar em staging, abra o PR de `staging` para `main`. Ao mesclar,
   o mesmo workflow publica em production.

## Pipelines (GitHub Actions)

### CI — `.github/workflows/ci.yml`

- Dispara em `push` para `main`/`staging` e em `pull_request` para `main`/`staging`.
- Passos: `npm install`, `npm run typecheck`, `npm test`.
- Nao precisa de segredos; serve como gate de qualidade antes do deploy.

### Deploy — `.github/workflows/deploy.yml`

- Dispara em `push` para `staging` (deploy em staging) e `main` (deploy em production).
- Seleciona o ambiente do Wrangler a partir da branch:
  `main -> production`, caso contrario `staging`.
- Passos: `typecheck` e `test` (novo gate), `wrangler d1 migrations apply`
  (`--remote`) e `wrangler deploy --env <ambiente>`.
- Usa `concurrency` por `github.ref` com `cancel-in-progress: false` para nao
  interromper uma migracao em andamento.
- Vincula-se ao GitHub Environment homonimo (`staging`/`production`), permitindo
  regras de protecao (revisores obrigatorios, wait timer) na UI do GitHub.

## Segredos necessarios

Configure em **Settings > Secrets and variables > Actions**. Se usar regras de
protecao por ambiente, defina-os como **Environment secrets** em cada Environment
(`staging` e `production`); caso contrario, como Repository secrets.

| Segredo                 | Descricao                                                        |
| ----------------------- | ---------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Token com permissao de editar Workers e D1 na conta.             |
| `CLOUDFLARE_ACCOUNT_ID` | ID da conta Cloudflare.                                          |

O `CLOUDFLARE_API_TOKEN` deve incluir, no minimo, as permissoes:
`Account > Workers Scripts > Edit` e `Account > D1 > Edit`.

## Segredos do Worker (runtime)

As credenciais da aplicacao NAO ficam no `wrangler.toml`. Defina-as por ambiente
com `wrangler secret put ... --env <ambiente>`:

```bash
wrangler secret put NUVEMSHOP_CLIENT_ID       --env staging
wrangler secret put NUVEMSHOP_CLIENT_SECRET   --env staging
wrangler secret put NUVEMSHOP_REDIRECT_URI    --env staging
wrangler secret put TOKEN_ENCRYPTION_KEY      --env staging
wrangler secret put WEBHOOK_SHARED_SECRET     --env staging
wrangler secret put ADMIN_SESSION_SECRET      --env staging
```

Repita com `--env production` para o ambiente de producao. Veja `.env.example`
para a lista completa de variaveis.

## Provisionamento inicial dos bancos D1

Os `database_id` no `wrangler.toml` estao como placeholders. Crie os bancos e
substitua os IDs:

```bash
wrangler d1 create maison-decants-automation-staging
wrangler d1 create maison-decants-automation
```

Copie cada `database_id` retornado para o bloco correspondente em `wrangler.toml`
(`REPLACE_WITH_STAGING_D1_DATABASE_ID` e `REPLACE_WITH_PRODUCTION_D1_DATABASE_ID`).

As migracoes ficam em `migrations/` e sao aplicadas automaticamente pelo pipeline
de deploy. Para aplicar manualmente:

```bash
wrangler d1 migrations apply DB --env staging --remote
```

## Deploy manual (fallback)

Caso precise publicar fora do pipeline:

```bash
npm run check                                   # typecheck + testes
wrangler d1 migrations apply DB --env staging --remote
wrangler deploy --env staging
```
