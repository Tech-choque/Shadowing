(() => {
  const $ = (id) => document.getElementById(id);
  const SDK = window.SpeechSDK;

  // 台本の {書いた形|実際の言い方} のうち、読み上げに「実際の言い方」を渡しても崩れないもの
  const SPEAK_AS_WRITTEN = new Set(["gonna", "wanna", "gotta", "kinda", "sorta", "lemme", "gimme", "outta", "lotta", "'em", "dunno", "gotcha", "ya"]);
  const AUDIO_VERSION = 1; // 音声の作り方を変えたら上げる（端末の保存分が作り直しになる）
  const CHUNK_WORDS = 450;  // 1回のAzure呼び出しの量（1回10分の上限より十分小さく）
  const CHUNK_VOICES = 40;  // 1回の呼び出しで声を切り替える回数（Azureの上限50より小さく）

  // ---------- settings (shared with the pronunciation page: same origin, same keys) ----------
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };
  $("key").value = store.get("iec.key") || "";
  $("region").value = store.get("iec.region") || "japaneast";
  $("b-save").onclick = () => { saveKey(); say("保存しました。"); };
  function saveKey() {
    store.set("iec.key", $("key").value.trim());
    store.set("iec.region", $("region").value.trim().toLowerCase());
  }

  const say = (msg, isErr) => { $("status").textContent = msg; if (isErr) $("status").dataset.err = ""; else delete $("status").dataset.err; };
  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));

  // ---------- markup ----------
  const RE_RUBY = /\{([^{}|]+)\|([^{}|]+)\}/g, RE_FLAP = /⟨([a-z]{1,2})⟩/g, RE_DROP = /\(([a-z])\)/g;
  const render = (md) => esc(md)
    .replace(RE_RUBY, '<ruby class="m-rd">$1<rt>$2</rt></ruby>')
    .replace(RE_FLAP, '<span class="m-fl">$1</span>')
    .replace(RE_DROP, '<span class="m-dr">$1</span>')
    .replace(/‿/g, '<span class="m-lk" aria-hidden="true">‿</span>');
  const spoken = (md) => md
    .replace(RE_RUBY, (m, written, said) => (SPEAK_AS_WRITTEN.has(said.toLowerCase()) ? said : written))
    .replace(RE_FLAP, "$1").replace(RE_DROP, "$1").replace(/‿/g, " ");
  document.querySelectorAll("[data-md]").forEach((el) => { el.innerHTML = render(el.dataset.md); });

  // ---------- audio cache (IndexedDB, this device only) ----------
  const idb = () => new Promise((res, rej) => {
    const r = indexedDB.open("shadowing", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("audio");
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  async function cacheGet(k) {
    try { const db = await idb(); return await new Promise((res) => { const q = db.transaction("audio").objectStore("audio").get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); }
    catch { return null; }
  }
  async function cachePut(k, v, keepIds) {
    try {
      const db = await idb();
      await new Promise((res) => {
        const tx = db.transaction("audio", "readwrite"), os = tx.objectStore("audio");
        os.put(v, k);
        const q = os.getAllKeys();
        q.onsuccess = () => q.result.forEach((key) => { if (key !== k && !keepIds.some((id) => String(key).startsWith(id + ":"))) os.delete(key); });
        tx.oncomplete = res; tx.onerror = res;
      });
    } catch {}
  }
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };

  // ---------- load & render ----------
  let script = null, lineEls = [], times = null, cacheKey = "", index = [];
  const fmt = (sec) => `${Math.floor(sec / 60)}分${String(Math.round(sec % 60)).padStart(2, "0")}秒`;

  async function boot() {
    try { index = await (await fetch("scripts/index.json", { cache: "no-cache" })).json(); }
    catch { $("title").textContent = "台本の一覧を読み込めませんでした"; return; }
    if (!index.length) { $("title").textContent = "まだ台本がありません"; return; }
    const wanted = location.hash.slice(1);
    const sel = $("week");
    sel.innerHTML = index.map((e) => `<option value="${e.id}">${e.id}　${esc(e.title_ja)}</option>`).join("");
    $("week-wrap").hidden = index.length < 2;
    sel.value = index.some((e) => e.id === wanted) ? wanted : index[0].id;
    sel.onchange = () => { location.hash = sel.value; load(sel.value); };
    load(sel.value);
  }

  async function load(id) {
    say("");
    try { script = await (await fetch(`scripts/${id}.json`, { cache: "no-cache" })).json(); }
    catch { $("title").textContent = "台本を読み込めませんでした"; return; }
    const cast = script.cast;
    $("eyebrow").textContent = `${script.id} の台本 · ${script.words.toLocaleString()}語`;
    $("title").textContent = script.title;
    $("title-ja").textContent = script.title_ja;
    $("cast").textContent = Object.values(cast).map((c) => `${c.name}（${c.role_ja}）`).join(" と ");
    document.title = `${script.title} · シャドーイング`;

    const ol = $("script");
    ol.replaceChildren(); lineEls = [];
    let n = 0;
    for (const l of script.lines) {
      if (l.scene) {
        const h = document.createElement("li"); h.className = "scene";
        h.innerHTML = `${esc(l.scene)}<span class="ja">${esc(l.ja)}</span>`; ol.append(h);
        continue;
      }
      n++;
      const c = cast[l.s];
      const li = document.createElement("li"); li.className = "line";
      li.tabIndex = 0; li.setAttribute("role", "button"); li.setAttribute("aria-pressed", "false");
      li.innerHTML = `<span class="num">${n}</span><div class="body"><div class="spk ${l.s}">${esc(c.name)}</div><p class="en">${render(l.en)}</p><p class="ja" lang="ja">${esc(l.ja)}</p></div>`;
      ol.append(li); lineEls.push(li);
    }

    cacheKey = `${script.id}:${hash(JSON.stringify([AUDIO_VERSION, cast, script.lines.map((l) => l.en || l.scene)]))}`;
    const hit = await cacheGet(cacheKey);
    if (hit) attach(hit); else detach();
  }

  // ---------- tap a line: English <-> Japanese (starts in English) ----------
  const toggle = (li) => { const on = li.classList.toggle("show-ja"); li.setAttribute("aria-pressed", String(on)); };
  $("script").addEventListener("click", (e) => { const li = e.target.closest(".line"); if (li) toggle(li); });
  $("script").addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const li = e.target.closest(".line"); if (li) { e.preventDefault(); toggle(li); }
  });

  // ---------- play count (this device only): +1 each time the audio plays to the end ----------
  const PLAYS_KEY = "sh.plays";
  const readPlays = () => { try { return JSON.parse(store.get(PLAYS_KEY) || "{}"); } catch { return {}; } };
  function showPlays() {
    const p = readPlays();
    $("plays-this").textContent = p[script.id] || 0;
    $("plays-all").textContent = Object.values(p).reduce((a, b) => a + b, 0);
  }
  $("audio").addEventListener("ended", () => {
    const p = readPlays(); p[script.id] = (p[script.id] || 0) + 1;
    store.set(PLAYS_KEY, JSON.stringify(p)); showPlays();
  });

  // ---------- player ----------
  let blobUrl = "";
  function detach() {
    times = null;
    $("audio").hidden = true; $("play-row").hidden = true; $("plays").hidden = true; $("make-row").hidden = false;
    $("audio").removeAttribute("src");
  }
  function attach({ blob, times: t, duration }) {
    times = t;
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    blobUrl = URL.createObjectURL(blob);
    const a = $("audio"); a.src = blobUrl; a.hidden = false;
    $("dl").href = blobUrl; $("dl").download = `shadowing-${script.id}.mp3`;
    $("make-row").hidden = true; $("play-row").hidden = false; $("plays").hidden = false;
    showPlays();
    say(`音声 ${fmt(duration)}（この端末に保存済み）`);
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: script.title, artist: "Shadowing", album: script.id });
    }
  }

  let current = -1;
  $("audio").addEventListener("timeupdate", () => {
    if (!times) return;
    const t = $("audio").currentTime;
    let lo = 0, hi = times.length - 1, i = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (times[mid] <= t) { i = mid; lo = mid + 1; } else hi = mid - 1; }
    if (i === current) return;
    if (current >= 0 && lineEls[current]) lineEls[current].classList.remove("now");
    current = i;
    if (i >= 0 && lineEls[i]) {
      lineEls[i].classList.add("now");
      if ($("follow").checked && document.visibilityState === "visible") lineEls[i].scrollIntoView({ block: "start", behavior: "smooth" });
    }
  });

  // ---------- synthesis (Azure) ----------
  // Azure のエラーには、原因に関係なく "websocket" が入ることが多い。判定は番号で行い、詳細は必ず添える
  const cancelText = (details) => {
    const d = (details && details.errorDetails) || "（詳細なし）";
    let head = "音声を作れませんでした。";
    if (/\b401\b|Unauthorized|authentication/i.test(d)) head = "キーが違うか、リージョンが合っていません。下の設定を見直してください。";
    else if (/\b(429|4429)\b|quota|throttl/i.test(d)) head = "Azureの無料枠の上限か、呼び出しが多すぎます。少し待ってから作り直してください。";
    else if (/\b1007\b/.test(d)) head = "Azureが台本の形式を受け付けませんでした。";
    else if (/\b1006\b/.test(d)) head = "Azureにつながりませんでした。通信状態を確かめてください。";
    return `${head}（詳細: ${d}）`;
  };

  function chunks() {
    const out = []; let cur = [], words = 0, voices = 0, idx = 0, sceneBreak = false;
    for (const l of script.lines) {
      if (l.scene) { sceneBreak = idx > 0; continue; }
      const text = spoken(l.en);
      const prev = cur[cur.length - 1];
      if (!prev || script.cast[prev.s].voice !== script.cast[l.s].voice) voices++;
      cur.push({ i: idx++, s: l.s, text, sceneBreak }); sceneBreak = false;
      words += text.split(/\s+/).length;
      if (words >= CHUNK_WORDS || voices >= CHUNK_VOICES) { out.push(cur); cur = []; words = 0; voices = 0; }
    }
    if (cur.length) out.push(cur);
    return out;
  }
  function ssml(chunk) {
    let body = "", open = null;
    for (const l of chunk) {
      const voice = script.cast[l.s].voice;
      if (voice !== open) { if (open) body += "</voice>"; body += `<voice name="${voice}">`; open = voice; }
      if (l.sceneBreak) body += '<break time="800ms"/>';
      body += `<bookmark mark="L${l.i}"/>${esc(l.text)} `;
    }
    if (open) body += "</voice>";
    return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">${body}</speak>`;
  }
  function synth(cfg, xml) {
    return new Promise((res, rej) => {
      const s = new SDK.SpeechSynthesizer(cfg, null);
      const marks = [];
      s.bookmarkReached = (_, e) => marks.push([e.text, e.audioOffset / 1e7]);
      s.speakSsmlAsync(xml, (r) => {
        s.close();
        if (r.reason === SDK.ResultReason.SynthesizingAudioCompleted) {
          const dur = r.audioDuration ? r.audioDuration / 1e7 : (r.audioData.byteLength * 8) / 48000;
          res({ audio: r.audioData, dur, marks });
        } else rej(new Error(cancelText(SDK.CancellationDetails.fromResult(r))));
      }, (e) => { s.close(); rej(new Error(`音声を作れませんでした。（詳細: ${e}）`)); });
    });
  }

  async function make() {
    if (!SDK) { say("音声の部品を読み込めませんでした。ページを開き直してください。", true); return; }
    const key = $("key").value.trim(), region = $("region").value.trim().toLowerCase();
    if (!key || !region) { $("settings").open = true; say("下の設定にAzureのキーとリージョンを入れてください。", true); return; }
    saveKey();
    const cfg = SDK.SpeechConfig.fromSubscription(key, region);
    cfg.speechSynthesisOutputFormat = SDK.SpeechSynthesisOutputFormat.Audio24Khz48KBitRateMonoMp3;

    const parts = chunks(), total = parts.reduce((a, c) => a + c.length, 0);
    const t = new Array(total).fill(0), audio = [];
    let offset = 0, lock = null;
    try { lock = await navigator.wakeLock?.request("screen"); } catch {}
    $("b-make").disabled = true; $("b-remake").disabled = true; $("bar").hidden = false;
    try {
      for (let k = 0; k < parts.length; k++) {
        say(`音声を作っています… ${k + 1} / ${parts.length}`);
        $("bar-fill").style.width = `${(k / parts.length) * 100}%`;
        const r = await synth(cfg, ssml(parts[k]));
        for (const [mark, sec] of r.marks) { const i = Number(mark.slice(1)); if (i >= 0 && i < total) t[i] = offset + sec; }
        audio.push(r.audio); offset += r.dur;
      }
      $("bar-fill").style.width = "100%";
      for (let i = 1; i < total; i++) if (!t[i]) t[i] = t[i - 1]; // 位置が取れなかった文は直前に合わせる
      const rec = { blob: new Blob(audio, { type: "audio/mpeg" }), times: t, duration: offset };
      await cachePut(cacheKey, rec, index.slice(0, 4).map((e) => e.id));
      attach(rec);
    } catch (e) {
      say(e.message || String(e), true);
    } finally {
      $("b-make").disabled = false; $("b-remake").disabled = false; $("bar").hidden = true;
      try { await lock?.release(); } catch {}
    }
  }
  $("b-make").onclick = make;
  $("b-remake").onclick = () => { detach(); make(); };

  boot();
})();
