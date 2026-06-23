import { mkdir, readFile, writeFile } from "node:fs/promises";

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

const USERNAME = "anxiangsir";
const COMMIT_START_YEAR = 2018; // first year of the commit-history line chart
const SCHOLAR_USER = "1ckaPgwAAAAJ"; // Google Scholar profile id

const assetsDir = new URL("../assets/", import.meta.url);
const scholarCacheFile = new URL("../data/scholar-history.json", import.meta.url);

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

// --- Commit history (yearly public commit contributions) --------------------

const ghGraphQL = async (query) => {
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "anxiangsir-dashboard",
    },
    body: JSON.stringify({ query }),
  });
  if (!response.ok) throw new Error(`GraphQL HTTP ${response.status}`);
  const json = await response.json();
  if (json.errors) throw new Error(`GraphQL: ${JSON.stringify(json.errors)}`);
  return json;
};

// Returns [{ label:"2018", value:<commits> }] from COMMIT_START_YEAR to now.
const fetchCommitHistory = async () => {
  const now = new Date();
  const endYear = now.getUTCFullYear();
  const years = [];
  for (let y = COMMIT_START_YEAR; y <= endYear; y += 1) years.push(y);

  const rows = await Promise.all(
    years.map(async (y) => {
      const to = y === endYear ? now.toISOString() : `${y}-12-31T23:59:59Z`;
      const query = `{ user(login:"${USERNAME}"){ contributionsCollection(from:"${y}-01-01T00:00:00Z", to:"${to}"){ totalCommitContributions } } }`;
      const json = await ghGraphQL(query);
      return {
        label: String(y),
        value: json.data.user.contributionsCollection.totalCommitContributions,
      };
    }),
  );
  return rows;
};

// --- Google Scholar citation history ----------------------------------------

