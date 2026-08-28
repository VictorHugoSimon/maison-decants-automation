# Maison Decants Automation

Middleware oficial da Maison Decants para integracao segura com a Nuvemshop.

## Objetivo

Centralizar autenticacao OAuth 2.0, webhooks, sincronizacao de produtos, estoque, pedidos e clientes, mantendo a Nuvemshop como fonte oficial dos dados da loja.

## Arquitetura

- Cloudflare Workers + TypeScript
- Cloudflare D1 por ambiente
- Cloudflare Queues para processamento assincrono de webhooks
- retry + dead-letter queue
- OAuth 2.0 Authorization Code
- tokens criptografados antes da persistencia
- validacao HMAC dos webhooks
- idempotencia de eventos
- GitHub Actions para CI/CD
- ambientes `staging` e `production` isolados

## Seguranca

- Nunca versionar `client_secret`, `access_token` ou chaves privadas.
- Credenciais devem ser configuradas como secrets do Cloudflare/GitHub.
- O aplicativo deve solicitar apenas os escopos necessarios.
- Eventos e mudancas de credenciais devem possuir trilha de auditoria.
- Staging e producao usam bancos, filas e configuracoes isoladas.

## Deploy

O pipeline de CI/CD e a infraestrutura de staging/production estao documentados em [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Status

- codigo base OAuth e webhooks: concluido;
- D1 staging e production: provisionados;
- Queue, retry e DLQ: configurados no codigo/infra;
- CI: ativo;
- proxima etapa: merge em `staging`, deploy real do Worker e obtencao da URL HTTPS para configurar o aplicativo **Maison Decants Automacao** na Nuvemshop.
