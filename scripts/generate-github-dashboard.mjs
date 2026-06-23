import { mkdir, writeFile } from "node:fs/promises";

const STATS_URL =
  "https://github-readme-stats-psi-plum-61.vercel.app/api?username=anxiangsir&show_icons=true&include_all_commits=true&rank_icon=github&hide_border=true";
const LANGS_URL =
  "https://github-readme-stats-psi-plum-61.vercel.app/api/top-langs/?username=anxiangsir&layout=compact&hide_border=true&langs_count=8";
const TROPHY_URL =
  "https://gh-trophy.cdnsoft.net/?username=anxiangsir&theme=flat&no-frame=true&no-bg=true&margin-w=8&rank=SSS,SS,S,AAA,AA,A,B";

const assetsDir = new URL("../assets/", import.meta.url);

const THEMES = {
  dark: {
    title: "#f8fafc",
    text: "#dbeafe",
    muted: "#94a3b8",
    track: "#1e293b",
  },
  light: {
    title: "#0f172a",
    text: "#1e293b",
    muted: "#64748b",
    track: "#e2e8f0",
  },
};

const FILES = {
  dark: "github-dashboard-dark.svg",
  light: "github-dashboard-light.svg",
  darkMobile: "github-dashboard-dark-mobile.svg",
  lightMobile: "github-dashboard-light-mobile.svg",
};

const DESKTOP_HERO_HEIGHT = 150;
const MOBILE_HERO_HEIGHT = 154;

const htmlDecode = (value) =>
  value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

const escapeXml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const fetchText = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return response.text();
};

const parseStats = (svg) => {
  const title = htmlDecode(svg.match(/<title[^>]*>(.*?)<\/title>/s)?.[1] || "");
  const desc = htmlDecode(svg.match(/<desc[^>]*>(.*?)<\/desc>/s)?.[1] || "");
  const rank = title.match(/Rank:\s*([^<,]+)/)?.[1]?.trim() || "A+";
  const get = (label) => {
    const raw =
      desc.match(new RegExp(`${label}\\s*:?\\s*([0-9,]+)`, "i"))?.[1] || "0";
    const value = Number.parseInt(raw.replaceAll(",", ""), 10);
    return Number.isFinite(value) ? value.toLocaleString("en-US") : "0";
  };

  return {
    rank,
    stars: get("Total Stars Earned"),
    commits: get("Total Commits"),
    prs: get("Total PRs"),
    issues: get("Total Issues"),
    contribs: get("Contributed to \\(last year\\)"),
  };
};

const parseLanguages = (svg) => {
  const names = [
    ...svg.matchAll(
      /<text[^>]*data-testid="lang-name"[^>]*>\s*([^<]+)\s*<\/text>/g,
    ),
  ].map((match) => htmlDecode(match[1].trim()));
  const colors = [...svg.matchAll(/<circle[^>]*fill="([^"]+)"/g)].map(
    (match) => match[1],
  );

  return names.map((entry, index) => {
    const [, name, percent] = entry.match(/^(.*)\s+([\d.]+%)$/) || [
      null,
      entry,
      "0%",
    ];
    return {
      name,
      percent,
      value: Number.parseFloat(percent),
      color: colors[index] || "#58a6ff",
    };
  });
};

const parseTrophies = (svg) => {
  const texts = [
    ...svg.matchAll(/<text[^>]*>\s*([^<]+?)\s*<\/text>/g),
  ].map((match) => htmlDecode(match[1].trim()));
  const rankPattern = /^(SSS|SS|S|AAA|AA|A|B|C)$/;
  const trophies = [];

  for (let index = 0; index < texts.length; index += 1) {
    if (!rankPattern.test(texts[index])) continue;
    const title = texts[index + 1];
    const subtitle = texts[index + 2];
    const score = texts[index + 3];
    if (!title || !subtitle || !score || rankPattern.test(title)) continue;

    trophies.push({
      rank: texts[index],
      title,
      score,
    });
    index += 3;
  }

  return trophies.slice(0, 6);
};

const typingLines = [
  "AI Researcher",
  "AI 研究者",
  "Open-source Builder",
  "开源构建者",
  "Multimodal Systems",
  "多模态系统",
  "Models that see, reason, and act",
  "让模型看见、推理、行动",
];

const mobileTypingLines = [
  "AI Researcher",
  "AI 研究者",
  "Open-source Builder",
  "开源构建者",
  "Multimodal AI",
  "多模态 AI",
  "Models that see + act",
  "看见、推理、行动",
];

