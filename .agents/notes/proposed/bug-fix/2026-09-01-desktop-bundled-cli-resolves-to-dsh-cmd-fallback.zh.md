# Agent Note: App empacotada resolve o CLI para o fallback dsh.cmd

Status: proposed

[English](2026-09-01-desktop-bundled-cli-resolves-to-dsh-cmd-fallback.md) | 中文

## Problema

A app desktop do DeepSeek Harness (apps/desktop/src/main.js) lança o
backend web como um processo filho: encontra um executável do Node e depois
chama findDshTarget() para localizar a entrada do CLI dsh, então executa
"node <cli> web --no-open --port 3080". A app então faz polling de
http://127.0.0.1:3080 até responder, mostrando um modal
"Não foi possível conectar ao servidor backend na porta 3080" quando nada
escuta.

A build empacotada do Windows embarca toda a fonte dentro de
resources/app.asar (ver build.files em apps/desktop/package.json e
electron-builder com appOutDir=release/win-unpacked). Nenhum
apps/cli/lib/bin.js existe no filesystem real. A lista de candidatos de
findDshTarget() contiene três entradas de "App resources path" que apontam
para process.resourcesPath + 'apps/cli/lib/bin.js',
'resourcesPath + 'cli/lib/bin.js' e
'resourcesPath + 'app/apps/cli/lib/bin.js'. Nenhuma dessas existe, então
todas falham no fs.existsSync(). where.exe dsh também não está no PATH. A
função então retorna seu fallback final 'dsh.cmd', que o shell não
consegue resolver, então o processo sai com código 1 e nada escuta 3080. A
app mostra o modal de carregamento infinito e o usuário clica em OK para o
mesmo erro.

Este é um defeito na embalagem da build, não no sistema do usuário: o repo
de fonte inicializa normal via pnpm a partir de apps/cli/lib/bin.js, e o
falha original (a exceção não capturada do EPIPE quando o backend fecha o
pipe de stdout) é um crash separado, já registrado.

## Proposta

Corrigir findDshTarget() para que seu primeiro candidato de App resources
resolva o CLI de dentro do asar. process.resourcesPath já aponta para a
pasta resources/ dentro da app empacotada, e o asar está em
resources/app.asar. A app empacotada deve resolver a entrada do CLI aí, não
em nenhum path apps/cli/lib/bin.js no disco. Os candidatos no disco
(relative, common-repo, e dsh.cmd global) permanecem como fallbacks para
dev, sandbox, ou boots não empacotados.

Questões em aberto para quem finalizar isto:

- O usuário relatou que o arquivo .asar aparece solto na pasta e oferece-se
  a abrir com um editor de texto. Confirmar se isso é o instalador
  copiando o asar para onde não deveria, ou um artefato benigno de como a
  pasta release/ é inspecionada. Não embarcar uma build onde o asar está
  acessível fora do bundle da app.
- Decidir se mantém os fallbacks no disco como candidatos primários ou se
  faz do path do asar o único candidato Windows, para que uma refatoração
  futura não reintroduza o fallback que causou o bug.
- Considerar adicionar uma mensagem que falha alto e é útil quando o backend
  nunca escuta: o modal atual diz "Timeout waiting for server on port 3080"
  mesmo quando a causa real é que o CLI nunca foi encontrado.

## Alternativas consideradas

- **Embarcar um dsh.cmd pré-compilado no asar.** Adiciona um binário e um
  artefato de release a mais; o asar já contiene a entrada JS compilada,
  então duplica ela.
- **Manter os fallbacks no disco como candidatos primários.** Eles nunca
  existem numa build de release, que é exatamente o bug.
- **Hardcodar o path do asar com uma string literal.** Menos robusto que
  process.resourcesPath, que permanece correto em rebuilds e relaunches do
  electron.

## Critérios de aceitação

- A build empacotada do Windows resolve o CLI de dentro de
  resources/app.asar; o backend escuta 127.0.0.1:3080 e a app abre sem o
  modal.
- O asar não está acessível ou solto fora do bundle da app.
- Dev, sandbox e boots não empacotados ainda resolvem o CLI pelos fallbacks
  no disco.

## Riscos

O path do asar deve estar correto para o layout embarcado; uma mudança na
config do electron-builder para appOutDir ou na inclusão de arquivos pode
deslocá-lo. A correção não pode regredir os paths Linux e Windows não
empacotados que os fallbacks no disco servem.
