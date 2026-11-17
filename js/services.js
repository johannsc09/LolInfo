/**
 * ============================================================================
 * RIFTCOACH.GG - SERVIÇOS DE DADOS (Riot Data Dragon + data/matchups.json)
 * ============================================================================
 */

let MATCHUPS_DB = null;

/**
 * Mapeamento de Campeões por Rota (Top, Jungle, Mid, ADC, Support)
 * Usado pelo filtro de ícones de Lane dentro do Modal de Seleção.
 * O botão "Todas" exibe todos os campeões permitindo flex picks em qualquer rota.
 */
const CHAMPION_LANES = {
  TOP: [
    'Aatrox', 'Akali', 'Ambessa', 'aurora', 'Camille', 'ChoGath', 'Darius', 'DrMundo', 'Fiora',
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

/**
 * Verifica se um campeão pertence a uma rota no filtro do modal
 */
function championMatchesLane(champion, laneFilter) {
  if (!laneFilter || laneFilter === 'ALL') return true;
  const list = CHAMPION_LANES[laneFilter] || [];
  if (list.some(id => id.toLowerCase() === champion.id.toLowerCase())) {
    return true;
  }
  // Fallback pelas tags do Data Dragon para novos campeões lançados no patch
  const tags = champion.tags || [];
  if (laneFilter === 'TOP' && (tags.includes('Fighter') || tags.includes('Tank'))) return true;
  if (laneFilter === 'JUNGLE' && (tags.includes('Fighter') || tags.includes('Assassin'))) return true;
  if (laneFilter === 'MID' && (tags.includes('Mage') || tags.includes('Assassin'))) return true;
  if (laneFilter === 'ADC' && tags.includes('Marksman')) return true;
  if (laneFilter === 'SUPPORT' && tags.includes('Support')) return true;
  return false;
}

/**
 * Busca a versão atual do patch e todos os campeões na CDN oficial Riot Data Dragon
 */
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

/**
 * Carrega o arquivo data/matchups.json
 */
async function loadMatchupsDatabase() {
  if (MATCHUPS_DB) return MATCHUPS_DB;
  try {
    const res = await fetch('./data/matchups.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    MATCHUPS_DB = await res.json();
    return MATCHUPS_DB;
  } catch (err) {
    console.warn('Não foi possível carregar ./data/matchups.json via HTTP, usando fallback se disponível.', err);
    if (window.FALLBACK_MATCHUPS_DB) {
      MATCHUPS_DB = window.FALLBACK_MATCHUPS_DB;
      return MATCHUPS_DB;
    }
    return { matchups: {} };
  }
}

function getChampionIconUrl(patch, champId) {
  return `https://ddragon.leagueoflegends.com/cdn/${patch}/img/champion/${champId}.png`;
}

function getItemIconUrl(patch, itemId) {
  return `https://ddragon.leagueoflegends.com/cdn/${patch}/img/item/${itemId}.png`;
}

/**
 * Consulta estrita no JSON de confrontos.
 * Nunca gera números falsos aleatórios: retorna `null` caso o confronto ou filtro não exista.
 */
async function getMatchupAnalysis({ ally, enemy, role, elo, junglerActive, enemyJungler }) {
  if (!ally || !enemy || !role || !elo) return null;

  const db = await loadMatchupsDatabase();
  const key = `${role}:${ally.id}:${enemy.id}`;
  const record = db?.matchups?.[key];

  if (!record) {
    return null;
  }

  const eloStats = record.baseStatsByElo?.[elo];
  if (!eloStats) {
    return null;
  }

  // Clona os dados para não mutar o cache quando o modo +Jungler estiver ativo
  const stats = JSON.parse(JSON.stringify(eloStats));
  const buildsAndRunes = JSON.parse(JSON.stringify(record.buildsAndRunes));
  const aiCards = JSON.parse(JSON.stringify(record.aiCoach.cards));
  let difficulty = record.difficulty || 'Equilibrado';

  // Aplica modificadores reais de 2v2 caso o toggle "+ Jungler Inimigo" esteja ativo e um Jungler selecionado
  if (junglerActive && enemyJungler) {
    const overrides = record.aiCoach?.junglerOverrides || {};
    const jgOverride = overrides[enemyJungler.id] || overrides.DEFAULT;

    if (jgOverride) {
      const wrDelta = Number(jgOverride.winRateDelta || 0);
      stats.winRate = Number(Math.min(65, Math.max(35, stats.winRate + wrDelta)).toFixed(1));
      stats.enemyWinRate = Number((100 - stats.winRate).toFixed(1));
      stats.deltaWr = Number((stats.deltaWr + wrDelta).toFixed(1));

      // Atualiza o Card 04 (Dinâmica de Selva & Risco de Gank)
      const card04 = aiCards.find(c => c.step === '04');
      if (card04) {
        card04.subtitle = overrides[enemyJungler.id]
          ? jgOverride.subtitle
          : `Ameaça 2v2: ${enemy.name} + ${enemyJungler.name}`;
        card04.accent = 'red';
        card04.bullets = jgOverride.bullets.map(b =>
          b.replace(/Jungler inimigo|Jungler adversário/gi, enemyJungler.name)
        );
      }
    }
  }

  return {
    allyId: record.allyId,
    enemyId: record.enemyId,
    role: record.role,
    elo,
    difficulty,
    stats,
    buildsAndRunes,
    aiCards
  };
}

/**
 * Retorna a lista de confrontos disponíveis no JSON para facilitar a verificação
 */
async function getAvailableMatchupKeys() {
  const db = await loadMatchupsDatabase();
  return Object.keys(db?.matchups || {});
}

/**
 * Retorna em quais rotas (TOP, JUNGLE, MID, ADC, SUPPORT) já existem dados para o par selecionado
 */
async function getAvailableRolesForPair(allyId, enemyId) {
  if (!allyId || !enemyId) return [];
  const db = await loadMatchupsDatabase();
  const matchups = db?.matchups || {};
  const roles = [];
  for (const key of Object.keys(matchups)) {
    const [r, a, e] = key.split(':');
    if (a === allyId && e === enemyId) {
      roles.push(r);
    }
  }
  return roles;
}

window.RiftServices = {
  fetchDataDragonBootstrap,
  loadMatchupsDatabase,
  championMatchesLane,
  getChampionIconUrl,
  getItemIconUrl,
  getMatchupAnalysis,
  getAvailableMatchupKeys,
  getAvailableRolesForPair
};
