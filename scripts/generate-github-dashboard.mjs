import { mkdir, writeFile } from "node:fs/promises";

const STATS_URL =
  "https://github-readme-stats-psi-plum-61.vercel.app/api?username=anxiangsir&show_icons=true&include_all_commits=true&rank_icon=github&hide_border=true";
const LANGS_URL =
  "https://github-readme-stats-psi-plum-61.vercel.app/api/top-langs/?username=anxiangsir&layout=compact&hide_border=true&langs_count=8";

const outFile = new URL("../assets/github-dashboard.svg", import.meta.url);

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
    const raw = desc.match(new RegExp(`${label}\\s*:?\\s*([0-9,]+)`, "i"))?.[1] || "0";
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
  const names = [...svg.matchAll(/<text[^>]*data-testid="lang-name"[^>]*>\s*([^<]+)\s*<\/text>/g)].map(
    (match) => htmlDecode(match[1].trim()),
  );
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

const metricCard = ({ x, y, label, value, accent, delay }) => `
  <g class="float" style="animation-delay:${delay}ms" transform="translate(${x} ${y})">
    <rect width="154" height="86" rx="18" fill="url(#panel)" stroke="${accent}" stroke-opacity=".32"/>
    <text x="18" y="29" class="label">${escapeXml(label)}</text>
    <text x="18" y="62" class="metric" fill="${accent}">${escapeXml(value)}</text>
  </g>`;

const languageRows = (languages) =>
  languages
    .slice(0, 8)
    .map((language, index) => {
      const y = index * 31;
      const width = Math.max(8, Math.min(270, (language.value / 100) * 270));
      return `
        <g class="langRow" transform="translate(0 ${y})">
          <circle cx="8" cy="8" r="5" fill="${language.color}"/>
          <text x="22" y="12" class="lang">${escapeXml(language.name)}</text>
          <text x="266" y="12" class="langPercent" text-anchor="end">${escapeXml(language.percent)}</text>
          <rect x="0" y="19" width="270" height="7" rx="3.5" fill="#1f2937"/>
          <rect x="0" y="19" width="${width.toFixed(1)}" height="7" rx="3.5" fill="${language.color}">
            <animate attributeName="width" from="0" to="${width.toFixed(1)}" dur="1.2s" begin="${index * 0.08}s" fill="freeze"/>
          </rect>
        </g>`;
    })
    .join("");

