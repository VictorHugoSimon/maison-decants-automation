# Configuracao Nuvemshop — Maison Decants Automacao

## Pre-requisito

Nao configure o OAuth com URL provisoria. Primeiro publique o Worker de staging e valide `GET /health`.

A URL final de staging tera o formato:

`https://maison-decants-automation-staging.<subdominio>.workers.dev`

Use sempre o endereco real retornado pela Cloudflare.

## Aplicativo

- Nome: `Maison Decants Automacao`
- Tipo: aplicativo externo
- Distribuicao: `Para seus clientes`
- Loja alvo: Maison Decants

## Caminho no Portal de Parceiros

1. Acesse **Aplicativos → Criar Aplicativo**.
2. Informe o nome `Maison Decants Automacao`.
3. Selecione **Para seus clientes**.
4. Abra **Editar dados / Dados Basicos**.
5. Configure a URL principal usando a URL publica real de staging.
6. Configure a URL de redirecionamento como `<URL-STAGING>/oauth/callback`.
7. Habilite somente os escopos necessarios para produtos, pedidos, estoque, variantes e clientes.
8. Configure os callbacks obrigatorios de privacidade/LGPD suportados pelo app.
9. Salve.
10. Em **Chaves de Acesso**, obtenha `app_id` e `client_secret`.

## Credenciais

Nunca registrar credenciais em arquivos versionados ou mensagens.

Configurar como secrets do Cloudflare Worker de staging:

- `NUVEMSHOP_CLIENT_ID` = App ID
- `NUVEMSHOP_CLIENT_SECRET` = Client Secret
- `NUVEMSHOP_REDIRECT_URI` = URL HTTPS publica terminando em `/oauth/callback`
- `TOKEN_ENCRYPTION_KEY` = chave aleatoria exclusiva da Maison Decants
- `ADMIN_SESSION_SECRET` = chave aleatoria exclusiva do painel administrativo

## Webhooks de operacao

Apos o OAuth, o middleware registra os eventos suportados pelo codigo e pela API atual da Nuvemshop, incluindo ciclo do aplicativo, pedidos, produtos e clientes.

O endpoint publico e:

`POST /webhooks/nuvemshop`

A assinatura recebida em `x-linkedstore-hmac-sha256` e validada antes de qualquer persistencia operacional. Depois da validacao, o evento recebe uma chave SHA-256 deterministica para idempotencia, e persistido no D1 e enviado para a Cloudflare Queue.

O consumidor da Queue executa o processamento assincrono com retry e dead-letter queue por ambiente.

## LGPD

Os callbacks obrigatorios de privacidade exigidos pela Nuvemshop para aplicativos no Brasil devem estar implementados e publicados antes da homologacao final. Nenhum dado pessoal deve ser armazenado sem finalidade operacional definida.

## Instalacao de staging

Quando o Worker estiver publicado e os secrets configurados, iniciar a instalacao acessando:

`https://<dominio-real-staging>/oauth/install`

O fluxo esperado e:

1. redirecionar para a autorizacao da Nuvemshop;
2. autorizar a loja Maison Decants;
3. receber o `code` no callback;
4. trocar o codigo por `access_token`;
5. criptografar o token antes de persistir no D1;
6. registrar os webhooks;
7. validar chamada simples da API e leitura de produtos.

## Criterio para producao

Promover `staging` para `main` somente depois de validar:

- `/health` = 200;
- OAuth real concluido;
- token criptografado;
- API respondendo;
- produtos consultados;
- webhooks recebidos;
- Queue consumindo;
- retry e idempotencia funcionando;
- D1 persistindo corretamente;
- nenhuma credencial em logs ou codigo.
