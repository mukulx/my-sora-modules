const BASE_URL = "https://anineko.to";

// ─────────────────────────────────────────────
// 1. SEARCH RESULTS (ROBUST PATTERN MATCHING)
// ─────────────────────────────────────────────
async function searchResults(keyword) {
    try {
        const cleanKeyword = keyword.trim();
        const encodedKeyword = encodeURIComponent(cleanKeyword);
        
        // Comprehensive list of alternative routing structures for modern anime frameworks
        const searchPaths = [
            `/search?keyword=${encodedKeyword}`,
            `/search/?keyword=${encodedKeyword}`,
            `/search?key=${encodedKeyword}`,
            `/search?q=${encodedKeyword}`,
            `/filter?keyword=${encodedKeyword}`,
            `/filter/?keyword=${encodedKeyword}`,
            `/search-anime?keyword=${encodedKeyword}`,
            `/?s=${encodedKeyword}`
        ];

        let html = "";
        let finalResults = [];

        for (const path of searchPaths) {
            try {
                const response = await fetch(BASE_URL + path);
                if (!response.ok) continue;
                
                const tempHtml = await response.text();
                
                // Skip explicit error pages immediately
                if (tempHtml.includes("Page Not Found") || tempHtml.includes("404 Error")) {
                    continue;
                }

                const localResults = [];
                
                // Non-rigid card scanning: extracts data blocks from the start of an item up to its title closing tag
                const blockRegex = /<div[^>]*class="[^"]*flw-item[^"]*"[\s\S]*?<\/h3>/gi;
                const blocks = tempHtml.match(blockRegex) || [];

                for (const block of blocks) {
                    const hrefMatch = block.match(/href="(\/watch\/[^"?#\s>]+)"/i);
                    const titleMatch = block.match(/title="([^"]+)"/i) || block.match(/<a[^>]*>([^<]+)<\/a>/i);
                    const imgMatch = block.match(/(?:data-src|src)="([^"]+)"/i);

                    if (hrefMatch && titleMatch) {
                        localResults.push({
                            title: titleMatch[1].trim(),
                            image: imgMatch ? imgMatch[1] : "",
                            href: BASE_URL + hrefMatch[1]
                        });
                    }
                }

                // Broad Fallback Scraper: parses any valid media anchors if custom structural grid classes are absent
                if (localResults.length === 0) {
                    const fallbackRegex = /<a[^>]+href="(\/watch\/[^"?#\s>]+)"[^>]*title="([^"]+)"[\s\S]*?<img[^>]+(?:data-src|src)="([^"]+)"/gi;
                    let match;
                    const seenUrls = new Set();

                    while ((match = fallbackRegex.exec(tempHtml)) !== null) {
                        const url = BASE_URL + match[1];
                        if (!seenUrls.has(url) && !match[2].toLowerCase().includes("episode")) {
                            seenUrls.add(url);
                            localResults.push({
                                title: match[2].trim(),
                                image: match[3],
                                href: url
                            });
                        }
                    }
                }

                // KEYWORD VALIDATION FILTER: Confirms that the page contains matching query data 
                // to prevent false positives caused by homepage fallbacks.
                if (localResults.length > 0) {
                    const hasKeywordMatch = localResults.some(item => 
                        item.title.toLowerCase().includes(cleanKeyword.toLowerCase())
                    );
                    
                    if (hasKeywordMatch) {
                        html = tempHtml;
                        finalResults = localResults;
                        break; // Correct search endpoint found, exit loop safely
                    }
                }
            } catch (e) {
                // Fail-silent traversal to next endpoint
            }
        }

        // Return validated search array if verification passes
        if (finalResults.length > 0) {
            return JSON.stringify(finalResults);
        }

        // Final Debug fallback if the structure cannot be mapped
        const cleanHtml = html ? html.replace(/\s+/g, ' ').substring(0, 120) : "No Response Content";
        return JSON.stringify([{
            title: `DEBUG [Extraction Failure]: ${cleanHtml}...`, 
            image: "https://anineko.to/img/logo.png?v=4", 
            href: BASE_URL
        }]);

    } catch (error) {
        return JSON.stringify([{ title: "Execution Error", image: "", href: "" }]);
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

        const epRegex = /href="(\/watch\/[^"'\s>]+\/ep-(\d+))"/g;
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
