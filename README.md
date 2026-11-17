# RiftCoach.GG — Análise de Confrontos & AI Laning Coach (LolInfo)

Plataforma de análise de matchups de League of Legends focada em fase de rotas (`@15 min`), builds anti-matchup e plano de jogo tático.

🌐 **Acesse online (GitHub Pages):** [https://johannsc09.github.io/LolInfo/](https://johannsc09.github.io/LolInfo/)

## Funcionalidades
- **Estado Inicial Limpo:** Seleção rápida de Campeão Aliado e Campeão Inimigo com integração oficial ao **Riot Data Dragon CDN**.
- **Modal Pesquisável com Filtro por Lane:** Busca por nome e filtro por ícones de rota (`Todas`, `Top`, `Jungle`, `Mid`, `ADC`, `Suporte`), permitindo flexibilidade total de picks.
- **Modo 1v1 & 2v2 (`+ Jungler Inimigo`):** Inclusão opcional do Jungler adversário para ajustar Win Rate e recomendações de controle de visão/gank.
- **Navegação Organizada em 4 Abas:**
  1. **Visão Geral & Win Rate:** Win Rate, Delta WR, Pick/Ban/Presença, Dificuldade e Win Rate por duração de partida (`0–25m`, `25–35m`, `35+m`).
  2. **Fase de Rotas (`@15 min`):** Barras comparativas de Ouro (`GD@15`), XP (`XPD@15`), CS (`CSD@15`), Lane Kill Rate, First Blood %, Solo Kills, Barricadas (`<14m`) e Tempo da 1ª Torre.
  3. **Builds & Runas:** Árvore Primária, Secundária, Shards, Itens Iniciais, Botas, Core Build (1º ao 3º item), **Item Situacional de Counter** e Ordem de Habilidades.
  4. **Coach de IA:** 5 cards diretos e escaneáveis (Nível 1–3, Power Spikes, Janelas de Troca, Selva & Ganks e Condição de Vitória).
- **Dados Estruturados (`data/matchups.json`):** Pronto para alimentação automatizada via coletor Python, sem geração de estatísticas aleatórias.
