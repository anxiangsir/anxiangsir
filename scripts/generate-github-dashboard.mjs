import { mkdir, writeFile } from "node:fs/promises";

const STATS_URL =
  "https://github-readme-stats-psi-plum-61.vercel.app/api?username=anxiangsir&show_icons=true&include_all_commits=true&rank_icon=github&hide_border=true";
const LANGS_URL =
  "https://github-readme-stats-psi-plum-61.vercel.app/api/top-langs/?username=anxiangsir&layout=compact&hide_border=true&langs_count=8";
// Flagship repositories whose star history is charted together (stacked).
// Colors follow the hero gradient: cyan -> purple -> green.
const STAR_REPOS = [
  { name: "InsightFace", repo: "deepinsight/insightface", color: "#22d3ee" },
  { name: "LLaVA-OneVision-2", repo: "EvolvingLMMs-Lab/LLaVA-OneVision-2", color: "#a78bfa" },
  { name: "OneVision-Encoder", repo: "EvolvingLMMs-Lab/OneVision-Encoder", color: "#34d399" },
];
const STAR_SAMPLE_PAGES = 30; // evenly-spaced page samples per repo
const STAR_GRID_POINTS = 60; // resampled timeline resolution for smooth curves
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";

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

// --- Star history -----------------------------------------------------------

