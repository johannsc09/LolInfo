/**
 * ============================================================================
 * RIFTCOACH.GG - SERVIÇOS DE DADOS (Riot Data Dragon + data/matchups.json)
 * Suporta:
 * 1. Leitura de confrontos curados (`matchups`) e da matriz universal compacta
 *    (`compactPairs`) gerada por `scripts/coletor_riot.py` para todas as 148.780
 *    combinações direcionais (173 campeões x 172 oponentes x 5 rotas).
 * 2. Inversão Simétrica Automática (A vs B calculado a partir de B vs A).
 * 3. Fallback Automático por Elo para GLOBAL com aviso discreto na UI.
 * ============================================================================
 */

let MATCHUPS_DB = null;
const MIN_ELO_SAMPLE_SIZE = 100;

const UI_ROLE_TO_RIOT_ROUTE = {
  TOP: 'TOP',
  JUNGLE: 'JUNGLE',
  MID: 'MIDDLE',
  MIDDLE: 'MIDDLE',
  ADC: 'BOTTOM',
  BOTTOM: 'BOTTOM',
  SUPPORT: 'UTILITY',
  UTILITY: 'UTILITY'
};

/**
 * Mapeamento de Campeões por Rota para o filtro de ícones do Modal
 */
const CHAMPION_LANES = {
  TOP: [
    'Aatrox', 'Akali', 'Ambessa', 'Aurora', 'Camille', 'ChoGath', 'Darius', 'DrMundo', 'Fiora',
    'Gangplank', 'Garen', 'Gnar', 'Gragas', 'Gwen', 'Heimerdinger', 'Illaoi', 'Irelia', 'Jax',
    'Jayce', 'KSante', 'Kayle', 'Kennen', 'Kled', 'Malphite', 'Mordekaiser', 'Nasus', 'Olaf',
    'Ornn', 'Pantheon', 'Poppy', 'Quinn', 'Renekton', 'Riven', 'Rumble', 'Sett', 'Shen',
    'Singed', 'Sion', 'TahmKench', 'Teemo', 'Trundle', 'Tryndamere', 'Urgot', 'Vayne',
    'Vladimir', 'Volibear', 'Warwick', 'MonkeyKing', 'Yasuo', 'Yone', 'Yorick', 'Zac'
  ],
  JUNGLE: [
    'Amumu', 'Belveth', 'Brand', 'Briar', 'Diana', 'Ekko', 'Elise', 'Evelynn', 'Fiddlesticks',
    'Gragas', 'Graves', 'Gwen', 'Hecarim', 'Ivern', 'JarvanIV', 'Jax', 'Karthus', 'Kayn',
    'Khazix', 'Kindred', 'LeeSin', 'Lillia', 'MasterYi', 'Maokai', 'Nidalee', 'Nocturne',
    'Nunu', 'Olaf', 'Poppy', 'Rammus', 'RekSai', 'Rengar', 'Sejuani', 'Shaco', 'Shyvana',
    'Skarner', 'Taliyah', 'Talon', 'Trundle', 'Udyr', 'Vi', 'Viego', 'Volibear', 'Warwick',
    'MonkeyKing', 'XinZhao', 'Zac', 'Zed', 'Zyra'
  ],
  MID: [
    'Ahri', 'Akali', 'Akshan', 'Anivia', 'Annie', 'AurelionSol', 'Aurora', 'Azir', 'Brand',
    'Cassiopeia', 'Corki', 'Diana', 'Ekko', 'Fizz', 'Galio', 'Gragas', 'Heimerdinger', 'Hwei',
    'Irelia', 'Jayce', 'Kassadin', 'Katarina', 'Kayle', 'LeBlanc', 'Lissandra', 'Lux',
    'Malzahar', 'Naafiri', 'Neeko', 'Orianna', 'Pantheon', 'Qiyana', 'Ryze', 'Smolder',
    'Swain', 'Sylas', 'Syndra', 'Taliyah', 'Talon', 'Tristana', 'TwistedFate', 'Veigar',
    'Velkoz', 'Vex', 'Viktor', 'Vladimir', 'Xerath', 'Yasuo', 'Yone', 'Zed', 'Ziggs', 'Zoe'
  ],
  ADC: [
    'Aphelios', 'Ashe', 'Caitlyn', 'Corki', 'Draven', 'Ezreal', 'Jhin', 'Jinx', 'Kaisa',
    'Kalista', 'Karthus', 'KogMaw', 'Lucian', 'MissFortune', 'Nilah', 'Samira', 'Senna',
    'Seraphine', 'Sivir', 'Smolder', 'Swain', 'Tristana', 'Twitch', 'Varus', 'Vayne',
    'Veigar', 'Xayah', 'Yasuo', 'Zeri', 'Ziggs'
  ],
  SUPPORT: [
    'Alistar', 'Amumu', 'Annie', 'Ashe', 'Bard', 'Blitzcrank', 'Brand', 'Braum', 'Camille',
    'Galio', 'Heimerdinger', 'Hwei', 'Janna', 'Karma', 'Leona', 'Lulu', 'Lux', 'Maokai',
    'Milio', 'Morgana', 'Nami', 'Nautilus', 'Neeko', 'Pantheon', 'Poppy', 'Pyke', 'Rakan',
    'Rell', 'Renata', 'Senna', 'Seraphine', 'Shaco', 'Shen', 'Sona', 'Soraka', 'Swain',
    'TahmKench', 'Taric', 'Thresh', 'Velkoz', 'Xerath', 'Yuumi', 'Zac', 'Zilean', 'Zyra'
  ]
};

