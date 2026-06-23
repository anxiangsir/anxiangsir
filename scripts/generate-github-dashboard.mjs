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
    surface: "#0b1220",
    surfaceAlt: "#111827",
    title: "#f8fafc",
    text: "#dbeafe",
    muted: "#94a3b8",
    track: "#1f2937",
    border: "#334155",
    shadow: "#020617",
  },
  light: {
    surface: "#ffffff",
    surfaceAlt: "#f8fafc",
    title: "#0f172a",
    text: "#1e293b",
    muted: "#64748b",
    track: "#dbeafe",
    border: "#cbd5e1",
    shadow: "#dbeafe",
  },
};

const FILES = {
  dark: "github-dashboard-dark.svg",
  light: "github-dashboard-light.svg",
  darkMobile: "github-dashboard-dark-mobile.svg",
  lightMobile: "github-dashboard-light-mobile.svg",
};

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
  "Open-source Builder",
  "Multimodal Systems",
  "Making models see, reason, and act",
];

const mobileTypingLines = [
  "AI Researcher",
  "Open-source Builder",
  "Multimodal AI",
  "Models that see + act",
];

const renderTyping = ({ x, y, lines = typingLines }) =>
  lines
    .map(
      (line, index) => `
  <text x="${x}" y="${y}" class="typing" opacity="0">${escapeXml(line)}
    <animate attributeName="opacity" values="0;1;1;0;0" keyTimes="0;0.08;0.72;0.86;1" dur="12s" begin="${index * 3}s" repeatCount="indefinite"/>
  </text>`,
    )
    .join("");

const metricCard = ({ x, y, w = 142, label, value, accent }) => `
  <g transform="translate(${x} ${y})">
    <rect width="${w}" height="70" rx="14" fill="url(#panel)" stroke="${accent}" stroke-opacity=".36"/>
    <text x="16" y="25" class="label">${escapeXml(label)}</text>
    <text x="16" y="54" class="metric" fill="${accent}">${escapeXml(value)}</text>
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
          <rect width="${w}" height="54" rx="14" fill="url(#panel)" stroke="${rankColor}" stroke-opacity=".34"/>
          <circle cx="24" cy="27" r="14" fill="${rankColor}" fill-opacity=".14" stroke="${rankColor}" stroke-opacity=".58"/>
          <text x="24" y="32" class="trophyRank" text-anchor="middle" fill="${rankColor}">${escapeXml(trophy.rank)}</text>
          <text x="48" y="25" class="trophyTitle">${escapeXml(trophy.title)}</text>
          <text x="48" y="41" class="trophyScore">${escapeXml(trophy.score)}</text>
        </g>`;
    })
    .join("");

const defs = (theme, width, height) => `
  <defs>
    <linearGradient id="panel" x1="0" y1="0" x2="1" y2="1">
      <stop stop-color="${theme.surface}" stop-opacity=".96"/>
      <stop offset="1" stop-color="${theme.surfaceAlt}" stop-opacity=".88"/>
    </linearGradient>
    <linearGradient id="line" x1="0" y1="0" x2="${width}" y2="${height}" gradientUnits="userSpaceOnUse">
      <stop stop-color="#22d3ee"/>
      <stop offset=".52" stop-color="#8b5cf6"/>
      <stop offset="1" stop-color="#22c55e"/>
    </linearGradient>
    <filter id="softShadow" x="-8%" y="-8%" width="116%" height="116%">
      <feDropShadow dx="0" dy="12" stdDeviation="18" flood-color="${theme.shadow}" flood-opacity=".16"/>
    </filter>
    <style>
      .title{font:800 31px Inter,Segoe UI,Arial,sans-serif;fill:${theme.title};letter-spacing:0}
      .subtitle{font:500 13px Inter,Segoe UI,Arial,sans-serif;fill:${theme.muted};letter-spacing:0}
      .typing{font:700 18px Fira Code,Consolas,monospace;fill:#0ea5e9;letter-spacing:0}
      .label{font:700 10px Inter,Segoe UI,Arial,sans-serif;fill:${theme.muted};text-transform:uppercase;letter-spacing:.08em}
      .metric{font:800 25px Inter,Segoe UI,Arial,sans-serif;letter-spacing:0}
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
  <rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="24" fill="none" stroke="url(#line)" stroke-opacity=".6"/>
  <g filter="url(#softShadow)">
    <rect x="14" y="14" width="${width - 28}" height="${height - 28}" rx="20" fill="${theme.surface}" fill-opacity=".72" stroke="${theme.border}" stroke-opacity=".48"/>
  </g>
  ${body}
</svg>`;

