// Library media database + topic-and-sentiment classifiers.
//
// Two-tier recommendation:
//   * BOOKS  — ≈25 curated titles spanning the major reading-room
//              categories at a typical academic library
//   * FILMS  — ≈15 films chosen for library-installation atmosphere
//              (philosophy, libraries, mathematics, biopic, sci-fi)
//
// Spoken input is supported in **English (primary)** and **Mandarin Chinese
// (for testing only)**. Chinese is handled by a small alias map that
// translates spoken topic words into the same English topic vocabulary
// the rest of the file uses. Output (titles, authors/directors, blurbs,
// the mood label on the avatar) is always English.
//
// To add new media: include 4-8 lowercase keywords/phrases a reader
// might say out loud when interested in that topic. For films add the
// director under `creator` and set `type: 'film'`.

export const MEDIA = [
  // ─── BOOKS ────────────────────────────────────────────────────────────
  // Philosophy / classics
  { type: 'book', title: 'The Republic',             creator: 'Plato',               topics: ['philosophy','justice','politics','plato','ethics','classical','republic','government','democracy'] },
  { type: 'book', title: 'Meditations',              creator: 'Marcus Aurelius',     topics: ['philosophy','stoicism','self','reflection','marcus','aurelius','virtue','wisdom'] },
  { type: 'book', title: 'Beyond Good and Evil',     creator: 'Friedrich Nietzsche', topics: ['philosophy','morality','nietzsche','metaphysics','existential','will'] },
  // Physics / cosmology / maths
  { type: 'book', title: 'A Brief History of Time',  creator: 'Stephen Hawking',     topics: ['physics','space','time','universe','cosmology','black hole','big bang','hawking','quantum','relativity'] },
  { type: 'book', title: 'Six Easy Pieces',          creator: 'Richard Feynman',     topics: ['physics','feynman','atoms','energy','quantum','science','easy'] },
  { type: 'book', title: 'Gödel, Escher, Bach',      creator: 'Douglas Hofstadter',  topics: ['mathematics','logic','music','consciousness','recursion','godel','escher','bach','formal'] },
  // Biology / evolution
  { type: 'book', title: 'The Selfish Gene',         creator: 'Richard Dawkins',     topics: ['biology','evolution','genetics','darwin','dawkins','gene','natural selection','species'] },
  { type: 'book', title: 'Sapiens',                  creator: 'Yuval Noah Harari',   topics: ['history','evolution','humanity','anthropology','civilization','sapiens','homo','agriculture','revolution'] },
  // Computer science / tech
  { type: 'book', title: 'Code: The Hidden Language',creator: 'Charles Petzold',     topics: ['computer','code','programming','electronics','hardware','binary','petzold','software','language'] },
  { type: 'book', title: 'The Pragmatic Programmer', creator: 'Hunt & Thomas',       topics: ['programming','software','engineer','code','craft','pragmatic','development','design'] },
  { type: 'book', title: 'Algorithms to Live By',    creator: 'Brian Christian',     topics: ['algorithm','computer science','decision','optimisation','sorting','search'] },
  // Psychology / behaviour
  { type: 'book', title: 'Thinking, Fast and Slow',  creator: 'Daniel Kahneman',     topics: ['psychology','decision','behavioural','bias','cognition','thinking','kahneman','heuristic','system'] },
  { type: 'book', title: 'Atomic Habits',            creator: 'James Clear',         topics: ['habits','self-help','productivity','behaviour','psychology','clear','routine','identity'] },
  { type: 'book', title: "Man's Search for Meaning", creator: 'Viktor Frankl',       topics: ['psychology','meaning','existential','frankl','holocaust','suffering','purpose'] },
  // Fiction / literature
  { type: 'book', title: '1984',                     creator: 'George Orwell',       topics: ['dystopia','politics','surveillance','totalitarian','freedom','orwell','big brother','language'] },
  { type: 'book', title: 'Brave New World',          creator: 'Aldous Huxley',       topics: ['dystopia','future','society','huxley','technology','conditioning','soma','utopia'] },
  { type: 'book', title: 'To Kill a Mockingbird',    creator: 'Harper Lee',          topics: ['fiction','justice','race','american','south','prejudice','lee','mockingbird','childhood'] },
  { type: 'book', title: 'One Hundred Years of Solitude', creator: 'Gabriel García Márquez', topics: ['fiction','magical realism','marquez','latin','family','solitude','colombia'] },
  { type: 'book', title: 'Pride and Prejudice',      creator: 'Jane Austen',         topics: ['fiction','romance','austen','english','class','marriage','regency'] },
  // History
  { type: 'book', title: 'Guns, Germs, and Steel',   creator: 'Jared Diamond',       topics: ['history','geography','diamond','civilization','agriculture','disease','colonial'] },
  { type: 'book', title: 'The Silk Roads',           creator: 'Peter Frankopan',     topics: ['history','silk road','asia','trade','empire','frankopan','world'] },
  // Architecture / urbanism (CASA-adjacent)
  { type: 'book', title: 'The Death and Life of Great American Cities', creator: 'Jane Jacobs', topics: ['city','urban','planning','street','jacobs','community','architecture','neighborhood'] },
  { type: 'book', title: 'Image of the City',        creator: 'Kevin Lynch',         topics: ['city','urban','wayfinding','perception','lynch','planning','mental map'] },
  { type: 'book', title: 'Soft City',                creator: 'David Sim',           topics: ['city','urban','density','soft','sim','street life','public space'] },
  // Library science / books about books
  { type: 'book', title: 'The Library at Night',     creator: 'Alberto Manguel',     topics: ['library','books','reading','culture','manguel','knowledge','night'] },
  { type: 'book', title: 'A History of Reading',     creator: 'Alberto Manguel',     topics: ['reading','history','books','library','manguel','literacy'] },

  // ─── FILMS ────────────────────────────────────────────────────────────
  // Films now carry a `mood` tag used by the sensor-driven recommender:
  //   atmospheric — dim, contemplative, slow-cinema   (low lux, still room)
  //   contemplative — quiet, big ideas                (low-mid lux, still or steady)
  //   classic — biopic, period, warm                  (mid lux, light motion)
  //   energetic — uplifting, pacy                     (high lux, motion present)
  { type: 'film', mood: 'atmospheric',  title: 'Wings of Desire',          creator: 'Wim Wenders',          topics: ['film','berlin','library','angel','philosophy','poetry','wenders','black white'] },
  { type: 'film', mood: 'atmospheric',  title: 'The Name of the Rose',     creator: 'Jean-Jacques Annaud',  topics: ['film','library','medieval','mystery','monastery','books','umberto eco','murder'] },
  { type: 'film', mood: 'contemplative',title: '2001: A Space Odyssey',    creator: 'Stanley Kubrick',      topics: ['film','space','ai','evolution','sci-fi','science','kubrick','hal','odyssey','classic'] },
  { type: 'film', mood: 'contemplative',title: 'Arrival',                  creator: 'Denis Villeneuve',     topics: ['film','linguistics','alien','communication','language','sci-fi','villeneuve','time'] },
  { type: 'film', mood: 'contemplative',title: 'Interstellar',             creator: 'Christopher Nolan',    topics: ['film','space','physics','time','nolan','sci-fi','relativity','black hole','interstellar'] },
  { type: 'film', mood: 'classic',      title: 'The Theory of Everything', creator: 'James Marsh',          topics: ['film','physics','hawking','biography','cosmology','marsh','biopic'] },
  { type: 'film', mood: 'energetic',    title: 'Hidden Figures',           creator: 'Theodore Melfi',       topics: ['film','mathematics','nasa','biography','race','melfi','women','science'] },
  { type: 'film', mood: 'classic',      title: 'A Beautiful Mind',         creator: 'Ron Howard',           topics: ['film','mathematics','biography','mental health','schizophrenia','nash','howard','genius'] },
  { type: 'film', mood: 'energetic',    title: 'The Imitation Game',       creator: 'Morten Tyldum',        topics: ['film','turing','computer','history','code','war','tyldum','cryptography','wwii'] },
  { type: 'film', mood: 'energetic',    title: 'Good Will Hunting',        creator: 'Gus Van Sant',         topics: ['film','mathematics','psychology','philosophy','van sant','boston','genius','friendship'] },
  { type: 'film', mood: 'classic',      title: 'Dead Poets Society',       creator: 'Peter Weir',           topics: ['film','poetry','education','literature','weir','school','teacher','carpe diem'] },
  { type: 'film', mood: 'atmospheric',  title: 'Cinema Paradiso',          creator: 'Giuseppe Tornatore',   topics: ['film','italian','cinema','nostalgia','tornatore','memory','projection','childhood'] },
  { type: 'film', mood: 'atmospheric',  title: 'The Reader',               creator: 'Stephen Daldry',       topics: ['film','reading','history','books','holocaust','daldry','literature','germany'] },
  { type: 'film', mood: 'contemplative',title: 'Spirited Away',            creator: 'Hayao Miyazaki',       topics: ['film','animation','japanese','miyazaki','spirits','fantasy','ghibli','girl'] },
  { type: 'film', mood: 'atmospheric',  title: 'Blade Runner 2049',        creator: 'Denis Villeneuve',     topics: ['film','sci-fi','dystopia','android','identity','villeneuve','memory','rain','future','city','urban','architecture'] },
];

