/**
 * ============================================================================
 * RIFTCOACH.GG - CAMADA DE DADOS E INTEGRAÇÃO (Riot Data Dragon + Supabase + IA)
 * ============================================================================
 * Para conectar ao seu backend real em produção:
 * 1. Insira suas chaves do Supabase em SUPABASE_CONFIG
 * 2. Insira seu endpoint da Gemini API / Edge Function em AI_COACH_CONFIG
 */

const SUPABASE_CONFIG = {
  url: 'https://seu-projeto.supabase.co',
  anonKey: 'SUA_SUPABASE_ANON_KEY_AQUI',
  enabled: false // Mude para true quando configurar a tabela `matchup_stats_patch`
};

const AI_COACH_CONFIG = {
  endpoint: '/api/gemini-coach',
  apiKey: 'SUA_GEMINI_API_KEY_AQUI',
  enabled: false // Mude para true para consumir a Gemini API em tempo real
};

/**
 * Função utilitária de hash determinístico para que cada combinação de
 * (Aliado + Oponente + Rota + Elo + Jungler) gere dados consistentes nos testes.
 */
function hashString(str) {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
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
  const championList = Object.values(champions).sort((a, b) => a.name.localeCompare(b.name));

  return { patch, champions, championList };
}

function getChampionIconUrl(patch, champId) {
  return `https://ddragon.leagueoflegends.com/cdn/${patch}/img/champion/${champId}.png`;
}

function getItemIconUrl(patch, itemId) {
  return `https://ddragon.leagueoflegends.com/cdn/${patch}/img/item/${itemId}.png`;
}

/**
 * Busca estatísticas de fase de rotas (@15) e Setup Recomendado
 */
