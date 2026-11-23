import type { SnippetAgent, SnippetItem } from './types';

export const BUILTIN_SNIPPETS: SnippetItem[] = [
  // === Launchers CLI (AGY & Claude Code) ===
  {
    id: 'agy-skip-perms',
    label: 'AGY Skip Permissions',
    command: 'agy --dangerously-skip-permissions',
    category: 'CLI (AGY & Claude)',
    description: 'Inicia Antigravity CLI aprovando todas as permissões de ferramentas',
    aliases: [
      'agy --dangerlsouy-skip-permission',
      'dangerlsouy',
      'dangerously',
      'skip-permission',
      'skip-permissions',
      'yolo',
    ],
    autoEnter: true,
  },
  {
    id: 'claude-skip-perms',
    label: 'Claude Skip Permissions',
    command: 'claude --dangerously-skip-permissions',
    category: 'CLI (AGY & Claude)',
    description: 'Inicia Claude Code ignorando confirmações de permissão',
    aliases: [
      'claude --dangersly-skip-permissions',
      'dangersly',
      'dangerously',
      'skip-permissions',
      'skip-permission',
      'yolo',
    ],
    autoEnter: true,
  },
  {
    id: 'agy-continue-skip',
    label: 'AGY Continue + Skip Perms',
    command: 'agy --continue --dangerously-skip-permissions',
    category: 'CLI (AGY & Claude)',
    description: 'Retoma a última conversa no AGY com auto-aprovação',
    aliases: ['agy -c', 'continuar', 'dangerlsouy'],
    autoEnter: true,
  },
  {
    id: 'claude-continue-skip',
    label: 'Claude Continue + Skip Perms',
    command: 'claude --continue --dangerously-skip-permissions',
    category: 'CLI (AGY & Claude)',
    description: 'Retoma a última conversa no Claude Code com auto-aprovação',
    aliases: ['claude -c', 'continuar', 'dangersly'],
    autoEnter: true,
  },
  {
    id: 'agy-resume',
    label: 'AGY Resume Picker',
    command: 'agy --conversation',
    category: 'CLI (AGY & Claude)',
    description: 'Abre AGY retomando conversa por ID (adicione o ID)',
    aliases: ['resume', 'conversas'],
    autoEnter: false,
  },
  {
    id: 'claude-resume',
    label: 'Claude Resume Picker',
    command: 'claude --resume',
    category: 'CLI (AGY & Claude)',
    description: 'Abre seletor de sessões anteriores do Claude Code',
    aliases: ['resume', 'sessoes'],
    autoEnter: true,
  },
  {
    id: 'agy-mode-plan',
    label: 'AGY Mode Plan',
    command: 'agy --mode plan',
    category: 'CLI (AGY & Claude)',
    description: 'Inicia AGY em modo planejamento',
    aliases: ['plan'],
    autoEnter: true,
  },
  {
    id: 'agy-mode-auto',
    label: 'AGY Mode Auto',
    command: 'agy --mode auto',
    category: 'CLI (AGY & Claude)',
    description: 'Inicia AGY em modo autônomo com sandbox',
    aliases: ['auto'],
    autoEnter: true,
  },

  // === Comandos / Comuns (Claude Code & AGY) ===
  {
    id: 'slash-clear',
    label: '/clear (com confirmação)',
    command: '/clear',
    category: 'Comandos / (Comuns)',
    description: 'Limpa o terminal e reinicia o contexto da conversa (pede confirmação)',
    aliases: ['/cl3ar', 'cl3ar', '/new', 'limpar', 'reset'],
    autoEnter: true,
    confirm: true,
  },
  {
    id: 'slash-compact',
    label: '/compact',
    command: '/compact',
    category: 'Comandos / (Comuns)',
    description: 'Resume a conversa atual para liberar janela de contexto',
    aliases: ['resumir', 'compactar'],
    autoEnter: true,
  },
  {
    id: 'slash-help',
    label: '/help',
    command: '/help',
    category: 'Comandos / (Comuns)',
    description: 'Exibe comandos slash e atalhos disponíveis',
    aliases: ['ajuda'],
    autoEnter: true,
  },
  {
    id: 'slash-model',
    label: '/model',
    command: '/model',
    category: 'Comandos / (Comuns)',
    description: 'Seleciona ou troca o modelo ativo',
    aliases: ['modelo'],
    autoEnter: true,
  },
  {
    id: 'slash-config',
    label: '/config',
    command: '/config',
    category: 'Comandos / (Comuns)',
    description: 'Abre o painel de configurações da sessão',
    aliases: ['/settings'],
    autoEnter: true,
  },
  {
    id: 'slash-context',
    label: '/context',
    command: '/context',
    category: 'Comandos / (Comuns)',
    description: 'Visualiza o uso atual da janela de contexto',
    aliases: ['tokens'],
    autoEnter: true,
  },
  {
    id: 'slash-diff',
    label: '/diff',
    command: '/diff',
    category: 'Comandos / (Comuns)',
    description: 'Abre o visualizador de alterações (diff) da sessão',
    autoEnter: true,
  },
  {
    id: 'slash-resume',
    label: '/resume',
    command: '/resume',
    category: 'Comandos / (Comuns)',
    description: 'Abre o seletor para retomar uma conversa anterior',
    aliases: ['/switch', '/conversation'],
    autoEnter: true,
  },
  {
    id: 'slash-rewind',
    label: '/rewind',
    command: '/rewind',
    category: 'Comandos / (Comuns)',
    description: 'Desfaz e volta o histórico da conversa para uma mensagem anterior',
    aliases: ['/undo'],
    autoEnter: true,
  },
  {
    id: 'slash-copy',
    label: '/copy',
    command: '/copy',
    category: 'Comandos / (Comuns)',
    description: 'Copia a última resposta do agente para a área de transferência',
    autoEnter: true,
  },
  {
    id: 'slash-mcp',
    label: '/mcp',
    command: '/mcp',
    category: 'Comandos / (Comuns)',
    description: 'Gerencia servidores Model Context Protocol (MCP)',
    autoEnter: true,
  },
  {
    id: 'slash-agents',
    label: '/agents',
    command: '/agents',
    category: 'Comandos / (Comuns)',
    description: 'Gerencia subagentes e agentes customizados',
    autoEnter: true,
  },
  {
    id: 'slash-permissions',
    label: '/permissions',
    command: '/permissions',
    category: 'Comandos / (Comuns)',
    description: 'Abre o gerenciador de permissões de ferramentas',
    autoEnter: true,
  },
  {
    id: 'slash-hooks',
    label: '/hooks',
    command: '/hooks',
    category: 'Comandos / (Comuns)',
    description: 'Inspeciona e configura hooks de execução',
    autoEnter: true,
  },
  {
    id: 'slash-plugin',
    label: '/plugin',
    command: '/plugin',
    category: 'Comandos / (Comuns)',
    description: 'Abre o gerenciador de plugins',
    aliases: ['/plugins'],
    autoEnter: true,
  },
  {
    id: 'slash-add-dir',
    label: '/add-dir',
    command: '/add-dir ',
    category: 'Comandos / (Comuns)',
    description: 'Adiciona um diretório ao workspace ativo',
    autoEnter: false,
  },
  {
    id: 'slash-rename',
    label: '/rename',
    command: '/rename ',
    category: 'Comandos / (Comuns)',
    description: 'Renomeia a thread/sessão atual',
    autoEnter: false,
  },
  {
    id: 'slash-effort',
    label: '/effort',
    command: '/effort ',
    category: 'Comandos / (Comuns)',
    description: 'Define o nível de raciocínio (low, medium, high, max)',
    autoEnter: false,
  },
  {
    id: 'slash-btw',
    label: '/btw',
    command: '/btw ',
    category: 'Comandos / (Comuns)',
    description: 'Faz uma pergunta paralela sem poluir o contexto principal',
    autoEnter: false,
  },
  {
    id: 'slash-exit',
    label: '/exit (com confirmação)',
    command: '/exit',
    category: 'Comandos / (Comuns)',
    description: 'Encerra a sessão da CLI e volta para o shell',
    aliases: ['/quit'],
    autoEnter: true,
    confirm: true,
  },

  // === Comandos / Específicos do AGY ===
  {
    id: 'agy-plan',
    label: '/plan',
    command: '/plan ',
    category: 'Comandos / (AGY)',
    description: 'Explora o código e cria um plano de implementação revisável',
    autoEnter: false,
  },
  {
    id: 'agy-goal',
    label: '/goal',
    command: '/goal ',
    category: 'Comandos / (AGY)',
    description: 'Executa autonomamente até concluir o objetivo sem pausas',
    autoEnter: false,
  },
  {
    id: 'agy-boost',
    label: '/boost',
    command: '/boost ',
    category: 'Comandos / (AGY)',
    description: 'Ativa raciocínio profundo multi-perspectiva sob demanda',
    autoEnter: false,
  },
  {
    id: 'agy-grill-me',
    label: '/grill-me',
    command: '/grill-me ',
    category: 'Comandos / (AGY)',
    description: 'Entrevista interativa para alinhar decisões de design antes de codar',
    autoEnter: false,
  },
  {
    id: 'agy-swarm',
    label: '/swarm',
    command: '/swarm ',
    category: 'Comandos / (AGY)',
    description: 'Lança um enxame (swarm) de workers coordenados',
    autoEnter: false,
  },
  {
    id: 'agy-swarm-board',
    label: '/swarm board',
    command: '/swarm board',
    category: 'Comandos / (AGY)',
    description: 'Abre o painel ao vivo do swarm em tela cheia',
    autoEnter: true,
  },
  {
    id: 'agy-teamwork',
    label: '/teamwork',
    command: '/teamwork ',
    category: 'Comandos / (AGY)',
    description: 'Inicia time colaborativo multi-agente para projetos longos',
    autoEnter: false,
  },
  {
    id: 'agy-browser',
    label: '/browser',
    command: '/browser ',
    category: 'Comandos / (AGY)',
    description: 'Delega navegação web e verificação visual ao subagente de browser',
    autoEnter: false,
  },
  {
    id: 'agy-learn',
    label: '/learn',
    command: '/learn ',
    category: 'Comandos / (AGY)',
    description: 'Salva correções da sessão como rules ou skills persistentes',
    autoEnter: false,
  },
  {
    id: 'agy-schedule',
    label: '/schedule',
    command: '/schedule ',
    category: 'Comandos / (AGY)',
    description: 'Agenda timer único ou tarefa recorrente (cron)',
    autoEnter: false,
  },
  {
    id: 'agy-skills',
    label: '/skills',
    command: '/skills',
    category: 'Comandos / (AGY)',
    description: 'Lista e recarrega Agent Skills locais e globais',
    autoEnter: true,
  },
  {
    id: 'agy-tasks',
    label: '/tasks',
    command: '/tasks',
    category: 'Comandos / (AGY)',
    description: 'Abre o gerenciador de tarefas em segundo plano',
    autoEnter: true,
  },
  {
    id: 'agy-artifact',
    label: '/artifact',
    command: '/artifact',
    category: 'Comandos / (AGY)',
    description: 'Abre o painel de revisão de artefatos',
    autoEnter: true,
  },
  {
    id: 'agy-codesearch',
    label: '/codesearch',
    command: '/codesearch ',
    category: 'Comandos / (AGY)',
    description: 'Busca semântica de código no workspace',
    aliases: ['/cs', '/search'],
    autoEnter: false,
  },
  {
    id: 'agy-usage',
    label: '/usage',
    command: '/usage',
    category: 'Comandos / (AGY)',
    description: 'Exibe consumo e cota restante dos modelos',
    aliases: ['/quota'],
    autoEnter: true,
  },
  {
    id: 'agy-credits',
    label: '/credits',
    command: '/credits',
    category: 'Comandos / (AGY)',
    description: 'Exibe créditos de IA restantes',
    autoEnter: true,
  },
  {
    id: 'agy-voice',
    label: '/voice',
    command: '/voice',
    category: 'Comandos / (AGY)',
    description: 'Ativa conversa ou ditado por voz',
    aliases: ['/record'],
    autoEnter: true,
  },
  {
    id: 'agy-fork',
    label: '/fork',
    command: '/fork',
    category: 'Comandos / (AGY)',
    description: 'Clona a thread atual em uma nova sessão paralela',
    aliases: ['/branch'],
    autoEnter: true,
  },
  {
    id: 'agy-statusline',
    label: '/statusline',
    command: '/statusline',
    category: 'Comandos / (AGY)',
    description: 'Personaliza a barra de status do AGY',
    autoEnter: true,
  },
  {
    id: 'agy-keybindings',
    label: '/keybindings',
    command: '/keybindings',
    category: 'Comandos / (AGY)',
    description: 'Abre o editor de atalhos do AGY',
    autoEnter: true,
  },

  // === Comandos / Específicos do Claude Code ===
  {
    id: 'claude-cost',
    label: '/cost',
    command: '/cost',
    category: 'Comandos / (Claude Code)',
    description: 'Exibe o uso de tokens e custo da sessão atual',
    autoEnter: true,
  },
  {
    id: 'claude-doctor',
    label: '/doctor',
    command: '/doctor',
    category: 'Comandos / (Claude Code)',
    description: 'Diagnostica a instalação e saúde do Claude Code',
    autoEnter: true,
  },
  {
    id: 'claude-init',
    label: '/init',
    command: '/init',
    category: 'Comandos / (Claude Code)',
    description: 'Inicializa o projeto gerando um CLAUDE.md',
    autoEnter: true,
  },
  {
    id: 'claude-memory',
    label: '/memory',
    command: '/memory',
    category: 'Comandos / (Claude Code)',
    description: 'Edita arquivos de memória do Claude Code (CLAUDE.md)',
    autoEnter: true,
  },
  {
    id: 'claude-review',
    label: '/review',
    command: '/review',
    category: 'Comandos / (Claude Code)',
    description: 'Solicita revisão de Pull Request ou alterações atuais',
    autoEnter: true,
  },
  {
    id: 'claude-pr-comments',
    label: '/pr-comments',
    command: '/pr-comments',
    category: 'Comandos / (Claude Code)',
    description: 'Exibe comentários do Pull Request atual',
    autoEnter: true,
  },
  {
    id: 'claude-status',
    label: '/status',
    command: '/status',
    category: 'Comandos / (Claude Code)',
    description: 'Exibe versão, conta, modelo e conectividade',
    autoEnter: true,
  },
  {
    id: 'claude-terminal-setup',
    label: '/terminal-setup',
    command: '/terminal-setup',
    category: 'Comandos / (Claude Code)',
    description: 'Configura bindings Shift+Enter no terminal (quando suportado)',
    autoEnter: true,
  },
  {
    id: 'claude-vim',
    label: '/vim',
    command: '/vim',
    category: 'Comandos / (Claude Code)',
    description: 'Alterna o modo de edição Vim no prompt',
    autoEnter: true,
  },
  {
    id: 'claude-bug',
    label: '/bug',
    command: '/bug',
    category: 'Comandos / (Claude Code)',
    description: 'Reporta bug para a equipe do Claude Code',
    autoEnter: true,
  },
  {
    id: 'claude-login',
    label: '/login',
    command: '/login',
    category: 'Comandos / (Claude Code)',
    description: 'Troca ou autentica conta no Claude Code',
    autoEnter: true,
  },
  {
    id: 'claude-logout',
    label: '/logout',
    command: '/logout',
    category: 'Comandos / (Claude Code)',
    description: 'Desconecta a conta ativa',
    autoEnter: true,
  },
];