const renderTyping = ({ x, y, lines = typingLines }) => {
  const slotSeconds = 2.2;
  const cycleSeconds = lines.length * slotSeconds;
  const visibleUntil = 1 / lines.length;
  const fade = Math.min(0.035, visibleUntil / 3);

  return lines
    .map((line, index) => {
      const values = index === 0 ? "1;1;1;0;0" : "0;1;1;0;0";
      return `
  <text x="${x}" y="${y}" class="typing" opacity="${index === 0 ? 1 : 0}">${escapeXml(line)}
    <animate attributeName="opacity" values="${values}" keyTimes="0;${fade};${Math.max(fade, visibleUntil - fade)};${visibleUntil};1" dur="${cycleSeconds}s" begin="${(index * slotSeconds).toFixed(1)}s" repeatCount="indefinite"/>
    <animateTransform attributeName="transform" type="translate" values="0 4;0 0;0 0;0 -4;0 -4" keyTimes="0;${fade};${Math.max(fade, visibleUntil - fade)};${visibleUntil};1" dur="${cycleSeconds}s" begin="${(index * slotSeconds).toFixed(1)}s" repeatCount="indefinite"/>
  </text>`;
    })
    .join("");
};

const renderHero = ({ width, height, compact = false }) => {
  const waveStart = compact ? height - 45 : height - 50;
  const titleY = compact ? 56 : 64;
  const descY = compact ? 86 : 96;
  const subY = compact ? 111 : 122;

  return `
  <g>
    <path d="M0 0H${width}V${waveStart}C${(width * 0.76).toFixed(0)} ${height + 4} ${(width * 0.48).toFixed(0)} ${height - 36} ${(width * 0.25).toFixed(0)} ${height - 14}C${(width * 0.12).toFixed(0)} ${height} ${(width * 0.05).toFixed(0)} ${height - 24} 0 ${height - 8}Z" fill="url(#heroGradient)"/>
    <path d="M0 ${height - 62}C${(width * 0.28).toFixed(0)} ${height - 24} ${(width * 0.58).toFixed(0)} ${height - 58} ${width} ${height - 34}V${height - 6}C${(width * 0.62).toFixed(0)} ${height - 40} ${(width * 0.26).toFixed(0)} ${height + 2} 0 ${height - 30}Z" fill="#ffffff" opacity=".18"/>
    <text x="${width / 2}" y="${titleY}" class="${compact ? "heroTitleCompact" : "heroTitle"}" text-anchor="middle">Xiang An</text>
    <text x="${width / 2}" y="${descY}" class="heroDesc" text-anchor="middle">AI Research / Open Source / Multimodal Systems</text>
    <text x="${width / 2}" y="${subY}" class="heroMeta" text-anchor="middle">GitHub telemetry, trophies, and languages</text>
  </g>`;
};

const metricTile = ({ x, y, label, value, accent }) => `
  <g transform="translate(${x} ${y})">
    <rect x="0" y="0" width="34" height="3" rx="1.5" fill="${accent}" opacity=".9"/>
    <text x="0" y="19" class="label">${escapeXml(label)}</text>
    <text x="0" y="52" class="metric" fill="${accent}">${escapeXml(value)}</text>
  </g>`;

const metricLine = ({ x, y, width, label, value, accent }) => `
  <g transform="translate(${x} ${y})">
    <text x="0" y="17" class="label">${escapeXml(label)}</text>
    <text x="${width}" y="20" class="metricSmall" fill="${accent}" text-anchor="end">${escapeXml(value)}</text>
    <rect x="0" y="31" width="${width}" height="4" rx="2" fill="${accent}" opacity=".14"/>
    <rect x="0" y="31" width="${Math.min(width, 44)}" height="4" rx="2" fill="${accent}" opacity=".9"/>
  </g>`;

const languageRows = ({ languages, theme, x, y, width, rowGap = 28 }) =>
  languages
    .slice(0, 8)
    .map((language, index) => {
      const rowY = y + index * rowGap;
      const barWidth = Math.max(8, Math.min(width, (language.value / 100) * width));
      return `
        <g transform="translate(${x} ${rowY})">
          <circle cx="7" cy="7" r="5" fill="${language.color}"/>
          <text x="20" y="11" class="lang">${escapeXml(language.name)}</text>
          <text x="${width}" y="11" class="langPercent" text-anchor="end">${escapeXml(language.percent)}</text>
          <rect x="0" y="17" width="${width}" height="6" rx="3" fill="${theme.track}"/>
          <rect x="0" y="17" width="${barWidth.toFixed(1)}" height="6" rx="3" fill="${language.color}">
            <animate attributeName="width" from="0" to="${barWidth.toFixed(1)}" dur="1.1s" begin="${index * 0.08}s" fill="freeze"/>
          </rect>
        </g>`;
    })
    .join("");

