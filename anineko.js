const BASE_URL = "https://anineko.to";

// ─────────────────────────────────────────────
// 1. SEARCH RESULTS 
// ─────────────────────────────────────────────
async function searchResults(keyword) {
    try {
        const encodedKeyword = encodeURIComponent(keyword);
        
        // Test all possible search endpoints
        const searchPaths = [
            `/search?keyword=${encodedKeyword}`, 
            `/filter?keyword=${encodedKeyword}`, 
            `/search.html?keyword=${encodedKeyword}`,
            `/?s=${encodedKeyword}`
        ];

        let debugHtml = "";

        for (const path of searchPaths) {
            try {
                const response = await fetch(BASE_URL + path);
                if (!response.ok) continue;
                
                const html = await response.text();
                if (!debugHtml) debugHtml = html; // Store first valid response for debugging
                
                const results = [];

                // Method 1: Relaxed Card Regex (ignores strict CDN requirements)
                const cardRegex = /<div[^>]*class="[^"]*flw-item[^"]*"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/gi;
                const cards = html.match(cardRegex) || [];

                for (const card of cards) {
                    const hrefMatch = card.match(/href="(\/watch\/[^"?]+)"[^>]*>([^<]+)<\/a>/);
                    const imgMatch = card.match(/data-src="([^"]+)"/) || card.match(/src="([^"]+)"/);

                    if (hrefMatch) {
                        results.push({
                            title: hrefMatch[2].trim(),
                            image: imgMatch ? imgMatch[1] : "",
                            href: BASE_URL + hrefMatch[1]
                        });
                    }
                }

                // Method 2: Fallback broad link scraping if cards fail
                if (results.length === 0) {
                    const linkRegex = /<a[^>]+href="(\/watch\/[^"?]+)"[^>]*>([\s\S]*?)<\/a>/gi;
                    let match;
                    const seenUrls = new Set();
                    
                    while ((match = linkRegex.exec(html)) !== null) {
                        const url = BASE_URL + match[1];
                        if (seenUrls.has(url)) continue;

                        const innerContent = match[2];
                        
                        // Extract title from title attribute or inner text
                        const titleMatch = match[0].match(/title="([^"]+)"/);
                        const title = titleMatch ? titleMatch[1].trim() : innerContent.replace(/<[^>]+>/g, '').trim();

                        if (!title || title.length < 2 || title.includes("Episode")) continue;

                        const imgMatch = innerContent.match(/data-src="([^"]+)"/) || innerContent.match(/src="([^"]+)"/);
                        
                        results.push({
                            title: title,
                            image: imgMatch ? imgMatch[1] : "",
                            href: url
                        });
                        seenUrls.add(url);
                    }
                }

                // If results are found, return them and break the loop immediately
                if (results.length > 0) {
                    return JSON.stringify(results);
                }

            } catch (e) {
                // Ignore failure and continue to the next path
            }
        }

        // If loop finishes with 0 results, print the HTML structure to the screen
        const cleanHtml = debugHtml.replace(/\s+/g, ' ').substring(0, 150);
        return JSON.stringify([{
            title: `DEBUG [No Results Found]: ${cleanHtml}...`, 
            image: "https://anineko.to/img/logo.png?v=4", 
            href: BASE_URL
        }]);

    } catch (error) {
        return JSON.stringify([{ title: "Error Fetching", image: "", href: "" }]);
    }
}

// ─────────────────────────────────────────────
// 2. EXTRACT DETAILS
// ─────────────────────────────────────────────
async function extractDetails(url) {
    try {
        const response = await fetch(url);
        const html = await response.text();

        let description = "";
        const descMatch =
            html.match(/<div[^>]*class="[^"]*description[^"]*"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/) ||
            html.match(/<div[^>]*class="[^"]*synopsis[^"]*"[^>]*>([\s\S]*?)<\/div>/) ||
            html.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/);
        if (descMatch) {
            description = descMatch[1].replace(/<[^>]+>/g, "").trim();
        }

        let aliases = "";
        const aliasMatch = html.match(/(?:Other Names?|Synonyms?)[^>]*>[\s]*<span[^>]*>(.*?)<\/span>/i);
        if (aliasMatch) aliases = aliasMatch[1].replace(/<[^>]+>/g, "").trim();

        let airdate = "";
        const yearMatch = html.match(/(?:Aired|Released?|Year)[^>]*>[\s]*<span[^>]*>(.*?)<\/span>/i) ||
                          html.match(/<time[^>]*datetime="(\d{4})/);
        if (yearMatch) airdate = yearMatch[1].replace(/<[^>]+>/g, "").trim();

        return JSON.stringify([{ description, aliases, airdate }]);
    } catch (error) {
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

        episodes.sort((a, b) => a.number - b.number);
        return JSON.stringify(episodes);
    } catch (error) {
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

        const m3u8Match =
            html.match(/["']?(https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)["']?/) ||
            html.match(/file:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
        if (m3u8Match) return m3u8Match[1];

        const mp4Match = html.match(/["'](https?:\/\/[^"'\s]+\.mp4[^"'\s]*)["']/);
        if (mp4Match) return mp4Match[1];

        const iframeMatch =
            html.match(/<iframe[^>]+src="(https?:\/\/[^"]+)"/) ||
            html.match(/data-src="(https?:\/\/[^"]+player[^"]+)"/i);
        if (iframeMatch) return iframeMatch[1];

        const epMatch = url.match(/\/watch\/([^\/]+)\/ep-(\d+)/);
        if (epMatch) {
            const slug = epMatch[1];
            const ep = epMatch[2];

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
        return null;
    }
}
