/**
 * ============================================================================
 * RIFTCOACH.GG - CONTROLADOR PRINCIPAL DA APLICAÇÃO (app.js)
 * Suporta:
 * 1. Inversão Automática de Confronto (winRateA = 100 - winRateB, sinais +/- de GD@15, XPD@15 e CSD@15)
 * 2. Fallback Inteligente de Elo (para GLOBAL com aviso sutil abaixo do header)
 * 3. Dinâmica de Jungler Inimigo (ajuste de Risco de Gank e Card 4 do Coach de IA)
 * ============================================================================
 */

const STATE = {
  patch: '16.22.1',
  champions: {},
  championList: [],
  role: 'TOP',
  elo: 'EMERALD_PLUS',
  ally: null,          // Estado inicial vazio (null)
  enemy: null,         // Estado inicial vazio (null)
  junglerActive: false,
  enemyJungler: null,
  modalTarget: 'ally', // 'ally' | 'enemy' | 'jungler'
  modalLaneFilter: 'ALL',
  activeTab: 'overview' // 'overview' | 'lane15' | 'builds' | 'aicoach'
};

const ELO_LABELS = {
  GLOBAL: 'Global',
  IRON: 'Ferro',
  BRONZE: 'Bronze',
  SILVER: 'Prata',
  GOLD: 'Ouro',
  PLATINUM: 'Platina',
  EMERALD: 'Esmeralda',
  EMERALD_PLUS: 'Esmeralda+',
  DIAMOND: 'Diamante',
  MASTER: 'Mestre',
  GRANDMASTER: 'Grão-Mestre',
  CHALLENGER: 'Desafiante'
};

const ROLE_LABELS = {
  TOP: 'Top',
  JUNGLE: 'Jungle',
  MID: 'Mid',
  ADC: 'ADC',
  SUPPORT: 'Suporte'
};

/**
 * ============================================================================
 * LEITURA ULTRARRÁPIDA COM INVERSÃO SIMÉTRICA, FALLBACK DE ELO E JUNGLER 2v2
 * ============================================================================
 */
async function resolveMatchupAnalysis({ ally, enemy, role, elo, junglerActive, enemyJungler }) {
  if (!ally || !enemy || !role || !elo || ally.id === enemy.id) return null;

  const {
    MIN_ELO_SAMPLE_SIZE,
    loadMatchupsDatabase,
    hydrateCompactPairRecord,
    invertStatsSymmetrically,
    invertDifficulty,
    evaluateJunglerThreat,
    buildDynamicAICoachCards
  } = window.RiftServices;

  const db = await loadMatchupsDatabase();
  const matchupsMap = db?.matchups || {};
  const compactPairs = db?.compactPairs || {};
  const profilesMap = db?.championProfiles || {};

  const directKey = `${role}:${ally.id}:${enemy.id}`;
  const reverseKey = `${role}:${enemy.id}:${ally.id}`;

  let rawRecord = matchupsMap[directKey];
  let isSymmetricInversion = false;

  // 1. Inversão Automática de Confronto (se salvo como B vs A, inverte para A vs B)
  if (!rawRecord && matchupsMap[reverseKey]) {
    rawRecord = matchupsMap[reverseKey];
    isSymmetricInversion = true;
  }

  // 1b. Consulta em O(1) na matriz compacta de 148.780 combinações (compactPairs)
  if (!rawRecord) {
    const directPairKey = `${ally.id}:${enemy.id}`;
    const reversePairKey = `${enemy.id}:${ally.id}`;
    if (compactPairs[directPairKey]) {
      rawRecord = hydrateCompactPairRecord(compactPairs[directPairKey], role, ally.id, enemy.id, db);
      isSymmetricInversion = false;
    } else if (compactPairs[reversePairKey]) {
      rawRecord = hydrateCompactPairRecord(compactPairs[reversePairKey], role, enemy.id, ally.id, db);
      isSymmetricInversion = true;
    }
  }

  if (!rawRecord) {
    return null;
  }

  // 2. Fallback Inteligente de Elo: se o Elo filtrado não tiver amostra suficiente, usa GLOBAL
  const eloDict = rawRecord.baseStatsByElo || {};
  let selectedEloStats = eloDict[elo];
  let isEloFallback = false;

  if (
    elo !== 'GLOBAL' &&
    (!selectedEloStats || (selectedEloStats.gamesAnalyzed || 0) < MIN_ELO_SAMPLE_SIZE)
  ) {
    selectedEloStats = eloDict['GLOBAL'] || eloDict['EMERALD_PLUS'];
    isEloFallback = true;
  }

  if (!selectedEloStats) {
    return null;
  }

  // Copia rápida das estatísticas do Elo e aplica inversão simétrica se necessário
  let stats = {
    ...selectedEloStats,
    wrByDuration: { ...selectedEloStats.wrByDuration },
    lane15: { ...selectedEloStats.lane15 }
  };
  let difficulty = rawRecord.difficulty || 'Equilibrado';

  if (isSymmetricInversion) {
    stats = invertStatsSymmetrically(stats);
    difficulty = invertDifficulty(difficulty);
  }

  // Resolve Builds & Runas do campeão Aliado
  let buildsAndRunes = null;
  if (!isSymmetricInversion && rawRecord.buildsAndRunes) {
    buildsAndRunes = rawRecord.buildsAndRunes;
  } else if (profilesMap[ally.id]) {
    const baseProfile = profilesMap[ally.id];
    buildsAndRunes = {
      ...baseProfile,
      counterItem: {
        ...baseProfile.counterItem,
        reason: `${baseProfile.counterItem.reason.replace(/\.$/, '')} contra ${enemy.name}.`
      }
    };
  }

  // Resolve os 5 Cards do Coach de IA
  let aiCards = (!isSymmetricInversion && rawRecord.aiCoach?.cards)
    ? rawRecord.aiCoach.cards.map(c => ({ ...c, bullets: [...c.bullets] }))
    : buildDynamicAICoachCards(ally, enemy, stats, buildsAndRunes);

  // 3. Dinâmica de Jungler Inimigo (Modo 2v2 e Risco de Gank por Arquétipo)
  let junglerThreat = null;
  if (junglerActive && enemyJungler) {
    junglerThreat = evaluateJunglerThreat(enemyJungler, ally, enemy, db);

    // Se houver override específico cadastrado no JSON curado, prioriza as dicas específicas
    const customOverride = (!isSymmetricInversion && rawRecord.aiCoach?.junglerOverrides?.[enemyJungler.id]) || null;
    const wrDelta = customOverride ? Number(customOverride.winRateDelta) : junglerThreat.winRateDelta;

    stats.winRate = Number(Math.min(65, Math.max(35, stats.winRate + wrDelta)).toFixed(1));
    stats.enemyWinRate = Number((100 - stats.winRate).toFixed(1));
    stats.deltaWr = Number((stats.deltaWr + wrDelta).toFixed(1));
    stats.lane15.goldDiff15 = Math.round(stats.lane15.goldDiff15 + junglerThreat.gd15Delta);

    const card04 = aiCards.find(c => c.step === '04');
    if (card04) {
      card04.title = 'Dinâmica de Selva & Risco de Gank';
      card04.subtitle = customOverride ? customOverride.subtitle : junglerThreat.subtitle;
      card04.accent = 'red';
      card04.bullets = customOverride ? customOverride.bullets : junglerThreat.bullets;
    }
  }

  return {
    allyId: ally.id,
    enemyId: enemy.id,
    role,
    elo,
    isEloFallback,
    isSymmetricInversion,
    junglerThreat,
    difficulty,
    stats,
    buildsAndRunes,
    aiCards
  };
}

