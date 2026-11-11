# Painel de monitoramento da frota

Aplicação publicada em [Cloudflare Workers](https://painel-monitoramento-frota.kleberlucas268.workers.dev/), com dados compartilhados no D1. Qualquer pessoa com o link pode consultar a frota. Atualizar os dados exige o segredo `IMPORT_TOKEN`, configurado como Secret no ambiente Production.

## Estrutura

- `public/`: interface responsiva, ilustrações e biblioteca SheetJS 0.20.3 para ler Excel no navegador. A licença da biblioteca está em `public/SheetJS-LICENSE.txt`.
- `src/worker.js`: API pública de leitura e API protegida de importação.
- `migrations/`: estrutura da tabela D1.
- `wrangler.jsonc`: configuração do Worker, arquivos estáticos e banco D1.

O navegador lê o Excel e envia ao Worker somente os campos necessários aos cartões: código do bem, placa, modelo, motorista, contadores, revisão, intervalo e manutenção. A coluna de endereço não é armazenada. O arquivo Excel não é enviado ao GitHub.

## Atualizar a frota

1. Exporte o relatório do Qlik em `.xlsx`, `.xls` ou `.xlsm`.
2. Abra o [painel](https://painel-monitoramento-frota.kleberlucas268.workers.dev/) e clique em **Atualizar frota**.
3. Selecione o arquivo, informe a chave de atualização e clique em **Publicar atualização**.

As linhas são agrupadas pelo campo `Bem`, resultando em um cartão por veículo. O contador atual vem de `Cont. Acumulado`. Quando há registro de revisão, a próxima é `Cont. Manutenção` + `Incremento Manut.`; `Cont. Restante` indica a distância até ela. A manutenção pertinente ao ciclo atual é escolhida entre as linhas do veículo, evitando tratar a primeira revisão antiga como próxima revisão.

O intervalo do relatório prevalece sobre os exemplos de referência. Sem registro de última revisão, o painel estima o próximo ciclo e mostra `estimativa`: 10.000 km para motocicletas e 30.000 km para caminhões e ônibus quando não houver outro intervalo no relatório. A tolerância exibida também é estimada quando ausente: 1.000 km ou 100 horas. Veículos medidos por horas usam `h` no lugar de `km`.

## Implantação

O repositório [kleberlucas268/painel-frota](https://github.com/kleberlucas268/painel-frota) está conectado ao Workers Builds na branch `main`. O diretório raiz do build é `/worker-app`; os comandos configurados são `npm install` e `npx wrangler deploy`. Mudanças nessa pasta disparam uma nova implantação. O `wrangler.jsonc` já contém o ID do banco D1 `painel-monitoramento-frota`.

Para rodar localmente, execute `npm install` e `npm run dev` dentro de `worker-app/`. A migração do D1 está em `migrations/0001_create_fleet_snapshot.sql`. O segredo `IMPORT_TOKEN` fica apenas no Cloudflare, nunca no repositório.

`GET /api/fleet` é público. `POST /api/import` exige `Authorization: Bearer <IMPORT_TOKEN>` e substitui o retrato compartilhado da frota. A chave não fica salva no navegador após a importação.

