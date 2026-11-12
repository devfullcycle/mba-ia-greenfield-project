# Requisições HTTP da API StreamTube

Arquivos `.http` no formato do HTTP Client do JetBrains (IntelliJ, WebStorm).

| Arquivo | Conteúdo |
|---------|----------|
| `health.http` | Healthcheck, Swagger e Mailpit |
| `auth.http` | Registro, confirmação de e-mail (token lido do Mailpit), login, refresh, me, reset de senha, logout |
| `videos-upload.http` | Upload multipart completo (iniciar, enviar parte, renovar URLs, finalizar, abortar) |
| `videos-media.http` | Metadados, stream, download e thumbnail (com e sem `Range`) |
| `http-client.env.json` | Ambiente `dev` público (URLs e credenciais locais de teste) |

## Como usar

1. Suba o ambiente (`docker compose up -d`) e a API em `http://localhost:3000`.
2. Abra um `.http` no IntelliJ e escolha o ambiente **dev** no seletor no topo do editor.
3. Execute os requests com o botão verde ao lado de cada um (ou `Ctrl+Enter`).

## Ordem de execução

1. `auth.http`: rode o **login** (item 4). Ele guarda `accessToken` e `refreshToken` em variáveis globais.
   Para um usuário novo: registrar (1), buscar o e-mail no Mailpit (3a, 3b) e confirmar (3c) antes do login.
2. `videos-upload.http`: rode os itens 1, 2, 4 e 5 em ordem. O vídeo fica `READY` em poucos segundos
   (o worker precisa estar rodando). O `videoId` fica guardado para o próximo arquivo.
3. `videos-media.http`: usa o `videoId` do passo anterior (ou o vídeo de exemplo `WwXreTVSFP`).

## Observações

- O Swagger (`/api/docs`, `/api/docs-json`) só responde com `SWAGGER_ENABLED=true` no `.env` da API.
- O access token expira em **15 minutos**: ao receber 401, rode o login de novo.
- O arquivo de exemplo do upload (`test/video/fixtures/sample.mp4`, ~885 KB) cabe em uma parte só.
  Para arquivos maiores use o cliente de CLI: `npm run upload:video -- --file <caminho> --api http://localhost:3000 --token <access_token>`.
- A URL pré-assinada do upload aponta para `http://localhost:9000` (MinIO): não altere o header `Host`
  nem envie `Authorization` nesse request.
- O banco de dev é **compartilhado com os testes automatizados**. Não rode os testes e2e enquanto
  estiver usando esses dados, pois eles limpam o banco.
- Não há arquivo de ambiente privado: tudo no `http-client.env.json` é valor local, sem segredo.
