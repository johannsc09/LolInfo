/**
 * ============================================================================
 * RIFTCOACH.GG - CONTROLADOR DE INTERFACE & EVENTOS
 * ============================================================================
 */

const STATE = {
  patch: '14.23.1',
  champions: {},
  championList: [],
  role: 'TOP',
  elo: 'EMERALD_PLUS',
  ally: null,
  enemy: null,
  junglerActive: false,
  enemyJungler: null,
  modalTarget: 'ally' // 'ally' | 'enemy' | 'jungler'
};

// Campeões populares por rota para carregamento inicial rápido
const DEFAULT_ROLE_MATCHUPS = {
  TOP:     { ally: 'Darius',   enemy: 'Aatrox',   jg: 'LeeSin' },
  JUNGLE:  { ally: 'Viego',    enemy: 'LeeSin',   jg: 'Sejuani' },
  MID:     { ally: 'Ahri',     enemy: 'Yone',     jg: 'JarvanIV' },
  ADC:     { ally: 'Jinx',     enemy: 'Caitlyn',  jg: 'Vi' },
  SUPPORT: { ally: 'Thresh',   enemy: 'Nautilus', jg: 'Viego' }
};

async function initApp() {
  try {
    const { patch, champions, championList } = await window.RiftServices.fetchDataDragonBootstrap();
    STATE.patch = patch;
    STATE.champions = champions;
    STATE.championList = championList;

    document.getElementById('patchBadge').textContent = STATE.patch;

    setDefaultChampionsForRole(STATE.role);
    await refreshDashboard();
  } catch (err) {
    console.error('Erro ao inicializar Data Dragon:', err);
    document.getElementById('patchBadge').textContent = STATE.patch + ' (Offline)';
  }
}

function setDefaultChampionsForRole(role) {
  const preset = DEFAULT_ROLE_MATCHUPS[role] || DEFAULT_ROLE_MATCHUPS.TOP;
  STATE.ally = STATE.champions[preset.ally] || STATE.championList[0];
  STATE.enemy = STATE.champions[preset.enemy] || STATE.championList[1];
  STATE.enemyJungler = STATE.champions[preset.jg] || STATE.championList[2];
}

