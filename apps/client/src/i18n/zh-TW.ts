import type { ErrorCode, HintRejectReason } from "@hw/core";

/** Every server error code plus the socket-only "kicked" reason, in 繁體中文. */
export const ERROR_MESSAGES: Record<ErrorCode | "kicked", string> = {
  bad_request: "請求格式不正確",
  room_not_found: "房間不存在",
  room_full: "房間已滿",
  game_started: "遊戲已經開始",
  not_host: "只有主持人可以執行這個操作",
  not_enough_players: "玩家人數不足",
  not_all_ready: "還有玩家尚未準備",
  wrong_phase: "目前階段無法執行這個操作",
  not_your_turn: "現在不是你的回合",
  not_in_envelope: "這個詞不在你的信封中",
  already_picked: "你已經選好隱藏詞了",
  hint_pending: "還有一個提示正在評分",
  hint_cap: "本階段提示數量已達上限",
  already_guessed: "你已經提交過答案",
  no_piece: "你沒有棋子了",
  piece_used: "本回合已經使用過棋子",
  unknown_player: "找不到這位玩家",
  rate_limited: "操作太頻繁，請稍後再試",
  kicked: "你已被主持人移出房間",
};

export function errorMessage(code: string): string {
  return (ERROR_MESSAGES as Record<string, string>)[code] ?? ERROR_MESSAGES.bad_request;
}

export function hintReason(reason: HintRejectReason, maxWordLength: number): string {
  switch (reason) {
    case "format":
      return `提示必須是 1–${maxWordLength} 個漢字`;
    case "contains_hidden":
      return "提示不可與隱藏詞相同、包含或被包含";
    case "duplicate":
      return "本回合已使用過這個提示";
    case "not_noun":
      return "提示必須是名詞";
    case "scorer_error":
      return "評分失敗，請再試一次";
    case "quota":
      return "今日評分額度已用完";
  }
}