/* ---------- Chinese → English topic alias map ----------
 * Supports Mandarin testing — when the recogniser is set to zh-CN, the
 * transcript will contain Chinese characters. We scan it for the keys
 * below and inject the English topic word into the matcher's word set.
 * The matched item itself is still rendered in English in the dashboard.
 */
const ZH_TO_TOPIC = {
  // subjects
  '物理':   'physics',
  '哲学':   'philosophy',
  '历史':   'history',
  '科幻':   'sci-fi',
  '小说':   'fiction',
  '诗':     'poetry',
  '诗歌':   'poetry',
  '文学':   'literature',
  '心理学': 'psychology',
  '心理':   'psychology',
  '艺术':   'art',
  '建筑':   'architecture',
  '城市':   'city',
  '编程':   'programming',
  '计算机': 'computer',
  '电脑':   'computer',
  '生物':   'biology',
  '进化':   'evolution',
  '图书馆': 'library',
  '阅读':   'reading',
  '科学':   'science',
  '数学':   'mathematics',
  '宇宙':   'universe space cosmology',
  '太空':   'space universe',
  '时间':   'time',
  '黑洞':   'black hole space',
  '基因':   'gene',
  '中世纪': 'medieval',
  '丝绸之路':'silk road',
  // media types
  '电影':   'film',
  '影片':   'film',
  '书':     'book',
  '书籍':   'book',
  // mood / themes
  '爱情':   'romance',
  '战争':   'war',
  '推理':   'mystery',
  '悬疑':   'mystery',
  '反乌托邦':'dystopia',
  // proper nouns
  '霍金':   'hawking',
  '图灵':   'turing',
  '柏拉图': 'plato',
  '尼采':   'nietzsche',
};

