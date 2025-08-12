// JUFO integration: fetch ranking by ISSN using the public REST API
// Source: https://jufo-rest.csc.fi
// Example: https://jufo-rest.csc.fi/v1.1/etsi.php?issn=1758-4078

(function(){
  // Minimal module exposing getRankSpan-like function added into scholar.rankSpanList
  function fetchJufoByIssn(issn) {
    if(!window.__jufoCache) window.__jufoCache = new Map();
    const cacheKey = String(issn);
    if(window.__jufoCache.has(cacheKey)) return Promise.resolve(window.__jufoCache.get(cacheKey));

    // Helper: simple GET returning parsed JSON or null
    const getJSON = (url) => new Promise((res) => {
      try {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.onreadystatechange = function(){
          if(xhr.readyState === 4){
            try {
              if(xhr.status >= 200 && xhr.status < 300){
                res(JSON.parse(xhr.responseText));
              } else { res(null); }
            } catch { res(null); }
          }
        };
        xhr.onerror = function(){ res(null); };
        xhr.send();
      } catch { res(null); }
    });

    // Extract current level (1–3) from a kanava payload
    const getLevelFromKanava = (payload) => {
      const arr = Array.isArray(payload) ? payload : (payload?.results || payload?.result || []);
      if(!Array.isArray(arr) || !arr.length) return null;
      const row = arr[0];
      const raw = row?.Level ?? row?.level ?? row?.Julkaisufoorumitaso ?? row?.taso;
      const n = Number(String(raw||"").match(/^[0-9]+/)?.[0]);
      return Number.isFinite(n) && n > 0 ? String(n) : null;
    };

    return new Promise((resolve) => {
      if(!issn) { resolve(null); return; }

      const tryIssnQuery = async (query) => {
        const etsiUrl = `https://jufo-rest.csc.fi/v1.1/etsi.php?issn=${encodeURIComponent(query)}`;
        const found = await getJSON(etsiUrl);
        const list = Array.isArray(found) ? found : (found?.results || found?.result || []);
        if(!Array.isArray(list) || !list.length) return null;

        // Prefer exact ISSN match if present
        const digitsQ = String(query).replace(/[^0-9Xx]/g,"");
        const ordered = list.slice().sort((a,b)=>{
          const aIssn = String(a.ISSN||a.issn||"").replace(/[^0-9Xx]/g,"") === digitsQ ? -1 : 1;
          const bIssn = String(b.ISSN||b.issn||"").replace(/[^0-9Xx]/g,"") === digitsQ ? -1 : 1;
          return aIssn - bIssn;
        });

        for(const item of ordered){
          const link = item.Link || item.link || (item.Jufo_ID ? `https://jufo-rest.csc.fi/v1.1/kanava/${item.Jufo_ID}` : null);
          if(!link) continue;
          const details = await getJSON(link);
          const level = getLevelFromKanava(details);
          if(level) return level; // current level
        }
        return null;
      };

      const digits = String(issn).replace(/[^0-9Xx]/g,'');
      const hyphenated = digits.length === 8 ? `${digits.slice(0,4)}-${digits.slice(4)}` : String(issn);
      (async () => {
        let out = await tryIssnQuery(issn);
        if(!out && hyphenated !== issn) out = await tryIssnQuery(hyphenated);
        if(!out && digits && digits !== issn && digits !== hyphenated) out = await tryIssnQuery(digits);
        window.__jufoCache.set(cacheKey, out);
        resolve(out);
      })();
    });
  }

  // Fallback: fetch JUFO level by name ('nimi') when ISSN not available
  function fetchJufoByName(name) {
    if(!name) return Promise.resolve(null);
    if(!window.__jufoNameCache) window.__jufoNameCache = new Map();
    const key = name.toLowerCase().trim();
    if(window.__jufoNameCache.has(key)) return Promise.resolve(window.__jufoNameCache.get(key));

    const getJSON = (url) => new Promise((res) => {
      try {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.onreadystatechange = function(){
          if(xhr.readyState === 4){
            try { if(xhr.status>=200 && xhr.status<300) res(JSON.parse(xhr.responseText)); else res(null);} catch{ res(null);} }
        };
        xhr.onerror = function(){ res(null); };
        xhr.send();
      } catch { res(null); }
    });

    const extractLevel = (payload) => {
      const arr = Array.isArray(payload) ? payload : (payload?.results || payload?.result || []);
      if(!Array.isArray(arr) || !arr.length) return null;
      // Sort to prefer closest name length (rough heuristic)
      const norm = (s)=>String(s||"").toLowerCase().replace(/[^a-z0-9 ]/g,'').trim();
      const qn = norm(name);
      arr.sort((a,b)=>{ const an=norm(a.Nimi||a.nimi||a.Name||a.name); const bn=norm(b.Nimi||b.nimi||b.Name||b.name); return Math.abs(an.length-qn.length)-Math.abs(bn.length-qn.length); });
      for(const row of arr){
        const raw = row?.Level ?? row?.level ?? row?.Julkaisufoorumitaso ?? row?.taso;
        const n = Number(String(raw||"").match(/^[0-9]+/)?.[0]);
        if(Number.isFinite(n) && n>0) return String(n);
      }
      return null;
    };

    return new Promise(async (resolve)=>{
      const url = `https://jufo-rest.csc.fi/v1.1/etsi.php?nimi=${encodeURIComponent(name)}`;
      const data = await getJSON(url);
      const level = extractLevel(data);
      window.__jufoNameCache.set(key, level);
      resolve(level);
    });
  }

  function getJufoBadge(level) {
    const span = $("<span>");
    if(!level) {
      return span.addClass("ccf-rank").addClass("JUFO_na").attr("data-jufo-badge","1").attr("title","JUFO: NA").text("NA");
    }
    const cls = `JUFO_${String(level).toLowerCase()}`; // levels are 1/2/3
    return span.addClass("ccf-rank").addClass(cls).attr("data-jufo-badge","1").attr("title",`JUFO: ${level}`).text(level);
  }

  function getRankSpan(refine, type, doi, elid, ISSN1, ISSN2, dblp_venue, dblp_doi, settings) {
    const container = $("<span>");
    if(!settings || settings.JUFO !== true) return container; // not selected

    const debug = (settings && ((settings.JUFO_DEBUG===true) || (String(settings.JUFO_DEBUG).toLowerCase()==='true'))) || (window.localStorage && window.localStorage.JUFO_DEBUG === 'true');
    const issnCandidates = [];
    if(ISSN1) issnCandidates.push(ISSN1);
    if(ISSN2) issnCandidates.push(ISSN2);

    const placeholder = getJufoBadge(null);
    container.append(placeholder);

    if(issnCandidates.length === 0) {
      // No ISSN candidates; rely on ensureByQuery & name fallback later
      if(debug) console.log("JUFO getRankSpan: no ISSNs for element", {elid, refine, type});
      return container;
    }

    (async () => {
      let level = null;
      for(const raw of issnCandidates) {
        const normalized = String(raw).replace(/[^0-9Xx-]/g,'');
        level = await fetchJufoByIssn(normalized);
        if(debug) console.log("JUFO getRankSpan ISSN attempt", raw, level);
        if(level) break;
      }
      if(!level && elid) {
        // attempt name fallback using element text (if present)
        try {
          const txt = typeof elid === 'string' ? $("#"+elid) : $(elid);
          const t = txt && txt.text ? txt.text().trim() : '';
          if(t) {
            level = await fetchJufoByName(t);
            if(debug) console.log("JUFO name fallback (direct)", t, level);
          }
        } catch(_){}
      }
      placeholder.replaceWith(getJufoBadge(level));
    })();

    return container;
  }

  function ensureByQuery(node, title, compl, author, settings) {
    try {
      if(!settings || settings.JUFO !== true) return;
      if(!title) return;
      const debug = (settings.JUFO_DEBUG === true) || (typeof settings.JUFO_DEBUG === 'string' && settings.JUFO_DEBUG.toLowerCase() === 'true') || (window.localStorage && window.localStorage.JUFO_DEBUG === 'true');
      const rows = Number(settings.JUFO_MAX_CROSSREF_ROWS)||8; // configurable breadth
      const api = `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(title + " " + (compl||""))}&rows=${rows}&select=DOI,container-title,ISSN`;
      const xhr = new XMLHttpRequest();
      xhr.open('GET', api, true);
      xhr.onreadystatechange = function(){
        if(xhr.readyState === 4) {
          try {
            const resp = JSON.parse(xhr.responseText).message;
            let cand = [];
            const containerTitles = [];
            if(resp && resp.items && resp.items.length) {
              for(const it of resp.items) {
                const issns = Array.isArray(it.ISSN) ? it.ISSN : (it.ISSN ? [it.ISSN] : []);
                cand.push(...issns);
                const cts = Array.isArray(it['container-title']) ? it['container-title'] : (it['container-title'] ? [it['container-title']] : []);
                for(const ct of cts) {
                  if(ct && containerTitles.indexOf(ct) === -1) containerTitles.push(ct);
                }
              }
            }
            // Optional user-provided hint patterns: settings.JUFO_CUSTOM_HINTS = [{pattern:"/regex/i", issn:"1234-5678"}, ...]
            const hints = Array.isArray(settings.JUFO_CUSTOM_HINTS) ? settings.JUFO_CUSTOM_HINTS : [];
            // Permanent hint for CHI / PACMHCI mismatch
            hints.push({ pattern: /CHI Conference|Human Factors in Computing Systems/i, issn: '2573-0142' });
            if(hints.length > 0) {
              try {
                const texts = [title, compl||""].concat(containerTitles);
                for(const hint of hints) {
                  if(!hint || !hint.pattern || !hint.issn) continue;
                  let re = hint.pattern;
                  if(typeof re === 'string') {
                    // Allow pattern strings like "/.../i"
                    const m = re.match(/^\s*\/(.*)\/(\w*)\s*$/);
                    if(m) re = new RegExp(m[1], m[2]);
                    else re = new RegExp(re, 'i');
                  }
                  for(const txt of texts) {
                    if(txt && re.test(txt)) cand.push(hint.issn);
                  }
                }
              } catch(_) { /* ignore bad hints */ }
            }
            // Normalize / dedupe
            const norm = (x)=>String(x).replace(/[^0-9Xx]/g,'').toUpperCase();
            const unique = [];
            const seen = new Set();
            for(const c of cand) { const n = norm(c); if(n && !seen.has(n)) { seen.add(n); unique.push(c); } }
            cand = unique;
            if(debug) console.log("JUFO ensureByQuery first pass", {title, compl, cand, containerTitles});
            (async () => {
              // Fallback: if no ISSNs yet, try container-title focused queries to harvest ISSNs
              async function harvestFromContainerTitles() {
                const newIssn = [];
                for(const ct of containerTitles) {
                  if(!ct) continue;
                  const url = `https://api.crossref.org/works?rows=3&select=ISSN,container-title&query.container-title=${encodeURIComponent(ct)}`;
                  if(debug) console.log("JUFO container query", ct, url);
                  try {
                    const r = await new Promise(res=>{ const x=new XMLHttpRequest(); x.open('GET',url,true); x.onreadystatechange=function(){ if(x.readyState===4){ try{ res(JSON.parse(x.responseText).message); }catch{ res(null);} } }; x.onerror=function(){res(null)}; x.send(); });
                    if(r && Array.isArray(r.items)) {
                      for(const it of r.items) {
                        const issns = Array.isArray(it.ISSN) ? it.ISSN : (it.ISSN ? [it.ISSN] : []);
                        for(const i of issns) { const n=norm(i); if(n && !seen.has(n)) { seen.add(n); newIssn.push(i); } }
                      }
                    }
                  } catch(_) { /* ignore */ }
                  if(newIssn.length) break; // stop early once we get something
                }
                if(newIssn.length) cand.push(...newIssn);
              }

              if(cand.length === 0) await harvestFromContainerTitles();
              if(debug && cand.length === 0) console.log("JUFO still no ISSNs after container-title harvest", {title});

              let level = null;
              for(const issn of cand) {
                level = await fetchJufoByIssn(issn);
                if(debug) console.log("JUFO probe", issn, level);
                if(level) break;
              }
              // If still no level, attempt harvest and retry once (in case we had ISSNs but none yielded)
              if(!level) {
                const beforeRetry = cand.slice();
                await harvestFromContainerTitles();
                const added = cand.filter(x=>beforeRetry.indexOf(x)===-1);
                if(debug && added.length) console.log("JUFO retry with new ISSNs", added);
                if(added.length) {
                  for(const issn of added) {
                    level = await fetchJufoByIssn(issn);
                    if(debug) console.log("JUFO retry probe", issn, level);
                    if(level) break;
                  }
                }
              }
              // Final fallback: try name lookups (title then container titles)
              if(!level) {
                const titleClean = String(title).replace(/\s+/g,' ').trim();
                if(titleClean) {
                  const nameLevel = await fetchJufoByName(titleClean);
                  if(debug) console.log("JUFO title name fallback", titleClean, nameLevel);
                  if(nameLevel) level = nameLevel;
                }
              }
              if(!level) {
                for(const ct of containerTitles) {
                  const cleaned = String(ct).replace(/\b\d{4}\b/g,'').trim();
                  const nameLevel = await fetchJufoByName(cleaned);
                  if(debug) console.log("JUFO container-title name fallback", cleaned, nameLevel);
                  if(nameLevel) { level = nameLevel; break; }
                }
              }
              const badge = getJufoBadge(level);
              try {
                const $node = $(node);
                // Replace existing placeholder if adjacent
                let replaced = false;
                const next = $node.next('[data-jufo-badge]');
                if(next && next.length) { next.replaceWith(badge); replaced = true; }
                if(!replaced) $node.after(badge);
                badge.attr('data-jufo-issn-candidates', cand.join(','));
              } catch(_){ }
              if(debug && !level) console.log("JUFO no level found final", {title, compl, candidates:cand});
            })();
          } catch(e) {
            // ignore
          }
        }
      };
      xhr.send();
    } catch(e) { /* noop */ }
  }

  // Register with existing pipeline if available
  if(window.scholar && Array.isArray(window.scholar.rankSpanList)) {
    window.scholar.rankSpanList.push(getRankSpan);
  }

  // Expose for testing
  window.jufo = { fetchJufoByIssn, fetchJufoByName, getJufoBadge, getRankSpan, ensureByQuery };
})();