const renderDesktop = ({ stats, languages, trophies, theme }) => {
  const generatedAt = new Date().toISOString().slice(0, 10);
  const body = `
    <text x="42" y="58" class="title">Xiang An's GitHub stats</text>
    <text x="42" y="83" class="subtitle">Private-instance telemetry from GitHub Readme Stats APIs</text>
    ${renderTyping({ x: 42, y: 113 })}
    <text x="42" y="136" class="tiny">Generated ${generatedAt}</text>

    ${metricCard({ x: 42, y: 164, label: "Stars", value: stats.stars, accent: "#22d3ee" })}
    ${metricCard({ x: 202, y: 164, label: "Commits", value: stats.commits, accent: "#a78bfa" })}
    ${metricCard({ x: 362, y: 164, label: "Pull requests", value: stats.prs, accent: "#34d399" })}
    ${metricCard({ x: 42, y: 248, label: "Issues", value: stats.issues, accent: "#fbbf24" })}
    ${metricCard({ x: 202, y: 248, label: "Contributed", value: stats.contribs, accent: "#fb7185" })}
    ${metricCard({ x: 362, y: 248, label: "Rank", value: stats.rank, accent: "#38bdf8" })}

    <text x="560" y="58" class="sectionTitle">Top languages</text>
    ${languageRows({ languages, theme, x: 560, y: 84, width: 300, rowGap: 27 })}

    <text x="42" y="370" class="sectionTitle">Xiang An's GitHub trophies</text>
    ${trophyPills({ trophies, theme, x: 42, y: 390, columns: 3, gapX: 170, gapY: 66, w: 150 })}
  `;

  return shell({
    width: 900,
    height: 530,
    theme,
    body,
    desc: `Stars ${stats.stars}, commits ${stats.commits}, rank ${stats.rank}.`,
  });
};

const renderMobile = ({ stats, languages, trophies, theme }) => {
  const generatedAt = new Date().toISOString().slice(0, 10);
  const body = `
    <text x="28" y="54" class="title">Xiang An</text>
    <text x="28" y="79" class="subtitle">GitHub dashboard</text>
    ${renderTyping({ x: 28, y: 108, lines: mobileTypingLines })}
    <text x="28" y="130" class="tiny">Generated ${generatedAt}</text>

    ${metricCard({ x: 28, y: 154, w: 148, label: "Stars", value: stats.stars, accent: "#22d3ee" })}
    ${metricCard({ x: 194, y: 154, w: 148, label: "Commits", value: stats.commits, accent: "#a78bfa" })}
    ${metricCard({ x: 28, y: 238, w: 148, label: "Pull requests", value: stats.prs, accent: "#34d399" })}
    ${metricCard({ x: 194, y: 238, w: 148, label: "Rank", value: stats.rank, accent: "#38bdf8" })}

    <text x="28" y="354" class="sectionTitle">Top languages</text>
    ${languageRows({ languages, theme, x: 28, y: 380, width: 314, rowGap: 29 })}

    <text x="28" y="650" class="sectionTitle">GitHub trophies</text>
    ${trophyPills({ trophies, theme, x: 28, y: 672, columns: 1, gapX: 0, gapY: 64, w: 314 })}
  `;

  return shell({
    width: 370,
    height: 1088,
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