function expandWithChinese(text) {
  const lower = text.toLowerCase();
  const words = new Set(lower.split(/[^a-z']+/).filter(Boolean));
  for (const zh in ZH_TO_TOPIC) {
    if (text.includes(zh)) {
      ZH_TO_TOPIC[zh].split(' ').forEach((w) => words.add(w.toLowerCase()));
    }
  }
  return { lower, words };
}

/* ---------- Sentiment lexicon (English + minimal Chinese) ---------- */
const POS = new Set([
  'happy','love','great','wonderful','like','liked','good','beautiful','amazing','awesome',
  'enjoy','enjoyed','interesting','curious','wow','excellent','brilliant','fun','fascinating',
  'inspiring','delightful','exciting','perfect','best','glad','smart','clever',
]);
const NEG = new Set([
  'sad','hate','hated','bad','terrible','worried','angry','frustrated','boring','bored',
  'dull','tired','exhausted','awful','horrible','depressing','painful','annoying','disappointing',
  'difficult','hard','confused','confusing','worst','stupid',
]);
const QUESTION = new Set([
  'what','why','how','who','when','where','which','can','could','would','should','is','are',
  'does','do','did','will','tell',
]);
const ZH_POS = ['喜欢','爱','棒','好','优秀','美丽','有趣','想看','开心'];
const ZH_NEG = ['讨厌','糟','无聊','累','坏','差','不喜欢','悲伤'];
const ZH_QUESTION = ['什么','为什么','怎么','谁','哪个','哪里','吗','呢'];

export function classifySentiment(text) {
  const lower = text.toLowerCase();
  const enWords = lower.split(/[^a-z']+/).filter(Boolean);
  let p = 0, n = 0, q = 0;
  for (const w of enWords) {
    if (POS.has(w)) p++;
    else if (NEG.has(w)) n++;
    if (QUESTION.has(w)) q++;
  }
  for (const t of ZH_POS)      if (text.includes(t)) p++;
  for (const t of ZH_NEG)      if (text.includes(t)) n++;
  for (const t of ZH_QUESTION) if (text.includes(t)) q++;
  if (q >= 1 && p === 0 && n === 0) return 'thinking';
  if (p > n) return 'happy';
  if (n > p) return 'sad';
  return 'neutral';
}

/* ---------- Recommender ----------
 * Returns the best book OR film. Caller can read `.type` ('book'|'film')
 * to format the dashboard line correctly.
 */
export function recommend(text) {
  const { lower, words } = expandWithChinese(text);

  // Type bias: if the user explicitly asked for a film or a book, push
  // that media type to the front; if they asked for one, demote the other.
  const wantsFilm = words.has('film') || words.has('movie') || words.has('films') || words.has('movies') ||
                    /电影|影片/.test(text);
  const wantsBook = words.has('book') || words.has('books') || words.has('novel') || words.has('read') ||
                    /书籍|^书$|小说|阅读/.test(text);

  let best = null, bestScore = 0, bestMatched = [];
  for (const item of MEDIA) {
    let score = 0;
    const matched = [];
    for (const topic of item.topics) {
      if (topic.includes(' ')) {
        if (lower.includes(topic)) { score += 2; matched.push(topic); }
      } else {
        if (words.has(topic))      { score += 1; matched.push(topic); }
      }
    }
    if (score === 0) continue;
    // Type bias
    if (item.type === 'film' &&  wantsFilm)              score += 0.8;
    if (item.type === 'book' &&  wantsBook)              score += 0.8;
    if (item.type === 'film' &&  wantsBook && !wantsFilm) score -= 0.5;
    if (item.type === 'book' &&  wantsFilm && !wantsBook) score -= 0.5;
    if (score > bestScore) { bestScore = score; best = item; bestMatched = matched; }
  }
  if (!best) return null;
  return { ...best, matchedTopics: bestMatched, score: bestScore };
}

// Back-compat alias — main.js still calls recommendBook(text).
export const recommendBook = recommend;

/* ============================================================
 * Speech → BOOK recommender (books only)
 * ------------------------------------------------------------
 * The user speaks; we return the best-matching book and ignore
 * films. Used by the iPad's Listen mode.
 * ============================================================ */
export function recommendBookFromSpeech(text) {
  if (!text) return null;
  const { lower, words } = expandWithChinese(text);
  let best = null, bestScore = 0, bestMatched = [];
  for (const item of MEDIA) {
    if (item.type !== 'book') continue;
    let score = 0;
    const matched = [];
    for (const topic of item.topics) {
      if (topic.includes(' ')) {
        if (lower.includes(topic))   { score += 2; matched.push(topic); }
      } else {
        if (words.has(topic))        { score += 1; matched.push(topic); }
      }
    }
    if (score > bestScore) { bestScore = score; best = item; bestMatched = matched; }
  }
  return best ? { ...best, matchedTopics: bestMatched, score: bestScore } : null;
}

/* ============================================================
 * RFID book tags (RC522 + NTAG213 stickers)
 * ------------------------------------------------------------
 * Map each sticker's UID to a title in MEDIA. To enrol a book:
 *   1. Stick an NTAG213 inside the back cover.
 *   2. Place it on the sensor box; read the UID from the Arduino
 *      serial log ("[rfid] book ON uid=...") or curl /sensors.
 *   3. Add a row below: 'UID': 'Exact MEDIA title'.
 * Unknown UIDs still show as "Unknown book" + raw UID on the
 * dashboard — detection works before enrolment.
 * ============================================================ */
export const BOOK_TAGS = {
  // Demo sticker (Feiju ISO 14443-4). The HW-126 RC522 can't decode this card,
  // so the Arduino detects it by RF field-loading and reports this fixed UID.
  '5357E918950001': 'Image of the City',
  // '04A1B2C3':     'A Brief History of Time',
  // '04D5E6F708':   'The Library at Night',
};

export function bookByUid(uid) {
  if (!uid) return null;
  const title = BOOK_TAGS[uid.toUpperCase()];
  if (!title) return { type: 'book', title: 'Unknown book', creator: 'UID ' + uid, topics: [], unknown: true };
  const item = MEDIA.find((m) => m.type === 'book' && m.title === title);
  return item ? { ...item, uid } : null;
}

/* ============================================================
 * Sensor → FILM recommender (v3: VL53L0X + BME/BMP280 + RC522)
 * ------------------------------------------------------------
 * Inputs (all optional — degrade gracefully):
 *   - presence:    0|1   (reader within ~1 m, latched on Arduino)
 *   - distanceCm:  ToF distance to the reader
 *   - tempC, humidity:   ambient comfort
 *   - bookUid:     RFID tag of the book on the desk
 *   - lux, motion: legacy fields, still honoured if present
 *
 * Mood mapping:
 *   nobody there            → atmospheric   (room ambience)
 *   reader close (< 60 cm)  → contemplative (sitting, reading)
 *   reader mid  (60–120 cm) → classic       (settling in)
 *   reader far / passing    → energetic     (catch their eye)
 * Modifiers:
 *   cold  (< 18 °C)          → nudge classic → contemplative ("stay in")
 *   warm  (> 26 °C) or muggy (> 65 %) → nudge → atmospheric (calm down)
 * Book override:
 *   a recognised book on the desk → recommend the film sharing the
 *   most topics with that book (e.g. Hawking book → Theory of Everything).
 * ============================================================ */
const FILM_MOODS = ['atmospheric', 'contemplative', 'classic', 'energetic'];

export function pickMoodFromSensors(s = {}) {
  const { presence = null, distanceCm = null, tempC = null, humidity = null,
          lux = null, motion = 0 } = s;

  let mood;
  if (presence != null || distanceCm != null) {
    if (!presence)                 mood = 'atmospheric';
    else if (distanceCm != null && distanceCm < 60)  mood = 'contemplative';
    else if (distanceCm != null && distanceCm < 120) mood = 'classic';
    else                           mood = 'energetic';
  } else if (lux != null) {
    // legacy TEMT6000 path (browser mock / old firmware)
    if (lux < 120)      mood = motion ? 'contemplative' : 'atmospheric';
    else if (lux < 350) mood = motion ? 'classic'       : 'contemplative';
    else                mood = motion ? 'energetic'     : 'classic';
  } else {
    mood = motion ? 'classic' : 'contemplative';
  }

  // Comfort modifiers from BME/BMP280
  if (tempC != null && tempC < 18 && mood === 'classic')        mood = 'contemplative';
  if ((tempC != null && tempC > 26) || (humidity != null && humidity > 65)) {
    if (mood === 'energetic') mood = 'classic';
    else if (mood === 'classic') mood = 'atmospheric';
  }
  return mood;
}

function filmMatchingBook(book) {
  if (!book || !book.topics?.length) return null;
  let best = null, bestScore = 0;
  for (const m of MEDIA) {
    if (m.type !== 'film') continue;
    const score = m.topics.filter((t) => book.topics.includes(t)).length;
    if (score > bestScore) { bestScore = score; best = m; }
  }
  return best ? { ...best, matchedTopics: ['book: ' + book.title], score: bestScore } : null;
}

export function recommendFilmFromSensors(state = {}, seed = 0) {
  // 1. Book on the desk wins: recommend the film closest to what they're reading.
  if (state.bookUid) {
    const viaBook = filmMatchingBook(bookByUid(state.bookUid));
    if (viaBook) return viaBook;
  }
  // 2. Blend SPEECH (what the reader said — offline Vosk) with the ENVIRONMENT
  //    mood. Spoken topics weigh heavily; the ambient mood is a gentle tiebreaker.
  const mood = pickMoodFromSensors(state);
  const { lower, words } = state.speechText
    ? expandWithChinese(state.speechText)
    : { lower: '', words: new Set() };
  let best = null, bestScore = -1, bestMatched = [];
  for (const m of MEDIA) {
    if (m.type !== 'film') continue;
    let score = 0; const matched = [];
    for (const topic of m.topics) {
      if (topic.includes(' ')) { if (lower.includes(topic)) { score += 2; matched.push(topic); } }
      else if (words.has(topic)) { score += 2; matched.push(topic); }
    }
    if (m.mood === mood) score += 0.5;                 // environment nudge
    if (score > bestScore) { bestScore = score; best = m; bestMatched = matched; }
  }
  // 3. Nothing was said → fall back to a stable rotation within the mood bucket
  //    (deterministic in `seed` so the title doesn't flicker every frame).
  if (!best || bestMatched.length === 0) {
    const pool = MEDIA.filter((m) => m.type === 'film' && m.mood === mood);
    if (pool.length) {
      const idx = ((Math.floor(seed) % pool.length) + pool.length) % pool.length;
      return { ...pool[idx], matchedTopics: [mood], score: 1 };
    }
    return best ? { ...best, matchedTopics: [mood], score: 1 } : null;
  }
  return { ...best, matchedTopics: ['heard: ' + bestMatched.join(', ')], score: bestScore };
}
