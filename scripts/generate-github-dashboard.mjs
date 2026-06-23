import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";

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
  darkCinematic: "github-dashboard-cinematic-dark.svg",
  lightCinematic: "github-dashboard-cinematic-light.svg",
  darkMobileCinematic: "github-dashboard-cinematic-dark-mobile.svg",
  lightMobileCinematic: "github-dashboard-cinematic-light-mobile.svg",
};

const DESKTOP_HERO_HEIGHT = 150;
const MOBILE_HERO_HEIGHT = 154;
const DESKTOP_HEIGHT = 1010;
const MOBILE_HEIGHT = 1560;
const filmFile = new URL("../svg-cinematic.svg", import.meta.url);

const setActionOutput = async (name, value) => {
  if (!process.env.GITHUB_OUTPUT) return;
  await appendFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
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

// Cumulative citations interpolated to monthly resolution (approximation:
// each year's increment is spread evenly across that year's months; the
// current, partial year only spans the elapsed months). Yields
// [{ label, value }] with year labels on January and "" elsewhere.
const scholarMonthly = (perYear, fetchedAt) => {
  const now = fetchedAt ? new Date(fetchedAt) : new Date();
  const curYear = now.getUTCFullYear();
  const points = [];
  let cum = 0;
  for (const [year, val] of perYear) {
    const months = year >= curYear ? Math.max(1, now.getUTCMonth() + 1) : 12;
    for (let m = 1; m <= months; m += 1) {
      points.push({
        label: m === 1 ? String(year) : "",
        value: cum + (val * m) / months,
      });
    }
    cum += val;
  }
  return points;
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

  // Monthly series carry blank labels between Januaries; render only the
  // year markers and a single end dot so the dense curve stays clean.
  const sparse = points.some((p) => p.label === "");
  const labelStep = n > 8 ? 2 : 1;
  let xticks = "";
  points.forEach((p, i) => {
    if (sparse) {
      if (!p.label) return;
    } else if (i % labelStep !== 0 && i !== n - 1) {
      return;
    }
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
      if (sparse && !isLast) return "";
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

const FILM_FONT = "-apple-system, 'PingFang SC', system-ui, sans-serif";

// --- Cinematic film banner (randomized style per run) ------------------------

const FILM_STYLES = [
  "sunset",
  "cyberpunk",
  "startrail",
  "silent",
  "zelda",
  "caribbean-pirates",
  "dwarf-rabbit",
  "super-mario-bros",
  "lanzhou-noodles",
  "red-dead-2",
];

const FILM_PALETTES = {
  sunset: {
    sky: ["#0a1130", "#2c2154", "#7a3a64", "#c2593f", "#ec8a47", "#f9c06a"],
    m1: ["#3e3258", "#251b3c"], m2: ["#201a34", "#0c0a1c"],
    water: ["#eda165", "#824064", "#080814"],
    orb: ["#fff9ea", "#ffdc8e", "#ffb24d"], core: "#fff4d6",
    accent: "#ffd9a0", fg: "#05050e", bird: "#0d0a1a",
    grade: ["#ff7828", "#142878"], sub: "SUNSET · PURE SVG",
  },
  cyberpunk: {
    sky: ["#05021a", "#11013a", "#3a0a5e", "#7a1466", "#c81e7a"],
    m1: ["#240a44", "#100428"], m2: ["#15052e", "#070214"],
    water: ["#c81e7a", "#3a0a5e", "#03010d"],
    orb: ["#ffe9fb", "#ff5ce0", "#00eaff"], core: "#ff8cf0",
    accent: "#00eaff", fg: "#02010a", bird: "#00141d",
    grade: ["#ff14c6", "#00b3ff"], sub: "CYBERPUNK · PURE SVG",
  },
  startrail: {
    sky: ["#02040f", "#04102e", "#0a2a4e", "#16456e"],
    m1: ["#cfe0f0", "#8fa6c4"], m2: ["#86a0c0", "#42597c"],
    water: ["#16456e", "#0a2238", "#02060f"],
    orb: ["#ffffff", "#dfeaff", "#9fc0e8"], core: "#eef4ff",
    accent: "#cfe6ff", fg: "#0a1424", bird: "#0a1424",
    grade: ["#3a6ea5", "#0a1a3a"], sub: "STAR TRAILS · PURE SVG",
  },
  silent: {
    sky: ["#161616", "#333333", "#555555", "#777777", "#999999"],
    m1: ["#2a2a2a", "#141414"], m2: ["#181818", "#070707"],
    water: ["#8a8a8a", "#3a3a3a", "#050505"],
    orb: ["#ffffff", "#dcdcdc", "#9a9a9a"], core: "#ffffff",
    accent: "#f0f0f0", fg: "#000000", bird: "#0a0a0a",
    grade: ["#888888", "#222222"], sub: "SILENT FILM · PURE SVG",
  },
  zelda: {
    sky: ["#05150d", "#0b2d1a", "#1d5733", "#6c8f3a", "#e3c46b"],
    m1: ["#2f6338", "#15311f"], m2: ["#173c22", "#06150d"],
    water: ["#2f7b4d", "#0e3a27", "#04100b"],
    orb: ["#fff7c8", "#ffd66c", "#70d66a"], core: "#fff4bc",
    accent: "#ffd45a", fg: "#06130b", bird: "#082114",
    grade: ["#f0c94e", "#0d6b48"], sub: "HYRULE FOREST · PURE SVG",
  },
  "caribbean-pirates": {
    sky: ["#03101c", "#062a43", "#0b5a78", "#cf6c3e", "#f0b15f"],
    m1: ["#17516a", "#092b3b"], m2: ["#092f3f", "#031018"],
    water: ["#11a5a5", "#06606d", "#02131d"],
    orb: ["#fff0ce", "#ffc56e", "#ff8a3c"], core: "#fff5d8",
    accent: "#ffd37a", fg: "#02080c", bird: "#031018",
    grade: ["#ff9d4d", "#034d68"], sub: "CARIBBEAN PIRATES · PURE SVG",
  },
  "dwarf-rabbit": {
    sky: ["#101b2f", "#243d5b", "#5b7fa6", "#d8b2c5", "#ffe0b2"],
    m1: ["#8ebf85", "#4f8553"], m2: ["#4d7c45", "#17351f"],
    water: ["#8dcf7e", "#4f9b56", "#15391f"],
    orb: ["#ffffff", "#ffe8f1", "#d7e8ff"], core: "#fff8fb",
    accent: "#ffb7d5", fg: "#112016", bird: "#16261c",
    grade: ["#ffbfd6", "#4ea96a"], sub: "DWARF RABBIT MEADOW · PURE SVG",
  },
  "super-mario-bros": {
    sky: ["#58b7ff", "#6dccff", "#ffe08a", "#f49a45"],
    m1: ["#6ccf52", "#2c7f3a"], m2: ["#2fa44f", "#0b4a2a"],
    water: ["#7bd94c", "#3ca43e", "#145024"],
    orb: ["#fff9b0", "#ffd43b", "#ff8c26"], core: "#fff6a8",
    accent: "#ffd928", fg: "#142312", bird: "#102b1c",
    grade: ["#ffce2e", "#1788df"], sub: "PLATFORM WORLD · PURE SVG",
  },
  "lanzhou-noodles": {
    sky: ["#2b0f08", "#5d1f0e", "#a64018", "#e39036", "#f8d69a"],
    m1: ["#8b3d1b", "#4a1a0c"], m2: ["#54200e", "#170704"],
    water: ["#f2c36b", "#b95a24", "#240a04"],
    orb: ["#fff6dc", "#ffd27d", "#ff7b2e"], core: "#fff4d2",
    accent: "#facc15", fg: "#170704", bird: "#241008",
    grade: ["#ffb84a", "#9c1d0b"], sub: "LANZHOU NOODLES · PURE SVG",
  },
  "red-dead-2": {
    sky: ["#120807", "#4a1512", "#8b2e1d", "#cb6a2b", "#f6b763"],
    m1: ["#9a4c25", "#54200f"], m2: ["#5b2110", "#160706"],
    water: ["#a74421", "#5d1f10", "#120604"],
    orb: ["#fff0c2", "#ffbd5a", "#b92d18"], core: "#ffe9b5",
    accent: "#ffcf6a", fg: "#100504", bird: "#180806",
    grade: ["#ff6a2a", "#3f0c0a"], sub: "WESTERN FRONTIER · PURE SVG",
  },
};

const filmStops = (colors) =>
  colors
    .map((c, i) => `<stop offset="${Math.round((i / (colors.length - 1)) * 100)}%" stop-color="${c}"/>`)
    .join("");

const filmStars = () =>
  [[120, 70, 3], [240, 120, 2.4], [330, 60, 3.6], [620, 80, 2.8], [760, 140, 3.2], [850, 64, 2.2], [500, 50, 3], [180, 150, 2.6], [690, 44, 3.4]]
    .map(([x, y, d], i) => `<circle cx="${x}" cy="${y}" r="${1 + (i % 2) * 0.3}"><animate attributeName="opacity" values="${i % 2 ? "1;.2;1" : ".2;1;.2"}" dur="${d}s" repeatCount="indefinite"/></circle>`)
    .join("");

// Lone bare tree silhouette framing the left edge; sways gently in the wind.
const filmTree = (fg) => `
  <g fill="none" stroke="${fg}" stroke-linecap="round">
    <animateTransform attributeName="transform" type="rotate" values="-1 96 540;1.4 96 540;-1 96 540" dur="9s" repeatCount="indefinite"/>
    <path stroke-width="11" d="M96 542 C94 472 90 420 98 372"/>
    <path stroke-width="6" d="M98 372 C86 352 70 344 52 340 M98 372 C112 350 130 342 150 340 M96 396 C82 386 68 384 54 384 M98 416 C114 408 130 408 146 406"/>
    <path stroke-width="3" d="M52 340 C44 332 38 324 32 312 M150 340 C160 332 166 322 172 310 M54 384 C46 380 40 374 36 364 M146 406 C156 402 164 396 170 386 M98 352 C100 340 104 330 110 320"/>
  </g>`;

// Distant sailboat drifting across the water with a faint reflection.
const filmBoat = (fg) => `
  <g fill="${fg}">
    <g>
      <animateTransform attributeName="transform" type="translate" values="300 392;640 386;300 392" dur="48s" repeatCount="indefinite"/>
      <g>
        <animateTransform attributeName="transform" type="translate" values="0 0;0 1.5;0 0" dur="4s" repeatCount="indefinite"/>
        <path d="M-16 0 L16 0 L11 7 L-11 7 Z"/>
        <rect x="-0.8" y="-21" width="1.6" height="21"/>
        <path d="M1 -21 L1 -2 L15 -4 Z"/>
        <path d="M-1 -17 L-1 -3 L-11 -4 Z"/>
        <path d="M-14 11 L14 11 L9 15 L-9 15 Z" opacity=".22"/>
      </g>
    </g>
  </g>`;

// A V-formation flock crossing the sky.
const filmFlock = (bird) => {
  const wing = `M0 0 q5 -5 10 0 q5 -5 10 0`;
  const members = [[0, 0], [-15, 7], [15, 7], [-30, 14], [30, 14], [-45, 21], [45, 21]]
    .map(([dx, dy], i) => `<path transform="translate(${dx} ${dy}) scale(${(0.95 - i * 0.03).toFixed(2)})" d="${wing}"/>`)
    .join("");
  return `
  <g fill="none" stroke="${bird}" stroke-width="2" stroke-linecap="round" opacity=".85">
    <g>${members}
      <animateTransform attributeName="transform" type="translate" values="1000 96;-160 150;-160 150" keyTimes="0;.85;1" dur="26s" repeatCount="indefinite"/>
    </g>
  </g>`;
};

const filmStarTrails = (color) => {
  let arcs = "";
  for (let r = 48; r <= 320; r += 24) {
    const circ = 2 * Math.PI * r;
    arcs += `<circle cx="740" cy="108" r="${r}" fill="none" stroke="${color}" stroke-width="1.1" stroke-opacity="${(0.5 - r / 820).toFixed(2)}" stroke-dasharray="${(circ * 0.16).toFixed(0)} ${(circ * 0.84).toFixed(0)}" stroke-dashoffset="${Math.round(r * 4) % Math.round(circ)}"/>`;
  }
  return `<g style="mix-blend-mode:screen"><g>${arcs}<animateTransform attributeName="transform" type="rotate" values="0 740 108;9 740 108" dur="70s" repeatCount="indefinite"/></g></g>`;
};

const filmGrid = (color) => {
  let s = "";
  for (let i = 1; i <= 7; i += 1) {
    const y = (372 + (i / 7) ** 2 * 168).toFixed(0);
    s += `<line x1="0" y1="${y}" x2="960" y2="${y}" stroke="${color}" stroke-width="1" stroke-opacity="${(0.45 * (1 - i / 9)).toFixed(2)}"/>`;
  }
  for (let x = -720; x <= 1680; x += 120) {
    s += `<line x1="480" y1="372" x2="${x}" y2="540" stroke="${color}" stroke-width="1" stroke-opacity=".22"/>`;
  }
  return `<g style="mix-blend-mode:screen" filter="url(#glow)">${s}</g>`;
};

const filmRain = (color) =>
  `<g style="mix-blend-mode:screen">` +
  [60, 150, 230, 320, 410, 520, 610, 700, 790, 880]
    .map((x, i) => `<line x1="${x}" y1="0" x2="${x - 16}" y2="46" stroke="${color}" stroke-width="1.4" stroke-linecap="round" opacity=".5"><animateTransform attributeName="transform" type="translate" values="0 -60;0 600" dur="${(1.1 + (i % 4) * 0.3).toFixed(1)}s" begin="-${(i * 0.27).toFixed(2)}s" repeatCount="indefinite"/></line>`)
    .join("") +
  `</g>`;

const filmSnow = () =>
  `<g fill="#ffffff" style="mix-blend-mode:screen">` +
  [80, 200, 300, 420, 540, 640, 760, 860, 160, 700]
    .map((x, i) => `<circle cx="${x}" cy="0" r="${(1.4 + (i % 3) * 0.5).toFixed(1)}" opacity=".7"><animate attributeName="cy" values="-20;560" dur="${(8 + (i % 4) * 2)}s" begin="-${(i * 0.9).toFixed(1)}s" repeatCount="indefinite"/><animate attributeName="cx" values="${x};${x + 18};${x}" dur="${5 + (i % 3)}s" repeatCount="indefinite"/></circle>`)
    .join("") +
  `</g>`;

const filmEmbers = () =>
  `<g style="mix-blend-mode:screen">` +
  [[300, 11, 0], [640, 13, -4], [470, 14, -8], [800, 12, -6], [180, 13.5, -2]]
    .map(([x, dur, begin], i) => `<circle cx="${x}" cy="520" r="${(1.8 + (i % 3) * 0.3).toFixed(1)}" fill="url(#ember)"><animate attributeName="cy" values="520;${180 + i * 12}" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/><animate attributeName="opacity" values="0;1;1;0" keyTimes="0;.1;.8;1" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/><animate attributeName="cx" values="${x};${x + 18};${x}" dur="${5 + (i % 3)}s" repeatCount="indefinite"/></circle>`)
    .join("") +
  `</g>`;

const filmScratches = () =>
  `<g stroke="#fff" style="mix-blend-mode:overlay">` +
  [[210, 0.6, 2.3], [620, 0.5, 3.1], [810, 0.7, 1.9]]
    .map(([x, op, dur]) => `<line x1="${x}" y1="0" x2="${x}" y2="540" stroke-width="1" opacity="0"><animate attributeName="opacity" values="0;${op};0;0" keyTimes="0;.04;.1;1" dur="${dur}s" repeatCount="indefinite"/><animate attributeName="x1" values="${x};${x + 6};${x - 4}" dur="${dur}s" repeatCount="indefinite"/><animate attributeName="x2" values="${x};${x + 6};${x - 4}" dur="${dur}s" repeatCount="indefinite"/></line>`)
    .join("") +
  `</g>`;

const filmRunes = (accent) => `
  <g fill="none" stroke="${accent}" stroke-linejoin="round" stroke-linecap="round" opacity=".76" filter="url(#glow)" style="mix-blend-mode:screen">
    <g transform="translate(744 162)">
      <path d="M0 -52 L45 26 L-45 26 Z"/>
      <path d="M0 -26 L22 13 L-22 13 Z"/>
      <path d="M-45 26 H45 M-22 13 H22"/>
      <animateTransform attributeName="transform" type="rotate" values="-3 0 0;3 0 0;-3 0 0" dur="9s" repeatCount="indefinite" additive="sum"/>
    </g>
    <circle cx="196" cy="178" r="20"/>
    <path d="M196 150 V206 M168 178 H224 M182 164 L210 192 M210 164 L182 192"/>
  </g>`;

const filmPirateShip = (fg, accent) => `
  <g transform="translate(650 350)" fill="${fg}" stroke="${fg}" stroke-linecap="round" stroke-linejoin="round">
    <animateTransform attributeName="transform" type="translate" values="650 350;618 344;650 350" dur="18s" repeatCount="indefinite"/>
    <path d="M-98 22 C-68 48 52 50 98 22 L72 58 C25 72 -40 70 -80 56 Z"/>
    <path d="M-78 22 C-30 34 30 34 80 22" fill="none" stroke-width="4"/>
    <rect x="-4" y="-122" width="8" height="148"/>
    <rect x="-62" y="-76" width="5" height="92"/>
    <path d="M4 -118 C54 -98 76 -58 8 -48 Z" fill="${accent}" opacity=".7"/>
    <path d="M-8 -92 C-50 -78 -70 -44 -10 -38 Z" fill="${accent}" opacity=".55"/>
    <path d="M4 -42 C48 -34 68 -8 8 4 Z" fill="${accent}" opacity=".38"/>
    <path d="M-92 30 L-124 42" stroke-width="5"/>
    <circle cx="-28" cy="42" r="4" fill="#000" opacity=".55"/>
    <circle cx="20" cy="44" r="4" fill="#000" opacity=".55"/>
  </g>`;

const filmRabbit = (fg, accent) => `
  <g transform="translate(732 402)" fill="${fg}" stroke="${fg}" stroke-linecap="round" stroke-linejoin="round">
    <animateTransform attributeName="transform" type="translate" values="732 402;744 392;732 402" dur="6s" repeatCount="indefinite"/>
    <ellipse cx="0" cy="34" rx="62" ry="35"/>
    <circle cx="52" cy="12" r="26"/>
    <ellipse cx="48" cy="-34" rx="10" ry="42" transform="rotate(-8 48 -34)"/>
    <ellipse cx="70" cy="-30" rx="9" ry="38" transform="rotate(18 70 -30)"/>
    <circle cx="78" cy="8" r="3" fill="${accent}"/>
    <circle cx="-54" cy="24" r="12" fill="#fff" opacity=".72"/>
    <path d="M42 22 C28 31 10 32 -5 27" fill="none" stroke-width="5"/>
  </g>
  <g fill="${accent}" opacity=".8" style="mix-blend-mode:screen">
    ${[130, 180, 235, 806, 852, 894]
      .map((x, i) => `<path d="M${x} 414 C${x - 8} 388 ${x + 8} 388 ${x} 414 C${x + 14} 394 ${x + 30} 406 ${x} 414 Z"><animateTransform attributeName="transform" type="translate" values="0 0;0 -6;0 0" dur="${4 + i * 0.4}s" repeatCount="indefinite"/></path>`)
      .join("")}
  </g>`;

const filmPlatformWorld = (fg, accent) => {
  const blocks = [[110, 312], [158, 312], [206, 312], [640, 262], [688, 262], [736, 262], [784, 262]]
    .map(([x, y], i) => `<g transform="translate(${x} ${y})"><rect x="0" y="0" width="42" height="42" rx="5" fill="${i % 3 === 1 ? accent : "#c56d2c"}" stroke="${fg}" stroke-width="3"/><circle cx="12" cy="12" r="3" fill="${fg}" opacity=".45"/><circle cx="30" cy="30" r="3" fill="${fg}" opacity=".45"/></g>`)
    .join("");
  return `
  <g>${blocks}</g>
  <g transform="translate(496 332)" fill="${fg}" filter="url(#glow)">
    <animateTransform attributeName="transform" type="translate" values="496 332;496 292;496 332" dur="3.8s" repeatCount="indefinite"/>
    <circle cx="0" cy="0" r="20" fill="${accent}"/>
    <circle cx="-7" cy="-5" r="5" fill="#fff" opacity=".8"/>
    <circle cx="7" cy="-5" r="5" fill="#fff" opacity=".8"/>
  </g>
  <g fill="${fg}">
    <rect x="90" y="390" width="92" height="120" rx="6"/>
    <rect x="108" y="350" width="56" height="50" rx="8"/>
    <rect x="778" y="372" width="86" height="142" rx="6"/>
    <rect x="792" y="330" width="58" height="52" rx="8"/>
  </g>`;
};

const filmNoodleBowl = (fg, accent) => `
  <g transform="translate(484 382)">
    <g stroke="${accent}" stroke-width="5" stroke-linecap="round" opacity=".75" filter="url(#glow)" style="mix-blend-mode:screen">
      ${[-46, -16, 16, 46].map((x, i) => `<path d="M${x} -82 C${x - 22} -118 ${x + 22} -134 ${x} -174"><animate attributeName="d" values="M${x} -82 C${x - 22} -118 ${x + 22} -134 ${x} -174;M${x} -82 C${x + 20} -118 ${x - 20} -134 ${x} -174;M${x} -82 C${x - 22} -118 ${x + 22} -134 ${x} -174" dur="${5 + i}s" repeatCount="indefinite"/></path>`).join("")}
    </g>
    <g fill="${fg}">
      <ellipse cx="0" cy="4" rx="180" ry="46"/>
      <path d="M-160 0 C-130 96 130 96 160 0 Z"/>
      <ellipse cx="0" cy="-5" rx="150" ry="30" fill="${accent}" opacity=".86"/>
      <path d="M-96 -12 C-58 12 -20 -34 20 -6 C58 20 90 -18 126 2" fill="none" stroke="#fff2c7" stroke-width="9" stroke-linecap="round" opacity=".8"/>
      <circle cx="-62" cy="-18" r="12" fill="#3aa657"/>
      <circle cx="82" cy="-8" r="10" fill="#e24d2b"/>
      <path d="M-146 -96 L152 -30" stroke="${fg}" stroke-width="8" stroke-linecap="round"/>
      <path d="M-120 -110 L172 -46" stroke="${fg}" stroke-width="8" stroke-linecap="round"/>
    </g>
  </g>`;

const filmWesternRider = (fg, accent) => `
  <g transform="translate(680 364)" fill="${fg}" stroke="${fg}" stroke-linecap="round" stroke-linejoin="round">
    <animateTransform attributeName="transform" type="translate" values="680 364;632 360;680 364" dur="16s" repeatCount="indefinite"/>
    <ellipse cx="-8" cy="38" rx="78" ry="24"/>
    <path d="M54 22 C82 16 112 28 120 48 C95 45 72 42 52 40 Z"/>
    <circle cx="116" cy="28" r="13"/>
    <path d="M-62 54 L-90 92 M-26 58 L-36 98 M28 58 L18 98 M62 52 L88 90" stroke-width="9"/>
    <path d="M-20 8 L8 -42 L32 8 Z"/>
    <circle cx="9" cy="-60" r="14"/>
    <path d="M-22 -68 H42 M-12 -82 C6 -74 24 -74 40 -82" fill="none" stroke-width="7"/>
    <path d="M18 -38 L52 -12" fill="none" stroke-width="8"/>
    <path d="M-92 92 C-40 78 46 78 104 92" fill="none" stroke="${accent}" stroke-width="3" opacity=".7"/>
  </g>
  <g fill="${fg}" opacity=".85">
    <path d="M178 365 c22 -58 40 -58 62 0 c-18 -8 -44 -8 -62 0 Z"/>
    <rect x="205" y="310" width="8" height="76" rx="4"/>
    <path d="M122 388 c18 -42 31 -42 48 0 c-14 -6 -34 -6 -48 0 Z"/>
    <rect x="142" y="334" width="7" height="64" rx="4"/>
  </g>`;

const renderFilm = (style) => {
  const p = FILM_PALETTES[style] || FILM_PALETTES.sunset;
  const warm = style === "sunset";
  const neon = style === "cyberpunk";
  const trails = style === "startrail";
  const silent = style === "silent";
  const zelda = style === "zelda";
  const pirates = style === "caribbean-pirates";
  const rabbit = style === "dwarf-rabbit";
  const mario = style === "super-mario-bros";
  const noodles = style === "lanzhou-noodles";
  const western = style === "red-dead-2";
  const highOrb = trails || zelda || pirates;
  // Celestial body sits at the horizon for most styles, higher for moon/forest scenes.
  const orbY = highOrb ? 150 : 300;
  const reflectY = highOrb ? 280 : 430;

  const back = trails ? filmStarTrails(p.accent) : zelda ? filmRunes(p.accent) : "";
  const frontParticles = warm
    ? filmEmbers()
    : neon
      ? filmRain(p.accent)
      : trails
        ? filmSnow()
        : rabbit
          ? filmSnow()
          : noodles || western
            ? filmEmbers()
            : "";
  const rays = warm || neon || zelda || noodles || western
    ? `<g opacity=".4" filter="url(#soft)" style="mix-blend-mode:screen">
        <polygon points="480,${orbY} 350,${orbY + 140} 610,${orbY + 140}" fill="url(#ray)"><animateTransform attributeName="transform" type="rotate" values="-6 480 ${orbY};6 480 ${orbY};-6 480 ${orbY}" dur="15s" repeatCount="indefinite"/></polygon>
        <polygon points="480,${orbY} 430,${orbY + 140} 530,${orbY + 140}" fill="url(#ray)"><animateTransform attributeName="transform" type="rotate" values="5 480 ${orbY};-5 480 ${orbY};5 480 ${orbY}" dur="11s" repeatCount="indefinite"/></polygon>
      </g>`
    : "";
  const flare = warm || neon || western
    ? `<g style="mix-blend-mode:screen">
        <rect x="120" y="${orbY - 4}" width="720" height="6" rx="3" fill="url(#flareStreak)" filter="url(#soft)"><animate attributeName="opacity" values=".5;.9;.5" dur="6s" repeatCount="indefinite"/></rect>
        <circle cx="600" cy="${orbY - 60}" r="24" fill="url(#flareOrb)" opacity=".55"/>
        <circle cx="380" cy="${orbY + 60}" r="18" fill="url(#flareOrb)" opacity=".4"/>
      </g>`
    : "";
  const neonRim = neon
    ? `<path d="M-80 372 L160 320 L380 372 L560 318 L760 372 L980 326 L1040 372" fill="none" stroke="${p.accent}" stroke-width="1.6" stroke-opacity=".9" filter="url(#glow)"/>`
    : "";
  const grid = neon || mario ? filmGrid(p.accent) : "";
  const leak = warm || neon || noodles
    ? `<ellipse cx="0" cy="160" rx="320" ry="200" fill="url(#leak)" style="mix-blend-mode:screen"><animate attributeName="cx" values="-200;1160;-200" dur="15s" repeatCount="indefinite"/></ellipse>`
    : "";
  const themeProp = pirates
    ? filmPirateShip(p.fg, p.accent)
    : rabbit
      ? filmRabbit(p.fg, p.accent)
      : mario
        ? filmPlatformWorld(p.fg, p.accent)
        : noodles
          ? filmNoodleBowl(p.fg, p.accent)
          : western
            ? filmWesternRider(p.fg, p.accent)
            : "";
  const defaultBoat = pirates || mario || noodles || western ? "" : filmBoat(p.fg);
  const defaultTree = mario || noodles || rabbit ? "" : filmTree(p.fg);
  const flicker = warm || silent || western
    ? `<rect x="0" y="0" width="960" height="540" fill="${silent ? "#ffffff" : "#ffdca0"}" style="mix-blend-mode:overlay"><animate attributeName="opacity" values="0;${silent ? ".09" : ".05"};0;.03;0" dur="${silent ? 3 : 4}s" repeatCount="indefinite"/></rect>`
    : "";
  const scratches = silent ? filmScratches() : "";
  const grainOpacity = silent ? 0.85 : 0.5;
  const jitter = silent
    ? `<animateTransform attributeName="transform" type="translate" values="0 0;0.6 -0.4;-0.5 0.5;0 0" dur="0.32s" repeatCount="indefinite" additive="sum"/>`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540" width="960" height="540" preserveAspectRatio="xMidYMid slice" font-family="${FILM_FONT}" data-style="${style}">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">${filmStops(p.sky)}</linearGradient>
    <linearGradient id="water" x1="0" y1="0" x2="0" y2="1">${filmStops(p.water)}</linearGradient>
    <radialGradient id="sun" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="${p.orb[0]}"/><stop offset="30%" stop-color="${p.orb[1]}"/><stop offset="100%" stop-color="${p.orb[2]}" stop-opacity="0"/></radialGradient>
    <linearGradient id="ray" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${p.orb[1]}" stop-opacity=".5"/><stop offset="100%" stop-color="${p.orb[1]}" stop-opacity="0"/></linearGradient>
    <radialGradient id="flareOrb" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="${p.accent}" stop-opacity=".7"/><stop offset="100%" stop-color="${p.accent}" stop-opacity="0"/></radialGradient>
    <linearGradient id="flareStreak" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="${p.accent}" stop-opacity="0"/><stop offset="50%" stop-color="#eaf7ff" stop-opacity=".85"/><stop offset="100%" stop-color="${p.accent}" stop-opacity="0"/></linearGradient>
    <radialGradient id="ember" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#ffe6b0"/><stop offset="60%" stop-color="#ffb863" stop-opacity=".8"/><stop offset="100%" stop-color="#ffb863" stop-opacity="0"/></radialGradient>
    <linearGradient id="m1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${p.m1[0]}"/><stop offset="100%" stop-color="${p.m1[1]}"/></linearGradient>
    <linearGradient id="m2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${p.m2[0]}"/><stop offset="100%" stop-color="${p.m2[1]}"/></linearGradient>
    <linearGradient id="grade" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${p.grade[0]}" stop-opacity=".3"/><stop offset="100%" stop-color="${p.grade[1]}" stop-opacity=".35"/></linearGradient>
    <radialGradient id="vig" cx="50%" cy="46%" r="65%"><stop offset="45%" stop-color="#000" stop-opacity="0"/><stop offset="82%" stop-color="#000" stop-opacity="${silent ? 0.55 : 0.4}"/><stop offset="100%" stop-color="#000" stop-opacity="${silent ? 0.95 : 0.85}"/></radialGradient>
    <radialGradient id="leak" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#ffdca8" stop-opacity=".5"/><stop offset="100%" stop-color="#ffdca8" stop-opacity="0"/></radialGradient>
    <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" stitchTiles="stitch" result="n"><animate attributeName="seed" values="1;9;3;7;2;8;4" dur="0.5s" repeatCount="indefinite"/></feTurbulence><feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .5 0"/><feComposite operator="in" in2="SourceGraphic"/></filter>
    <filter id="glow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="7" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="9"/></filter>
    <filter id="rip" x="-20%" y="-20%" width="140%" height="140%"><feTurbulence type="fractalNoise" baseFrequency="0.012 0.06" numOctaves="2" seed="3" result="t"><animate attributeName="baseFrequency" values="0.012 0.06;0.016 0.08;0.012 0.06" dur="6s" repeatCount="indefinite"/></feTurbulence><feDisplacementMap in="SourceGraphic" in2="t" scale="14" xChannelSelector="R" yChannelSelector="G"/></filter>
    <clipPath id="screen"><rect x="0" y="0" width="960" height="540"/></clipPath>
    <clipPath id="below"><rect x="0" y="372" width="960" height="168"/></clipPath>
  </defs>
  <g clip-path="url(#screen)">
    <rect x="0" y="0" width="960" height="540" fill="#000"/>
    <g>${jitter}
      <g>
        <animateTransform attributeName="transform" type="scale" values="1;1.1;1" dur="26s" repeatCount="indefinite" additive="sum"/>
        <animateTransform attributeName="transform" type="translate" values="0 0;-24 -9;0 0" dur="26s" repeatCount="indefinite" additive="sum"/>
        <rect x="-80" y="-40" width="1120" height="460" fill="url(#sky)"/>
        <g fill="#fff">${filmStars()}</g>
        ${back}
        <g stroke="#fff" stroke-width="2" stroke-linecap="round" opacity="0"><line x1="0" y1="0" x2="46" y2="20"/><animate attributeName="opacity" values="0;0;.9;0;0" keyTimes="0;.55;.62;.7;1" dur="9s" repeatCount="indefinite"/><animateTransform attributeName="transform" type="translate" values="760 40;560 130;560 130" keyTimes="0;.12;1" dur="9s" repeatCount="indefinite"/></g>
        <circle cx="480" cy="${orbY}" r="${highOrb ? 70 : 155}" fill="url(#sun)"><animate attributeName="cy" values="${orbY - 12};${orbY + 6};${orbY - 12}" dur="22s" repeatCount="indefinite"/></circle>
        <circle cx="480" cy="${orbY}" r="${highOrb ? 30 : 48}" fill="${p.core}" filter="url(#glow)"><animate attributeName="cy" values="${orbY - 12};${orbY + 6};${orbY - 12}" dur="22s" repeatCount="indefinite"/></circle>
        ${rays}
        ${flare}
        <g><path d="M-80 360 L120 300 L280 350 L460 285 L640 345 L820 295 L1040 350 L1040 380 L-80 380 Z" fill="url(#m1)"/><animateTransform attributeName="transform" type="translate" values="0 0;16 0;0 0" dur="26s" repeatCount="indefinite"/></g>
        <g><path d="M-80 372 L160 320 L380 372 L560 318 L760 372 L980 326 L1040 372 L-80 372 Z" fill="url(#m2)"/>${neonRim}<animateTransform attributeName="transform" type="translate" values="0 0;36 0;0 0" dur="26s" repeatCount="indefinite"/></g>
        <rect x="-80" y="372" width="1120" height="220" fill="url(#water)"/>
        <g clip-path="url(#below)" filter="url(#rip)" opacity=".75" style="mix-blend-mode:screen"><circle cx="480" cy="${reflectY}" r="120" fill="url(#sun)"><animate attributeName="cy" values="${reflectY - 6};${reflectY - 22};${reflectY - 6}" dur="22s" repeatCount="indefinite"/></circle><rect x="430" y="372" width="100" height="200" fill="${p.orb[1]}" opacity=".5"/></g>
        ${grid}
        ${themeProp}
        ${defaultBoat}
        ${defaultTree}
        ${frontParticles}
        ${filmFlock(p.bird)}
      </g>
    </g>
    ${leak}
    <rect x="0" y="0" width="960" height="540" fill="url(#grade)" style="mix-blend-mode:soft-light"/>
    <rect x="0" y="0" width="960" height="540" fill="url(#vig)"/>
    ${flicker}
    ${scratches}
    <g text-anchor="middle" fill="#fff" filter="url(#glow)" font-weight="700">
      <text x="480" y="266" font-size="58" letter-spacing="2"><tspan>an</tspan><tspan fill="${p.accent}">xiang</tspan><tspan>sir</tspan><animate attributeName="opacity" values="0;0;1;1;0;0" keyTimes="0;.08;.2;.5;.62;1" dur="13s" repeatCount="indefinite"/></text>
    </g>
    <g text-anchor="middle" fill="${p.accent}"><text x="480" y="304" font-size="14" letter-spacing="7" opacity=".9">${p.sub.split("").join(" ")}<animate attributeName="opacity" values="0;0;.9;.9;0;0" keyTimes="0;.12;.24;.5;.62;1" dur="13s" repeatCount="indefinite"/></text></g>
    <rect x="0" y="0" width="960" height="540" filter="url(#grain)" opacity="${grainOpacity}" style="mix-blend-mode:overlay"/>
  </g>
</svg>
`;
};


const stripSvgWrapper = (svg) =>
  svg.replace(/^\s*<svg\b[^>]*>/, "").replace(/<\/svg>\s*$/, "");

// Stacks the cinematic film banner above a dashboard into one self-contained
// SVG. The dashboard's own hero strip is dropped (its viewBox starts below the
// hero) so only a single cinematic banner shows. Both halves keep their own
// coordinate systems and defs via nested <svg> elements.
const combineWithFilm = ({ dashboard, filmInner, width, height, heroHeight }) => {
  const filmH = +(width * (540 / 960)).toFixed(2);
  const bodyH = height - heroHeight;
  const total = +(filmH + bodyH).toFixed(2);
  const dashInner = stripSvgWrapper(dashboard);
  return `<svg width="${width}" height="${total}" viewBox="0 0 ${width} ${total}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="ctitle cdesc">
  <title id="ctitle">Xiang An — cinematic GitHub dashboard</title>
  <desc id="cdesc">A pure-SVG cinematic sunset banner above Xiang An's animated GitHub dashboard.</desc>
  <svg x="0" y="0" width="${width}" height="${filmH}" viewBox="0 0 960 540" preserveAspectRatio="xMidYMid slice" font-family="${FILM_FONT}">${filmInner}</svg>
  <svg x="0" y="${filmH}" width="${width}" height="${bodyH}" viewBox="0 ${heroHeight} ${width} ${bodyH}" fill="none">${dashInner}</svg>
</svg>
`;
};

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
    height: DESKTOP_HEIGHT,
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
    height: MOBILE_HEIGHT,
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
  const citations = scholarMonthly(scholar.perYear, scholar.fetchedAt);
  if (!languages.length) throw new Error("Could not parse languages");
  if (!stacked.layers.length) throw new Error("Could not build star series");
  if (!commits.length) throw new Error("Could not build commit history");
  if (!citations.length) throw new Error("Could not build citation history");

  await mkdir(assetsDir, { recursive: true });

  const darkSvg = renderDesktop({ stats, languages, stacked, commits, citations, theme: THEMES.dark });
  const lightSvg = renderDesktop({ stats, languages, stacked, commits, citations, theme: THEMES.light });
  const darkMobileSvg = renderMobile({ stats, languages, stacked, commits, citations, theme: THEMES.dark });
  const lightMobileSvg = renderMobile({ stats, languages, stacked, commits, citations, theme: THEMES.light });

  // Cinematic variants: generate the film banner in a randomly-picked style
  // (override with FILM_STYLE=...), persist it, then stack it over each dashboard.
  const filmStyle =
    process.env.FILM_STYLE && FILM_STYLES.includes(process.env.FILM_STYLE)
      ? process.env.FILM_STYLE
      : FILM_STYLES[Math.floor(Math.random() * FILM_STYLES.length)];
  const filmSvg = renderFilm(filmStyle);
  await writeFile(filmFile, filmSvg);
  await setActionOutput("film_style", filmStyle);
  console.log(`Film style: ${filmStyle}`);
  const filmInner = stripSvgWrapper(filmSvg);
  const combine = (dashboard, width, height, heroHeight) =>
    combineWithFilm({ dashboard, filmInner, width, height, heroHeight });

  const outputs = [
    ...FILM_STYLES.map((style) => [`film-${style}.svg`, renderFilm(style)]),
    [FILES.dark, darkSvg],
    [FILES.light, lightSvg],
    [FILES.darkMobile, darkMobileSvg],
    [FILES.lightMobile, lightMobileSvg],
    [FILES.darkCinematic, combine(darkSvg, 900, DESKTOP_HEIGHT, DESKTOP_HERO_HEIGHT)],
    [FILES.lightCinematic, combine(lightSvg, 900, DESKTOP_HEIGHT, DESKTOP_HERO_HEIGHT)],
    [FILES.darkMobileCinematic, combine(darkMobileSvg, 370, MOBILE_HEIGHT, MOBILE_HERO_HEIGHT)],
    [FILES.lightMobileCinematic, combine(lightMobileSvg, 370, MOBILE_HEIGHT, MOBILE_HERO_HEIGHT)],
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

export {
  renderHero,
  defs,
  shell,
  THEMES,
  renderLineChart,
  scholarMonthly,
  combineWithFilm,
  stripSvgWrapper,
  renderFilm,
  FILM_STYLES,
};
