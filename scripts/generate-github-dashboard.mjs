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
    file: "github-dashboard-dark.svg",
    bgA: "#020617",
    bgB: "#0f172a",
    bgC: "#111827",
    panelA: "#111827",
    panelB: "#020617",
    title: "#f8fafc",
    text: "#dbeafe",
    muted: "#94a3b8",
    faint: "#64748b",
    track: "#1f2937",
    line: "#334155",
    glass: "#020617",
    glassOpacity: ".46",
    glowOpacity: ".58",
  },
  light: {
    file: "github-dashboard-light.svg",
    bgA: "#eff6ff",
    bgB: "#f8fafc",
    bgC: "#ecfeff",
    panelA: "#ffffff",
    panelB: "#f8fafc",
    title: "#0f172a",
    text: "#1e293b",
    muted: "#475569",
    faint: "#64748b",
    track: "#dbeafe",
    line: "#bfdbfe",
    glass: "#ffffff",
    glassOpacity: ".72",
    glowOpacity: ".42",
  },
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
    if (!rankPattern.test(texts[index])) {
      continue;
    }

    const title = texts[index + 1];
    const subtitle = texts[index + 2];
    const score = texts[index + 3];
    if (!title || !subtitle || !score || rankPattern.test(title)) {
      continue;
    }

    trophies.push({
      rank: texts[index],
      title,
      subtitle,
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

const metricCard = ({ x, y, label, value, accent }) => `
  <g transform="translate(${x} ${y})">
    <rect width="154" height="76" rx="18" fill="url(#panel)" stroke="${accent}" stroke-opacity=".36"/>
    <text x="18" y="27" class="label">${escapeXml(label)}</text>
    <text x="18" y="58" class="metric" fill="${accent}">${escapeXml(value)}</text>
  </g>`;

const languageRows = (languages, theme) =>
  languages
    .slice(0, 8)
    .map((language, index) => {
      const y = index * 27;
      const width = Math.max(8, Math.min(260, (language.value / 100) * 260));
      return `
        <g transform="translate(0 ${y})">
          <circle cx="8" cy="8" r="5" fill="${language.color}"/>
          <text x="22" y="12" class="lang">${escapeXml(language.name)}</text>
          <text x="258" y="12" class="langPercent" text-anchor="end">${escapeXml(language.percent)}</text>
          <rect x="0" y="18" width="260" height="6" rx="3" fill="${theme.track}"/>
          <rect x="0" y="18" width="${width.toFixed(1)}" height="6" rx="3" fill="${language.color}">
            <animate attributeName="width" from="0" to="${width.toFixed(1)}" dur="1.2s" begin="${index * 0.08}s" fill="freeze"/>
          </rect>
        </g>`;
    })
    .join("");

const trophyCards = (trophies, theme) =>
  trophies
    .map((trophy, index) => {
      const x = 64 + (index % 3) * 170;
      const y = 410 + Math.floor(index / 3) * 86;
      const rankColor =
        trophy.rank === "S" || trophy.rank === "SS" || trophy.rank === "SSS"
          ? "#f59e0b"
          : "#38bdf8";
      return `
        <g transform="translate(${x} ${y})">
          <rect width="150" height="70" rx="16" fill="url(#panel)" stroke="${rankColor}" stroke-opacity=".34"/>
          <circle cx="26" cy="28" r="15" fill="${rankColor}" fill-opacity=".18" stroke="${rankColor}" stroke-opacity=".55"/>
          <text x="26" y="33" class="trophyRank" text-anchor="middle" fill="${rankColor}">${escapeXml(trophy.rank)}</text>
          <text x="52" y="27" class="trophyTitle">${escapeXml(trophy.title)}</text>
          <text x="52" y="46" class="trophyScore">${escapeXml(trophy.score)}</text>
        </g>`;
    })
    .join("");

const renderTyping = () => `
  <text x="64" y="128" class="typing">
    ${typingLines
      .map(
        (line, index) => `
      <tspan opacity="0">${escapeXml(line)}
        <animate attributeName="opacity" values="0;1;1;0;0" keyTimes="0;0.08;0.72;0.86;1" dur="12s" begin="${index * 3}s" repeatCount="indefinite"/>
      </tspan>`,
      )
      .join("")}
  </text>`;

const renderDashboard = ({ stats, languages, trophies, themeName }) => {
  const theme = THEMES[themeName];
  const generatedAt = new Date().toISOString().slice(0, 10);
  return `<svg width="980" height="620" viewBox="0 0 980 620" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title desc">
  <title id="title">Xiang An's GitHub stats, trophies, and top languages</title>
  <desc id="desc">Stars ${escapeXml(stats.stars)}, commits ${escapeXml(stats.commits)}, rank ${escapeXml(stats.rank)}, top language ${escapeXml(languages[0]?.name || "Python")}.</desc>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="980" y2="620" gradientUnits="userSpaceOnUse">
      <stop stop-color="${theme.bgA}"/>
      <stop offset=".52" stop-color="${theme.bgB}"/>
      <stop offset="1" stop-color="${theme.bgC}"/>
    </linearGradient>
    <linearGradient id="glow" x1="110" y1="31" x2="865" y2="560" gradientUnits="userSpaceOnUse">
      <stop stop-color="#22d3ee"/>
      <stop offset=".5" stop-color="#8b5cf6"/>
      <stop offset="1" stop-color="#22c55e"/>
    </linearGradient>
    <linearGradient id="panel" x1="0" y1="0" x2="154" y2="86" gradientUnits="userSpaceOnUse">
      <stop stop-color="${theme.panelA}" stop-opacity=".90"/>
      <stop offset="1" stop-color="${theme.panelB}" stop-opacity=".78"/>
    </linearGradient>
    <radialGradient id="orbA" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(132 88) rotate(49) scale(190 120)">
      <stop stop-color="#0ea5e9" stop-opacity="${theme.glowOpacity}"/>
      <stop offset="1" stop-color="#0ea5e9" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="orbB" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(830 356) rotate(49) scale(220 140)">
      <stop stop-color="#22c55e" stop-opacity="${theme.glowOpacity}"/>
      <stop offset="1" stop-color="#22c55e" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="clip"><rect width="980" height="620" rx="30"/></clipPath>
    <style>
      .title{font:800 34px Inter,Segoe UI,Arial,sans-serif;fill:${theme.title};letter-spacing:0}
      .subtitle{font:500 14px Inter,Segoe UI,Arial,sans-serif;fill:${theme.muted};letter-spacing:0}
      .typing{font:700 22px Fira Code,Consolas,monospace;fill:#0ea5e9;letter-spacing:0}
      .label{font:700 11px Inter,Segoe UI,Arial,sans-serif;fill:${theme.muted};text-transform:uppercase;letter-spacing:.08em}
      .metric{font:800 27px Inter,Segoe UI,Arial,sans-serif;letter-spacing:0}
      .sectionTitle{font:800 22px Inter,Segoe UI,Arial,sans-serif;fill:${theme.title};letter-spacing:0}
      .lang{font:700 12px Inter,Segoe UI,Arial,sans-serif;fill:${theme.text};letter-spacing:0}
      .langPercent{font:700 12px Inter,Segoe UI,Arial,sans-serif;fill:${theme.muted};letter-spacing:0}
      .tiny{font:600 11px Inter,Segoe UI,Arial,sans-serif;fill:${theme.faint};letter-spacing:0}
      .trophyRank{font:900 12px Inter,Segoe UI,Arial,sans-serif;letter-spacing:0}
      .trophyTitle{font:800 12px Inter,Segoe UI,Arial,sans-serif;fill:${theme.text};letter-spacing:0}
      .trophyScore{font:700 10px Inter,Segoe UI,Arial,sans-serif;fill:${theme.muted};letter-spacing:0}
      .scan{animation:scan 4s linear infinite}
      @keyframes scan{0%{transform:translateX(-500px)}100%{transform:translateX(980px)}}
    </style>
  </defs>

  <g clip-path="url(#clip)">
    <rect width="980" height="620" fill="url(#bg)"/>
    <rect width="980" height="620" fill="url(#orbA)"/>
    <rect width="980" height="620" fill="url(#orbB)"/>
    <path d="M-90 351C80 272 130 428 283 323C436 218 519 276 660 174C766 98 864 114 1078 36" stroke="url(#glow)" stroke-width="2" stroke-opacity=".42"/>
    <path d="M-80 396C119 295 226 430 359 328C491 226 579 308 736 196C848 117 908 153 1064 94" stroke="#38bdf8" stroke-width="1" stroke-opacity=".18"/>
    <rect class="scan" y="0" width="280" height="620" fill="url(#glow)" opacity=".06"/>

    <rect x="24" y="24" width="932" height="572" rx="26" fill="${theme.glass}" fill-opacity="${theme.glassOpacity}" stroke="url(#glow)" stroke-opacity=".62"/>
    <rect x="36" y="36" width="908" height="548" rx="20" fill="${theme.panelA}" fill-opacity=".22" stroke="${theme.line}" stroke-opacity=".46"/>

    <text x="64" y="78" class="title">Xiang An's GitHub stats</text>
    <text x="64" y="106" class="subtitle">Private-instance telemetry, refreshed from GitHub Readme Stats APIs</text>
    ${renderTyping()}
    <text x="64" y="154" class="tiny">Generated ${generatedAt}</text>

    ${metricCard({ x: 64, y: 184, label: "Stars", value: stats.stars, accent: "#22d3ee" })}
    ${metricCard({ x: 236, y: 184, label: "Commits", value: stats.commits, accent: "#a78bfa" })}
    ${metricCard({ x: 408, y: 184, label: "Pull requests", value: stats.prs, accent: "#34d399" })}
    ${metricCard({ x: 64, y: 278, label: "Issues", value: stats.issues, accent: "#fbbf24" })}
    ${metricCard({ x: 236, y: 278, label: "Contributed", value: stats.contribs, accent: "#fb7185" })}
    ${metricCard({ x: 408, y: 278, label: "Rank", value: stats.rank, accent: "#38bdf8" })}

    <g transform="translate(620 184)">
      <text x="0" y="-18" class="sectionTitle">Top languages</text>
      ${languageRows(languages, theme)}
    </g>

    <text x="64" y="390" class="sectionTitle">Xiang An's GitHub trophies</text>
    ${trophyCards(trophies, theme)}
  </g>
</svg>
`;
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
  if (!languages.length) {
    throw new Error("Could not parse languages");
  }
  if (!trophies.length) {
    throw new Error("Could not parse trophies");
  }

  await mkdir(assetsDir, { recursive: true });
  for (const themeName of Object.keys(THEMES)) {
    const outFile = new URL(`../assets/${THEMES[themeName].file}`, import.meta.url);
    await writeFile(outFile, renderDashboard({ stats, languages, trophies, themeName }));
    console.log(`Wrote ${outFile.pathname}`);
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
