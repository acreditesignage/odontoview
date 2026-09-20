(()=>{
      const $ = (id) => document.getElementById(id);
      const welcome = $('welcome');
      const viewerScreen = $('viewerScreen');
      const fileInput = $('fileInput');
      const dropZone = $('dropZone');
      const openButton = $('openButton');
      const dicomViewport = $('dicomViewport');
      const imageViewport = $('imageViewport');
      const mprGrid = $('mprGrid');
      const fileName = $('fileName');
      const status = $('status');
      const sliceRangeWrap = $('sliceRangeWrap');
      const sliceRange = $('sliceRange');
      const sliceCount = $('sliceCount');
      const loading = $('loading');
      const loadingText = $('loadingText');
      const toast = $('toast');
      const adjustImage = $('adjustImage');
      const adjustPanel = $('adjustPanel');
      const brightnessRange = $('brightnessRange');
      const contrastRange = $('contrastRange');
      const brightnessValue = $('brightnessValue');
      const contrastValue = $('contrastValue');
      const artifactBtn = $('artifactBtn');
      const artifactNote = $('artifactNote');
      const noiseBtn = $('noiseBtn');
      const noiseNote = $('noiseNote');
      const rulerBtn = $('rulerBtn');
      const measureNote = $('measureNote');
      const measurePill = $('measurePill');
      const measureText = $('measureText');
      const measureValue = $('measureValue');

      const aiAssistBtn = $('aiAssistBtn');
      const aiPanel = $('aiPanel');
      const aiClose = $('aiClose');
      const generateReport = $('generateReport');
      const copyReport = $('copyReport');
      const reportType = $('reportType');
      const reportRegion = $('reportRegion');
      const reportOutput = $('reportOutput');
      const aiOutputStatus = $('aiOutputStatus');
      const aiStatExam = $('aiStatExam');
      const aiStatSlices = $('aiStatSlices');
      const aiStatCursor = $('aiStatCursor');
      const aiStatSpacing = $('aiStatSpacing');

      const canvases = {
        axial: $('canvasAxial'),
        coronal: $('canvasCoronal'),
        sagittal: $('canvasSagittal')
      };
      const metas = {
        axial: $('metaAxial'),
        coronal: $('metaCoronal'),
        sagittal: $('metaSagittal')
      };

      let mode = null;
      let imageUrl = null;
      let imageScale = 1;
      let dicomImageIds = [];
      let currentIndex = 0;
      let cornerstoneReady = false;
      let toastTimer = null;
      let baseWindowCenter = 40;
      let baseWindowWidth = 400;
      let artifactOn = false;
      let noiseOn = false;
      let activePlane = 'axial';
      let spacingX = 1, spacingY = 1, spacingZ = 1;
      let spacingKnown = false;

      let volume = null; // Int16Array, z-major
      let volW = 0, volH = 0, volD = 0;
      let cursor = { x: 0, y: 0, z: 0 };
      let cleanedVolume = null;
      let denoisedVolume = null;
      let measurement = null;
      let rulerMode = false;
      let renderQueued = false;
      let preparedSeries = [];

      function hideAdjustPanel() {
        adjustPanel.classList.remove('show');
        adjustImage.classList.remove('active');
      }

      function syncAdjustmentUI() {
        brightnessValue.textContent = brightnessRange.value;
        contrastValue.textContent = `${contrastRange.value}%`;
      }

      function resetAdjustmentsUI() {
        brightnessRange.value = 0;
        contrastRange.value = 100;
        syncAdjustmentUI();
      }



      function hideAiPanel() {
        aiPanel.classList.remove('show');
        aiAssistBtn.classList.remove('active');
      }

      function updateAiSummary() {
        aiStatExam.textContent = mode === 'dicom' && volume ? `${fileName.textContent} • ${volW}×${volH}×${volD}` : (fileName.textContent || 'Nenhum exame');
        aiStatSlices.textContent = volume ? `A ${volD} • C ${volH} • S ${volW}` : 'Axial • Coronal • Sagital';
        aiStatCursor.textContent = volume ? `X ${cursor.x + 1} • Y ${cursor.y + 1} • Z ${cursor.z + 1}` : 'Centro do volume';
        aiStatSpacing.textContent = volume ? `${spacingX.toFixed(2)} × ${spacingY.toFixed(2)} × ${spacingZ.toFixed(2)} mm` : 'Aguardando DICOM';
      }

      function reportHeaderText() {
        const examName = fileName.textContent || 'Exame local';
        const region = reportRegion.value.trim() || 'Região selecionada pelo profissional';
        const today = new Date().toLocaleString('pt-BR');
        return [
          'PRÉ-LAUDO ODONTOLÓGICO ASSISTIDO',
          `Exame: ${examName}`,
          `Tipo: ${reportType.options[reportType.selectedIndex].text}`,
          `Região de interesse: ${region}`,
          `Gerado em: ${today}`,
          'Status: rascunho para revisão profissional',
          ''
        ].join(String.fromCharCode(10));
      }

      function reportFooterText() {
        return [
          '',
          'Aviso:',
          'Este conteúdo foi gerado em modo demonstrativo e deve ser revisado, confirmado e validado por profissional habilitado antes de qualquer uso clínico, diagnóstico ou terapêutico.'
        ].join(String.fromCharCode(10));
      }

      function buildDemoReport() {
        updateAiSummary();
        const region = reportRegion.value.trim() || 'Região selecionada pelo profissional';
        const dims = volume ? `${volW} x ${volH} x ${volD}` : 'não disponível';
        const spacingText = volume ? `${spacingX.toFixed(2)} x ${spacingY.toFixed(2)} x ${spacingZ.toFixed(2)} mm` : 'não disponível';
        let body = '';
        if (reportType.value === 'siso') {
          body = [
            'Achados observados:',
            `- Exame tomográfico analisado em cortes axial, coronal e sagital, com foco em ${region}.`,
            '- A interface localiza a região de interesse e permite revisão multiplanar para avaliação de posição dentária, relação com estruturas adjacentes e planejamento cirúrgico.',
            '- Recomenda-se revisar especialmente inclinação do terceiro molar, padrão radicular, proximidade com o canal mandibular e necessidade de osteotomia/odontosecção.',
            `- Posição atual do cursor no volume: X ${cursor.x + 1}, Y ${cursor.y + 1}, Z ${cursor.z + 1}.`,
            '',
            'Conclusão sugerida:',
            `- Achados compatíveis com estudo pré-operatório da região ${region}, exigindo correlação clínica e revisão profissional das relações anatômicas observadas.`,
            '',
            'Pontos de atenção:',
            '- revisar proximidade com nervo alveolar inferior;',
            '- revisar forma e divergência radicular;',
            '- avaliar contato com o segundo molar adjacente;',
            '- considerar acesso cirúrgico e necessidade de odontosecção.'
          ].join(String.fromCharCode(10));
        } else if (reportType.value === 'implante') {
          body = [
            'Achados observados:',
            `- Exame tomográfico avaliado nos três planos com foco em ${region}.`,
            '- A navegação multiplanar permite revisar altura óssea, espessura vestíbulo-lingual/palatina e relação com estruturas anatômicas relevantes.',
            '- O caso deve ser conferido quanto à proximidade com canal mandibular, seio maxilar e eixo protético desejado.',
            `- Volume carregado: ${dims}. Espaçamento estimado: ${spacingText}.`,
            '',
            'Conclusão sugerida:',
            `- Região ${region} com potencial para planejamento implantar, condicionado à confirmação das medidas ósseas e à revisão profissional das relações anatômicas.`,
            '',
            'Pontos de atenção:',
            '- confirmar altura óssea disponível;',
            '- confirmar espessura óssea vestibulolingual;',
            '- revisar distância de estruturas nobres;',
            '- integrar planejamento protético-cirúrgico.'
          ].join(String.fromCharCode(10));
        } else {
          body = [
            'Achados observados:',
            `- Exame odontológico revisado em cortes axial, coronal e sagital, com foco em ${region}.`,
            '- O visualizador permite inspeção multiplanar da anatomia dentária e óssea, navegação por fatias e medições diretas com régua.',
            '- Devem ser revisadas presença/ausência dentária, áreas periapicais suspeitas, perdas ósseas aparentes, relações anatômicas relevantes e eventuais alterações estruturais visíveis.',
            `- Volume carregado: ${dims}. Espaçamento estimado: ${spacingText}.`,
            '',
            'Conclusão sugerida:',
            `- Exame apto para revisão clínica detalhada da região ${region}, recomendando-se correlação com a história clínica e validação profissional dos achados.`,
            '',
            'Pontos de atenção:',
            '- revisar dentes inclusos e impactados;',
            '- revisar áreas periapicais e padrão ósseo periodontal;',
            '- revisar estruturas anatômicas adjacentes;',
            '- complementar com descrição clínica final pelo profissional.'
          ].join(String.fromCharCode(10));
        }
        return reportHeaderText() + body + reportFooterText();
      }

      function clearMeasurement() {
        measurement = null;
        measurePill.classList.remove('show');
        measureText.textContent = 'Régua pronta';
        measureValue.textContent = '—';
      }

      function updateMeasureNote() {
        measureNote.textContent = rulerMode ? 'Régua: ativa' : 'Régua: desligada';
      }

      function voxelFromHit(hit) {
        if (!hit) return null;
        if (hit.plane === 'axial') return { x: hit.i, y: hit.j, z: cursor.z, plane: hit.plane };
        if (hit.plane === 'coronal') return { x: hit.i, y: cursor.y, z: hit.j, plane: hit.plane };
        return { x: cursor.x, y: hit.i, z: hit.j, plane: hit.plane };
      }

      function planeCoords(point, plane) {
        if (!point) return null;
        if (plane === 'axial') return { a: point.x, b: point.y };
        if (plane === 'coronal') return { a: point.x, b: point.z };
        return { a: point.y, b: point.z };
      }

      function spacingForPlane(plane) {
        if (plane === 'axial') return [spacingX, spacingY];
        if (plane === 'coronal') return [spacingX, spacingZ];
        return [spacingY, spacingZ];
      }

      function measurementLengthMm(m) {
        const [sa, sb] = spacingForPlane(m.plane);
        const p1 = planeCoords(m.start, m.plane);
        const p2 = planeCoords(m.end, m.plane);
        if (!p1 || !p2) return null;
        const da = (p2.a - p1.a) * sa;
        const db = (p2.b - p1.b) * sb;
        return Math.sqrt(da * da + db * db);
      }

      function updateMeasurementPill() {
        if (!measurement || !measurement.start) {
          measurePill.classList.remove('show');
          measureText.textContent = 'Régua pronta';
          measureValue.textContent = '—';
          return;
        }
        measurePill.classList.add('show');
        if (!measurement.end) {
          measureText.textContent = 'Régua';
          measureValue.textContent = 'Marque o 2º ponto';
          return;
        }
        const len = measurementLengthMm(measurement);
        measureText.textContent = `Régua • ${measurement.plane.charAt(0).toUpperCase() + measurement.plane.slice(1)}`;
        measureValue.textContent = len != null ? `${len.toFixed(2)} mm` : '—';
      }

      function handleMeasureHit(hit) {
        const point = voxelFromHit(hit);
        if (!point) return;
        if (!measurement || measurement.plane !== hit.plane || (measurement.start && measurement.end)) {
          measurement = { plane: hit.plane, start: point, end: null };
        } else if (!measurement.start) {
          measurement.start = point;
        } else {
          measurement.end = point;
        }
        updateMeasurementPill();
        queueRender();
      }

      function currentWL() {
        const brightness = Number(brightnessRange.value) / 100;
        const contrast = Number(contrastRange.value) / 100;
        const wc = baseWindowCenter + (brightness * baseWindowWidth);
        const ww = Math.max(1, baseWindowWidth * contrast);
        return { wc, ww };
      }

      function applyDicomAdjustments() {
        syncAdjustmentUI();
        queueRender();
      }

      function showToast(message) {
        toast.textContent = message;
        toast.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
      }

      function setLoading(show, text = 'Abrindo exame…') {
        loadingText.textContent = text;
        loading.classList.toggle('show', show);
      }

      function showViewer() {
        welcome.style.display = 'none';
        viewerScreen.classList.add('active');
        setTimeout(resizeViewer, 0);
      }

      function resizeViewer() {
        queueRender();
        if (mode === 'dicom' && cornerstoneReady && window.cornerstone && dicomViewport.style.display !== 'none') {
          try { cornerstone.resize(dicomViewport, true); } catch (_) {}
        }
      }

      function openPicker() {
        fileInput.value = '';
        fileInput.click();
      }

      openButton.addEventListener('click', (e) => { e.stopPropagation(); openPicker(); });
      dropZone.addEventListener('click', openPicker);
      dropZone.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPicker(); }
      });

      ['dragenter', 'dragover'].forEach(type => dropZone.addEventListener(type, e => {
        e.preventDefault();
        dropZone.classList.add('dragging');
      }));
      ['dragleave', 'drop'].forEach(type => dropZone.addEventListener(type, e => {
        e.preventDefault();
        dropZone.classList.remove('dragging');
      }));
      dropZone.addEventListener('drop', e => handleFiles([...e.dataTransfer.files]));
      fileInput.addEventListener('change', e => handleFiles([...e.target.files]));

      function looksLikeImage(file) {
        return file.type.startsWith('image/') || /\.(jpe?g|png|webp|gif)$/i.test(file.name);
      }

      async function handleFiles(files) {
        if (!files.length) return;
        setLoading(true, 'Lendo arquivos…');
        showViewer();
        try {
          if (files.length === 1 && looksLikeImage(files[0])) {
            openStandardImage(files[0]);
            return;
          }
          await openDicomFiles(files);
        } catch (err) {
          console.error(err);
          setLoading(false);
          showToast('Não consegui abrir esse exame nesta versão. Tente um DICOM P10, JPG ou PNG.');
        }
      }

      function hideMpr() {
        mprGrid.classList.remove('show');
      }

      function showMpr() {
        mprGrid.classList.add('show');
        dicomViewport.style.display = 'none';
        imageViewport.style.display = 'none';
      }

      function openStandardImage(file) {
        mode = 'image';
        volume = null;
        cleanedVolume = null;
        denoisedVolume = null;
        artifactOn = false;
        noiseOn = false;
        artifactBtn.classList.remove('artifact-on');
        noiseBtn.classList.remove('noise-on');
        rulerMode = false;
        rulerBtn.classList.remove('ruler-on');
        clearMeasurement();
        updateMeasureNote();
        if (artifactNote) artifactNote.textContent = 'Artefatos: desligado';
        if (noiseNote) noiseNote.textContent = 'Ruído: desligado';
        hideMpr();
        if (imageUrl) URL.revokeObjectURL(imageUrl);
        imageUrl = URL.createObjectURL(file);
        imageScale = 1;
        imageViewport.src = imageUrl;
        imageViewport.style.display = 'block';
        imageViewport.style.transform = 'scale(1)';
        dicomViewport.style.display = 'none';
        sliceRangeWrap.classList.remove('show');
        fileName.textContent = file.name;
        status.textContent = 'Imagem local • não salva';
        hideAdjustPanel();
        updateAiSummary();
        setLoading(false);
      }

      function ensureCornerstone() {
        if (!window.cornerstone || !window.dicomParser || !window.cornerstoneWADOImageLoader) {
          throw new Error('Bibliotecas DICOM não carregadas. Verifique a conexão com a internet.');
        }
        if (!cornerstoneReady) {
          cornerstoneWADOImageLoader.external.cornerstone = cornerstone;
          cornerstoneWADOImageLoader.external.dicomParser = dicomParser;
          cornerstoneWADOImageLoader.configure({ useWebWorkers: false });
          cornerstone.enable(dicomViewport);
          cornerstoneReady = true;
        }
      }

      async function readDicomMeta(file) {
        try {
          const buffer = await file.arrayBuffer();
          const dataSet = dicomParser.parseDicom(new Uint8Array(buffer));
          const instanceNumber = Number.parseInt(dataSet.string('x00200013') || '', 10);
          const sliceLocation = Number.parseFloat(dataSet.string('x00201041') || '');
          const imagePosition = (dataSet.string('x00200032') || '').split('\\').map(Number);
          return {
            instanceNumber: Number.isFinite(instanceNumber) ? instanceNumber : Number.MAX_SAFE_INTEGER,
            sliceLocation: Number.isFinite(sliceLocation) ? sliceLocation : null,
            zPos: Number.isFinite(imagePosition[2]) ? imagePosition[2] : null
          };
        } catch (_) {
          return { instanceNumber: Number.MAX_SAFE_INTEGER, sliceLocation: null, zPos: null };
        }
      }

      async function openDicomFiles(files) {
        ensureCornerstone();
        mode = 'dicom';
        imageViewport.style.display = 'none';
        dicomViewport.style.display = 'none';
        cornerstoneWADOImageLoader.wadouri.fileManager.purge();
        setLoading(true, files.length > 1 ? `Montando volume • ${files.length} fatias…` : 'Abrindo DICOM…');

        const prepared = await Promise.all(files.map(async (file, originalIndex) => ({
          file,
          originalIndex,
          ...(await readDicomMeta(file))
        })));

        prepared.sort((a, b) => {
          if (a.zPos != null && b.zPos != null && a.zPos !== b.zPos) return a.zPos - b.zPos;
          if (a.sliceLocation != null && b.sliceLocation != null && a.sliceLocation !== b.sliceLocation) {
            return a.sliceLocation - b.sliceLocation;
          }
          if (a.instanceNumber !== b.instanceNumber) return a.instanceNumber - b.instanceNumber;
          return a.file.name.localeCompare(b.file.name, undefined, { numeric: true });
        });

        preparedSeries = prepared;
        dicomImageIds = prepared.map(item => cornerstoneWADOImageLoader.wadouri.fileManager.add(item.file));
        currentIndex = 0;
        artifactOn = false;
        noiseOn = false;
        cleanedVolume = null;
        denoisedVolume = null;
        artifactBtn.classList.remove('artifact-on');
        noiseBtn.classList.remove('noise-on');
        if (artifactNote) artifactNote.textContent = 'Artefatos: desligado';
        if (noiseNote) noiseNote.textContent = 'Ruído: desligado';
        rulerMode = false;
        rulerBtn.classList.remove('ruler-on');
        clearMeasurement();
        updateMeasureNote();

        fileName.textContent = files.length === 1 ? files[0].name : `Volume DICOM • ${files.length} fatias`;
        resetAdjustmentsUI();
        hideAdjustPanel();

        await buildVolume();
        showMpr();
        sliceRangeWrap.classList.add('show');
        sliceRangeWrap.classList.add('multi');
        syncSliceSlider();
        setLoading(false);
        queueRender();
        status.textContent = volD > 1
          ? `3 cortes • ${volW}×${volH}×${volD} • local • não salvo`
          : 'DICOM local • volume de 1 fatia';
      }

      async function buildVolume() {
        const first = await cornerstone.loadAndCacheImage(dicomImageIds[0]);
        volW = first.columns;
        volH = first.rows;
        volD = dicomImageIds.length;
        volume = new Int16Array(volW * volH * volD);

        spacingX = Number(first.columnPixelSpacing) || 1;
        spacingY = Number(first.rowPixelSpacing) || 1;
        const zPositions = [];
        for (const item of preparedSeries || []) {
          if (item && Number.isFinite(item.zPos)) zPositions.push(item.zPos);
        }
        let derivedZ = null;
        for (let i = 1; i < zPositions.length; i++) {
          const diff = Math.abs(zPositions[i] - zPositions[i - 1]);
          if (diff > 0.0001) { derivedZ = diff; break; }
        }
        spacingZ = derivedZ || Number(first.sliceThickness) || 1;
        spacingKnown = Number.isFinite(spacingX) && Number.isFinite(spacingY) && Number.isFinite(spacingZ);

        const slope = Number(first.slope) || 1;
        const intercept = Number(first.intercept) || 0;
        if (Number.isFinite(first.windowCenter)) {
          baseWindowCenter = Array.isArray(first.windowCenter) ? first.windowCenter[0] : first.windowCenter;
        } else {
          baseWindowCenter = 400;
        }
        if (Number.isFinite(first.windowWidth) && first.windowWidth > 0) {
          baseWindowWidth = Array.isArray(first.windowWidth) ? first.windowWidth[0] : first.windowWidth;
        } else {
          baseWindowWidth = 2000;
        }

        for (let z = 0; z < volD; z++) {
          if (z % 8 === 0) setLoading(true, `Montando volume… ${z + 1}/${volD}`);
          const image = z === 0 ? first : await cornerstone.loadAndCacheImage(dicomImageIds[z]);
          const pixels = image.getPixelData();
          const s = Number(image.slope) || slope;
          const i = Number(image.intercept) || intercept;
          const offset = z * volW * volH;
          const n = volW * volH;
          for (let p = 0; p < n; p++) volume[offset + p] = (pixels[p] * s) + i;
        }

        cursor = {
          x: Math.floor(volW / 2),
          y: Math.floor(volH / 2),
          z: Math.floor(volD / 2)
        };
      }

      function sample(src, x, y, z) {
        if (x < 0 || y < 0 || z < 0 || x >= volW || y >= volH || z >= volD) return 0;
        return src[z * volW * volH + y * volW + x];
      }

      function reduceArtifacts(src) {
        const out = new Int16Array(src.length);
        out.set(src);
        const planeSize = volW * volH;
        // Threshold metal on a subsample
        let min = Infinity, max = -Infinity;
        for (let i = 0; i < src.length; i += 17) {
          const v = src[i];
          if (v < min) min = v;
          if (v > max) max = v;
        }
        const metalCut = min + (max - min) * 0.92;

        for (let z = 0; z < volD; z++) {
          const zOff = z * planeSize;
          for (let y = 1; y < volH - 1; y++) {
            for (let x = 1; x < volW - 1; x++) {
              const idx = zOff + y * volW + x;
              const v = src[idx];
              // 3x3 median-ish + metal inpaint
              const neigh = [];
              for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                  neigh.push(src[zOff + (y + dy) * volW + (x + dx)]);
                }
              }
              neigh.sort((a, b) => a - b);
              const med = neigh[4];
              if (v >= metalCut) {
                const soft = neigh.filter(n => n < metalCut);
                out[idx] = soft.length ? soft[Math.floor(soft.length / 2)] : med;
              } else if (Math.abs(v - med) > (baseWindowWidth * 0.35)) {
                out[idx] = med;
              }
            }
          }
        }
        return out;
      }


      function reduceNoiseVolume(src) {
        const out = new Int16Array(src.length);
        const planeSize = volW * volH;
        for (let z = 0; z < volD; z++) {
          const zOff = z * planeSize;
          for (let y = 0; y < volH; y++) {
            for (let x = 0; x < volW; x++) {
              let sum = 0;
              let weight = 0;
              for (let dy = -1; dy <= 1; dy++) {
                const yy = y + dy;
                if (yy < 0 || yy >= volH) continue;
                for (let dx = -1; dx <= 1; dx++) {
                  const xx = x + dx;
                  if (xx < 0 || xx >= volW) continue;
                  const w = (dx === 0 && dy === 0) ? 4 : ((dx === 0 || dy === 0) ? 2 : 1);
                  sum += src[zOff + yy * volW + xx] * w;
                  weight += w;
                }
              }
              out[zOff + y * volW + x] = Math.round(sum / weight);
            }
          }
        }
        return out;
      }


      function activeVolume() {
        if (noiseOn) {
          if (!denoisedVolume && volume) denoisedVolume = reduceNoiseVolume(volume);
          return denoisedVolume || volume;
        }
        if (artifactOn) {
          if (!cleanedVolume && volume) cleanedVolume = reduceArtifacts(volume);
          return cleanedVolume || volume;
        }
        return volume;
      }

      function applyWL(value, wc, ww) {
        const lo = wc - ww / 2;
        const hi = wc + ww / 2;
        if (value <= lo) return 0;
        if (value >= hi) return 255;
        return ((value - lo) / ww) * 255;
      }

      function fitCanvas(canvas) {
        const rect = canvas.parentElement.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = Math.max(1, Math.floor(rect.width * dpr));
        const h = Math.max(1, Math.floor(rect.height * dpr));
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        return { w, h, dpr, cssW: rect.width, cssH: rect.height };
      }

      function drawPlane(plane) {
        if (!volume) return;
        const canvas = canvases[plane];
        const ctx = canvas.getContext('2d', { alpha: false });
        const { w, h } = fitCanvas(canvas);
        const src = activeVolume();
        const { wc, ww } = currentWL();

        let pw, ph;
        if (plane === 'axial') { pw = volW; ph = volH; }
        else if (plane === 'coronal') { pw = volW; ph = volD; }
        else { pw = volH; ph = volD; }

        const scale = Math.min(w / pw, h / ph);
        const dw = pw * scale;
        const dh = ph * scale;
        const ox = (w - dw) / 2;
        const oy = (h - dh) / 2;

        const img = ctx.createImageData(pw, ph);
        const data = img.data;
        let p = 0;
        if (plane === 'axial') {
          const z = cursor.z;
          for (let y = 0; y < volH; y++) {
            for (let x = 0; x < volW; x++) {
              const g = applyWL(sample(src, x, y, z), wc, ww);
              data[p++] = g; data[p++] = g; data[p++] = g; data[p++] = 255;
            }
          }
        } else if (plane === 'coronal') {
          const y = cursor.y;
          for (let z = 0; z < volD; z++) {
            for (let x = 0; x < volW; x++) {
              const g = applyWL(sample(src, x, y, z), wc, ww);
              data[p++] = g; data[p++] = g; data[p++] = g; data[p++] = 255;
            }
          }
        } else {
          const x = cursor.x;
          for (let z = 0; z < volD; z++) {
            for (let y = 0; y < volH; y++) {
              const g = applyWL(sample(src, x, y, z), wc, ww);
              data[p++] = g; data[p++] = g; data[p++] = g; data[p++] = 255;
            }
          }
        }

        const tmp = document.createElement('canvas');
        tmp.width = pw;
        tmp.height = ph;
        tmp.getContext('2d').putImageData(img, 0, 0);

        ctx.fillStyle = '#080a0d';
        ctx.fillRect(0, 0, w, h);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(tmp, ox, oy, dw, dh);

        // crosshair
        ctx.save();
        ctx.strokeStyle = 'rgba(80, 200, 255, .85)';
        ctx.lineWidth = 1;
        let hx, hy, vx, vy;
        if (plane === 'axial') {
          hx = ox + (cursor.x + 0.5) * scale;
          hy = oy + (cursor.y + 0.5) * scale;
        } else if (plane === 'coronal') {
          hx = ox + (cursor.x + 0.5) * scale;
          hy = oy + (cursor.z + 0.5) * scale;
        } else {
          hx = ox + (cursor.y + 0.5) * scale;
          hy = oy + (cursor.z + 0.5) * scale;
        }
        ctx.beginPath();
        ctx.moveTo(hx, oy);
        ctx.lineTo(hx, oy + dh);
        ctx.moveTo(ox, hy);
        ctx.lineTo(ox + dw, hy);
        ctx.stroke();
        ctx.restore();


        if (measurement && measurement.plane === plane && measurement.start) {
          const p1 = planeCoords(measurement.start, plane);
          const x1 = ox + (p1.a + 0.5) * scale;
          const y1 = oy + (p1.b + 0.5) * scale;
          ctx.save();
          ctx.fillStyle = 'rgba(245, 158, 11, .95)';
          ctx.strokeStyle = 'rgba(245, 158, 11, .95)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(x1, y1, 4, 0, Math.PI * 2);
          ctx.fill();
          if (measurement.end) {
            const p2 = planeCoords(measurement.end, plane);
            const x2 = ox + (p2.a + 0.5) * scale;
            const y2 = oy + (p2.b + 0.5) * scale;
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(x2, y2, 4, 0, Math.PI * 2);
            ctx.fill();
            const len = measurementLengthMm(measurement);
            if (len != null) {
              const mx = (x1 + x2) / 2;
              const my = (y1 + y2) / 2;
              const label = `${len.toFixed(2)} mm`;
              ctx.font = '12px Inter, sans-serif';
              const tw = ctx.measureText(label).width;
              ctx.fillStyle = 'rgba(20, 23, 29, .82)';
              ctx.fillRect(mx - tw / 2 - 8, my - 18, tw + 16, 20);
              ctx.fillStyle = 'white';
              ctx.fillText(label, mx - tw / 2, my - 4);
            }
          }
          ctx.restore();
        }

        canvas._map = { ox, oy, scale, pw, ph, plane };

        if (plane === 'axial') metas.axial.textContent = `Z ${cursor.z + 1}/${volD}`;
        if (plane === 'coronal') metas.coronal.textContent = `Y ${cursor.y + 1}/${volH}`;
        if (plane === 'sagittal') metas.sagittal.textContent = `X ${cursor.x + 1}/${volW}`;
      }

      function renderAll() {
        if (!volume) return;
        drawPlane('axial');
        drawPlane('coronal');
        drawPlane('sagittal');
        syncSliceSlider();
        updateAiSummary();
      }

      function queueRender() {
        if (renderQueued) return;
        renderQueued = true;
        requestAnimationFrame(() => {
          renderQueued = false;
          renderAll();
        });
      }

      function syncSliceSlider() {
        if (!volume) return;
        if (activePlane === 'axial') {
          sliceRange.min = 0;
          sliceRange.max = Math.max(0, volD - 1);
          sliceRange.value = cursor.z;
          sliceCount.textContent = `Axial ${cursor.z + 1}/${volD}`;
        } else if (activePlane === 'coronal') {
          sliceRange.min = 0;
          sliceRange.max = Math.max(0, volH - 1);
          sliceRange.value = cursor.y;
          sliceCount.textContent = `Coronal ${cursor.y + 1}/${volH}`;
        } else {
          sliceRange.min = 0;
          sliceRange.max = Math.max(0, volW - 1);
          sliceRange.value = cursor.x;
          sliceCount.textContent = `Sagital ${cursor.x + 1}/${volW}`;
        }
      }

      function setActivePlane(plane) {
        activePlane = plane;
        document.querySelectorAll('.mpr-pane').forEach(el => {
          el.classList.toggle('active-pane', el.dataset.plane === plane);
        });
        syncSliceSlider();
      }

      function canvasToVoxel(canvas, ev) {
        const map = canvas._map;
        if (!map) return null;
        const rect = canvas.getBoundingClientRect();
        const dpr = canvas.width / rect.width;
        const cx = (ev.clientX - rect.left) * dpr;
        const cy = (ev.clientY - rect.top) * dpr;
        const i = Math.floor((cx - map.ox) / map.scale);
        const j = Math.floor((cy - map.oy) / map.scale);
        if (i < 0 || j < 0 || i >= map.pw || j >= map.ph) return null;
        return { i, j, plane: map.plane };
      }

      function applyPick(hit) {
        if (!hit) return;
        if (hit.plane === 'axial') {
          cursor.x = hit.i;
          cursor.y = hit.j;
        } else if (hit.plane === 'coronal') {
          cursor.x = hit.i;
          cursor.z = hit.j;
        } else {
          cursor.y = hit.i;
          cursor.z = hit.j;
        }
        queueRender();
      }

      Object.entries(canvases).forEach(([plane, canvas]) => {
        canvas.addEventListener('pointerdown', ev => {
          setActivePlane(plane);
          const hit = canvasToVoxel(canvas, ev);
          if (rulerMode) {
            handleMeasureHit(hit);
          } else {
            applyPick(hit);
          }
          canvas.setPointerCapture(ev.pointerId);
        });
        canvas.addEventListener('pointermove', ev => {
          if (!ev.buttons || rulerMode) return;
          applyPick(canvasToVoxel(canvas, ev));
        });
        canvas.addEventListener('wheel', ev => {
          ev.preventDefault();
          setActivePlane(plane);
          const step = ev.deltaY > 0 ? 1 : -1;
          if (plane === 'axial') cursor.z = Math.min(Math.max(cursor.z + step, 0), volD - 1);
          if (plane === 'coronal') cursor.y = Math.min(Math.max(cursor.y + step, 0), volH - 1);
          if (plane === 'sagittal') cursor.x = Math.min(Math.max(cursor.x + step, 0), volW - 1);
          queueRender();
        }, { passive: false });
      });

      sliceRange.addEventListener('input', e => {
        const v = Number(e.target.value);
        if (activePlane === 'axial') cursor.z = v;
        else if (activePlane === 'coronal') cursor.y = v;
        else cursor.x = v;
        queueRender();
      });

      viewerScreen.addEventListener('wheel', async e => {
        if (mode !== 'dicom' || volume) return;
      }, { passive: false });

      function zoom(factor) {
        if (mode === 'image') {
          imageScale = Math.min(Math.max(imageScale * factor, .2), 8);
          imageViewport.style.transform = `scale(${imageScale})`;
        } else {
          const next = Number(contrastRange.value) * (factor > 1 ? 0.92 : 1.08);
          contrastRange.value = String(Math.min(300, Math.max(20, next)));
          applyDicomAdjustments();
        }
      }

      artifactBtn.addEventListener('click', () => {
        if (mode !== 'dicom' || !volume) {
          showToast('Abra um volume DICOM para retirar artefatos.');
          return;
        }
        artifactOn = !artifactOn;
        if (artifactOn) {
          noiseOn = false;
          denoisedVolume = null;
          noiseBtn.classList.remove('noise-on');
          if (noiseNote) noiseNote.textContent = 'Ruído: desligado';
        }
        artifactBtn.classList.toggle('artifact-on', artifactOn);
        if (artifactOn) {
          setLoading(true, 'Reduzindo artefatos metálicos…');
          setTimeout(() => {
            cleanedVolume = reduceArtifacts(volume);
            setLoading(false);
            queueRender();
            showToast('Filtro de artefatos ligado. Não altera o arquivo original.');
          }, 30);
        } else {
          queueRender();
          showToast('Filtro de artefatos desligado.');
        }
        if (artifactNote) artifactNote.textContent = artifactOn ? 'Artefatos: filtro ativo' : 'Artefatos: desligado';
      });

      noiseBtn.addEventListener('click', () => {
        if (mode !== 'dicom' || !volume) {
          showToast('Abra um volume DICOM para retirar ruído.');
          return;
        }
        noiseOn = !noiseOn;
        if (noiseOn) {
          artifactOn = false;
          cleanedVolume = null;
          artifactBtn.classList.remove('artifact-on');
          if (artifactNote) artifactNote.textContent = 'Artefatos: desligado';
        }
        noiseBtn.classList.toggle('noise-on', noiseOn);
        if (noiseOn) {
          setLoading(true, 'Suavizando ruído da imagem…');
          setTimeout(() => {
            denoisedVolume = reduceNoiseVolume(volume);
            setLoading(false);
            queueRender();
            showToast('Filtro de ruído ligado. Não altera o arquivo original.');
          }, 30);
        } else {
          queueRender();
          showToast('Filtro de ruído desligado.');
        }
        if (noiseNote) noiseNote.textContent = noiseOn ? 'Ruído: filtro ativo' : 'Ruído: desligado';
      });

      rulerBtn.addEventListener('click', () => {
        if (mode !== 'dicom' || !volume) {
          showToast('Abra um volume DICOM para usar a régua.');
          return;
        }
        rulerMode = !rulerMode;
        rulerBtn.classList.toggle('ruler-on', rulerMode);
        updateMeasureNote();
        clearMeasurement();
        queueRender();
        showToast(rulerMode ? 'Régua ligada. Clique em dois pontos no corte ativo.' : 'Régua desligada.');
      });

      adjustImage.addEventListener('click', () => {
        if (mode !== 'dicom') {
          showToast('Brilho e contraste estarão disponíveis ao abrir um DICOM.');
          return;
        }
        const show = !adjustPanel.classList.contains('show');
        adjustPanel.classList.toggle('show', show);
        adjustImage.classList.toggle('active', show);
      });


      aiAssistBtn.addEventListener('click', () => {
        const show = !aiPanel.classList.contains('show');
        aiPanel.classList.toggle('show', show);
        aiAssistBtn.classList.toggle('active', show);
        if (show) {
          hideAdjustPanel();
          updateAiSummary();
        }
      });

      aiClose.addEventListener('click', hideAiPanel);

      generateReport.addEventListener('click', () => {
        if (!volume) {
          showToast('Abra um volume DICOM para gerar o pré-laudo.');
          return;
        }
        const draft = buildDemoReport();
        reportOutput.value = draft;
        aiOutputStatus.textContent = 'Rascunho gerado';
        aiPanel.classList.add('show');
        aiAssistBtn.classList.add('active');
        showToast('Pré-laudo gerado. Revise antes de usar.');
      });

      copyReport.addEventListener('click', async () => {
        if (!reportOutput.value.trim()) {
          showToast('Gere um pré-laudo antes de copiar.');
          return;
        }
        try {
          await navigator.clipboard.writeText(reportOutput.value);
          showToast('Pré-laudo copiado.');
        } catch (_) {
          reportOutput.select();
          document.execCommand('copy');
          showToast('Pré-laudo copiado.');
        }
      });

      reportType.addEventListener('change', () => {
        aiOutputStatus.textContent = 'Tipo atualizado';
      });
      reportRegion.addEventListener('input', () => {
        aiOutputStatus.textContent = 'Região atualizada';
      });

      brightnessRange.addEventListener('input', applyDicomAdjustments);      contrastRange.addEventListener('input', applyDicomAdjustments);

      $('zoomIn').addEventListener('click', () => zoom(1.2));
      $('zoomOut').addEventListener('click', () => zoom(1 / 1.2));
      $('resetView').addEventListener('click', () => {
        if (volume) {
          cursor = { x: Math.floor(volW / 2), y: Math.floor(volH / 2), z: Math.floor(volD / 2) };
          resetAdjustmentsUI();
          clearMeasurement();
          queueRender();
        } else if (mode === 'image') {
          imageScale = 1;
          imageViewport.style.transform = 'scale(1)';
        }
        hideAdjustPanel();
      });
      $('newExam').addEventListener('click', openPicker);

      window.addEventListener('resize', resizeViewer);

      window.addEventListener('keydown', e => {
        if (mode !== 'dicom' || !volume) return;
        const map = {
          ArrowUp: () => { if (activePlane === 'axial') cursor.y = Math.max(0, cursor.y - 1); else cursor.z = Math.max(0, cursor.z - 1); },
          ArrowDown: () => { if (activePlane === 'axial') cursor.y = Math.min(volH - 1, cursor.y + 1); else cursor.z = Math.min(volD - 1, cursor.z + 1); },
          ArrowLeft: () => { if (activePlane === 'sagittal') cursor.y = Math.max(0, cursor.y - 1); else cursor.x = Math.max(0, cursor.x - 1); },
          ArrowRight: () => { if (activePlane === 'sagittal') cursor.y = Math.min(volH - 1, cursor.y + 1); else cursor.x = Math.min(volW - 1, cursor.x + 1); },
          PageUp: () => { cursor.z = Math.max(0, cursor.z - 1); setActivePlane('axial'); },
          PageDown: () => { cursor.z = Math.min(volD - 1, cursor.z + 1); setActivePlane('axial'); }
        };
        if (map[e.key]) {
          e.preventDefault();
          map[e.key]();
          queueRender();
        }
      });
    })();