const trophyPills = ({ trophies, x, y, columns, gapX, gapY, w, theme }) =>
  trophies
    .map((trophy, index) => {
      const rankColor =
        trophy.rank === "S" || trophy.rank === "SS" || trophy.rank === "SSS"
          ? "#f59e0b"
          : "#38bdf8";
      const itemX = x + (index % columns) * gapX;
      const itemY = y + Math.floor(index / columns) * gapY;
      return `
        <g transform="translate(${itemX} ${itemY})">
          <circle cx="16" cy="18" r="15" fill="${rankColor}" fill-opacity=".16"/>
          <text x="16" y="23" class="trophyRank" text-anchor="middle" fill="${rankColor}">${escapeXml(trophy.rank)}</text>
          <text x="42" y="16" class="trophyTitle">${escapeXml(trophy.title)}</text>
          <text x="42" y="33" class="trophyScore">${escapeXml(trophy.score)}</text>
        </g>`;
    })
    .join("");

const defs = (theme, width, height) => `
  <defs>
    <linearGradient id="heroGradient" x1="0" y1="0" x2="${width}" y2="0" gradientUnits="userSpaceOnUse">
      <stop stop-color="#06b6d4"/>
      <stop offset=".46" stop-color="#8b5cf6"/>
      <stop offset="1" stop-color="#22c55e"/>
    </linearGradient>
    <linearGradient id="accentTitle" x1="0" y1="0" x2="${width}" y2="0" gradientUnits="userSpaceOnUse">
      <stop stop-color="#06b6d4"/>
      <stop offset=".52" stop-color="#8b5cf6"/>
      <stop offset="1" stop-color="#22c55e"/>
    </linearGradient>
    <style>
      .heroTitle{font:900 47px Inter,Segoe UI,Arial,sans-serif;fill:#ffffff;letter-spacing:0}
      .heroTitleCompact{font:900 36px Inter,Segoe UI,Arial,sans-serif;fill:#ffffff;letter-spacing:0}
      .heroDesc{font:800 15px Inter,Segoe UI,Arial,sans-serif;fill:#f8fbff;letter-spacing:0}
      .heroMeta{font:700 11px Inter,Segoe UI,Arial,sans-serif;fill:#eef6ff;letter-spacing:.08em;text-transform:uppercase}
      .title{font:800 31px Inter,Segoe UI,Arial,sans-serif;fill:${theme.title};letter-spacing:0}
      .titleAccent{font:800 31px Inter,Segoe UI,Arial,sans-serif;fill:url(#accentTitle);letter-spacing:0}
      .subtitle{font:500 13px Inter,Segoe UI,Arial,sans-serif;fill:${theme.muted};letter-spacing:0}
      .typing{font:800 18px Inter,"Noto Sans CJK SC","PingFang SC","Microsoft YaHei",Arial,sans-serif;fill:#0ea5e9;letter-spacing:0}
      .label{font:800 10px Inter,Segoe UI,Arial,sans-serif;fill:${theme.muted};text-transform:uppercase;letter-spacing:.08em}
      .metric{font:800 29px Inter,Segoe UI,Arial,sans-serif;letter-spacing:0}
      .metricSmall{font:800 22px Inter,Segoe UI,Arial,sans-serif;letter-spacing:0}
      .sectionTitle{font:800 19px Inter,Segoe UI,Arial,sans-serif;fill:${theme.title};letter-spacing:0}
      .lang{font:700 12px Inter,Segoe UI,Arial,sans-serif;fill:${theme.text};letter-spacing:0}
      .langPercent{font:700 12px Inter,Segoe UI,Arial,sans-serif;fill:${theme.muted};letter-spacing:0}
      .tiny{font:600 10px Inter,Segoe UI,Arial,sans-serif;fill:${theme.muted};letter-spacing:0}
      .trophyRank{font:900 11px Inter,Segoe UI,Arial,sans-serif;letter-spacing:0}
      .trophyTitle{font:800 12px Inter,Segoe UI,Arial,sans-serif;fill:${theme.text};letter-spacing:0}
      .trophyScore{font:700 10px Inter,Segoe UI,Arial,sans-serif;fill:${theme.muted};letter-spacing:0}
    </style>
  </defs>`;

const shell = ({ width, height, theme, body, desc }) => `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title desc">
  <title id="title">Xiang An's GitHub dashboard</title>
  <desc id="desc">${escapeXml(desc)}</desc>
  ${defs(theme, width, height)}
  ${body}
</svg>`;

