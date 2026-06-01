const BASE_URL = "https://anineko.to";

// ─────────────────────────────────────────────
// 1. SEARCH RESULTS
// ─────────────────────────────────────────────
async function searchResults(keyword) {
    try {
        const encodedKeyword = encodeURIComponent(keyword);
        const response = await fetch(`${BASE_URL}/search?keyword=${encodedKeyword}`);
        const html = await response.text();

        const results = [];

        // Match all anime cards (each film item block)
        const cardRegex = /<div class="flw-item"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/g;
        const cards = html.match(cardRegex) || [];

        for (const card of cards) {
            // Get title and href from film-name link
            const hrefMatch = card.match(/href="(\/watch\/[^"?]+)"[^>]*>([^<]+)<\/a>/);
            // Get cover image (data-src or src from cdn.cimovix.store)
            const imgMatch = card.match(/data-src="([^"]+cdn\.cimovix[^"]+)"|src="([^"]+cdn\.cimovix[^"]+)"/);

            if (hrefMatch) {
                results.push({
                    title: hrefMatch[2].trim(),
                    image: imgMatch ? (imgMatch[1] || imgMatch[2]) : "",
                    href: BASE_URL + hrefMatch[1]
                });
            }
        }

        // Fallback: try simpler link pattern if card regex fails
        if (results.length === 0) {
            const linkRegex = /href="(\/watch\/[^"?\/]+)"[^>]*title="([^"]+)"/g;
            const imgRegex = /data-src="(https:\/\/cdn\.cimovix[^"]+)"/g;
            const imgs = [];
            let m;
            while ((m = imgRegex.exec(html)) !== null) imgs.push(m[1]);

            let i = 0;
            while ((m = linkRegex.exec(html)) !== null) {
                results.push({
                    title: m[2].trim(),
                    image: imgs[i] || "",
                    href: BASE_URL + m[1]
                });
                i++;
            }
        }

        return JSON.stringify(results);
    } catch (error) {
        console.log("searchResults error:", error);
        return JSON.stringify([{ title: "Error", image: "", href: "" }]);
    }
}

// ─────────────────────────────────────────────
// 2. EXTRACT DETAILS
// ─────────────────────────────────────────────
async function extractDetails(url) {
    try {
        const response = await fetch(url);
        const html = await response.text();

        // Description — try multiple selectors
        let description = "";
        const descMatch =
            html.match(/<div[^>]*class="[^"]*description[^"]*"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/) ||
            html.match(/<div[^>]*class="[^"]*synopsis[^"]*"[^>]*>([\s\S]*?)<\/div>/) ||
            html.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/);
        if (descMatch) {
            description = descMatch[1].replace(/<[^>]+>/g, "").trim();
        }

        // Aliases (alternative title if present)
        let aliases = "";
        const aliasMatch = html.match(/(?:Other Names?|Synonyms?)[^>]*>[\s]*<span[^>]*>(.*?)<\/span>/i);
        if (aliasMatch) aliases = aliasMatch[1].replace(/<[^>]+>/g, "").trim();

        // Air date / year
        let airdate = "";
        const yearMatch = html.match(/(?:Aired|Released?|Year)[^>]*>[\s]*<span[^>]*>(.*?)<\/span>/i) ||
                          html.match(/<time[^>]*datetime="(\d{4})/);
        if (yearMatch) airdate = yearMatch[1].replace(/<[^>]+>/g, "").trim();

        return JSON.stringify([{ description, aliases, airdate }]);
    } catch (error) {
        console.log("extractDetails error:", error);
        return JSON.stringify([{ description: "Error loading details", aliases: "", airdate: "" }]);
    }
}

// ─────────────────────────────────────────────
// 3. EXTRACT EPISODES
// ─────────────────────────────────────────────
async function extractEpisodes(url) {
    try {
        const response = await fetch(url);
        const html = await response.text();

        // Match all episode links: /watch/slug/ep-N
        const epRegex = /href="(\/watch\/[^"]+\/ep-(\d+))"/g;
        const seen = new Set();
        const episodes = [];
        let match;

        while ((match = epRegex.exec(html)) !== null) {
            const href = BASE_URL + match[1];
            const number = parseInt(match[2], 10);
            if (!seen.has(href)) {
                seen.add(href);
                episodes.push({ href, number });
            }
        }

        // Sort by episode number ascending
        episodes.sort((a, b) => a.number - b.number);

        return JSON.stringify(episodes);
    } catch (error) {
        console.log("extractEpisodes error:", error);
        return JSON.stringify([]);
    }
}

// ─────────────────────────────────────────────
// 4. EXTRACT STREAM URL
// ─────────────────────────────────────────────
async function extractStreamUrl(url) {
    try {
        const response = await fetch(url);
        const html = await response.text();

        // Priority 1: direct m3u8 stream in a script variable
        const m3u8Match =
            html.match(/["']?(https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)["']?/) ||
            html.match(/file:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
        if (m3u8Match) return m3u8Match[1];

        // Priority 2: mp4 direct source
        const mp4Match = html.match(/["'](https?:\/\/[^"'\s]+\.mp4[^"'\s]*)["']/);
        if (mp4Match) return mp4Match[1];

        // Priority 3: iframe embed src
        const iframeMatch =
            html.match(/<iframe[^>]+src="(https?:\/\/[^"]+)"/) ||
            html.match(/data-src="(https?:\/\/[^"]+player[^"]+)"/i);
        if (iframeMatch) return iframeMatch[1];

        // Priority 4: try to find an API endpoint for HD-1 server
        // Extract slug and episode number from the URL
        const epMatch = url.match(/\/watch\/([^\/]+)\/ep-(\d+)/);
        if (epMatch) {
            const slug = epMatch[1];
            const ep = epMatch[2];

            // Try common API patterns for this type of site
            const apiAttempts = [
                `${BASE_URL}/api/episode/sources?anime=${slug}&ep=${ep}&type=sub`,
                `${BASE_URL}/api/v1/sources?slug=${slug}&ep=${ep}`,
                `${BASE_URL}/player/${slug}/${ep}`
            ];

            for (const apiUrl of apiAttempts) {
                try {
                    const apiRes = await fetch(apiUrl);
                    const apiHtml = await apiRes.text();
                    const apiM3u8 = apiHtml.match(/(https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)/);
                    if (apiM3u8) return apiM3u8[1];
                } catch (_) {}
            }
        }

        return null;
    } catch (error) {
        console.log("extractStreamUrl error:", error);
        return null;
    }
}