async function initApp() {
  try {
    // Carrega Data Dragon e banco de matchups em paralelo para velocidade máxima
    const [ddData] = await Promise.all([
      window.RiftServices.fetchDataDragonBootstrap(),
      window.RiftServices.loadMatchupsDatabase()
    ]);

    STATE.patch = ddData.patch;
    STATE.champions = ddData.champions;
    STATE.championList = ddData.championList;

    document.getElementById('patchBadge').textContent = STATE.patch;
    await refreshDashboard();
  } catch (err) {
    console.error('Erro ao inicializar dados do patch:', err);
    document.getElementById('patchBadge').textContent = STATE.patch;
    await refreshDashboard();
  }
}

async function refreshDashboard() {
  updateTopSelectorCards();

  const emptyView = document.getElementById('emptyStateView');
  const insufficientView = document.getElementById('insufficientDataView');
  const analysisView = document.getElementById('analysisContentView');

  // 1. Estado Inicial Vazio: aguarda os dois campeões serem selecionados
  if (!STATE.ally || !STATE.enemy) {
    emptyView.classList.remove('hidden');
    insufficientView.classList.add('hidden');
    analysisView.classList.add('hidden');
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  emptyView.classList.add('hidden');

  // 2. Consulta estatísticas (com Inversão Automática, Fallback por Elo e Jungler 2v2)
  const analysis = await resolveMatchupAnalysis(STATE);

  if (!analysis) {
    insufficientView.classList.remove('hidden');
    analysisView.classList.add('hidden');
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  // 3. Renderiza o confronto encontrado
  insufficientView.classList.add('hidden');
  analysisView.classList.remove('hidden');

  renderSummaryHeader(analysis);
  renderTabOverview(analysis);
  renderTabLane15(analysis);
  renderTabBuilds(analysis);
  renderTabAICoach(analysis);
  updateActiveTabUI();

  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function updateTopSelectorCards() {
  const { getChampionIconUrl } = window.RiftServices;

  // Aliado
  const allyImg = document.getElementById('allyImg');
  const allyPlaceholder = document.getElementById('allyPlaceholderIcon');
  const allyAvatarWrap = document.getElementById('allyAvatarWrap');
  if (STATE.ally) {
    allyImg.src = getChampionIconUrl(STATE.patch, STATE.ally.id);
    allyImg.alt = STATE.ally.name;
    allyImg.classList.remove('hidden');
    if (allyPlaceholder) allyPlaceholder.classList.add('hidden');
    allyAvatarWrap.className = 'w-12 h-12 rounded-lg border border-hextech-cyan bg-slate-900 flex items-center justify-center overflow-hidden shrink-0';
    document.getElementById('allyName').textContent = STATE.ally.name;
    document.getElementById('allyTitle').textContent = STATE.ally.title;
  } else {
    allyImg.classList.add('hidden');
    if (allyPlaceholder) allyPlaceholder.classList.remove('hidden');
    allyAvatarWrap.className = 'w-12 h-12 rounded-lg border border-dashed border-hextech-cyan/60 bg-slate-950 flex items-center justify-center overflow-hidden shrink-0';
    document.getElementById('allyName').textContent = 'Selecionar Campeão';
    document.getElementById('allyTitle').textContent = 'Clique para escolher seu campeão';
  }

  // Inimigo
  const enemyImg = document.getElementById('enemyImg');
  const enemyPlaceholder = document.getElementById('enemyPlaceholderIcon');
  const enemyAvatarWrap = document.getElementById('enemyAvatarWrap');
  if (STATE.enemy) {
    enemyImg.src = getChampionIconUrl(STATE.patch, STATE.enemy.id);
    enemyImg.alt = STATE.enemy.name;
    enemyImg.classList.remove('hidden');
    if (enemyPlaceholder) enemyPlaceholder.classList.add('hidden');
    enemyAvatarWrap.className = 'w-12 h-12 rounded-lg border border-rose-500 bg-slate-900 flex items-center justify-center overflow-hidden shrink-0';
    document.getElementById('enemyName').textContent = STATE.enemy.name;
    document.getElementById('enemyTitle').textContent = STATE.enemy.title;
  } else {
    enemyImg.classList.add('hidden');
    if (enemyPlaceholder) enemyPlaceholder.classList.remove('hidden');
    enemyAvatarWrap.className = 'w-12 h-12 rounded-lg border border-dashed border-rose-500/60 bg-slate-950 flex items-center justify-center overflow-hidden shrink-0';
    document.getElementById('enemyName').textContent = 'Selecionar Oponente';
    document.getElementById('enemyTitle').textContent = 'Clique para escolher o inimigo';
  }

  // Jungler Inimigo
  const jgImg = document.getElementById('junglerImg');
  const jgPlaceholder = document.getElementById('junglerPlaceholderIcon');
  if (STATE.enemyJungler) {
    jgImg.src = getChampionIconUrl(STATE.patch, STATE.enemyJungler.id);
    jgImg.alt = STATE.enemyJungler.name;
    jgImg.classList.remove('hidden');
    if (jgPlaceholder) jgPlaceholder.classList.add('hidden');
    document.getElementById('junglerName').textContent = STATE.enemyJungler.name;
  } else {
    jgImg.classList.add('hidden');
    if (jgPlaceholder) jgPlaceholder.classList.remove('hidden');
    document.getElementById('junglerName').textContent = 'Selecionar Jungler';
  }

  const swapBtn = document.getElementById('btnSwapChamps');
  swapBtn.disabled = !(STATE.ally && STATE.enemy);
}

function renderSummaryHeader(analysis) {
  const { getChampionIconUrl } = window.RiftServices;
  const { stats, isEloFallback, junglerThreat } = analysis;

  document.getElementById('summaryAllyImg').src = getChampionIconUrl(STATE.patch, STATE.ally.id);
  document.getElementById('summaryAllyName').textContent = STATE.ally.name;
  document.getElementById('allyWinRateLabel').textContent = `${stats.winRate}%`;

  document.getElementById('summaryEnemyImg').src = getChampionIconUrl(STATE.patch, STATE.enemy.id);
  document.getElementById('summaryEnemyName').textContent = STATE.enemy.name;
  document.getElementById('enemyWinRateLabel').textContent = `${stats.enemyWinRate}%`;

  document.getElementById('summaryRoleEloText').textContent = `${ROLE_LABELS[STATE.role]} • ${ELO_LABELS[STATE.elo]}`;
  document.getElementById('sampleSizeText').textContent = stats.gamesAnalyzed.toLocaleString('pt-BR');

  document.getElementById('allyWinBar').style.width = `${stats.winRate}%`;
  document.getElementById('enemyWinBar').style.width = `${stats.enemyWinRate}%`;

  // Aviso Sutil Abaixo do Header para Fallback de Elo
  const fallbackNotice = document.getElementById('eloFallbackNotice');
  if (fallbackNotice) {
    fallbackNotice.classList.toggle('hidden', !isEloFallback);
  }

  // Modo 1v1 vs 2v2 e Indicador de Risco de Gank
  const modeLabel = document.getElementById('summaryModeLabel');
  const gankBadge = document.getElementById('gankRiskBadge');

  if (STATE.junglerActive && STATE.enemyJungler && junglerThreat) {
    modeLabel.textContent = `Cenário 2v2: vs ${STATE.enemy.name} + ${STATE.enemyJungler.name} (${junglerThreat.archetypeLabel})`;
    modeLabel.className = 'text-[11px] text-amber-300 font-semibold mt-0.5';
    if (gankBadge) {
      gankBadge.textContent = `Risco de Gank: ${junglerThreat.riskLevel}`;
      gankBadge.className = `mt-1 text-[10px] font-semibold px-2.5 py-0.5 rounded-full border ${junglerThreat.riskBadgeClass}`;
    }
  } else {
    modeLabel.textContent = 'Confronto 1v1 na Rota';
    modeLabel.className = 'text-[11px] text-slate-400 mt-0.5';
    if (gankBadge) {
      gankBadge.classList.add('hidden');
    }
  }

  const badge = document.getElementById('matchupDifficultyBadge');
  const diffInfo = getDifficultyStyle(analysis.difficulty, stats.winRate);
  badge.textContent = diffInfo.label;
  badge.className = `text-[11px] font-semibold px-2.5 py-0.5 rounded-full border ${diffInfo.badgeClass}`;
}

function getDifficultyStyle(difficulty, winRate) {
  if (winRate >= 52.5 || difficulty === 'Fácil') {
    return {
      label: 'Fácil',
      desc: 'Seu campeão possui vantagem natural de kit e pressão neste confronto.',
      badgeClass: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
      textClass: 'text-emerald-400'
    };
  }
  if (winRate >= 51.0 || difficulty === 'Favorável') {
    return {
      label: 'Equilibrado (Leve Vantagem)',
      desc: 'Confronto favorável se você respeitar os tempos de recarga do oponente.',
      badgeClass: 'bg-cyan-500/15 text-hextech-cyan border-hextech-cyan/30',
      textClass: 'text-hextech-cyan'
    };
  }
  if (winRate <= 47.0 || difficulty === 'Counter') {
    return {
      label: 'Counter',
      desc: 'Confronto severo. Priorize sobrevivência, controle de wave e item de counter.',
      badgeClass: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
      textClass: 'text-rose-400'
    };
  }
  if (winRate <= 49.0 || difficulty === 'Difícil') {
    return {
      label: 'Difícil',
      desc: 'O oponente tem vantagem na fase de rotas; evite trocas longas sem seu Jungler.',
      badgeClass: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
      textClass: 'text-amber-400'
    };
  }
  return {
    label: 'Equilibrado',
    desc: 'Confronto de habilidade pura (Skill Matchup) decidido por controle de wave e janelas de troca.',
    badgeClass: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    textClass: 'text-amber-300'
  };
}

/**
 * ABA 1: VISÃO GERAL & WIN RATE
 */
function renderTabOverview(analysis) {
  const { stats, isEloFallback } = analysis;
  const diffInfo = getDifficultyStyle(analysis.difficulty, stats.winRate);
  const deltaSign = stats.deltaWr > 0 ? '+' : '';
  const deltaColor = stats.deltaWr >= 0 ? 'text-emerald-400' : 'text-rose-400';

  const durations = [
    { label: '0–25 min (Early / Mid)', value: stats.wrByDuration['0_25'] },
    { label: '25–35 min (Mid / Late)', value: stats.wrByDuration['25_35'] },
    { label: '35+ min (Late Game)',    value: stats.wrByDuration['35_plus'] }
  ];

  const container = document.getElementById('overviewContent');
  container.innerHTML = `
    <div class="lg:col-span-7 bg-hextech-card border border-slate-800 rounded-xl p-5 sm:p-6 flex flex-col justify-between space-y-5">
      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
        <div class="flex items-center gap-2">
          <i data-lucide="activity" class="w-5 h-5 text-hextech-cyan"></i>
          <h3 class="font-display font-bold text-lg text-white uppercase tracking-wide">Desempenho Geral no Confronto</h3>
        </div>
        <span class="text-xs text-slate-400">${ROLE_LABELS[STATE.role]} • ${isEloFallback ? 'Global' : ELO_LABELS[STATE.elo]}</span>
      </div>

      <div class="grid grid-cols-2 sm:grid-cols-3 gap-3.5">
        <div class="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
          <div class="text-xs text-slate-400 mb-1">Win Rate (${STATE.ally.name})</div>
          <div class="font-display font-bold text-2xl ${stats.winRate >= 50 ? 'text-hextech-cyan' : 'text-rose-400'}">${stats.winRate}%</div>
          <div class="text-[11px] text-slate-500 mt-1">vs ${stats.enemyWinRate}% de ${STATE.enemy.name}</div>
        </div>

        <div class="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
          <div class="text-xs text-slate-400 mb-1">Vantagem (Delta WR)</div>
          <div class="font-display font-bold text-2xl ${deltaColor}">${deltaSign}${stats.deltaWr}%</div>
          <div class="text-[11px] text-slate-500 mt-1">Acima da média do patch</div>
        </div>

        <div class="bg-slate-900/90 border border-slate-800 rounded-xl p-4 col-span-2 sm:col-span-1">
          <div class="text-xs text-slate-400 mb-1">Dificuldade</div>
          <div class="font-display font-bold text-xl ${diffInfo.textClass}">${diffInfo.label}</div>
          <div class="text-[11px] text-slate-500 mt-1">Classificação tática</div>
        </div>

        <div class="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
          <div class="text-xs text-slate-400 mb-1">Pick Rate</div>
          <div class="font-display font-bold text-xl text-white">${stats.pickRate}%</div>
          <div class="text-[11px] text-slate-500 mt-1">Taxa de escolha no elo</div>
        </div>

        <div class="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
          <div class="text-xs text-slate-400 mb-1">Ban Rate</div>
          <div class="font-display font-bold text-xl text-hextech-gold">${stats.banRate}%</div>
          <div class="text-[11px] text-slate-500 mt-1">Taxa de banimento</div>
        </div>

        <div class="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
          <div class="text-xs text-slate-400 mb-1">Taxa de Presença</div>
          <div class="font-display font-bold text-xl text-slate-200">${stats.presenceRate}%</div>
          <div class="text-[11px] text-slate-500 mt-1">Pick + Ban combinado</div>
        </div>
      </div>

      <div class="bg-slate-900/70 border border-slate-800/90 rounded-xl p-3.5 flex items-center gap-3 text-xs text-slate-300">
        <i data-lucide="shield-alert" class="w-4 h-4 text-hextech-gold shrink-0"></i>
        <span>${diffInfo.desc}</span>
      </div>
    </div>

    <div class="lg:col-span-5 bg-hextech-card border border-slate-800 rounded-xl p-5 sm:p-6 flex flex-col justify-between space-y-5">
      <div>
        <div class="flex items-center justify-between border-b border-slate-800 pb-3 mb-5">
          <div class="flex items-center gap-2">
            <i data-lucide="clock" class="w-5 h-5 text-hextech-gold"></i>
            <h3 class="font-display font-bold text-lg text-white uppercase tracking-wide">Win Rate por Duração da Partida</h3>
          </div>
        </div>

        <div class="space-y-5">
          ${durations.map(d => {
            const isFavored = d.value >= 50;
            const barColor = isFavored ? 'from-cyan-600 to-hextech-cyan' : 'from-rose-600 to-rose-400';
            const textColor = isFavored ? 'text-emerald-400' : 'text-rose-400';
            return `
              <div class="space-y-1.5">
                <div class="flex items-center justify-between text-xs">
                  <span class="font-medium text-slate-300">${d.label}</span>
                  <span class="font-display font-bold text-base ${textColor}">${d.value}% WR</span>
                </div>
                <div class="w-full h-3 bg-slate-900 rounded-full overflow-hidden border border-slate-800 relative">
                  <div class="absolute left-1/2 top-0 bottom-0 w-0.5 bg-slate-600 z-10" title="50% Equilíbrio"></div>
                  <div class="h-full bg-gradient-to-r ${barColor} rounded-full transition-all duration-500" style="width: ${Math.min(100, Math.max(20, d.value))}%"></div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <div class="bg-slate-900/70 border border-slate-800/90 rounded-xl p-3.5 text-xs text-slate-400 flex items-center justify-between">
        <span>Melhor janela de vitória:</span>
        <strong class="text-white">
          ${stats.wrByDuration['0_25'] >= stats.wrByDuration['35_plus'] ? '0–25 min (Fechar o jogo cedo)' : '35+ min (Escalar para o Late Game)'}
        </strong>
      </div>
    </div>
  `;
}

/**
 * ABA 2: FASE DE ROTAS (@15 MIN)
 */
function renderTabLane15(analysis) {
  const { lane15 } = analysis.stats;
  const formatSigned = (v, unit = '') => `${v > 0 ? '+' : ''}${v}${unit}`;

  const compareRows = [
    {
      title: 'Diferença de Ouro aos 15m (GD@15)',
      allyVal: formatSigned(lane15.goldDiff15, 'g'),
      enemyVal: formatSigned(-lane15.goldDiff15, 'g'),
      allyFavored: lane15.goldDiff15 >= 0,
      allyPct: Math.min(82, Math.max(18, 50 + (lane15.goldDiff15 / 18))),
      icon: 'coins'
    },
    {
      title: 'Diferença de Experiência aos 15m (XPD@15)',
      allyVal: formatSigned(lane15.xpDiff15, ' XP'),
      enemyVal: formatSigned(-lane15.xpDiff15, ' XP'),
      allyFavored: lane15.xpDiff15 >= 0,
      allyPct: Math.min(82, Math.max(18, 50 + (lane15.xpDiff15 / 14))),
      icon: 'trending-up'
    },
    {
      title: 'Diferença de Farm/CS aos 15m (CSD@15)',
      allyVal: formatSigned(lane15.csDiff15, ' CS'),
      enemyVal: formatSigned(-lane15.csDiff15, ' CS'),
      allyFavored: lane15.csDiff15 >= 0,
      allyPct: Math.min(82, Math.max(18, 50 + (lane15.csDiff15 * 2.2))),
      icon: 'wheat'
    },
    {
      title: 'Taxa de Vitória na Rota aos 15m (Lane Kill Rate)',
      allyVal: `${lane15.laneKillRate}%`,
      enemyVal: `${(100 - lane15.laneKillRate).toFixed(1)}%`,
      allyFavored: lane15.laneKillRate >= 50,
      allyPct: lane15.laneKillRate,
      icon: 'crosshair'
    }
  ];

  const enemyFb = Math.max(8.0, Number((40.0 - lane15.firstBloodPct).toFixed(1)));
  const enemyPlates = Math.max(0.5, Number((3.1 - lane15.platesBefore14).toFixed(1)));

  const container = document.getElementById('lane15Content');
  container.innerHTML = `
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 mb-6 border-b border-slate-800">
      <div class="flex items-center gap-2">
        <i data-lucide="swords" class="w-5 h-5 text-hextech-gold"></i>
        <h3 class="font-display font-bold text-lg text-white uppercase tracking-wide">
          Comparativo Direto de Fase de Rotas (@15 Minutos)
        </h3>
      </div>
      <div class="flex items-center gap-4 text-xs font-semibold">
        <span class="text-hextech-cyan flex items-center gap-1.5">
          <span class="w-2.5 h-2.5 rounded-full bg-hextech-cyan"></span> ${STATE.ally.name}
        </span>
        <span class="text-rose-400 flex items-center gap-1.5">
          <span class="w-2.5 h-2.5 rounded-full bg-rose-500"></span> ${STATE.enemy.name}
        </span>
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-6">
      ${compareRows.map(row => `
        <div class="bg-slate-900/80 border border-slate-800 rounded-xl p-4 space-y-2.5">
          <div class="flex items-center justify-between text-xs">
            <span class="font-display font-bold text-base ${row.allyFavored ? 'text-emerald-400' : 'text-slate-300'}">${row.allyVal}</span>
            <span class="text-slate-300 font-medium flex items-center gap-1.5">
              <i data-lucide="${row.icon}" class="w-3.5 h-3.5 text-hextech-gold"></i> ${row.title}
            </span>
            <span class="font-display font-bold text-base ${!row.allyFavored ? 'text-rose-400' : 'text-slate-400'}">${row.enemyVal}</span>
          </div>
          <div class="w-full h-3 bg-slate-950 rounded-full overflow-hidden flex p-0.5 border border-slate-800">
            <div class="h-full bg-gradient-to-r from-cyan-600 to-hextech-cyan rounded-l-full transition-all duration-500" style="width: ${row.allyPct.toFixed(1)}%"></div>
            <div class="w-0.5 h-full bg-slate-950"></div>
            <div class="h-full bg-gradient-to-l from-rose-600 to-rose-500 rounded-r-full transition-all duration-500" style="width: ${(100 - row.allyPct).toFixed(1)}%"></div>
          </div>
        </div>
      `).join('')}
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <div class="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
        <div class="flex items-center justify-between text-xs text-slate-400 mb-1">
          <span>Participação First Blood (FB%)</span>
          <i data-lucide="droplet" class="w-4 h-4 text-rose-400"></i>
        </div>
        <div class="font-display font-bold text-2xl text-white">${lane15.firstBloodPct}%</div>
        <div class="text-[11px] text-slate-500 mt-1">Oponente: ${enemyFb}%</div>
      </div>

      <div class="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
        <div class="flex items-center justify-between text-xs text-slate-400 mb-1">
          <span>Média de Abates Solo na Rota</span>
          <i data-lucide="skull" class="w-4 h-4 text-hextech-cyan"></i>
        </div>
        <div class="font-display font-bold text-2xl text-hextech-cyan">${lane15.soloKillsAvg} / jogo</div>
        <div class="text-[11px] text-slate-500 mt-1">Solo Kills antes dos 15 min</div>
      </div>

      <div class="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
        <div class="flex items-center justify-between text-xs text-slate-400 mb-1">
          <span>Barricadas Destruídas (&lt;14m)</span>
          <i data-lucide="shield" class="w-4 h-4 text-hextech-gold"></i>
        </div>
        <div class="font-display font-bold text-2xl text-hextech-gold">${lane15.platesBefore14} placas</div>
        <div class="text-[11px] text-slate-500 mt-1">Oponente: ${enemyPlates} placas</div>
      </div>

      <div class="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
        <div class="flex items-center justify-between text-xs text-slate-400 mb-1">
          <span>Tempo Médio 1ª Torre</span>
          <i data-lucide="castle" class="w-4 h-4 text-emerald-400"></i>
        </div>
        <div class="font-display font-bold text-2xl text-emerald-400">${lane15.firstTowerTime}</div>
        <div class="text-[11px] text-slate-500 mt-1">Queda da 1ª torre da rota</div>
      </div>
    </div>
  `;
}

/**
 * ABA 3: BUILDS & RUNAS
 */
function renderTabBuilds(analysis) {
  const { getItemIconUrl } = window.RiftServices;
  const { buildsAndRunes } = analysis;
  const { runes } = buildsAndRunes;

  const container = document.getElementById('buildsContent');
  container.innerHTML = `
    <div class="lg:col-span-5 bg-hextech-card border border-slate-800 rounded-xl p-5 sm:p-6 flex flex-col justify-between space-y-5">
      <div>
        <div class="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
          <div class="flex items-center gap-2">
            <i data-lucide="flame" class="w-5 h-5 text-hextech-gold"></i>
            <h3 class="font-display font-bold text-lg text-white uppercase tracking-wide">Página de Runas para o Matchup</h3>
          </div>
          <span class="text-xs font-semibold px-2.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
            ${runes.winRate}% WR
          </span>
        </div>

        <div class="bg-slate-900/90 border border-slate-800 rounded-xl p-4 mb-3.5">
          <div class="flex items-center gap-3 mb-3">
            <img src="${runes.keystone.icon}" alt="${runes.keystone.name}" class="w-12 h-12 rounded-full bg-slate-950 p-1 border border-hextech-gold/60" />
            <div>
              <span class="text-[10px] font-semibold uppercase tracking-wider text-hextech-gold">${runes.primaryTree} (Primária)</span>
              <h4 class="font-display font-bold text-lg text-white">${runes.keystone.name}</h4>
            </div>
          </div>
          <div class="flex flex-wrap gap-2 pt-2 border-t border-slate-800/80">
            ${runes.primaryPerks.map(perk => `
              <span class="text-xs bg-slate-950 text-slate-200 px-2.5 py-1 rounded-md border border-slate-800">${perk}</span>
            `).join('')}
          </div>
        </div>

        <div class="bg-slate-900/90 border border-slate-800 rounded-xl p-4 mb-3.5">
          <div class="flex items-center gap-2.5 mb-2.5">
            <img src="${runes.secondaryIcon}" alt="${runes.secondaryTree}" class="w-6 h-6" />
            <span class="text-xs font-bold uppercase tracking-wider text-slate-200">${runes.secondaryTree} (Secundária)</span>
          </div>
          <div class="flex flex-wrap gap-2">
            ${runes.secondaryPerks.map(perk => `
              <span class="text-xs bg-slate-950 text-slate-300 px-2.5 py-1 rounded-md border border-slate-800">${perk}</span>
            `).join('')}
          </div>
        </div>

        <div class="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5">
          <div class="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">Fragmentos de Atributo (Shards)</div>
          <div class="flex flex-wrap gap-2">
            ${runes.shards.map(shard => `
              <span class="text-[11px] bg-slate-950 text-hextech-goldLight px-2.5 py-1 rounded border border-hextech-gold/30">${shard}</span>
            `).join('')}
          </div>
        </div>
      </div>

      <div class="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5 flex items-center justify-between text-xs">
        <span class="text-slate-400 font-medium">Feitiços de Invocador Recomendados:</span>
        <span class="font-bold text-white bg-slate-950 px-3 py-1 rounded-md border border-slate-700">
          ${buildsAndRunes.summoners.join(' + ')}
        </span>
      </div>
    </div>

    <div class="lg:col-span-7 bg-hextech-card border border-slate-800 rounded-xl p-5 sm:p-6 flex flex-col justify-between space-y-5">
      <div class="space-y-5">
        <div class="flex items-center justify-between border-b border-slate-800 pb-3">
          <div class="flex items-center gap-2">
            <i data-lucide="shield-check" class="w-5 h-5 text-hextech-cyan"></i>
            <h3 class="font-display font-bold text-lg text-white uppercase tracking-wide">Progressão de Itens & Habilidades</h3>
          </div>
          <span class="text-xs text-slate-400">vs ${STATE.enemy.name}</span>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div class="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5">
            <div class="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2.5">Itens Iniciais</div>
            <div class="flex items-center gap-3">
              ${buildsAndRunes.startingItems.map(item => `
                <div class="flex items-center gap-2">
                  <img src="${getItemIconUrl(STATE.patch, item.id)}" alt="${item.name}" class="w-10 h-10 rounded-lg border border-slate-700" />
                  <span class="text-xs text-slate-200 font-medium">${item.name}</span>
                </div>
              `).join('')}
            </div>
          </div>

          <div class="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5">
            <div class="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2.5">Botas Recomendadas</div>
            <div class="flex items-center gap-3">
              <img src="${getItemIconUrl(STATE.patch, buildsAndRunes.boots.id)}" alt="${buildsAndRunes.boots.name}" class="w-10 h-10 rounded-lg border border-hextech-cyan/50" />
              <div>
                <div class="text-xs font-bold text-white">${buildsAndRunes.boots.name}</div>
                <div class="text-[11px] text-slate-400">Prioridade contra ${STATE.enemy.name}</div>
              </div>
            </div>
          </div>
        </div>

        <div class="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
          <div class="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-3">Core Build (1º, 2º e 3º Itens)</div>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            ${buildsAndRunes.coreItems.map((item, idx) => `
              <div class="bg-slate-950/90 border border-slate-800 rounded-lg p-2.5 flex items-center gap-3">
                <div class="relative shrink-0">
                  <img src="${getItemIconUrl(STATE.patch, item.id)}" alt="${item.name}" class="w-11 h-11 rounded-lg border border-slate-700" />
                  <span class="absolute -top-1.5 -left-1.5 w-5 h-5 rounded-full bg-hextech-cyan text-slate-950 text-[10px] font-extrabold flex items-center justify-center">${idx + 1}º</span>
                </div>
                <div>
                  <div class="text-xs font-bold text-white leading-tight">${item.name}</div>
                  <div class="text-[10px] text-slate-500 mt-0.5">Pico de ${idx + 1}º Item</div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="bg-amber-950/20 border border-hextech-gold/60 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 gold-glow">
          <div class="flex items-center gap-3.5">
            <div class="relative shrink-0">
              <img src="${getItemIconUrl(STATE.patch, buildsAndRunes.counterItem.id)}" alt="${buildsAndRunes.counterItem.name}" class="w-12 h-12 rounded-lg border-2 border-hextech-gold" />
              <span class="absolute -top-2 -right-2 px-1.5 py-0.5 rounded bg-hextech-gold text-slate-950 text-[9px] font-extrabold uppercase">Counter</span>
            </div>
            <div>
              <div class="text-xs font-bold uppercase tracking-wider text-hextech-gold">Item Situacional de Counter: ${buildsAndRunes.counterItem.name}</div>
              <p class="text-xs text-slate-200 mt-0.5">${buildsAndRunes.counterItem.reason}</p>
            </div>
          </div>
        </div>
      </div>

      <div class="bg-slate-900/90 border border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <span class="text-[11px] font-semibold uppercase tracking-wider text-slate-400 block">Ordem de Maximização de Habilidades</span>
          <span class="font-display font-bold text-xl text-hextech-cyan">${buildsAndRunes.skillOrder}</span>
        </div>
        <div class="flex flex-wrap gap-1">
          ${(buildsAndRunes.skillPriority || []).slice(0, 9).map((sk, idx) => `
            <div class="w-6 h-7 rounded bg-slate-950 border border-slate-800 flex flex-col items-center justify-center">
              <span class="text-[9px] text-slate-500 leading-none">${idx + 1}</span>
              <span class="text-[11px] font-mono font-bold text-white leading-tight">${sk}</span>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

/**
 * ABA 4: COACH DE IA (5 CARDS RÁPIDOS E ESCANEÁVEIS)
 */
function renderTabAICoach(analysis) {
  const modeBadge = document.getElementById('aiModeBadge');
  if (STATE.junglerActive && STATE.enemyJungler && analysis.junglerThreat) {
    modeBadge.textContent = `Modo 2v2: vs ${STATE.enemyJungler.name} (${analysis.junglerThreat.riskLevel})`;
    modeBadge.className = 'text-[11px] font-sans font-semibold px-2.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40';
  } else {
    modeBadge.textContent = 'Modo 1v1 Isolado';
    modeBadge.className = 'text-[11px] font-sans font-semibold px-2.5 py-0.5 rounded bg-slate-800 text-hextech-gold border border-hextech-gold/30';
  }

  const accentColors = {
    cyan:    { border: 'border-hextech-cyan/35', badge: 'bg-hextech-cyan/15 text-hextech-cyan', dot: 'bg-hextech-cyan' },
    gold:    { border: 'border-hextech-gold/35', badge: 'bg-hextech-gold/15 text-hextech-gold', dot: 'bg-hextech-gold' },
    red:     { border: 'border-rose-500/45',     badge: 'bg-rose-500/15 text-rose-400',         dot: 'bg-rose-400' },
    emerald: { border: 'border-emerald-500/40',  badge: 'bg-emerald-500/15 text-emerald-400',   dot: 'bg-emerald-400' }
  };

  const container = document.getElementById('aiCoachGrid');
  container.innerHTML = analysis.aiCards.map(card => {
    const theme = accentColors[card.accent] || accentColors.cyan;
    return `
      <article class="bg-hextech-card hover:bg-hextech-cardHover border ${theme.border} rounded-xl p-4 flex flex-col justify-between transition-all shadow-md">
        <div>
          <div class="flex items-center justify-between gap-2 mb-2.5">
            <span class="text-[10px] font-mono font-bold px-2 py-0.5 rounded ${theme.badge}">CARD ${card.step}</span>
            <i data-lucide="${card.icon}" class="w-4 h-4 text-slate-400"></i>
          </div>
          <h3 class="font-display font-bold text-base text-white tracking-wide">${card.title}</h3>
          <p class="text-[11px] text-slate-400 mb-3 pb-2 border-b border-slate-800/80">${card.subtitle}</p>

          <ul class="space-y-2 text-xs text-slate-200 leading-relaxed">
            ${card.bullets.slice(0, 3).map(b => `
              <li class="flex items-start gap-2">
                <span class="w-1.5 h-1.5 rounded-full ${theme.dot} mt-1.5 shrink-0"></span>
                <span>${b}</span>
              </li>
            `).join('')}
          </ul>
        </div>
      </article>
    `;
  }).join('');
}

function updateActiveTabUI() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    const isActive = btn.dataset.tab === STATE.activeTab;
    btn.className = isActive
      ? 'tab-btn flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-xs sm:text-sm font-semibold transition-all bg-hextech-cyan/15 text-hextech-cyan border border-hextech-cyan/40'
      : 'tab-btn flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-xs sm:text-sm font-medium text-slate-400 hover:text-white transition-all border border-transparent';
  });

  ['overview', 'lane15', 'builds', 'aicoach'].forEach(tabId => {
    const panel = document.getElementById(`tabPanel-${tabId}`);
    if (panel) {
      panel.classList.toggle('hidden', tabId !== STATE.activeTab);
    }
  });
}

function openChampionModal(target) {
  STATE.modalTarget = target;
  const titles = {
    ally: 'Selecionar Campeão Aliado (Você)',
    enemy: 'Selecionar Campeão Inimigo (Oponente)',
    jungler: 'Selecionar Jungler Inimigo (Modo 2v2)'
  };
  document.getElementById('modalTitle').textContent = titles[target];
  document.getElementById('championSearchInput').value = '';

  setModalLaneFilter(target === 'jungler' ? 'JUNGLE' : 'ALL');

  document.getElementById('championModal').classList.remove('hidden');
  setTimeout(() => document.getElementById('championSearchInput').focus(), 50);
}

function closeChampionModal() {
  document.getElementById('championModal').classList.add('hidden');
}

function setModalLaneFilter(lane) {
  STATE.modalLaneFilter = lane;
  document.querySelectorAll('.modal-lane-btn').forEach(btn => {
    const active = btn.dataset.modalLane === lane;
    btn.className = active
      ? 'modal-lane-btn flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all bg-hextech-cyan/20 text-hextech-cyan border border-hextech-cyan/40'
      : 'modal-lane-btn flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-white bg-slate-950/80 border border-slate-800 transition-all';
  });
  renderChampionModalList(document.getElementById('championSearchInput').value);
}

function renderChampionModalList(query = '') {
  const { getChampionIconUrl, championMatchesLane } = window.RiftServices;
  const normalized = query.trim().toLowerCase();

  const filtered = STATE.championList.filter(c => {
    const matchesSearch = !normalized ||
      c.name.toLowerCase().includes(normalized) ||
      c.id.toLowerCase().includes(normalized);
    const matchesLane = championMatchesLane(c, STATE.modalLaneFilter);
    return matchesSearch && matchesLane;
  });

  const grid = document.getElementById('championGridList');
  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="col-span-full py-10 text-center text-xs text-slate-400">
        Nenhum campeão encontrado neste filtro. Clique em <strong>"Todas"</strong> para buscar em todas as rotas.
      </div>
    `;
    return;
  }

  grid.innerHTML = filtered.map(c => `
    <button
      type="button"
      data-champ-id="${c.id}"
      class="champ-pick-btn flex flex-col items-center p-2 rounded-xl bg-slate-900/80 hover:bg-slate-800 border border-slate-800 hover:border-hextech-gold transition group"
    >
      <img src="${getChampionIconUrl(STATE.patch, c.id)}" alt="${c.name}" loading="lazy" class="w-12 h-12 rounded-lg mb-1.5 group-hover:scale-105 transition-transform" />
      <span class="text-xs font-medium text-slate-200 group-hover:text-hextech-gold truncate w-full text-center">${c.name}</span>
    </button>
  `).join('');

  grid.querySelectorAll('.champ-pick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const picked = STATE.champions[btn.dataset.champId];
      if (STATE.modalTarget === 'ally') STATE.ally = picked;
      else if (STATE.modalTarget === 'enemy') STATE.enemy = picked;
      else if (STATE.modalTarget === 'jungler') STATE.enemyJungler = picked;

      closeChampionModal();
      refreshDashboard();
    });
  });
}

function setRoleUI(role) {
  STATE.role = role;
  document.querySelectorAll('.role-btn').forEach(b => {
    const active = b.dataset.role === role;
    b.className = active
      ? 'role-btn flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-semibold transition-all bg-hextech-gold/20 text-hextech-gold border border-hextech-gold/40'
      : 'role-btn flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium text-slate-400 hover:text-white transition-all border border-transparent';
  });
}

function setupEventListeners() {
  document.getElementById('btnSelectAlly').addEventListener('click', () => openChampionModal('ally'));
  document.getElementById('btnSelectEnemy').addEventListener('click', () => openChampionModal('enemy'));
  document.getElementById('btnSelectJungler').addEventListener('click', () => openChampionModal('jungler'));
  document.getElementById('btnCloseModal').addEventListener('click', closeChampionModal);

  document.getElementById('championModal').addEventListener('click', (e) => {
    if (e.target.id === 'championModal') closeChampionModal();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeChampionModal();
  });

  document.getElementById('championSearchInput').addEventListener('input', (e) => {
    renderChampionModalList(e.target.value);
  });

  document.querySelectorAll('.modal-lane-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setModalLaneFilter(btn.dataset.modalLane);
    });
  });

  document.getElementById('btnSwapChamps').addEventListener('click', () => {
    if (!STATE.ally && !STATE.enemy) return;
    const temp = STATE.ally;
    STATE.ally = STATE.enemy;
    STATE.enemy = temp;
    refreshDashboard();
  });

  document.getElementById('btnToggleJungler').addEventListener('click', () => {
    STATE.junglerActive = !STATE.junglerActive;
    const container = document.getElementById('enemyJunglerContainer');
    const btn = document.getElementById('btnToggleJungler');
    const label = document.getElementById('junglerToggleText');

    if (STATE.junglerActive) {
      container.classList.remove('hidden');
      btn.className = 'flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border transition-all bg-amber-500/20 border-amber-500 text-amber-300';
      label.textContent = 'Remover Jungler (2v2)';
      if (!STATE.enemyJungler && STATE.champions['LeeSin']) {
        STATE.enemyJungler = STATE.champions['LeeSin'];
      }
    } else {
      container.classList.add('hidden');
      btn.className = 'flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border transition-all bg-slate-900 border-slate-700 text-slate-300 hover:border-amber-500/60';
      label.textContent = '+ Jungler Inimigo';
    }
    refreshDashboard();
  });

  document.querySelectorAll('.role-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setRoleUI(btn.dataset.role);
      refreshDashboard();
    });
  });

  document.getElementById('eloSelect').addEventListener('change', (e) => {
    STATE.elo = e.target.value;
    refreshDashboard();
  });

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      STATE.activeTab = btn.dataset.tab;
      updateActiveTabUI();
    });
  });

  document.querySelectorAll('.quick-matchup-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const [role, allyId, enemyId] = btn.dataset.quickMatchup.split(':');
      if (STATE.champions[allyId] && STATE.champions[enemyId]) {
        setRoleUI(role);
        STATE.ally = STATE.champions[allyId];
        STATE.enemy = STATE.champions[enemyId];
        refreshDashboard();
      }
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) {
    window.lucide.createIcons();
  }
  setupEventListeners();
  initApp();
});
