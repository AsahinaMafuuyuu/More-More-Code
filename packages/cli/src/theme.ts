export type ThemeColors = {
    primary: string;
    planMode: string;
    selection: string;
    thinking: string;
    success: string;
    error: string;
    info: string;
    background: string;
    surface: string;
    dialogSurface: string;
    thinkingBorder: string;
    dimSeparator: string;
};

export type Theme = {
    name: string;
    colors: ThemeColors;
}

export const THEMES: Theme[] = [
  {
    name: "Nightfox",
    colors: {
      primary: "#56D6C2",
      planMode: "#CF8EF4",
      selection: "#89B4FA",
      thinking: "#CF8EF4",
      success: "#82E0AA",
      error: "#E74C5E",
      info: "#56D6C2",
      background: "#0D0D12",
      surface: "#1A1A24",
      dialogSurface: "#0A0A10",
      thinkingBorder: "#34344A",
      dimSeparator: "#4E4E66",
    },
  },

  // 冷蓝科技感：适合 AI、开发者工具、终端面板
  {
    name: "Arctic Neon",
    colors: {
      primary: "#7DD3FC",
      planMode: "#A78BFA",
      selection: "#38BDF8",
      thinking: "#C084FC",
      success: "#86EFAC",
      error: "#FB7185",
      info: "#67E8F9",
      background: "#07111F",
      surface: "#0E1A2B",
      dialogSurface: "#050B14",
      thinkingBorder: "#27364F",
      dimSeparator: "#3B4A60",
    },
  },

  // 紫色幻想感：偏二次元、神秘、夜间模式
  {
    name: "Violet Mirage",
    colors: {
      primary: "#C084FC",
      planMode: "#F0ABFC",
      selection: "#A78BFA",
      thinking: "#E879F9",
      success: "#6EE7B7",
      error: "#F87171",
      info: "#A5B4FC",
      background: "#100A1F",
      surface: "#1B1230",
      dialogSurface: "#0B0617",
      thinkingBorder: "#3A2A5A",
      dimSeparator: "#5B4A75",
    },
  },

  // 暗红机械感：适合警告、战斗、赛博终端
  {
    name: "Crimson Core",
    colors: {
      primary: "#FB7185",
      planMode: "#F472B6",
      selection: "#F43F5E",
      thinking: "#FDA4AF",
      success: "#4ADE80",
      error: "#EF4444",
      info: "#FCA5A5",
      background: "#14070A",
      surface: "#231016",
      dialogSurface: "#0C0305",
      thinkingBorder: "#4A1F2A",
      dimSeparator: "#6B2F3D",
    },
  },

  // 橙金暖色：适合复古、炼金、机械、蒸汽朋克
  {
    name: "Solar Ember",
    colors: {
      primary: "#FDBA74",
      planMode: "#FACC15",
      selection: "#FB923C",
      thinking: "#FCD34D",
      success: "#84CC16",
      error: "#F87171",
      info: "#FDE68A",
      background: "#120B05",
      surface: "#21160B",
      dialogSurface: "#0B0603",
      thinkingBorder: "#4A3518",
      dimSeparator: "#6B4B24",
    },
  },

  // 森林绿：适合自然、稳定、安全、数据面板
  {
    name: "Emerald Grove",
    colors: {
      primary: "#34D399",
      planMode: "#A3E635",
      selection: "#10B981",
      thinking: "#86EFAC",
      success: "#22C55E",
      error: "#F87171",
      info: "#5EEAD4",
      background: "#06130D",
      surface: "#0D2118",
      dialogSurface: "#030B07",
      thinkingBorder: "#244A38",
      dimSeparator: "#3F6655",
    },
  },

  // 青色赛博：比 Nightfox 更偏电子蓝绿
  {
    name: "Cyber Cyan",
    colors: {
      primary: "#22D3EE",
      planMode: "#818CF8",
      selection: "#06B6D4",
      thinking: "#A78BFA",
      success: "#2DD4BF",
      error: "#FB7185",
      info: "#67E8F9",
      background: "#031217",
      surface: "#09242C",
      dialogSurface: "#020A0D",
      thinkingBorder: "#1E3A4A",
      dimSeparator: "#315B6B",
    },
  },

  // 粉紫柔光：适合二次元、角色系统、轻幻想 UI
  {
    name: "Sakura Pulse",
    colors: {
      primary: "#F9A8D4",
      planMode: "#D8B4FE",
      selection: "#F472B6",
      thinking: "#E879F9",
      success: "#86EFAC",
      error: "#FB7185",
      info: "#F0ABFC",
      background: "#140A14",
      surface: "#241426",
      dialogSurface: "#0D050D",
      thinkingBorder: "#4A2A4F",
      dimSeparator: "#6B486D",
    },
  },

  // 高级灰蓝：低饱和、专业、适合长时间编码
  {
    name: "Slate Quantum",
    colors: {
      primary: "#CBD5E1",
      planMode: "#93C5FD",
      selection: "#64748B",
      thinking: "#A5B4FC",
      success: "#86EFAC",
      error: "#F87171",
      info: "#BAE6FD",
      background: "#0B0F14",
      surface: "#151B23",
      dialogSurface: "#06090D",
      thinkingBorder: "#2E3A4A",
      dimSeparator: "#475569",
    },
  },
];
export const DEFAULT_THEME = THEMES.find((t) => t.name === "Nightfox")!