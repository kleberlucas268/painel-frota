# Painel de monitoramento da frota

Aplicação estática servida por um Cloudflare Worker, com dados compartilhados em Cloudflare D1. Qualquer pessoa com o link pode consultar a frota. A importação do relatório exige o segredo \`IMPORT_TOKEN\`.

## Projeto

- \`public/\`: interface responsiva e ilustrações vetoriais.
- \`src/worker.js\`: API pública de leitura e API protegida de importação.
- \`migrations/\`: estrutura do D1.
- \`wrangler.jsonc\`: configuração do Worker, arquivos estáticos e banco.

O Excel é processado no navegador que faz a atualização. O app publica somente código do bem, placa, modelo, motorista, contador, revisão e manutenção. A coluna de endereço não é lida para o banco e o arquivo Excel não é enviado ao GitHub.

## Preparar o Cloudflare

No terminal, dentro de \`worker-app/\`:

1. Instale as dependências: \`npm install\`.
2. Crie o banco D1: \`npm run db:create\`. Copie o ID retornado.
3. Substitua \`PREENCHER_COM_ID_DO_D1\` em \`wrangler.jsonc\` pelo ID do banco.
4. Aplique a tabela: \`npm run db:migrate:remote\`.
5. Crie o segredo de importação: \`npx wrangler secret put IMPORT_TOKEN\`. Digite uma senha longa e guarde-a.
6. Publique: \`npm run deploy\`.

A rota \`GET /api/fleet\` não exige login. A rota \`POST /api/import\` exige \`Authorization: Bearer <IMPORT_TOKEN>\`. O token não fica salvo no navegador; informe-o somente ao atualizar a planilha.

## Importar o relatório do Qlik

Abra a URL do Worker, selecione **Atualizar frota**, escolha o Excel exportado e informe o token de importação. As linhas são agrupadas pelo campo \`Bem\`; para cada veículo, o painel apresenta a manutenção com o menor contador restante disponível. Os intervalos padrão de referência são 10.000 km para motocicletas e 30.000 km para caminhões e ônibus quando o relatório não trouxer um intervalo.

## Conectar o GitHub ao Workers Builds

O repositório atual já contém um painel antigo na raiz. Este app fica isolado em \`worker-app/\`. Em **Workers & Pages → Create → Workers Builds**, conecte o repositório \`kleberlucas268/painel-frota\` e selecione a branch que contém esta pasta. Configure o diretório raiz como \`worker-app\`, o comando de implantação como \`npm run deploy\` e deixe o diretório de saída vazio. As alterações nessa branch passam a disparar os builds do Worker.

Se preferir manter a raiz antiga intacta, use a branch do app até revisar o pull request. O banco D1 e o segredo são configurados no Cloudflare; não os coloque no GitHub.

## Observações

- Os contadores e cartões são calculados a partir do Excel importado.
- O arquivo do relatório não deve ser colocado no repositório.
- Se uma coluna estiver vazia, o painel apresenta o dado como não informado.
- A tolerância padrão exibida quando o relatório não informa uma é de referência: 1.000 km ou 100 horas.
