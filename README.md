# Maison Decants Automation

Middleware oficial da Maison Decants para integração segura com a Nuvemshop.

## Objetivo

Centralizar autenticação OAuth 2.0, webhooks, sincronização de produtos, estoque, pedidos e clientes, mantendo a Nuvemshop como fonte oficial dos dados da loja.

## Arquitetura

- Cloudflare Workers + TypeScript
- Cloudflare D1 para persistência
- OAuth 2.0 Authorization Code
- Webhooks com processamento idempotente
- CI via GitHub Actions
- Ambientes `staging` e `production` isolados

## Segurança

- Nunca versionar `client_secret`, `access_token` ou chaves privadas.
- Credenciais devem ser configuradas como secrets do Cloudflare/GitHub.
- O aplicativo deve solicitar apenas os escopos necessários.
- Eventos e mudanças de credenciais devem possuir trilha de auditoria.

## Deploy

O pipeline de CI/CD e a infraestrutura de staging/production estao documentados em [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Status

Base técnica inicial em construção. A próxima etapa é cadastrar o aplicativo **Maison Decants Automação** no Portal de Parceiros Nuvemshop e configurar as credenciais OAuth.