// Scrapes the "Cited by year" histogram from the public Scholar profile and
// builds a cumulative series. Falls back to the last committed cache when the
// scrape fails (Scholar frequently blocks datacenter / CI traffic).
const fetchScholarHistory = async () => {
  try {
    const html = await fetchText(
      `https://scholar.google.com/citations?hl=en&user=${SCHOLAR_USER}`,
    );
    const years = [...html.matchAll(/gsc_g_t[^>]*>(\d{4})</g)].map((m) =>
      Number(m[1]),
    );
    const values = [...html.matchAll(/gsc_g_al[^>]*>(\d+)</g)].map((m) =>
      Number(m[1]),
    );
    const total = Number(html.match(/gsc_rsb_std">(\d+)/)?.[1] || 0);
    if (!years.length || years.length !== values.length) {
      throw new Error("Scholar histogram not found");
    }
    const perYear = years.map((year, i) => [year, values[i]]);
    const payload = { fetchedAt: new Date().toISOString(), total, perYear };
    await mkdir(new URL("../data/", import.meta.url), { recursive: true });
    await writeFile(scholarCacheFile, `${JSON.stringify(payload, null, 2)}\n`);
    return payload;
  } catch (error) {
    console.warn(`Scholar fetch failed, using cache: ${error.message}`);
    const cached = JSON.parse(await readFile(scholarCacheFile, "utf8"));
    return cached;
  }
};

// Cumulative citations: [{ label:"2020", value:<cumulative> }].
const scholarCumulative = (perYear) => {
  let running = 0;
  return perYear.map(([year, val]) => {
    running += val;
    return { label: String(year), value: running };
  });
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
  <text x="${x}" y="${y}" class="typing" opacity="${index === 0 ? 1 : 0}">${escapeXml(line)}<tspan dx="2">▌<animate attributeName="fill-opacity" values="1;1;0;0" keyTimes="0;0.49;0.5;1" dur="1.06s" repeatCount="indefinite" calcMode="discrete"/></tspan>
    <animate attributeName="opacity" values="${values}" keyTimes="0;${fade};${Math.max(fade, visibleUntil - fade)};${visibleUntil};1" dur="${cycleSeconds}s" begin="${(index * slotSeconds).toFixed(1)}s" repeatCount="indefinite"/>
    <animateTransform attributeName="transform" type="translate" values="0 4;0 0;0 0;0 -4;0 -4" keyTimes="0;${fade};${Math.max(fade, visibleUntil - fade)};${visibleUntil};1" dur="${cycleSeconds}s" begin="${(index * slotSeconds).toFixed(1)}s" repeatCount="indefinite"/>
  </text>`;
    })
    .join("");
};

// Layered mountain silhouette path closed off the bottom of the hero strip.
const cineRidge = ({ width: W, height: H, anchors, fill, drift, dur }) => {
  const pts = anchors
    .map(([xf, yf], i) => `${i === 0 ? "M" : "L"}${(xf * W).toFixed(0)} ${(yf * H).toFixed(0)}`)
    .join(" ");
  const d = `${pts} L${(1.02 * W).toFixed(0)} ${(1.2 * H).toFixed(0)} L${(-0.02 * W).toFixed(0)} ${(1.2 * H).toFixed(0)} Z`;
  return `<path d="${d}" fill="${fill}"><animateTransform attributeName="transform" type="translate" values="0 0;${drift} 0;0 0" dur="${dur}s" repeatCount="indefinite"/></path>`;
};

// Cinematic sunset hero: sky gradient, sun rising behind layered mountains,
// twinkling stars, a shooting star, drifting birds, light rays, film grain,
// vignette and thin letterbox bars. Replaces the old gradient-wave banner.
// Rendered inside a nested <svg> so overflow is clipped to the strip.
const renderHero = ({ width: W, height: H, compact = false }) => {
  const titleY = compact ? 56 : 64;
  const descY = compact ? 86 : 96;
  const subY = compact ? 111 : 120;
  const cx = (W / 2).toFixed(0);

  const sunR = (H * 0.82).toFixed(0);
  const coreR = (H * 0.22).toFixed(0);

  const stars = [
    [0.13, 0.17, 3], [0.28, 0.29, 2.4], [0.4, 0.13, 3.6],
    [0.71, 0.2, 2.8], [0.86, 0.33, 3.2], [0.93, 0.16, 2.2],
  ]
    .map(
      ([xf, yf, dur], i) =>
        `<circle cx="${(xf * W).toFixed(0)}" cy="${(yf * H).toFixed(0)}" r="${1 + (i % 2) * 0.2}"><animate attributeName="opacity" values="${i % 2 ? "1;.2;1" : ".2;1;.2"}" dur="${dur}s" repeatCount="indefinite"/></circle>`,
    )
    .join("");

  const farAnchors = [
    [-0.02, 0.88], [0.13, 0.72], [0.29, 0.85], [0.47, 0.69],
    [0.62, 0.84], [0.8, 0.71], [1.02, 0.85],
  ];
  const nearAnchors = [
    [-0.02, 0.93], [0.18, 0.79], [0.4, 0.93], [0.58, 0.77],
    [0.8, 0.93], [1.0, 0.8], [1.02, 0.93],
  ];

  const birdSpan = (frac) => (frac * W).toFixed(0);

  return `
  <svg x="0" y="0" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect x="0" y="0" width="${W}" height="${H}" fill="#0b1230"/>
    <rect x="0" y="0" width="${W}" height="${H}" fill="url(#cineSky)"/>
    <g fill="#fff">${stars}</g>
    <g stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity="0">
      <line x1="0" y1="0" x2="34" y2="13"/>
      <animate attributeName="opacity" values="0;0;.9;0;0" keyTimes="0;.55;.62;.7;1" dur="9s" repeatCount="indefinite"/>
      <animateTransform attributeName="transform" type="translate" values="${birdSpan(0.78)} ${(0.1 * H).toFixed(0)};${birdSpan(0.62)} ${(0.42 * H).toFixed(0)}" keyTimes="0;1" dur="9s" repeatCount="indefinite"/>
    </g>
    <circle cx="${cx}" cy="${H}" r="${sunR}" fill="url(#cineSun)">
      <animate attributeName="r" values="${(sunR * 0.94).toFixed(0)};${sunR};${(sunR * 0.94).toFixed(0)}" dur="9s" repeatCount="indefinite"/>
    </circle>
    <circle cx="${cx}" cy="${H}" r="${coreR}" fill="#fff4d6" filter="url(#cineGlow)"/>
    <g opacity=".3" style="mix-blend-mode:screen">
      <polygon points="${cx},${H} ${(W * 0.42).toFixed(0)},${(H * 0.2).toFixed(0)} ${(W * 0.58).toFixed(0)},${(H * 0.2).toFixed(0)}" fill="url(#cineRay)">
        <animateTransform attributeName="transform" type="rotate" values="-5 ${cx} ${H};5 ${cx} ${H};-5 ${cx} ${H}" dur="14s" repeatCount="indefinite"/>
      </polygon>
    </g>
    ${cineRidge({ width: W, height: H, anchors: farAnchors, fill: "url(#cineM1)", drift: 10, dur: 24 })}
    ${cineRidge({ width: W, height: H, anchors: nearAnchors, fill: "url(#cineM2)", drift: 22, dur: 24 })}
    <g fill="none" stroke="#0d0a1a" stroke-width="2" stroke-linecap="round" opacity=".8">
      <g><path d="M0 0 q6 -6 12 0 q6 -6 12 0"/>
        <animateTransform attributeName="transform" type="translate" values="${birdSpan(0.7)} ${(0.37 * H).toFixed(0)};${birdSpan(-0.1)} ${(0.26 * H).toFixed(0)};${birdSpan(-0.1)} ${(0.26 * H).toFixed(0)}" dur="16s" repeatCount="indefinite"/></g>
      <g><path d="M0 0 q6 -6 12 0 q6 -6 12 0" transform="scale(.7)"/>
        <animateTransform attributeName="transform" type="translate" values="${birdSpan(0.9)} ${(0.52 * H).toFixed(0)};${birdSpan(0.18)} ${(0.4 * H).toFixed(0)};${birdSpan(0.18)} ${(0.4 * H).toFixed(0)}" dur="16s" begin="-3s" repeatCount="indefinite"/></g>
    </g>
    <rect x="0" y="0" width="${W}" height="${H}" fill="url(#cineGrade)" style="mix-blend-mode:soft-light"/>
    <rect x="0" y="0" width="${W}" height="${H}" fill="url(#cineVig)"/>
    <g filter="url(#cineText)">
      <text x="${cx}" y="${titleY}" class="${compact ? "heroTitleCompact" : "heroTitle"}" text-anchor="middle">Xiang An</text>
      <text x="${cx}" y="${descY}" class="heroDesc" text-anchor="middle">AI Research / Open Source / Multimodal Systems</text>
      <text x="${cx}" y="${subY}" class="heroMeta" text-anchor="middle">GitHub telemetry, languages, and star growth</text>
    </g>
    <rect x="0" y="0" width="${W}" height="${H}" filter="url(#cineGrain)" opacity=".45" style="mix-blend-mode:overlay"/>
    <rect x="0" y="0" width="${W}" height="4" fill="#000" opacity=".85"/>
    <rect x="0" y="${H - 4}" width="${W}" height="4" fill="#000" opacity=".85"/>
  </svg>`;
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

// A glowing dot that travels along a path on a loop.
const motionDot = (pathD, color, dur, begin) => `
    <circle r="3" fill="#fff" stroke="${color}" stroke-width="1" opacity="0">
      <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.06;0.9;1" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/>
      <animateMotion dur="${dur}s" begin="${begin}s" repeatCount="indefinite" path="${pathD}"/>
    </circle>`;

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
    </circle>
    <circle cx="${f(totalPts[totalPts.length - 1].x)}" cy="${f(totalPts[totalPts.length - 1].y)}" r="3.5" fill="none" stroke="#22c55e" stroke-width="1.5" opacity="0">
      <animate attributeName="r" values="3.5;12" dur="2s" begin="1.7s" repeatCount="indefinite" calcMode="spline" keySplines="0.2 0 0.4 1" keyTimes="0;1"/>
      <animate attributeName="opacity" values=".7;0" dur="2s" begin="1.7s" repeatCount="indefinite"/>
    </circle>${motionDot(totalPath, "#22c55e", 5, 1.8)}`;

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

const niceCeil = (v) => {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
};

// Straight-segment line chart (折线图) with dots, area fill and a value badge.
const renderLineChart = ({
  points,
  theme,
  x,
  y,
  width,
  height,
  color,
  title,
  compact = false,
  delay = 0,
}) => {
  const padL = compact ? 34 : 40;
  const titleH = compact ? 30 : 34;
  const xLabH = 18;
  const plotTop = titleH;
  const plotBottom = height - xLabH;
  const plotH = plotBottom - plotTop;
  const plotW = width - padL;
  const n = points.length;
  const niceMax = niceCeil(Math.max(...points.map((p) => p.value), 1));
  const xAt = (i) => padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yAt = (v) => plotBottom - (v / niceMax) * plotH;

  let grids = "";
  for (const v of [0, niceMax / 2, niceMax]) {
    const gy = f(yAt(v));
    grids += `
    <line x1="${padL}" y1="${gy}" x2="${width}" y2="${gy}" stroke="${theme.track}" stroke-width="1" opacity=".6"/>
    <text x="${padL - 8}" y="${gy + 3}" class="tiny" text-anchor="end">${fmtAxis(Math.round(v))}</text>`;
  }

  const labelStep = n > 8 ? 2 : 1;
  let xticks = "";
  points.forEach((p, i) => {
    if (i % labelStep !== 0 && i !== n - 1) return;
    xticks += `<text x="${f(xAt(i))}" y="${plotBottom + 14}" class="tiny" text-anchor="middle">${escapeXml(p.label)}</text>`;
  });

  const pts = points.map((p, i) => ({ x: xAt(i), y: yAt(p.value) }));
  const linePath = pts
    .map((pt, i) => `${i === 0 ? "M" : "L"} ${f(pt.x)} ${f(pt.y)}`)
    .join(" ");

  const areaD =
    `M ${f(pts[0].x)} ${f(plotBottom)} ` +
    pts.map((pt) => `L ${f(pt.x)} ${f(pt.y)}`).join(" ") +
    ` L ${f(pts[n - 1].x)} ${f(plotBottom)} Z`;
  const areaPath = `<path d="${areaD}" fill="${color}" fill-opacity="0" stroke="none"><animate attributeName="fill-opacity" from="0" to=".14" dur="1s" begin="${(delay + 0.3).toFixed(2)}s" fill="freeze"/></path>`;

  let len = 0;
  for (let i = 1; i < pts.length; i += 1) {
    len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  len = Math.round(len);
  const line = `<path d="${linePath}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="${len}" stroke-dashoffset="${len}"><animate attributeName="stroke-dashoffset" from="${len}" to="0" dur="1.3s" begin="${(delay + 0.25).toFixed(2)}s" fill="freeze" calcMode="spline" keySplines="0.4 0 0.2 1" keyTimes="0;1" values="${len};0"/></path>`;

  const dots = pts
    .map((pt, i) => {
      const isLast = i === n - 1;
      return `<circle cx="${f(pt.x)}" cy="${f(pt.y)}" r="${isLast ? 3.5 : 2.4}" fill="${isLast ? "#fff" : color}" stroke="${color}" stroke-width="${isLast ? 2 : 1}" opacity="0"><animate attributeName="opacity" from="0" to="1" dur=".3s" begin="${(delay + 0.4 + i * 0.04).toFixed(2)}s" fill="freeze"/></circle>`;
    })
    .join("");

  // Radar pulse at the latest data point.
  const end = pts[n - 1];
  const pulseBegin = (delay + 1.6).toFixed(2);
  const pulse = `<circle cx="${f(end.x)}" cy="${f(end.y)}" r="3.5" fill="none" stroke="${color}" stroke-width="1.5" opacity="0">
    <animate attributeName="r" values="3.5;11" dur="1.9s" begin="${pulseBegin}s" repeatCount="indefinite" calcMode="spline" keySplines="0.2 0 0.4 1" keyTimes="0;1"/>
    <animate attributeName="opacity" values=".75;0" dur="1.9s" begin="${pulseBegin}s" repeatCount="indefinite"/>
  </circle>`;

  const labelAnchor = end.x > width - 40 ? "end" : "middle";
  const lastVal = `<text x="${f(end.x)}" y="${f(end.y) - 9}" class="lang" text-anchor="${labelAnchor}" fill="${color}" opacity="0">${fmtInt(points[n - 1].value)}<animate attributeName="opacity" from="0" to="1" dur=".4s" begin="${(delay + 1.4).toFixed(2)}s" fill="freeze"/></text>`;

  return `
  <g transform="translate(${x} ${y})">
    <text x="0" y="16" class="sectionTitle">${escapeXml(title)}</text>
    ${grids}${xticks}${areaPath}${line}${dots}${motionDot(linePath, color, 4.5, delay + 1.6)}${pulse}${lastVal}
  </g>`;
};

const defs = (theme, width, height) => `
  <defs>
    <linearGradient id="heroGradient" x1="0" y1="0" x2="${width}" y2="0" gradientUnits="userSpaceOnUse" spreadMethod="repeat">
      <stop offset="0" stop-color="#06b6d4"/>
      <stop offset=".33" stop-color="#8b5cf6"/>
      <stop offset=".66" stop-color="#22c55e"/>
      <stop offset="1" stop-color="#06b6d4"/>
      <animateTransform attributeName="gradientTransform" type="translate" values="0 0;${width} 0" dur="9s" repeatCount="indefinite"/>
    </linearGradient>
    <linearGradient id="accentTitle" x1="0" y1="0" x2="${width}" y2="0" gradientUnits="userSpaceOnUse" spreadMethod="repeat">
      <stop offset="0" stop-color="#06b6d4"/>
      <stop offset=".33" stop-color="#8b5cf6"/>
      <stop offset=".66" stop-color="#22c55e"/>
      <stop offset="1" stop-color="#06b6d4"/>
      <animateTransform attributeName="gradientTransform" type="translate" values="0 0;${width} 0" dur="7s" repeatCount="indefinite"/>
    </linearGradient>
    <linearGradient id="cineSky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0b1230"/>
      <stop offset="40%" stop-color="#3a2a5c"/>
      <stop offset="70%" stop-color="#9c3f5e"/>
      <stop offset="90%" stop-color="#e0683f"/>
      <stop offset="100%" stop-color="#f7b15c"/>
    </linearGradient>
    <radialGradient id="cineSun" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#fff8e6"/>
      <stop offset="34%" stop-color="#ffd98a"/>
      <stop offset="100%" stop-color="#ffb24d" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="cineRay" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffe7b0" stop-opacity=".4"/>
      <stop offset="100%" stop-color="#ffe7b0" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="cineM1" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#3a2f55"/><stop offset="100%" stop-color="#241a3a"/>
    </linearGradient>
    <linearGradient id="cineM2" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#1d1730"/><stop offset="100%" stop-color="#0c0a1a"/>
    </linearGradient>
    <linearGradient id="cineGrade" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#ff7828" stop-opacity=".22"/>
      <stop offset="100%" stop-color="#142878" stop-opacity=".30"/>
    </linearGradient>
    <radialGradient id="cineVig" cx="50%" cy="42%" r="75%">
      <stop offset="55%" stop-color="#000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000" stop-opacity=".55"/>
    </radialGradient>
    <filter id="cineGrain">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" stitchTiles="stitch" result="n">
        <animate attributeName="seed" values="1;9;3;7;2;8;4" dur="0.5s" repeatCount="indefinite"/>
      </feTurbulence>
      <feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .5 0"/>
      <feComposite operator="in" in2="SourceGraphic"/>
    </filter>
    <filter id="cineGlow" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="5" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="cineText" x="-30%" y="-80%" width="160%" height="260%">
      <feDropShadow dx="0" dy="1" stdDeviation="2.5" flood-color="#1a0a26" flood-opacity="0.85"/>
    </filter>
    <style>
      .heroTitle{font:900 47px Inter,Segoe UI,Arial,sans-serif;fill:#ffffff;letter-spacing:0}
      .heroTitleCompact{font:900 36px Inter,Segoe UI,Arial,sans-serif;fill:#ffffff;letter-spacing:0}
      .heroDesc{font:800 15px Inter,Segoe UI,Arial,sans-serif;fill:#fde7d6;letter-spacing:0}
      .heroMeta{font:700 11px Inter,Segoe UI,Arial,sans-serif;fill:#ffe6c4;letter-spacing:.08em;text-transform:uppercase}
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

const renderDesktop = ({ stats, languages, stacked, commits, citations, theme }) => {
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
      ${renderLineChart({ points: commits, theme, x: 34, y: 514, width: 832, height: 158, color: "#a78bfa", title: "Commits per year", delay: 0.6 })}
      ${renderLineChart({ points: citations, theme, x: 34, y: 690, width: 832, height: 158, color: "#fbbf24", title: "Scholar citations", delay: 1.1 })}
    </g>
  `;

  return shell({
    width: 900,
    height: 1010,
    theme,
    body,
    desc: `Stars ${stats.stars}, commits ${stats.commits}, rank ${stats.rank}. Combined star history of ${STAR_REPOS.map((r) => r.name).join(", ")}.`,
  });
};

const renderMobile = ({ stats, languages, stacked, commits, citations, theme }) => {
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
      ${renderLineChart({ points: commits, theme, x: 28, y: 1000, width: 314, height: 185, color: "#a78bfa", title: "Commits per year", compact: true, delay: 0.6 })}
      ${renderLineChart({ points: citations, theme, x: 28, y: 1205, width: 314, height: 185, color: "#fbbf24", title: "Scholar citations", compact: true, delay: 1.1 })}
    </g>
  `;

  return shell({
    width: 370,
    height: 1560,
    theme,
    body,
    desc: `Mobile GitHub dashboard. Stars ${stats.stars}, commits ${stats.commits}, rank ${stats.rank}.`,
  });
};

const main = async () => {
  const [statsSvg, langsSvg, starSeries, commits, scholar] = await Promise.all([
    fetchText(STATS_URL),
    fetchText(LANGS_URL),
    Promise.all(STAR_REPOS.map(fetchStarSeries)),
    fetchCommitHistory(),
    fetchScholarHistory(),
  ]);
  const stats = parseStats(statsSvg);
  const languages = parseLanguages(langsSvg);
  const stacked = buildStackedSeries(starSeries);
  const citations = scholarCumulative(scholar.perYear);
  if (!languages.length) throw new Error("Could not parse languages");
  if (!stacked.layers.length) throw new Error("Could not build star series");
  if (!commits.length) throw new Error("Could not build commit history");
  if (!citations.length) throw new Error("Could not build citation history");

  await mkdir(assetsDir, { recursive: true });
  const outputs = [
    [FILES.dark, renderDesktop({ stats, languages, stacked, commits, citations, theme: THEMES.dark })],
    [FILES.light, renderDesktop({ stats, languages, stacked, commits, citations, theme: THEMES.light })],
    [
      FILES.darkMobile,
      renderMobile({ stats, languages, stacked, commits, citations, theme: THEMES.dark }),
    ],
    [
      FILES.lightMobile,
      renderMobile({ stats, languages, stacked, commits, citations, theme: THEMES.light }),
    ],
  ];

  for (const [file, svg] of outputs) {
    const outFile = new URL(`../assets/${file}`, import.meta.url);
    await writeFile(outFile, svg);
    console.log(`Wrote ${outFile.pathname}`);
  }
};

const invokedDirectly =
  process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export { renderHero, defs, shell, THEMES };