async function fetchMatchupStats({ ally, enemy, role, elo, junglerActive, enemyJungler }) {
  // Exemplo pronto para ativação com Supabase PostgreSQL:
  /*
  if (SUPABASE_CONFIG.enabled) {
    const response = await fetch(
      `${SUPABASE_CONFIG.url}/rest/v1/matchup_stats?ally_id=eq.${ally.id}&enemy_id=eq.${enemy.id}&role=eq.${role}&elo=eq.${elo}`,
      {
        headers: {
          apikey: SUPABASE_CONFIG.anonKey,
          Authorization: `Bearer ${SUPABASE_CONFIG.anonKey}`
        }
      }
    );
    const data = await response.json();
    if (data && data.length > 0) return data[0];
  }
  */

  const seedKey = `${ally.id}_vs_${enemy.id}_${role}_${elo}_${junglerActive ? enemyJungler.id : '1v1'}`;
  const h = hashString(seedKey);

  const baseWr = 45.2 + ((h % 103) / 10);
  const jgModifier = junglerActive ? (((h >> 3) % 24) - 12) / 10 : 0;
  const winRate = Number(Math.min(57.8, Math.max(42.5, baseWr + jgModifier)).toFixed(1));
  const advantage = winRate >= 50;

  const deltaFactor = (winRate - 50) * 95;
  const goldDiff15 = Math.round(deltaFactor + ((h % 180) - 90));
  const xpDiff15 = Math.round(deltaFactor * 0.72 + ((h % 120) - 60));
  const csDiff15 = Number(((goldDiff15 / 28) + (((h >> 2) % 10) - 5) * 0.2).toFixed(1));
  const laneKillRate = Number((46 + (winRate - 46) * 1.15).toFixed(1));
  const firstBloodPct = Number((14 + (h % 15) + (advantage ? 3.2 : -1.5)).toFixed(1));
  const soloKillsAvg = Number((0.45 + ((h % 14) / 10) + (advantage ? 0.22 : -0.1)).toFixed(2));
  const pickRate = Number((3.8 + ((h >> 4) % 110) / 10).toFixed(1));
  const banRate = Number((4.5 + ((h >> 5) % 185) / 10).toFixed(1));
  const gamesAnalyzed = 2400 + (h % 21500);

  // Determinação inteligente do Setup com base nas tags da Riot API
  const isAP = ally.tags.includes('Mage') || (ally.info?.magic > ally.info?.attack);
  const isADC = role === 'ADC' || ally.tags.includes('Marksman');
  const isTank = ally.tags.includes('Tank') || role === 'SUPPORT';
  const enemyIsHeavyAD = enemy.info?.attack >= 6;
  const enemyHasHealing = [
    'Aatrox', 'Darius', 'Sylas', 'Yone', 'Yasuo',
    'Viego', 'Briar', 'Warwick', 'Fiora', 'Irelia', 'DrMundo', 'Vladimir'
  ].includes(enemy.id);

  let setup = {
    keystoneName: 'Conquistador',
    keystoneIcon: 'https://ddragon.leagueoflegends.com/cdn/img/perk-images/Styles/Precision/Conqueror/Conqueror.png',
    secondaryName: 'Determinação (Osso Revestido + Crescimento Excessivo)',
    secondaryIcon: 'https://ddragon.leagueoflegends.com/cdn/img/perk-images/Styles/7204_Resolve.png',
    coreItems: [
      { id: '6630', name: 'Quebrapassos / Eclipse' },
      { id: '3071', name: 'Cutelo Negro' },
      { id: '3053', name: 'Sinal de Sterak' }
    ],
    counterItem: enemyHasHealing
      ? { id: '3033', name: 'Lembrete Mortal', reason: `Corta-cura essencial vs ${enemy.name}` }
      : (enemyIsHeavyAD
          ? { id: '6333', name: 'Dança da Morte', reason: `Mitiga o burst físico de ${enemy.name}` }
          : { id: '3156', name: 'Mandíbula de Malmortius', reason: `Escudo anti-burst mágico vs ${enemy.name}` }),
    skillOrder: 'Q > E > W',
    summoners: role === 'TOP' ? 'Flash + Teleporte' : 'Flash + Incendiar'
  };

  if (isAP) {
    setup = {
      keystoneName: 'Eletrocutar',
      keystoneIcon: 'https://ddragon.leagueoflegends.com/cdn/img/perk-images/Styles/Domination/Electrocute/Electrocute.png',
      secondaryName: 'Feitiçaria (Faixa de Fluxo de Mana + Transcendência)',
      secondaryIcon: 'https://ddragon.leagueoflegends.com/cdn/img/perk-images/Styles/7202_Sorcery.png',
      coreItems: [
        { id: '6655', name: 'Companheiro de Luden' },
        { id: '4645', name: 'Chama Sombria' },
        { id: '3089', name: 'Capuz da Morte de Rabadon' }
      ],
      counterItem: enemyIsHeavyAD
        ? { id: '3157', name: 'Ampulheta de Zhonya', reason: `Anula o all-in de ${enemy.name}` }
        : { id: '3102', name: 'Véu da Banshee', reason: `Bloqueia a iniciação de ${enemy.name}` },
      skillOrder: 'Q > W > E',
      summoners: 'Flash + Teleporte / Incendiar'
    };
  } else if (isADC) {
    setup = {
      keystoneName: 'Ritmo Fatal',
      keystoneIcon: 'https://ddragon.leagueoflegends.com/cdn/img/perk-images/Styles/Precision/LethalTempo/LethalTempoTemp.png',
      secondaryName: 'Inspiração (Calçados Mágicos + Biscoitos)',
      secondaryIcon: 'https://ddragon.leagueoflegends.com/cdn/img/perk-images/Styles/7203_Whimsy.png',
      coreItems: [
        { id: '3031', name: 'Gume do Infinito' },
        { id: '3094', name: 'Canhão Fumegante' },
        { id: '3036', name: 'Lembranças do Lorde Dominik' }
      ],
      counterItem: { id: '3139', name: 'Cimitarra Mercurial', reason: `Remove CC crítico de ${enemy.name}` },
      skillOrder: 'Q > W > E',
      summoners: 'Flash + Barreira / Purificar'
    };
  } else if (isTank) {
    setup = {
      keystoneName: 'Aperto dos Mortos-Vivos',
      keystoneIcon: 'https://ddragon.leagueoflegends.com/cdn/img/perk-images/Styles/Resolve/GraspOfTheUndying/GraspOfTheUndying.png',
      secondaryName: 'Inspiração (Flashtrapção + Perspicácia Cósmica)',
      secondaryIcon: 'https://ddragon.leagueoflegends.com/cdn/img/perk-images/Styles/7203_Whimsy.png',
      coreItems: [
        { id: '3068', name: 'Égide de Fogo Solar' },
        { id: '3075', name: 'Armadura de Espinhos' },
        { id: '3110', name: 'Coração Congelado' }
      ],
      counterItem: { id: '4401', name: 'Força da Natureza', reason: `Mitigação contínua contra ${enemy.name}` },
      skillOrder: 'Q > E > W',
      summoners: role === 'SUPPORT' ? 'Flash + Incendiar' : 'Flash + Teleporte'
    };
  }

  return {
    winRate,
    enemyWinRate: Number((100 - winRate).toFixed(1)),
    gamesAnalyzed,
    goldDiff15,
    xpDiff15,
    csDiff15,
    laneKillRate,
    firstBloodPct,
    soloKillsAvg,
    pickRate,
    banRate,
    setup
  };
}