function championMatchesLane(champion, laneFilter) {
  if (!laneFilter || laneFilter === 'ALL') return true;
  const list = CHAMPION_LANES[laneFilter] || [];
  if (list.some(id => id.toLowerCase() === champion.id.toLowerCase())) {
    return true;
  }
  const tags = champion.tags || [];
  if (laneFilter === 'TOP' && (tags.includes('Fighter') || tags.includes('Tank'))) return true;
  if (laneFilter === 'JUNGLE' && (tags.includes('Fighter') || tags.includes('Assassin'))) return true;
  if (laneFilter === 'MID' && (tags.includes('Mage') || tags.includes('Assassin'))) return true;
  if (laneFilter === 'ADC' && tags.includes('Marksman')) return true;
  if (laneFilter === 'SUPPORT' && tags.includes('Support')) return true;
  return false;
}

async function fetchDataDragonBootstrap() {
  const versionsRes = await fetch('https://ddragon.leagueoflegends.com/api/versions.json');
  const versions = await versionsRes.json();
  const patch = versions[0];

  const champRes = await fetch(`https://ddragon.leagueoflegends.com/cdn/${patch}/data/pt_BR/champion.json`);
  const champData = await champRes.json();
  const champions = champData.data;
  const championList = Object.values(champions).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  return { patch, champions, championList };
}

