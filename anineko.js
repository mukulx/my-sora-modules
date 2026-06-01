const BASE_URL = "https://anineko.to";

// ─────────────────────────────────────────────
// 1. SEARCH RESULTS (SORA URL-PARSING IMMUNIZED)
// ─────────────────────────────────────────────
async function searchResults(inputParam) {
    try {
        let cleanKeyword = inputParam.trim();

        // 🚨 SORA ENGINE FIX: If Sora passes the entire constructed URL instead of the raw keyword, extract the query term safely.
        if (cleanKeyword.startsWith("http://") || cleanKeyword.startsWith("https://")) {
            try {
                const urlObject = new URL(cleanKeyword);
                cleanKeyword = urlObject.searchParams.get("keyword") || urlObject.searchParams.get("s") || urlObject.searchParams.get("key") || cleanKeyword;
                // If it extracted a path instead of a query, grab the last segment
                if (cleanKeyword.includes("/")) {
                    cleanKeyword = cleanKeyword.split("/").pop();
                }
            } catch (urlError) {
                // Fallback to original text if parsing fails
            }
        }

        const encodedKeyword = encodeURIComponent(cleanKeyword);
        
        // Multi-routing fallback array for layout structural shifts
        const searchPaths = [
            `/search?keyword=${encodedKeyword}`,
            `/search/?keyword=${encodedKeyword}`,
            `/filter?keyword=${encodedKeyword}`,
            `/?s=${encodedKeyword}`
        ];

        let debugHtml = "";
        let finalResults = [];

        for (const path of searchPaths) {
            try {
                const response = await fetch(BASE_URL + path);
                if (!response.ok) continue;
                
                const tempHtml = await response.text();
                if (!debugHtml) debugHtml = tempHtml; 

                // Skip explicit 404 documents
                if (tempHtml.includes("Page Not Found") || tempHtml.includes("404 Error")) {
                    continue;
                }

                const localResults = [];
                
                // Matches standard structural anime card blocks cleanly
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

                // Broad general grid fallback parser
                if (localResults.length === 0) {
                    const fallbackRegex = /<a[^>]+href="(\/watch\/[^"?#\s>]+)"[^>]*title="([^"]+)"[\s\S]*?<img[^>]+(data-src|src)="([^"]+)"/gi;
                    let match;
                    const seenUrls = new Set();

                    while ((match = fallbackRegex.exec(tempHtml)) !== null) {
                        const url = BASE_URL + match[1];
                        if (!seenUrls.has(url) && !match[2].toLowerCase().includes("episode")) {
                            seenUrls.add(url);
                            localResults.push({
                                title: match[2].trim(),
                                image: match[4],
                                href: url
                            });
                        }
                    }
                }

                // Validate that the output content actually belongs to the query array
                if (localResults.length > 0) {
                    const hasKeywordMatch = localResults.some(item => 
                        item.title.toLowerCase().includes(cleanKeyword.toLowerCase())
                    );
                    
                    if (hasKeywordMatch) {
                        html = tempHtml;
                        finalResults = localResults;
                        break; 
                    }
                }
            } catch (e) {
                // Continue structural loop traversal
            }
        }

        if (finalResults.length > 0) {
            return JSON.stringify(finalResults);
        }

        const cleanHtml = debugHtml ? debugHtml.replace(/\s+/g, ' ').substring(0, 100) : "No Server Connection";
        return JSON.stringify([{
            title: `DEBUG [No Results For: ${cleanKeyword}]: ${cleanHtml}...`, 
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