const ghFetch = async (path) => {
  const headers = {
    Accept: "application/vnd.github.star+json",
    "User-Agent": "anxiangsir-dashboard",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (GITHUB_TOKEN) headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
  const response = await fetch(`https://api.github.com${path}`, { headers });
  if (!response.ok) {
    throw new Error(`GitHub API ${path} -> ${response.status}`);
  }
  return response.json();
};

// Evenly-spaced page numbers across [1, totalPages], always including the last.
const samplePages = (totalPages, count) => {
  if (totalPages <= count) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const pages = new Set([1, totalPages]);
  for (let i = 1; i < count - 1; i += 1) {
    pages.add(Math.round(1 + (i * (totalPages - 1)) / (count - 1)));
  }
  return [...pages].sort((a, b) => a - b);
};

// Returns { name, color, total, points:[{t,c}] } where t=ms, c=cumulative stars.
const fetchStarSeries = async ({ name, repo, color }) => {
  const meta = await ghFetch(`/repos/${repo}`);
  const total = meta.stargazers_count;
  const perPage = 100;
  const totalPages = Math.min(Math.ceil(total / perPage), 400); // API caps at 400
  const pages = samplePages(totalPages, STAR_SAMPLE_PAGES);

  const pageData = await Promise.all(
    pages.map(async (page) => {
      const list = await ghFetch(
        `/repos/${repo}/stargazers?per_page=${perPage}&page=${page}`,
      );
      const first = Array.isArray(list) ? list[0] : null;
      if (!first?.starred_at) return null;
      // Cumulative count at the first star of this page.
      return { t: Date.parse(first.starred_at), c: (page - 1) * perPage + 1 };
    }),
  );

  const points = pageData.filter(Boolean).sort((a, b) => a.t - b.t);
  // Anchor the final point at the live total / now so the curve ends accurately.
  points.push({ t: Date.now(), c: total });
  return { name, color, total, points };
};

// Cumulative value of one series at time t (linear interpolation, 0 before start).
const valueAt = (points, t) => {
  if (!points.length || t < points[0].t) return 0;
  if (t >= points[points.length - 1].t) return points[points.length - 1].c;
  for (let i = 1; i < points.length; i += 1) {
    if (t <= points[i].t) {
      const a = points[i - 1];
      const b = points[i];
      const ratio = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
      return a.c + (b.c - a.c) * ratio;
    }
  }
  return points[points.length - 1].c;
};

// Resample every series onto a shared timeline so the areas can be stacked.
const buildStackedSeries = (seriesList) => {
  const starts = seriesList.map((s) => s.points[0]?.t).filter(Boolean);
  const minT = Math.min(...starts);
  const maxT = Date.now();
  const grid = Array.from({ length: STAR_GRID_POINTS }, (_, i) =>
    Math.round(minT + ((maxT - minT) * i) / (STAR_GRID_POINTS - 1)),
  );

  const layers = seriesList.map((s) => ({
    name: s.name,
    color: s.color,
    total: s.total,
    values: grid.map((t) => valueAt(s.points, t)),
  }));

  const totals = grid.map((_, gi) =>
    layers.reduce((sum, layer) => sum + layer.values[gi], 0),
  );

  return { grid, minT, maxT, layers, totals };
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
    <text x="${width / 2}" y="${subY}" class="heroMeta" text-anchor="middle">GitHub telemetry, languages, and star growth</text>
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

const f = (n) => Number(n.toFixed(1));
const fmtInt = (n) => Math.round(n).toLocaleString("en-US");
const fmtAxis = (n) => (n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`);

// Catmull-Rom -> cubic bezier command chain (assumes current point == pts[0]).
const curveCmds = (pts) => {
  let d = "";
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${f(c1x)} ${f(c1y)}, ${f(c2x)} ${f(c2y)}, ${f(p2.x)} ${f(p2.y)}`;
  }
  return d;
};

// Stacked-area chart of cumulative stars across the flagship repos.
const renderStarChart = ({ stacked, theme, x, y, width, height, compact = false }) => {
  const { grid, minT, maxT, layers, totals } = stacked;
  const padL = compact ? 38 : 46;
  const titleH = compact ? 56 : 34;
  const xLabH = 20;
  const plotTop = titleH;
  const plotBottom = height - xLabH;
  const plotH = plotBottom - plotTop;
  const plotW = width - padL;

  const peak = Math.max(...totals, 1);
  const niceMax = Math.max(10000, Math.ceil(peak / 10000) * 10000);
  const tickStep = niceMax > 60000 ? 20000 : 10000;

  const xScale = (t) => padL + ((t - minT) / (maxT - minT || 1)) * plotW;
  const yScale = (v) => plotBottom - (v / niceMax) * plotH;
  const toPts = (vals) => vals.map((v, gi) => ({ x: xScale(grid[gi]), y: yScale(v) }));

  // Horizontal gridlines + y labels.
  let grids = "";
  for (let v = 0; v <= niceMax; v += tickStep) {
    const gy = f(yScale(v));
    grids += `
    <line x1="${padL}" y1="${gy}" x2="${width}" y2="${gy}" stroke="${theme.track}" stroke-width="1" opacity=".6"/>
    <text x="${padL - 8}" y="${gy + 3}" class="tiny" text-anchor="end">${fmtAxis(v)}</text>`;
  }

  // Year ticks every 2 years.
  let xticks = "";
  const startYear = new Date(minT).getUTCFullYear();
  const endYear = new Date(maxT).getUTCFullYear();
  const yearStep = endYear - startYear > 10 ? 3 : 2;
  for (let yr = Math.ceil(startYear / yearStep) * yearStep; yr <= endYear; yr += yearStep) {
    const t = Date.UTC(yr, 0, 1);
    if (t < minT || t > maxT) continue;
    xticks += `<text x="${f(xScale(t))}" y="${plotBottom + 15}" class="tiny" text-anchor="middle">${yr}</text>`;
  }

  // Cumulative stacked tops: stackTops[k] = sum of layers[0..k] at each grid point.
  const stackTops = [];
  const running = grid.map(() => 0);
  for (const layer of layers) {
    for (let gi = 0; gi < grid.length; gi += 1) running[gi] += layer.values[gi];
    stackTops.push(running.slice());
  }

  // Bands painted bottom -> top (disjoint, no overlap).
  let bands = "";
  for (let k = 0; k < layers.length; k += 1) {
    const topPts = toPts(stackTops[k]);
    const botVals = k === 0 ? grid.map(() => 0) : stackTops[k - 1];
    const botPts = toPts(botVals);
    const botRev = [...botPts].reverse();
    const d =
      `M ${f(topPts[0].x)} ${f(topPts[0].y)}` +
      curveCmds(topPts) +
      ` L ${f(botRev[0].x)} ${f(botRev[0].y)}` +
      curveCmds(botRev) +
      " Z";
    bands += `
    <path d="${d}" fill="${layers[k].color}" fill-opacity="${0.32 - k * 0.04}" stroke="none">
      <animate attributeName="fill-opacity" from="0" to="${0.32 - k * 0.04}" dur="1s" begin="${0.15 * k}s" fill="freeze"/>
    </path>
    <path d="M ${f(topPts[0].x)} ${f(topPts[0].y)}${curveCmds(topPts)}" fill="none" stroke="${layers[k].color}" stroke-width="1.6" stroke-linecap="round" stroke-opacity=".95"/>`;
  }

  // Total line (top of the highest band) with a draw-in animation.
  const totalPts = toPts(stackTops[stackTops.length - 1]);
  const totalPath = `M ${f(totalPts[0].x)} ${f(totalPts[0].y)}${curveCmds(totalPts)}`;
  const len = Math.round(plotW * 1.6);
  const totalLine = `
    <path d="${totalPath}" fill="none" stroke="url(#accentTitle)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="${len}" stroke-dashoffset="${len}">
      <animate attributeName="stroke-dashoffset" from="${len}" to="0" dur="1.4s" begin="0.2s" fill="freeze" calcMode="spline" keySplines="0.4 0 0.2 1" keyTimes="0;1" values="${len};0"/>
    </path>
    <circle cx="${f(totalPts[totalPts.length - 1].x)}" cy="${f(totalPts[totalPts.length - 1].y)}" r="3.5" fill="#fff" stroke="url(#accentTitle)" stroke-width="2" opacity="0">
      <animate attributeName="opacity" from="0" to="1" dur=".4s" begin="1.5s" fill="freeze"/>
    </circle>`;

  // Legend.
  const grandTotal = layers.reduce((s, l) => s + l.total, 0);
  let legend = "";
  if (compact) {
    legend = layers
      .map((l, i) => {
        const ly = 24 + i * 15;
        return `
    <circle cx="4" cy="${ly - 3}" r="4" fill="${l.color}"/>
    <text x="14" y="${ly}" class="lang">${escapeXml(l.name)}</text>
    <text x="${width}" y="${ly}" class="langPercent" text-anchor="end">${fmtInt(l.total)}</text>`;
      })
      .join("");
  } else {
    let cursor = 150;
    legend = layers
      .map((l) => {
        const label = `${l.name}  ${fmtInt(l.total)}`;
        const seg = `
    <circle cx="${cursor}" cy="11" r="4" fill="${l.color}"/>
    <text x="${cursor + 11}" y="15" class="lang">${escapeXml(l.name)}</text>
    <text x="${cursor + 13 + l.name.length * 6.6}" y="15" class="langPercent">${fmtInt(l.total)}</text>`;
        cursor += 24 + (label.length) * 6.5;
        return seg;
      })
      .join("");
  }

  return `
  <g transform="translate(${x} ${y})">
    <text x="0" y="16" class="sectionTitle">Star growth</text>
    ${legend}${grids}${xticks}${bands}${totalLine}
  </g>`;
};

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
    </style>
  </defs>`;

const shell = ({ width, height, theme, body, desc }) => `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title desc">
  <title id="title">Xiang An's GitHub dashboard</title>
  <desc id="desc">${escapeXml(desc)}</desc>
  ${defs(theme, width, height)}
  ${body}
</svg>`;

const renderDesktop = ({ stats, languages, stacked, theme }) => {
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

      ${renderStarChart({ stacked, theme, x: 34, y: 332, width: 832, height: 162 })}
    </g>
  `;

  return shell({
    width: 900,
    height: 650,
    theme,
    body,
    desc: `Stars ${stats.stars}, commits ${stats.commits}, rank ${stats.rank}. Combined star history of ${STAR_REPOS.map((r) => r.name).join(", ")}.`,
  });
};