async function refreshDashboard() {
  if (!STATE.ally || !STATE.enemy) return;

  const { getChampionIconUrl, fetchMatchupStats, fetchAICoachGuide } = window.RiftServices;

  // Atualiza cards de seleção no topo
  document.getElementById('allyImg').src = getChampionIconUrl(STATE.patch, STATE.ally.id);
  document.getElementById('allyName').textContent = STATE.ally.name;
  document.getElementById('allyTitle').textContent = STATE.ally.title;

  document.getElementById('enemyImg').src = getChampionIconUrl(STATE.patch, STATE.enemy.id);
  document.getElementById('enemyName').textContent = STATE.enemy.name;
  document.getElementById('enemyTitle').textContent = STATE.enemy.title;

  if (STATE.enemyJungler) {
    document.getElementById('junglerImg').src = getChampionIconUrl(STATE.patch, STATE.enemyJungler.id);
    document.getElementById('junglerName').textContent = STATE.enemyJungler.name;
  }

  document.getElementById('telemetryPerspective').textContent = `${STATE.ally.name} vs ${STATE.enemy.name}`;

  // Busca dados estatísticos e guia de IA
  const stats = await fetchMatchupStats(STATE);
  const aiCards = await fetchAICoachGuide({ ...STATE, stats });

  renderWinRateBar(stats);
  renderStatsGrid(stats);
  renderSetupBlock(stats.setup, stats.winRate);
  renderAICoachCards(aiCards);

  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function renderWinRateBar(stats) {
  const allyLabel = document.getElementById('allyWinRateLabel');
  const enemyLabel = document.getElementById('enemyWinRateLabel');
  const allyBar = document.getElementById('allyWinBar');
  const enemyBar = document.getElementById('enemyWinBar');
  const badge = document.getElementById('matchupDifficultyBadge');

  allyLabel.textContent = `${stats.winRate}%`;
  enemyLabel.textContent = `${stats.enemyWinRate}%`;
  allyBar.style.width = `${stats.winRate}%`;
  enemyBar.style.width = `${stats.enemyWinRate}%`;
  document.getElementById('sampleSizeText').textContent = stats.gamesAnalyzed.toLocaleString('pt-BR');

  if (stats.winRate >= 51.5) {
    badge.textContent = 'Matchup Favorável (Vantagem)';
    badge.className = 'ml-2 text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30';
  } else if (stats.winRate <= 48.5) {
    badge.textContent = 'Matchup Difícil (Counter)';
    badge.className = 'ml-2 text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-rose-500/15 text-rose-400 border border-rose-500/30';
  } else {
    badge.textContent = 'Skill Matchup (Equilibrado)';
    badge.className = 'ml-2 text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30';
  }
}

function renderStatsGrid(stats) {
  const formatDiff = (val, suffix = '') => `${val > 0 ? '+' : ''}${val}${suffix}`;

  const metrics = [
    {
      label: 'Dif. de Ouro @15',
      value: formatDiff(stats.goldDiff15, 'g'),
      positive: stats.goldDiff15 >= 0,
      sub: 'Média aos 15 min',
      icon: 'coins'
    },
    {
      label: 'Dif. de XP @15',
      value: formatDiff(stats.xpDiff15, ' XP'),
      positive: stats.xpDiff15 >= 0,
      sub: 'Vantagem de nível',
      icon: 'trending-up'
    },
    {
      label: 'Dif. de CS @15',
      value: formatDiff(stats.csDiff15, ' CS'),
      positive: stats.csDiff15 >= 0,
      sub: 'Farm na fase de rotas',
      icon: 'wheat'
    },
    {
      label: 'Lane Kill Rate',
      value: `${stats.laneKillRate}%`,
      positive: stats.laneKillRate >= 50,
      sub: 'Taxa de vitória na lane',
      icon: 'crosshair'
    },
    {
      label: 'First Blood %',
      value: `${stats.firstBloodPct}%`,
      positive: stats.firstBloodPct >= 20,
      sub: 'Participação 1º abate',
      icon: 'droplet'
    },
    {
      label: 'Abates Solo',
      value: `${stats.soloKillsAvg}/jogo`,
      positive: stats.soloKillsAvg >= 1.0,
      sub: 'Média de Solo Kills',
      icon: 'skull'
    },
    {
      label: 'Pick Rate',
      value: `${stats.pickRate}%`,
      positive: true,
      neutral: true,
      sub: `Popularidade (${STATE.role})`,
      icon: 'users'
    },
    {
      label: 'Ban Rate',
      value: `${stats.banRate}%`,
      positive: false,
      neutral: true,
      sub: 'Taxa de banimento',
      icon: 'ban'
    }
  ];

  const container = document.getElementById('statsGrid');
  container.innerHTML = metrics.map(m => {
    const colorClass = m.neutral
      ? 'text-hextech-gold'
      : (m.positive ? 'text-emerald-400' : 'text-rose-400');

    const borderClass = m.neutral
      ? 'border-slate-800'
      : (m.positive ? 'border-emerald-500/25' : 'border-rose-500/25');

    return `
      <div class="bg-slate-900/80 border ${borderClass} rounded-xl p-3 flex flex-col justify-between hover:bg-slate-900 transition">
        <div class="flex items-center justify-between text-slate-400 text-[11px] font-medium">
          <span>${m.label}</span>
          <i data-lucide="${m.icon}" class="w-3.5 h-3.5 opacity-70"></i>
        </div>
        <div class="font-display font-bold text-xl my-1 ${colorClass}">${m.value}</div>
        <div class="text-[10px] text-slate-500">${m.sub}</div>
      </div>
    `;
  }).join('');

  document.getElementById('telemetryInsight').textContent = stats.goldDiff15 >= 0
    ? `${STATE.ally.name} costuma sair dos 15 minutos com +${stats.goldDiff15} de ouro sobre ${STATE.enemy.name}.`
    : `${STATE.enemy.name} pressiona o early game (${stats.goldDiff15}g @15). Jogue pela sobrevivência e escala.`;
}

function renderSetupBlock(setup, baseWr) {
  const { getItemIconUrl } = window.RiftServices;
  const setupWr = Math.min(61.5, (baseWr + 2.4)).toFixed(1);

  document.getElementById('setupWinrateBadge').textContent = `${setupWr}% WR com este Setup`;
  document.getElementById('skillOrderText').textContent = setup.skillOrder;
  document.getElementById('summonersText').textContent = setup.summoners;

  // Runas
  document.getElementById('runesContainer').innerHTML = `
    <div class="flex items-center gap-3">
      <img src="${setup.keystoneIcon}" alt="${setup.keystoneName}" class="w-11 h-11 rounded-full bg-slate-950 p-1 border border-hextech-gold/50" />
      <div>
        <div class="text-xs font-bold text-white">${setup.keystoneName}</div>
        <div class="text-[11px] text-slate-400">Runa Essencial Recomendada</div>
      </div>
    </div>
    <div class="flex items-center gap-2 border-l border-slate-800 pl-3">
      <img src="${setup.secondaryIcon}" alt="Secundária" class="w-7 h-7 opacity-90" />
      <div class="text-[11px] text-slate-300 max-w-[140px] leading-tight">${setup.secondaryName}</div>
    </div>
  `;

  // Itens (3 Core + 1 Counter Situacional)
  const itemsHtml = setup.coreItems.map((item, idx) => `
    <div class="bg-slate-900/90 border border-slate-800 rounded-lg p-2 flex flex-col items-center text-center group">
      <div class="relative">
        <img src="${getItemIconUrl(STATE.patch, item.id)}" alt="${item.name}" class="w-11 h-11 rounded-md border border-slate-700 group-hover:border-hextech-gold transition" />
        <span class="absolute -top-1.5 -left-1.5 w-4 h-4 rounded-full bg-slate-950 border border-slate-700 text-[10px] font-bold text-slate-300 flex items-center justify-center">${idx + 1}</span>
      </div>
      <span class="text-[10px] text-slate-300 font-medium mt-1.5 line-clamp-1">${item.name}</span>
      <span class="text-[9px] text-slate-500">Core Item</span>
    </div>
  `).join('');

  const counterHtml = `
    <div class="bg-amber-950/20 border border-hextech-gold/50 rounded-lg p-2 flex flex-col items-center text-center relative" title="${setup.counterItem.reason}">
      <div class="relative">
        <img src="${getItemIconUrl(STATE.patch, setup.counterItem.id)}" alt="${setup.counterItem.name}" class="w-11 h-11 rounded-md border border-hextech-gold" />
        <span class="absolute -top-1.5 -right-1.5 px-1 rounded bg-hextech-gold text-slate-950 text-[9px] font-extrabold">COUNTER</span>
      </div>
      <span class="text-[10px] text-hextech-goldLight font-semibold mt-1.5 line-clamp-1">${setup.counterItem.name}</span>
      <span class="text-[9px] text-amber-400/90 line-clamp-1">${setup.counterItem.reason}</span>
    </div>
  `;

  document.getElementById('itemsContainer').innerHTML = itemsHtml + counterHtml;
}

function renderAICoachCards(cards) {
  const modeBadge = document.getElementById('aiModeBadge');
  if (STATE.junglerActive && STATE.enemyJungler) {
    modeBadge.textContent = `Modo 2v2 Ativo (vs ${STATE.enemyJungler.name} JG)`;
    modeBadge.className = 'text-[11px] font-sans font-semibold px-2.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40';
  } else {
    modeBadge.textContent = 'Modo 1v1 Isolado';
    modeBadge.className = 'text-[11px] font-sans font-semibold px-2.5 py-0.5 rounded bg-slate-800 text-hextech-gold border border-hextech-gold/30';
  }

  const accentColors = {
    cyan:    { border: 'border-hextech-cyan/30', badge: 'bg-hextech-cyan/15 text-hextech-cyan', dot: 'bg-hextech-cyan' },
    gold:    { border: 'border-hextech-gold/30', badge: 'bg-hextech-gold/15 text-hextech-gold', dot: 'bg-hextech-gold' },
    red:     { border: 'border-rose-500/40',     badge: 'bg-rose-500/15 text-rose-400',         dot: 'bg-rose-400' },
    emerald: { border: 'border-emerald-500/35',  badge: 'bg-emerald-500/15 text-emerald-400',   dot: 'bg-emerald-400' }
  };

  const container = document.getElementById('aiCoachGrid');
  container.innerHTML = cards.map(card => {
    const theme = accentColors[card.accent] || accentColors.cyan;
    return `
      <article class="bg-hextech-card hover:bg-hextech-cardHover border ${theme.border} rounded-xl p-4 flex flex-col justify-between transition-all shadow-md">
        <div>
          <div class="flex items-center justify-between gap-2 mb-2.5">
            <span class="text-[10px] font-mono font-bold px-2 py-0.5 rounded ${theme.badge}">FASE ${card.step}</span>
            <i data-lucide="${card.icon}" class="w-4 h-4 text-slate-400"></i>
          </div>
          <h3 class="font-display font-bold text-base text-white tracking-wide">${card.title}</h3>
          <p class="text-[11px] text-slate-400 mb-3 pb-2 border-b border-slate-800/80">${card.subtitle}</p>

          <ul class="space-y-2 text-xs text-slate-300 leading-relaxed">
            ${card.bullets.map(b => `
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

function openChampionModal(target) {
  STATE.modalTarget = target;
  const titles = {
    ally: 'Selecionar Seu Campeão (Aliado)',
    enemy: 'Selecionar Oponente de Rota (Inimigo)',
    jungler: 'Selecionar Jungler Inimigo (Ameaça 2v2)'
  };
  document.getElementById('modalTitle').textContent = titles[target];
  document.getElementById('championSearchInput').value = '';
  renderChampionModalList('');
  document.getElementById('championModal').classList.remove('hidden');
  setTimeout(() => document.getElementById('championSearchInput').focus(), 50);
}

function closeChampionModal() {
  document.getElementById('championModal').classList.add('hidden');
}

function renderChampionModalList(query = '') {
  const { getChampionIconUrl } = window.RiftServices;
  const normalized = query.trim().toLowerCase();
  const filtered = STATE.championList.filter(c =>
    c.name.toLowerCase().includes(normalized) || c.id.toLowerCase().includes(normalized)
  );

  const grid = document.getElementById('championGridList');
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

  document.getElementById('btnSwapChamps').addEventListener('click', () => {
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
    } else {
      container.classList.add('hidden');
      btn.className = 'flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border transition-all bg-slate-900 border-slate-700 text-slate-300 hover:border-amber-500/60';
      label.textContent = '+ Jungler Inimigo';
    }
    refreshDashboard();
  });

  document.querySelectorAll('.role-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      STATE.role = btn.dataset.role;
      document.querySelectorAll('.role-btn').forEach(b => {
        b.className = 'role-btn px-2.5 py-1 rounded text-xs font-medium text-slate-400 hover:text-white transition-all';
      });
      btn.className = 'role-btn px-2.5 py-1 rounded text-xs font-medium transition-all bg-hextech-gold/20 text-hextech-gold border border-hextech-gold/40';
      setDefaultChampionsForRole(STATE.role);
      refreshDashboard();
    });
  });

  document.getElementById('eloSelect').addEventListener('change', (e) => {
    STATE.elo = e.target.value;
    refreshDashboard();
  });

  document.getElementById('btnRegenerateAI').addEventListener('click', () => {
    refreshDashboard();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) {
    window.lucide.createIcons();
  }
  setupEventListeners();
  initApp();
});
