# Configuração Nuvemshop — Maison Decants Automação

## Aplicativo

- Nome: `Maison Decants Automação`
- Tipo: aplicativo externo
- Distribuição: `Para seus clientes`
- Loja alvo: Maison Decants

## Caminho no Portal de Parceiros

1. Acesse **Aplicativos → Criar Aplicativo**.
2. Informe o nome `Maison Decants Automação`.
3. Selecione **Para seus clientes**.
4. Abra **Editar dados / Dados Básicos**.
5. Configure a URL de redirecionamento para o endpoint público do ambiente, terminando em `/oauth/callback`.
6. Habilite somente os escopos realmente necessários para produtos, pedidos e clientes.
7. Configure os webhooks obrigatórios de LGPD no portal.
8. Salve.
9. Em **Chaves de Acesso**, obtenha `app_id` e `client_secret`.

## Credenciais

Nunca registrar credenciais em arquivos versionados ou mensagens.

Configurar como secrets do Cloudflare Worker:

- `NUVEMSHOP_CLIENT_ID` = App ID
- `NUVEMSHOP_CLIENT_SECRET` = Client Secret
- `NUVEMSHOP_REDIRECT_URI` = URL HTTPS pública terminando em `/oauth/callback`
- `TOKEN_ENCRYPTION_KEY` = chave aleatória exclusiva da Maison Decants
- `ADMIN_SESSION_SECRET` = chave aleatória exclusiva do painel administrativo

## Webhooks de operação

Após o OAuth, o middleware registra automaticamente:

- `app/uninstalled`
- `app/suspended`
- `app/resumed`
- `order/created`
- `order/updated`
- `order/paid`
- `order/cancelled`
- `product/created`
- `product/updated`
- `product/deleted`
- `customer/created`
- `customer/updated`
- `customer/deleted`

A assinatura recebida em `x-linkedstore-hmac-sha256` é validada com o segredo do aplicativo antes de qualquer processamento.

## LGPD

Também devem ser configurados no Portal de Parceiros os callbacks obrigatórios de privacidade exigidos pela Nuvemshop para aplicativos no Brasil, incluindo solicitações de exclusão e acesso a dados. A implementação desses handlers deve estar publicada antes da homologação final.

## Instalação

Quando o Worker estiver publicado e os secrets configurados, iniciar a instalação acessando:

`https://<dominio-do-worker>/oauth/install`

O fluxo redirecionará para a autorização da Nuvemshop, receberá o `code`, trocará o código por `access_token`, criptografará o token no D1 e registrará os webhooks principais.