const renderDashboard = ({ stats, languages }) => {
  const generatedAt = new Date().toISOString().slice(0, 10);
  return `<svg width="980" height="430" viewBox="0 0 980 430" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title desc">
  <title id="title">Xiang An's GitHub stats and top languages</title>
  <desc id="desc">Stars ${escapeXml(stats.stars)}, commits ${escapeXml(stats.commits)}, rank ${escapeXml(stats.rank)}, top language ${escapeXml(languages[0]?.name || "Python")}.</desc>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="980" y2="430" gradientUnits="userSpaceOnUse">
      <stop stop-color="#020617"/>
      <stop offset=".48" stop-color="#0f172a"/>
      <stop offset="1" stop-color="#111827"/>
    </linearGradient>
    <linearGradient id="glow" x1="110" y1="31" x2="865" y2="390" gradientUnits="userSpaceOnUse">
      <stop stop-color="#22d3ee"/>
      <stop offset=".5" stop-color="#8b5cf6"/>
      <stop offset="1" stop-color="#22c55e"/>
    </linearGradient>
    <linearGradient id="panel" x1="0" y1="0" x2="154" y2="86" gradientUnits="userSpaceOnUse">
      <stop stop-color="#111827" stop-opacity=".88"/>
      <stop offset="1" stop-color="#020617" stop-opacity=".76"/>
    </linearGradient>
    <filter id="blurGlow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="18" result="blur"/>
      <feColorMatrix in="blur" type="matrix" values="0 0 0 0 0.25 0 0 0 0 0.9 0 0 0 0 1 0 0 0 .65 0"/>
      <feBlend in="SourceGraphic"/>
    </filter>
    <radialGradient id="orbA" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(140 92) rotate(49) scale(190 120)">
      <stop stop-color="#0ea5e9" stop-opacity=".55"/>
      <stop offset="1" stop-color="#0ea5e9" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="orbB" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(820 320) rotate(49) scale(220 140)">
      <stop stop-color="#22c55e" stop-opacity=".42"/>
      <stop offset="1" stop-color="#22c55e" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="clip"><rect width="980" height="430" rx="30"/></clipPath>
    <style>
      .title{font:700 34px Inter,Segoe UI,Arial,sans-serif;fill:#f8fafc;letter-spacing:0}
      .subtitle{font:500 14px Inter,Segoe UI,Arial,sans-serif;fill:#94a3b8;letter-spacing:0}
      .label{font:600 12px Inter,Segoe UI,Arial,sans-serif;fill:#94a3b8;text-transform:uppercase;letter-spacing:.08em}
      .metric{font:800 28px Inter,Segoe UI,Arial,sans-serif;letter-spacing:0}
      .rank{font:900 68px Inter,Segoe UI,Arial,sans-serif;fill:#f8fafc;letter-spacing:0}
      .sectionTitle{font:800 24px Inter,Segoe UI,Arial,sans-serif;fill:#f8fafc;letter-spacing:0}
      .lang{font:700 13px Inter,Segoe UI,Arial,sans-serif;fill:#dbeafe;letter-spacing:0}
      .langPercent{font:700 13px Inter,Segoe UI,Arial,sans-serif;fill:#93c5fd;letter-spacing:0}
      .tiny{font:600 11px Inter,Segoe UI,Arial,sans-serif;fill:#64748b;letter-spacing:0}
      .scan{animation:scan 4s linear infinite}
      .float{}
      .langRow{}
      @keyframes scan{0%{transform:translateX(-500px)}100%{transform:translateX(980px)}}
    </style>
  </defs>

  <g clip-path="url(#clip)">
    <rect width="980" height="430" fill="url(#bg)"/>
    <rect width="980" height="430" fill="url(#orbA)"/>
    <rect width="980" height="430" fill="url(#orbB)"/>
    <path d="M-90 329C80 250 130 406 283 301C436 196 519 254 660 152C766 76 864 92 1078 14" stroke="url(#glow)" stroke-width="2" stroke-opacity=".42"/>
    <path d="M-80 374C119 273 226 408 359 306C491 204 579 286 736 174C848 95 908 131 1064 72" stroke="#38bdf8" stroke-width="1" stroke-opacity=".18"/>
    <rect class="scan" y="0" width="280" height="430" fill="url(#glow)" opacity=".06"/>

    <rect x="24" y="24" width="932" height="382" rx="26" fill="#020617" fill-opacity=".46" stroke="url(#glow)" stroke-opacity=".65"/>
    <rect x="36" y="36" width="908" height="358" rx="20" fill="#0f172a" fill-opacity=".36" stroke="#334155" stroke-opacity=".42"/>

    <text x="64" y="82" class="title">Xiang An's GitHub stats</text>
    <text x="64" y="110" class="subtitle">Private-instance telemetry, refreshed from GitHub Readme Stats APIs</text>
    <text x="64" y="132" class="tiny">Generated ${generatedAt}</text>

    ${metricCard({ x: 64, y: 162, label: "Stars", value: stats.stars, accent: "#22d3ee", delay: 0 })}
    ${metricCard({ x: 236, y: 162, label: "Commits", value: stats.commits, accent: "#a78bfa", delay: 160 })}
    ${metricCard({ x: 408, y: 162, label: "Pull requests", value: stats.prs, accent: "#34d399", delay: 320 })}
    ${metricCard({ x: 64, y: 272, label: "Issues", value: stats.issues, accent: "#fbbf24", delay: 480 })}
    ${metricCard({ x: 236, y: 272, label: "Contributed", value: stats.contribs, accent: "#fb7185", delay: 640 })}
    ${metricCard({ x: 408, y: 272, label: "Rank", value: stats.rank, accent: "#38bdf8", delay: 800 })}

    <g transform="translate(610 160)">
      <text x="0" y="-18" class="sectionTitle">Top languages</text>
      ${languageRows(languages)}
    </g>
  </g>
</svg>
`;
};

const main = async () => {
  const [statsSvg, langsSvg] = await Promise.all([
    fetchText(STATS_URL),
    fetchText(LANGS_URL),
  ]);
  const stats = parseStats(statsSvg);
  const languages = parseLanguages(langsSvg);
  if (!languages.length) {
    throw new Error("Could not parse languages");
  }

  await mkdir(new URL("../assets/", import.meta.url), { recursive: true });
  await writeFile(outFile, renderDashboard({ stats, languages }));
  console.log(`Wrote ${outFile.pathname}`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