export const DEFAULT_AGENT_RANK: Record<'agy' | 'claude', string[]> = {
  agy: [
    'agy-skip-perms',
    'agy-continue-skip',
    'slash-clear',
    'agy-plan',
    'agy-goal',
    'agy-boost',
    'slash-compact',
    'slash-model',
    'agy-grill-me',
    'agy-swarm',
    'agy-swarm-board',
    'agy-teamwork',
    'agy-usage',
    'slash-context',
    'slash-diff',
    'slash-resume',
    'agy-mode-plan',
    'agy-mode-auto',
    'agy-resume',
    'agy-codesearch',
    'agy-browser',
    'agy-learn',
    'agy-schedule',
    'agy-skills',
    'agy-tasks',
    'agy-artifact',
    'agy-credits',
    'agy-voice',
    'agy-fork',
    'agy-statusline',
    'agy-keybindings',
    'slash-rewind',
    'slash-copy',
    'slash-mcp',
    'slash-agents',
    'slash-permissions',
    'slash-hooks',
    'slash-plugin',
    'slash-add-dir',
    'slash-rename',
    'slash-effort',
    'slash-btw',
    'slash-config',
    'slash-help',
    'slash-exit',
  ],
  claude: [
    'claude-skip-perms',
    'claude-continue-skip',
    'claude-resume',
    'slash-clear',
    'slash-compact',
    'slash-model',
    'claude-cost',
    'slash-context',
    'slash-diff',
    'slash-resume',
    'claude-review',
    'claude-memory',
    'claude-init',
    'claude-status',
    'claude-doctor',
    'slash-rewind',
    'slash-copy',
    'slash-mcp',
    'slash-agents',
    'slash-permissions',
    'slash-hooks',
    'slash-plugin',
    'claude-pr-comments',
    'claude-terminal-setup',
    'claude-vim',
    'claude-bug',
    'claude-login',
    'claude-logout',
    'slash-add-dir',
    'slash-rename',
    'slash-effort',
    'slash-btw',
    'slash-config',
    'slash-help',
    'slash-exit',
  ],
};

