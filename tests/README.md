# Fase 1A — validação de séries DICOM

Base de desenvolvimento/rollback: `1295efaf782e2f05cc7146a2fe5ac7ce551ba8c7`.
Branch: `etapa1-dicom-geometry`. Nenhuma mudança em `main` é necessária para testar.

## Executar

Requer Node.js 20 ou superior.

```sh
node --test tests/*.test.cjs
```

Para o navegador, instale as dependências de desenvolvimento e o Chromium:

```sh
npm install
npx playwright install chromium
npm run test:viewer
```

Para reproduzir exatamente o lockfile incluído, use `pnpm install --frozen-lockfile`
com pnpm 11 e depois `pnpm exec playwright install chromium` / `pnpm test:viewer`.

Também é possível definir `CHROME_PATH` com o caminho de um Chrome existente.
O teste inicia um servidor local temporário, usa um perfil isolado e encerra ambos
ao terminar. As bibliotecas do viewer são as mesmas versões usadas em produção.
O teste do PWA precisa de internet inicialmente para preencher o cache existente.

## Cobertura e limites

- Normalização de números/vetores, metadados ausentes e leitura das tags DICOM.
- Agrupamento por Study/Series/Frame of Reference; nenhuma seleção automática entre séries.
- Dimensões, Pixel Spacing anisotrópico e consistente, direções unitárias e ortogonais.
- Ordenação espacial, normal negativa, plano sagital e arredondamento dos cossenos.
- Duplicatas por SOP Instance UID ou posição, gaps, spacing irregular e deslocamento lateral.
- Uma fatia produz aviso; multi-frame/Enhanced é recusado nesta fase.
- No Chrome: arquivos DICOM binários **sintéticos**, decodificados pelas bibliotecas reais;
  ordem normal/invertida renderiza igual; entradas inválidas mantêm o exame anterior;
  brilho, filtros, régua com distância sintética conhecida de 2 mm, seletor de arcada e PNG continuam funcionando.
- PWA: shell, módulo e exame sintético abrem offline depois do preenchimento online do cache.

O relatório retornado por `validateImport` inclui `valid`, `series`, `errors`,
`warnings`, posições, normal e intervalos. Códigos de erro são estáveis para testes;
mensagens em português explicam a recusa. Os objetos ficam apenas em memória.

Tolerâncias operacionais: cossenos `1e-4`, posições duplicadas `0,001 mm`,
variação entre Pixel Spacings `1e-5 mm`, intervalos `max(0,01 mm, 1%)` e
deslocamento lateral `0,01 mm`. Um intervalo acima de 1,5 vezes o menor intervalo
observado (ou spacing declarado consistente, se menor) sinaliza uma possível lacuna.
Slice Thickness não é usado para inferir lacunas. Uma sequência uniformemente
subamostrada sem spacing declarado confiável pode não revelar cortes faltantes.

Séries com metadados obrigatórios ausentes, duplicatas, spacing irregular ou
deslocamento lateral são bloqueadas porque o renderer atual pressupõe uma grade
uniforme. Isso pode recusar exames que antes eram abertos sem validação. Não há
remoção automática de cortes nem reconstrução/interpolação nesta fase.

**Não testado:** exames clínicos reais, comparação com Romexis/Blue Sky Plan,
acurácia anatômica, medições clínicas, grandes volumes e dispositivos móveis.
Testes sintéticos não certificam o viewer para planejamento clínico.

Revisão independente: nenhum problema crítico/importante encontrado. Limite menor
conhecido: séries extremas de 150.000 cortes excedem o limite de argumentos em
`Math.min(...positive)`; isso não foi corrigido nesta entrega. Séries de 10.000
metadados passaram nessa verificação, sem testar decodificação/renderização nessa escala.

MPR, crosshair, navegação por arcada, zoom/pan, `app.js` e `service-worker.js`
permanecem como estavam. A Fase 1A não corrige ainda orientação anatômica nem
posicionamento por arcada. Cache e publicação devem ser revistos na etapa de
lançamento, especialmente para instalações antigas e primeira abertura offline.

Referência geométrica: [DICOM PS3.3 C.7.6.2](https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_C.7.6.2.html).
# ZIP/RAR import

Run `pnpm test` for metadata and archive unit tests, `pnpm test:archives` for the
real browser ZIP/RAR4/RAR5 flow, series selection, cancellation, preservation of
the current exam, desktop/mobile emulation and PWA offline extraction after
online warm-up. Set `CHROME_PATH` to an installed Chrome executable if needed.
`pnpm test:viewer` runs the existing DICOM/image controls regression suite.

The mobile test uses Chromium emulation, not a physical iOS/Android device.
Synthetic DICOM and stored RAR4/RAR5 fixtures verify the integration; they do
not establish support for every vendor's compressed RAR variant or DICOM codec.
ZIP is tested with DEFLATE. Archives with passwords or split volumes are refused.
Limits: 128 MiB archive, 256 MiB total expanded, 32 MiB per entry, 5000 entries.
Files stay in memory on the user's device; no examination is uploaded.
