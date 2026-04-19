/**
 * Translate `text` from language `from` to `to` (ISO codes, e.g. "de", "zh").
 *
 * Uses MyMemory (mymemory.translated.net), an Italian service that is generally
 * accessible from China without a VPN. 500 words/day free per IP.
 */
export async function translateText(text: string, from: string, to: string): Promise<string> {
    const url = 'https://api.mymemory.translated.net/get'
        + '?q='        + encodeURIComponent(text)
        + '&langpair=' + encodeURIComponent(from + '|' + to);

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Translation request failed (HTTP ${response.status})`);
    }

    const data = await response.json();
    const translated: string | undefined = data?.responseData?.translatedText;

    if (!translated) {
        throw new Error('Translation failed: empty response');
    }

    return translated;
}