/**
 * Gera os 5 Cards Escaneáveis do AI Coach
 */
async function fetchAICoachGuide({ ally, enemy, role, junglerActive, enemyJungler, stats }) {
  const favored = stats.winRate >= 50;
  const jgName = junglerActive && enemyJungler ? enemyJungler.name : 'Jungler Inimigo';

  return [
    {
      step: '01',
      title: 'Nível 1–3 & Wave',
      subtitle: 'Early Game & Prioridade',
      icon: 'waves',
      accent: 'cyan',
      bullets: [
        favored
          ? `Dispute os 3 primeiros minions melee com ${ally.name} para garantir Nível 2 antes de ${enemy.name}.`
          : `Conceda o push no Nível 1; deixe ${enemy.name} avançar e segure a wave próxima da sua torre.`,
        `Não gaste sua habilidade principal nos minions se ${enemy.name} estiver posicionado para punir seu cooldown.`,
        `Faça crash na 3ª wave (catapulta) para ganhar tempo de visão ou recall gratuito.`
      ]
    },
    {
      step: '02',
      title: 'Power Spikes',
      subtitle: 'Nível 6 & 1º Item',
      icon: 'zap',
      accent: 'gold',
      bullets: [
        `No Nível 6, o all-in de ${enemy.name} ganha letalidade extra: evite trocas longas abaixo de 65% de HP.`,
        `Seu pico de pressão ocorre ao fechar o 1º item core + bota defensiva adaptada ao dano de ${enemy.name}.`,
        favored
          ? `Use a prioridade do 1º item para forçar lutas no rio (Larvas do Vazio / Dragão).`
          : `Priorize o componente de counter (${stats.setup.counterItem.name}) antes de aceitar lutas 1v1.`
      ]
    },
    {
      step: '03',
      title: 'Janelas de Troca',
      subtitle: 'Cooldowns & Punição',
      icon: 'timer',
      accent: 'cyan',
      bullets: [
        `Janela de entrada: puna imediatamente quando ${enemy.name} errar seu controle de grupo ou gastar dash para farmar.`,
        `Prefira trocas ${ally.tags.includes('Assassin') || ally.tags.includes('Mage') ? 'curtas e explosivas (poke + recuo)' : 'prolongadas empilhando sua runa principal'} contra ${enemy.name}.`,
        `Use os arbustos da rota para resetar o aggro dos minions e cancelar ataques básicos de ${enemy.name}.`
      ]
    },
    {
      step: '04',
      title: 'Selva & Ganks',
      subtitle: junglerActive ? `Ameaça 2v2: ${jgName}` : 'Controle de Visão 1v1',
      icon: 'compass',
      accent: junglerActive ? 'red' : 'gold',
      bullets: junglerActive
        ? [
            `ALERTA 2v2: ${enemy.name} + ${jgName} possuem forte sinergia de setup de gank e perseguição antes do nível 6.`,
            `Coloque ward profunda aos 2:45 — ${jgName} costuma impactar a rota logo após o 3º campo ou aronguejo.`,
            `Guarde sua habilidade de mobilidade/escape exclusivamente caso ${jgName} esteja fora de visão no minimapa.`
          ]
        : [
            `Compre uma Sentinela de Controle após o 1º recall para negar visão do rio e destravar pressão na rota.`,
            `Acompanhe onde o Jungler inimigo começou aos 1:30 para jogar recuado no timming de 3:15.`,
            `Se ${enemy.name} congelar a wave perto da torre dele, chame seu Jungler para ajudar a crashar a wave.`
          ]
    },
    {
      step: '05',
      title: 'Condição de Vitória',
      subtitle: 'Win Con & Erro Fatal',
      icon: 'trophy',
      accent: 'emerald',
      bullets: [
        `WIN CON: ${favored ? `Converter pressão de rota (${stats.goldDiff15 > 0 ? '+' : ''}${stats.goldDiff15}g @15) em barricadas e objetivos.` : `Sobreviver aos primeiros 14 min sem ceder abates solo e superar ${enemy.name} nas lutas em equipe.`}`,
        `ERRO FATAL: Aceitar troca franca dentro de uma wave acumulada de ${enemy.name} nos níveis 3 a 5.`,
        `Gerencie o Teleporte para não perder ondas de catapulta; nunca dê recall com a wave travada na frente do inimigo.`
      ]
    }
  ];
}

// Exporta para o escopo global da aplicação
window.RiftServices = {
  fetchDataDragonBootstrap,
  getChampionIconUrl,
  getItemIconUrl,
  fetchMatchupStats,
  fetchAICoachGuide
};