export const UI = {
  common: {
    appName: "隱藏詞 Online",
    home: "回首頁",
    rules: "規則",
    close: "關閉",
    copy: "複製連結",
    copied: "已複製邀請連結",
    copyFailed: "複製失敗，請手動複製連結",
    you: "你",
    loading: "載入中…",
    connecting: "連線中…",
    networkError: "網路連線失敗，請稍後再試",
    offlineAction: "目前無法連線，請稍候再試",
    reconnecting: "連線中斷，正在重新連線…",
  },
  home: {
    tagline: "魔鬼的計謀：隱藏詞 · 線上多人版",
    intro:
      "每個人從信封中挑一個隱藏詞，輪流給出提示，讓其他人猜出你的詞。提示分數越高，對手越容易猜到，但分數太低你也拿不到分數。",
    createTitle: "建立房間",
    nickname: "暱稱",
    nicknamePlaceholder: "輸入你的暱稱",
    mode: "遊戲模式",
    modeQuick: (rounds: number) => `快速 · ${rounds} 回合`,
    modeFull: (rounds: number) => `正式 · ${rounds} 回合`,
    create: "建立房間",
    joinTitle: "加入房間",
    roomCode: "房間代碼",
    roomCodePlaceholder: "6 碼房間代碼",
    joinNamePlaceholder: "你的暱稱",
    join: "加入房間",
    invalidName: "請輸入 1–12 個字的暱稱",
    invalidCode: "請輸入 6 碼房間代碼",
    roomSummary: (players: number, max: number, mode: string) =>
      `目前 ${players} / ${max} 人 · ${mode}`,
    roomNotJoinable: "此房間已無法加入",
    loadingRoom: "查詢房間中…",
  },
  lobby: {
    title: "大廳",
    roomCodeLabel: "房間代碼",
    inviteLink: "邀請連結",
    players: "玩家",
    host: "主持人",
    ready: "已準備",
    notReady: "未準備",
    readyToggleOn: "取消準備",
    readyToggleOff: "我準備好了",
    start: "開始遊戲",
    waitingHost: "等待主持人開始遊戲",
    waitingAllReady: "所有玩家準備後即可開始",
    needPlayers: (min: number) => `至少需要 ${min} 位玩家`,
    kick: "移出",
    kickConfirm: (name: string) => `確定要將 ${name} 移出房間嗎？`,
  },
  pick: {
    title: "挑選隱藏詞",
    subtitle: "從信封中選一個詞作為本回合的隱藏詞，其他人不會看到。",
    envelope: "你的信封",
    picked: "你的隱藏詞",
    waiting: (n: number) => `等待其他玩家選擇…（剩餘 ${n} 人）`,
    allPicked: "所有人都選好了，準備開始…",
    timeoutHint: "時間到會自動隨機選擇。",
  },
  turn: {
    hintTitle: "出題階段",
    guessTitle: "猜測階段",
    resultTitle: "結算",
    round: (round: number, total: number) => `第 ${round} / ${total} 回合`,
    setter: (name: string) => `出題者：${name}`,
    stage: (stage: number, total: number) => `第 ${stage} / ${total} 階段`,
    turnProgress: (turn: number, total: number) => `第 ${turn} / ${total} 位出題者`,
    myHiddenWord: "你的隱藏詞",
    hiddenWord: "隱藏詞",
    hintInputPlaceholder: (max: number) => `輸入 1–${max} 個漢字的提示`,
    hintSubmit: "送出提示",
    stopHints: "停止出題",
    hintPending: "上一個提示還在評分中…",
    hintCapReached: (max: number) => `本階段已送出 ${max} 個提示，上限已滿`,
    hintsThisStage: "本階段提示",
    noHintsYet: "還沒有提示",
    revealedThisTurn: "已揭示的提示",
    noRevealedYet: "尚無揭示",
    waitingForHints: "出題者正在想提示…",
    guesserTitle: "你的答案",
    guessPlaceholder: "輸入你猜的詞",
    guessPlaceholder2: "第二個答案",
    usePiece: "使用棋子",
    pieceHint: (pieces: number) => `棋子 × ${pieces}`,
    pieceUsed: "本回合已使用棋子",
    noPiece: "沒有棋子了",
    submitGuess: "提交答案",
    pass: "跳過",
    answerEmpty: "請輸入答案，或按「跳過」",
    submitted: "已提交，等待其他玩家…",
    submittedCount: (n: number, total: number) => `已提交 ${n} / ${total} 人`,
    waitingOthers: "等待其他玩家提交…",
    setterWaitingGuess: "等待其他玩家猜測…",
    awayNotice: "你目前被標記為離開，將自動跳過。",
    resultGuessed: (name: string, points: number) => `${name} 猜中，+${points} 分`,
    resultSetterGain: (name: string, points: number) => `無人猜中，出題者 ${name} 獲得 +${points} 分`,
    resultNoReveal: "本階段沒有可揭示的提示，跳過猜測，出題者 0 分",
    resultLowReveal: (min: number) => `無人猜中，提示分數未達 ${min}，出題者本階段 0 分`,
    resultSkippedTurn: "出題者離開遊戲，本回合直接結束",
    revealedWordAt: (stage: number) => `第 ${stage} 階段揭示`,
    turnEnded: (word: string) => `本回合隱藏詞：${word}`,
  },
  hintStatus: {
    pending: "評分中",
    scored: "已評分",
    rejected: "已拒絕",
    failed: "評分失敗",
    dropped: "已略過",
  },
  bands: {
    top: "極高關聯",
    high: "高關聯",
    mid: "中關聯",
    low: "低關聯",
  },
  badges: {
    setter: "出題",
    away: "離開",
    offline: "離線",
  },
  final: {
    title: "最終排名",
    ranking: "排名",
    player: "玩家",
    score: "分數",
    hiddenWords: "本局隱藏詞",
    noHiddenWords: "沒有隱藏詞",
    backHome: "回首頁",
    endReasonCompleted: "遊戲結束",
    endReasonNotEnoughPlayers: "人數不足，遊戲提前結束",
  },
  rules: {
    title: "規則",
    heading: "隱藏詞 · 規則",
    players: (min: number, max: number) => `每房 ${min}–${max} 人；所有玩家準備後由主持人開始。`,
    envelope: (size: number) =>
      `每回合開始時，每人從信封中選 1 個隱藏詞（每人 ${size} 個候選詞，全房不重複）。`,
    rounds: (rounds: number, multipliers: number[]) =>
      `共 ${rounds} 回合；第 ${multipliers.map((m, i) => `${i + 1} 回合 ×${m}`).join("、")}。`,
    turns: "每回合中，每位玩家輪流擔任一次出題者。",
    stages: (stages: number) => `每次出題最多 ${stages} 個階段。`,
    hints: (max: number) => `每階段出題者最多送出 ${max} 個提示。`,
    instant: (threshold: number) => `提示分數 ≥ ${threshold} 時，立即結束該階段並揭示該提示。`,
    reveal:
      "每階段結束時揭示分數最高的提示（同分取較早送出者）；較早階段的揭示會保留。",
    guess: "猜測階段每人提交 1 個答案；每回合可使用 1 枚棋子，讓其中一人提交 2 個答案。",
    correct: (points: number) =>
      `有人猜中：每位猜中者 +${points} 分（乘上回合倍率），該回合立即結束。`,
    setterPoints: (points: number[], threshold: number) =>
      `無人猜中且揭示分數 ≥ ${threshold} 時，出題者依階段獲得 +${points.join(" / +")} 分（乘上回合倍率）。`,
    noReveal: "該階段沒有任何已評分提示：不揭示、跳過猜測，出題者 0 分。",
    pieces: (pieces: number) => `每人開局有 ${pieces} 枚棋子。`,
    wordLength: (max: number) => `提示與答案為 1–${max} 個漢字；簡繁、空白與標點會自動統一。`,
    timers: (pick: number, hint: number, guess: number, result: number) =>
      `計時：選詞 ${pick} 秒、出題 ${hint} 秒、猜測 ${guess} 秒、結算 ${result} 秒。`,
    disconnect: (seconds: number) =>
      `斷線後 ${seconds} 秒內可回到原座位；超過後標記為離開，出題者離開會直接結束該回合。`,
    ranking: "回合全部結束後依總分排名，同分同名次。",
  },
} as const;