export function getSnippetAgent(snippet: SnippetItem): SnippetAgent {
  if (snippet.agent === 'agy' || snippet.agent === 'claude' || snippet.agent === 'both') {
    return snippet.agent;
  }
  const cmd = snippet.command.trim().toLowerCase();
  const id = snippet.id.toLowerCase();
  const cat = snippet.category.toLowerCase();

  if (id.startsWith('agy-') || cat.includes('(agy)') || /^agy(?:\s|$)/.test(cmd)) {
    return 'agy';
  }
  if (id.startsWith('claude-') || cat.includes('(claude') || /^claude(?:\s|$)/.test(cmd)) {
    return 'claude';
  }
  return 'both';
}

export function getSnippetsForAgent(
  allSnippets: SnippetItem[],
  agent: 'agy' | 'claude'
): SnippetItem[] {
  return allSnippets.filter((item) => {
    const owner = getSnippetAgent(item);
    return owner === agent || owner === 'both';
  });
}

export function sortSnippetsByUsage(
  snippets: SnippetItem[],
  usage: Record<string, number>,
  agent: 'agy' | 'claude'
): SnippetItem[] {
  const rankList = DEFAULT_AGENT_RANK[agent] ?? [];
  const rankIndex = new Map<string, number>();
  rankList.forEach((id, idx) => rankIndex.set(id, idx));

  return snippets
    .map((item, origIdx) => ({ item, origIdx }))
    .sort((a, b) => {
      const countA = usage[a.item.id] ?? 0;
      const countB = usage[b.item.id] ?? 0;
      if (countB !== countA) {
        return countB - countA;
      }
      const rankA = rankIndex.get(a.item.id) ?? Number.MAX_SAFE_INTEGER;
      const rankB = rankIndex.get(b.item.id) ?? Number.MAX_SAFE_INTEGER;
      if (rankA !== rankB) {
        return rankA - rankB;
      }
      return a.origIdx - b.origIdx;
    })
    .map((entry) => entry.item);
}

export function getAllSnippets(customSnippets: SnippetItem[] = []): SnippetItem[] {
  const customTagged = customSnippets.map((item) => ({
    ...item,
    category: item.category || 'Personalizados',
  }));
  return [...customTagged, ...BUILTIN_SNIPPETS];
}

export function matchesSnippetQuery(snippet: SnippetItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const tokens = q.split(/\s+/).filter(Boolean);
  const haystack = [
    snippet.label,
    snippet.command,
    snippet.category,
    snippet.description,
    ...(snippet.aliases ?? []),
  ]
    .join(' ')
    .toLowerCase();

  return tokens.every((tok) => haystack.includes(tok));
}