const renderMobile = ({ stats, languages, stacked, theme }) => {
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

      ${renderStarChart({ stacked, theme, x: 28, y: 760, width: 314, height: 220, compact: true })}
    </g>
  `;

  return shell({
    width: 370,
    height: 1150,
    theme,
    body,
    desc: `Mobile GitHub dashboard. Stars ${stats.stars}, commits ${stats.commits}, rank ${stats.rank}.`,
  });
};

const main = async () => {
  const [statsSvg, langsSvg, starSeries] = await Promise.all([
    fetchText(STATS_URL),
    fetchText(LANGS_URL),
    Promise.all(STAR_REPOS.map(fetchStarSeries)),
  ]);
  const stats = parseStats(statsSvg);
  const languages = parseLanguages(langsSvg);
  const stacked = buildStackedSeries(starSeries);
  if (!languages.length) throw new Error("Could not parse languages");
  if (!stacked.layers.length) throw new Error("Could not build star series");

  await mkdir(assetsDir, { recursive: true });
  const outputs = [
    [FILES.dark, renderDesktop({ stats, languages, stacked, theme: THEMES.dark })],
    [FILES.light, renderDesktop({ stats, languages, stacked, theme: THEMES.light })],
    [
      FILES.darkMobile,
      renderMobile({ stats, languages, stacked, theme: THEMES.dark }),
    ],
    [
      FILES.lightMobile,
      renderMobile({ stats, languages, stacked, theme: THEMES.light }),
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