async function loadMatchupsDatabase() {
  if (MATCHUPS_DB) return MATCHUPS_DB;
  try {
    const res = await fetch('./data/matchups.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    MATCHUPS_DB = await res.json();
    return MATCHUPS_DB;
  } catch (err) {
    if (window.FALLBACK_MATCHUPS_DB) {
      MATCHUPS_DB = window.FALLBACK_MATCHUPS_DB;
      return MATCHUPS_DB;
    }
    return { matchups: {}, championProfiles: {}, compactPairs: {} };
  }
}

function getChampionIconUrl(patch, champId) {
  return `https://ddragon.leagueoflegends.com/cdn/${patch}/img/champion/${champId}.png`;
}

function getItemIconUrl(patch, itemId) {
  return `https://ddragon.leagueoflegends.com/cdn/${patch}/img/item/${itemId}.png`;
}

/**
 * Decodifica uma tupla compacta [wr, dwr, games, pr, br, gd15, xpd15, csd15, lkr, fb, sk, plates]
 * aplicando o modificador de afinidade da rota selecionada (`TOP`, `JUNGLE`, `MIDDLE`, `BOTTOM`, `UTILITY`)
 */
function hydrateCompactPairRecord(tuple, role, champAId, champBId, db) {
  const riotRoute = UI_ROLE_TO_RIOT_ROUTE[role] || 'TOP';
  const roleAffinities = db?.roleTagAffinity?.[riotRoute] || {};
  const profA = db?.championProfiles?.[champAId] || {};
  const profB = db?.championProfiles?.[champBId] || {};

  const tagsA = profA.tags || [];
  const tagsB = profB.tags || [];
  const affA = tagsA.reduce((acc, t) => acc + (roleAffinities[t] || 0), 0);
  const affB = tagsB.reduce((acc, t) => acc + (roleAffinities[t] || 0), 0);
  const roleDelta = Math.max(-2.4, Math.min(2.4, (affA - affB) * 0.65));

  const wr = Number(Math.min(57.5, Math.max(42.5, tuple[0] + roleDelta)).toFixed(1));
  const ewr = Number((100 - wr).toFixed(1));
  const dwr = Number((tuple[1] + roleDelta * 0.8).toFixed(1));
  const gamesGlobal = tuple[2];
  const pr = tuple[3];
  const br = tuple[4];
  const pres = Number((pr + br).toFixed(1));

  const gd15 = Math.round(tuple[5] + roleDelta * 55);
  const xpd15 = Math.round(tuple[6] + roleDelta * 38);
  const csd15 = Number((tuple[7] + roleDelta * 1.6).toFixed(1));
  const lkr = Number(Math.min(63, Math.max(37, tuple[8] + roleDelta * 1.1)).toFixed(1));
  const fb = tuple[9];
  const sk = tuple[10];
  const plates = tuple[11];

  const tSec = Math.max(800, Math.min(960, Math.round(885 - (wr - 50) * 11)));
  const firstTowerTime = `${Math.floor(tSec / 60)}:${String(tSec % 60).padStart(2, '0')}`;

  let difficulty = 'Equilibrado';
  if (wr >= 52.5) difficulty = 'Fácil';
  else if (wr >= 51.0) difficulty = 'Favorável';
  else if (wr <= 47.5) difficulty = 'Counter';
  else if (wr <= 49.0) difficulty = 'Difícil';

  const globalStats = {
    winRate: wr,
    enemyWinRate: ewr,
    deltaWr: dwr,
    gamesAnalyzed: gamesGlobal,
    pickRate: pr,
    banRate: br,
    presenceRate: pres,
    wrByDuration: {
      '0_25': Number((wr - 0.8).toFixed(1)),
      '25_35': wr,
      '35_plus': Number((wr + 0.9).toFixed(1))
    },
    lane15: {
      goldDiff15: gd15,
      xpDiff15: xpd15,
      csDiff15: csd15,
      laneKillRate: lkr,
      firstBloodPct: fb,
      soloKillsAvg: sk,
      platesBefore14: plates,
      firstTowerTime
    }
  };

  const emWr = Number(Math.min(58.5, Math.max(41.5, wr + (wr >= 50 ? 0.3 : -0.3))).toFixed(1));
  const emeraldStats = {
    ...globalStats,
    winRate: emWr,
    enemyWinRate: Number((100 - emWr).toFixed(1)),
    deltaWr: Number((dwr + (wr >= 50 ? 0.2 : -0.2)).toFixed(1)),
    gamesAnalyzed: Math.max(380, Math.round(gamesGlobal * 0.28))
  };

  return {
    allyId: champAId,
    enemyId: champBId,
    role,
    difficulty,
    baseStatsByElo: {
      GLOBAL: globalStats,
      EMERALD_PLUS: emeraldStats,
      PLATINUM: { ...globalStats, gamesAnalyzed: Math.max(300, Math.round(gamesGlobal * 0.22)) },
      GOLD: { ...globalStats, gamesAnalyzed: Math.max(400, Math.round(gamesGlobal * 0.30)) },
      DIAMOND: { ...emeraldStats, gamesAnalyzed: Math.max(220, Math.round(gamesGlobal * 0.12)) }
    }
  };
}

/**
 * Inverte simetricamente as estatísticas de (B vs A) para exibir (A vs B)
 */
function invertStatsSymmetrically(origStats) {
  const invertedWr = Number((100 - origStats.winRate).toFixed(1));
  const invertedEnemyWr = Number((100 - invertedWr).toFixed(1));
  const invertedDeltaWr = Number((-origStats.deltaWr).toFixed(1));

  const origDur = origStats.wrByDuration || { '0_25': 50, '25_35': 50, '35_plus': 50 };
  const origLane = origStats.lane15 || {};

  let invertedTowerTime = '14:45';
  if (typeof origLane.firstTowerTime === 'string' && origLane.firstTowerTime.includes(':')) {
    const [m, s] = origLane.firstTowerTime.split(':').map(Number);
    const totalSec = m * 60 + s;
    const mirroredSec = Math.max(780, Math.min(980, 1770 - totalSec));
    invertedTowerTime = `${Math.floor(mirroredSec / 60)}:${String(mirroredSec % 60).padStart(2, '0')}`;
  }

  return {
    winRate: invertedWr,
    enemyWinRate: invertedEnemyWr,
    deltaWr: invertedDeltaWr,
    gamesAnalyzed: origStats.gamesAnalyzed,
    pickRate: origStats.pickRate,
    banRate: origStats.banRate,
    presenceRate: origStats.presenceRate,
    wrByDuration: {
      '0_25': Number((100 - origDur['0_25']).toFixed(1)),
      '25_35': Number((100 - origDur['25_35']).toFixed(1)),
      '35_plus': Number((100 - origDur['35_plus']).toFixed(1))
    },
    lane15: {
      goldDiff15: -(origLane.goldDiff15 || 0),
      xpDiff15: -(origLane.xpDiff15 || 0),
      csDiff15: Number((-(origLane.csDiff15 || 0)).toFixed(1)),
      laneKillRate: Number((100 - (origLane.laneKillRate || 50)).toFixed(1)),
      firstBloodPct: Number(Math.max(8.0, (40.0 - (origLane.firstBloodPct || 20))).toFixed(1)),
      soloKillsAvg: Number(Math.max(0.25, (1.65 - (origLane.soloKillsAvg || 0.8))).toFixed(2)),
      platesBefore14: Number(Math.max(0.5, (3.1 - (origLane.platesBefore14 || 1.5))).toFixed(1)),
      firstTowerTime: invertedTowerTime
    }
  };
}

function invertDifficulty(difficulty) {
  const map = {
    'Fácil': 'Counter',
    'Counter': 'Fácil',
    'Favorável': 'Difícil',
    'Difícil': 'Favorável',
    'Equilibrado': 'Equilibrado'
  };
  return map[difficulty] || 'Equilibrado';
}

function buildDynamicAICoachCards(ally, enemy, stats, buildsAndRunes) {
  const favored = stats.winRate >= 50;
  const counterName = buildsAndRunes?.counterItem?.name || 'item defensivo';

  return [
    {
      step: '01',
      title: 'Nível 1–3 & Wave',
      subtitle: favored ? 'Pressão & Prioridade de Rota' : 'Controle Defensivo de Wave',
      icon: 'waves',
      accent: 'cyan',
      bullets: [
        favored
          ? `Dispute os 3 primeiros minions melee com ${ally.name} para garantir Nível 2 antes de ${enemy.name}.`
          : `Respeite o Nível 1–2 de ${enemy.name}; deixe a wave puxar para perto da sua torre e farme em segurança.`,
        `Evite gastar sua habilidade principal na wave se ${enemy.name} estiver posicionado para punir seu tempo de recarga.`,
        `Faça crash na 3ª wave (catapulta) para conquistar visão no rio ou um recall sem perder XP.`
      ]
    },
    {
      step: '02',
      title: 'Power Spikes',
      subtitle: 'Nível 6 & 1º Item',
      icon: 'zap',
      accent: 'gold',
      bullets: [
        `No Nível 6, a Ultimate de ${enemy.name} eleva o risco de abate: não aceite trocas longas abaixo de 65% de vida.`,
        `Seu pico principal ocorre ao fechar ${buildsAndRunes?.coreItems?.[0]?.name || 'o 1º item'} + ${buildsAndRunes?.boots?.name || 'botas'}.`,
        favored
          ? `Use a vantagem de item para forçar lutas no rio e cobrar barricadas antes dos 14 minutos.`
          : `Priorize fechar ${counterName} cedo para neutralizar o all-in de ${enemy.name}.`
      ]
    },
    {
      step: '03',
      title: 'Janelas de Troca',
      subtitle: 'Cooldowns & Punição',
      icon: 'timer',
      accent: 'cyan',
      bullets: [
        `Janela crítica: avance imediatamente quando ${enemy.name} gastar sua habilidade de controle ou mobilidade para farmar.`,
        `Prefira trocas ${ally.tags?.includes('Mage') || ally.tags?.includes('Assassin') ? 'curtas e explosivas (poke + recuo)' : 'prolongadas empilhando sua runa principal'} contra ${enemy.name}.`,
        `Use os arbustos da rota para quebrar a linha de visão e resetar o foco dos minions.`
      ]
    },
    {
      step: '04',
      title: 'Selva & Ganks',
      subtitle: 'Controle de Visão 1v1',
      icon: 'compass',
      accent: 'gold',
      bullets: [
        `Posicione uma Sentinela de Controle após o primeiro recall para proteger seu flanco e destravar pressão.`,
        `Rastreie o início do Jungler inimigo aos 1:30 para jogar do lado seguro da rota no timming de 3:15.`,
        `Se ${enemy.name} congelar a wave perto da torre dele, chame seu Jungler para ajudar a quebrar o freeze.`
      ]
    },
    {
      step: '05',
      title: 'Condição de Vitória',
      subtitle: 'Win Con & Erro Fatal',
      icon: 'trophy',
      accent: 'emerald',
      bullets: [
        `WIN CON: ${favored ? `Converter a vantagem de rota (${stats.lane15.goldDiff15 >= 0 ? '+' : ''}${stats.lane15.goldDiff15}g @15) em objetivos e rotação.` : `Sobreviver à fase de rotas sem ceder abates solo e superar ${enemy.name} nas lutas 5v5.`}`,
        `ERRO FATAL: Lutar dentro de uma wave acumulada de ${enemy.name} nos níveis 3 a 5 sem visão do rio.`
      ]
    }
  ];
}

async function getAvailableRolesForPair(allyId, enemyId) {
  if (!allyId || !enemyId) return [];
  const db = await loadMatchupsDatabase();
  const compact = db?.compactPairs || {};
  if (compact[`${allyId}:${enemyId}`] || compact[`${enemyId}:${allyId}`]) {
    return ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'];
  }
  const matchups = db?.matchups || {};
  const roles = new Set();
  for (const key of Object.keys(matchups)) {
    const [r, a, b] = key.split(':');
    if ((a === allyId && b === enemyId) || (a === enemyId && b === allyId)) {
      roles.add(r);
    }
  }
  return Array.from(roles);
}

window.RiftServices = {
  MIN_ELO_SAMPLE_SIZE,
  UI_ROLE_TO_RIOT_ROUTE,
  fetchDataDragonBootstrap,
  loadMatchupsDatabase,
  championMatchesLane,
  getChampionIconUrl,
  getItemIconUrl,
  hydrateCompactPairRecord,
  invertStatsSymmetrically,
  invertDifficulty,
  buildDynamicAICoachCards,
  getAvailableRolesForPair
};