const renderDesktop = ({ stats, languages, trophies, theme }) => {
  const generatedAt = new Date().toISOString().slice(0, 10);
  const body = `
    ${renderHero({ width: 900, height: DESKTOP_HERO_HEIGHT })}
    <g transform="translate(0 ${DESKTOP_HERO_HEIGHT})">
      <text x="34" y="52" class="titleAccent">GitHub stats</text>
      <text x="34" y="80" class="subtitle">Private-instance telemetry from GitHub Readme Stats APIs</text>
      ${renderTyping({ x: 34, y: 115 })}
      <text x="34" y="146" class="tiny">Generated ${generatedAt}</text>

      ${metricTile({ x: 34, y: 166, label: "Stars", value: stats.stars, accent: "#22d3ee" })}
      ${metricTile({ x: 194, y: 166, label: "Commits", value: stats.commits, accent: "#a78bfa" })}
      ${metricTile({ x: 354, y: 166, label: "Pull requests", value: stats.prs, accent: "#34d399" })}
      ${metricTile({ x: 34, y: 250, label: "Issues", value: stats.issues, accent: "#fbbf24" })}
      ${metricTile({ x: 194, y: 250, label: "Contributed", value: stats.contribs, accent: "#fb7185" })}
      ${metricTile({ x: 354, y: 250, label: "Rank", value: stats.rank, accent: "#38bdf8" })}

      <text x="558" y="52" class="sectionTitle">Top languages</text>
      ${languageRows({ languages, theme, x: 558, y: 80, width: 302, rowGap: 26 })}

      <text x="34" y="355" class="sectionTitle">Xiang An's GitHub trophies</text>
      ${trophyPills({ trophies, theme, x: 34, y: 380, columns: 3, gapX: 174, gapY: 47, w: 150 })}
    </g>
  `;

  return shell({
    width: 900,
    height: 650,
    theme,
    body,
    desc: `Stars ${stats.stars}, commits ${stats.commits}, rank ${stats.rank}.`,
  });
};

const renderMobile = ({ stats, languages, trophies, theme }) => {
  const generatedAt = new Date().toISOString().slice(0, 10);
  const body = `
    ${renderHero({ width: 370, height: MOBILE_HERO_HEIGHT, compact: true })}
    <g transform="translate(0 ${MOBILE_HERO_HEIGHT})">
      <text x="28" y="48" class="titleAccent">GitHub stats</text>
      ${renderTyping({ x: 28, y: 86, lines: mobileTypingLines })}
      <text x="28" y="116" class="tiny">Generated ${generatedAt}</text>

      ${metricLine({ x: 28, y: 148, width: 314, label: "Stars", value: stats.stars, accent: "#22d3ee" })}
      ${metricLine({ x: 28, y: 198, width: 314, label: "Commits", value: stats.commits, accent: "#a78bfa" })}
      ${metricLine({ x: 28, y: 248, width: 314, label: "Pull requests", value: stats.prs, accent: "#34d399" })}
      ${metricLine({ x: 28, y: 298, width: 314, label: "Issues", value: stats.issues, accent: "#fbbf24" })}
      ${metricLine({ x: 28, y: 348, width: 314, label: "Contributed", value: stats.contribs, accent: "#fb7185" })}
      ${metricLine({ x: 28, y: 398, width: 314, label: "Rank", value: stats.rank, accent: "#38bdf8" })}

      <text x="28" y="488" class="sectionTitle">Top languages</text>
      ${languageRows({ languages, theme, x: 28, y: 514, width: 314, rowGap: 27 })}

      <text x="28" y="770" class="sectionTitle">GitHub trophies</text>
      ${trophyPills({ trophies, theme, x: 28, y: 798, columns: 1, gapX: 0, gapY: 48, w: 314 })}
    </g>
  `;

  return shell({
    width: 370,
    height: 1260,
    theme,
    body,
    desc: `Mobile GitHub dashboard. Stars ${stats.stars}, commits ${stats.commits}, rank ${stats.rank}.`,
  });
};

const main = async () => {
  const [statsSvg, langsSvg, trophySvg] = await Promise.all([
    fetchText(STATS_URL),
    fetchText(LANGS_URL),
    fetchText(TROPHY_URL),
  ]);
  const stats = parseStats(statsSvg);
  const languages = parseLanguages(langsSvg);
  const trophies = parseTrophies(trophySvg);
  if (!languages.length) throw new Error("Could not parse languages");
  if (!trophies.length) throw new Error("Could not parse trophies");

  await mkdir(assetsDir, { recursive: true });
  const outputs = [
    [FILES.dark, renderDesktop({ stats, languages, trophies, theme: THEMES.dark })],
    [FILES.light, renderDesktop({ stats, languages, trophies, theme: THEMES.light })],
    [
      FILES.darkMobile,
      renderMobile({ stats, languages, trophies, theme: THEMES.dark }),
    ],
    [
      FILES.lightMobile,
      renderMobile({ stats, languages, trophies, theme: THEMES.light }),
    ],
  ];

  for (const [file, svg] of outputs) {
    const outFile = new URL(`../assets/${file}`, import.meta.url);
    await writeFile(outFile, svg);
    console.log(`Wrote ${outFile.pathname}`);
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
