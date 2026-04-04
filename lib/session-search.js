var fs = require("fs");
var path = require("path");

// ============================================================================
// session-search.js - Unified BM25 search for Clay
//
// Single module for ALL search: digests, session history, palette, mate context.
// Callers pass data in, get results out. No BM25 logic leaks outside this file.
// ============================================================================

// --- BM25 Parameters ---
var K1 = 1.2;   // term frequency saturation
var B = 0.75;    // document length normalization
var MAX_RESULTS = 10;

// --- Searchable session history entry types ---
var SEARCHABLE_TYPES = {
  "user_message": true,
  "delta": true,
  "mention_user": true,
  "mention_response": true,
  "debate_turn_done": true
};

// ==========================================================================
// 1. BM25 CORE - tokenizer, index builder, scorer
// ==========================================================================

var STOPWORDS = {
  // English
  "the": 1, "a": 1, "an": 1, "is": 1, "are": 1, "was": 1, "were": 1,
  "be": 1, "been": 1, "being": 1, "have": 1, "has": 1, "had": 1,
  "do": 1, "does": 1, "did": 1, "will": 1, "would": 1, "could": 1,
  "should": 1, "may": 1, "might": 1, "shall": 1, "can": 1,
  "to": 1, "of": 1, "in": 1, "for": 1, "on": 1, "with": 1, "at": 1,
  "by": 1, "from": 1, "as": 1, "into": 1, "through": 1, "about": 1,
  "and": 1, "or": 1, "but": 1, "not": 1, "so": 1, "if": 1, "then": 1,
  "it": 1, "its": 1, "this": 1, "that": 1, "these": 1, "those": 1,
  "i": 1, "me": 1, "my": 1, "we": 1, "our": 1, "you": 1, "your": 1,
  "he": 1, "she": 1, "they": 1, "them": 1, "their": 1,
  "what": 1, "which": 1, "who": 1, "when": 1, "where": 1, "how": 1,
  "all": 1, "each": 1, "every": 1, "both": 1, "few": 1, "more": 1,
  "other": 1, "some": 1, "such": 1, "no": 1, "nor": 1, "only": 1,
  "own": 1, "same": 1, "than": 1, "too": 1, "very": 1,
  "just": 1, "also": 1, "now": 1, "here": 1, "there": 1,
  "null": 1, "none": 1, "n/a": 1,
  // Korean particles/connectors
  "\uC740": 1, "\uB294": 1, "\uC774": 1, "\uAC00": 1, "\uC744": 1, "\uB97C": 1,
  "\uC758": 1, "\uC5D0": 1, "\uC5D0\uC11C": 1, "\uB85C": 1, "\uC73C\uB85C": 1,
  "\uB3C4": 1, "\uB9CC": 1, "\uAE4C\uC9C0": 1, "\uBD80\uD130": 1,
  "\uADF8": 1, "\uC800": 1, "\uB098": 1, "\uB108": 1,
};

function isCJK(ch) {
  var code = ch.charCodeAt(0);
  return (code >= 0xAC00 && code <= 0xD7AF) ||
         (code >= 0x3130 && code <= 0x318F) ||
         (code >= 0x4E00 && code <= 0x9FFF) ||
         (code >= 0x3400 && code <= 0x4DBF);
}

/**
 * Tokenize text for BM25. Handles mixed Korean/English.
 * Korean: whole words + character bigrams. English: whole words.
 */
function tokenize(text) {
  if (!text || typeof text !== "string") return [];

  var tokens = [];
  var words = text.toLowerCase().split(/[\s,.\-:;!?'"()\[\]{}<>|/\\@#$%^&*+=~`]+/);

  for (var i = 0; i < words.length; i++) {
    var word = words[i].trim();
    if (!word || word.length < 2) continue;
    if (STOPWORDS[word]) continue;

    var hasCJK = false;
    for (var c = 0; c < word.length; c++) {
      if (isCJK(word[c])) { hasCJK = true; break; }
    }

    if (hasCJK) {
      if (word.length >= 2) tokens.push(word);
      for (var bi = 0; bi < word.length - 1; bi++) {
        if (isCJK(word[bi]) || isCJK(word[bi + 1])) {
          tokens.push(word[bi] + word[bi + 1]);
        }
      }
    } else {
      tokens.push(word);
    }
  }

  return tokens;
}

/**
 * Build BM25 index from generic documents.
 * @param {Array} docs - [{ id: any, text: string, meta: any }]
 * @returns {object} Index for searchIndex()
 */
function buildIndex(docs) {
  var indexed = [];
  var df = {};
  var totalLength = 0;

  for (var i = 0; i < docs.length; i++) {
    var tokens = tokenize(docs[i].text);
    var docTerms = {};
    var tf = {};

    for (var t = 0; t < tokens.length; t++) {
      var term = tokens[t];
      tf[term] = (tf[term] || 0) + 1;
      docTerms[term] = true;
    }

    var terms = Object.keys(docTerms);
    for (var dt = 0; dt < terms.length; dt++) {
      df[terms[dt]] = (df[terms[dt]] || 0) + 1;
    }

    indexed.push({ id: docs[i].id, tf: tf, length: tokens.length, meta: docs[i].meta });
    totalLength += tokens.length;
  }

  return { docs: indexed, df: df, N: indexed.length, avgdl: indexed.length > 0 ? totalLength / indexed.length : 0 };
}

/**
 * Search a BM25 index. Returns [{ id, score, meta }] sorted by score desc.
 */
function searchIndex(index, query, maxResults) {
  if (!index || index.N === 0) return [];
  maxResults = maxResults || MAX_RESULTS;

  var queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  // Deduplicate
  var seen = {};
  var unique = [];
  for (var q = 0; q < queryTokens.length; q++) {
    if (!seen[queryTokens[q]]) {
      seen[queryTokens[q]] = true;
      unique.push(queryTokens[q]);
    }
  }

  var scores = [];
  for (var d = 0; d < index.docs.length; d++) {
    var doc = index.docs[d];
    var score = 0;

    for (var qt = 0; qt < unique.length; qt++) {
      var term = unique[qt];
      var termFreq = doc.tf[term] || 0;
      if (termFreq === 0) continue;

      var docFreq = index.df[term] || 0;
      var idf = Math.log((index.N - docFreq + 0.5) / (docFreq + 0.5) + 1);
      var tfNorm = (termFreq * (K1 + 1)) /
        (termFreq + K1 * (1 - B + B * doc.length / index.avgdl));

      score += idf * tfNorm;
    }

    if (score > 0) {
      scores.push({ id: doc.id, score: score, meta: doc.meta });
    }
  }

  scores.sort(function (a, b) { return b.score - a.score; });
  return scores.slice(0, maxResults);
}

// ==========================================================================
// 2. DATA SOURCES - convert various data into generic {id, text, meta} docs
// ==========================================================================

/**
 * Convert a digest entry into a searchable document.
 * Important fields get repeated for higher BM25 weight.
 */
function digestToDoc(digest, lineIdx) {
  var parts = [];
  // High weight
  if (digest.topic) { parts.push(digest.topic); parts.push(digest.topic); }
  if (digest.tags && digest.tags.length) {
    var tagStr = digest.tags.join(" ");
    parts.push(tagStr); parts.push(tagStr);
  }
  // Medium weight
  if (digest.summary) parts.push(digest.summary);
  if (digest.key_quotes && digest.key_quotes.length) parts.push(digest.key_quotes.join(" "));
  if (digest.user_intent) parts.push(digest.user_intent);
  if (digest.user_context) parts.push(digest.user_context);
  // Normal weight
  if (digest.my_position) parts.push(digest.my_position);
  if (digest.decisions) parts.push(digest.decisions);
  if (digest.open_items) parts.push(digest.open_items);
  if (digest.user_sentiment) parts.push(digest.user_sentiment);
  if (digest.other_perspectives) parts.push(digest.other_perspectives);
  if (digest.outcome) parts.push(digest.outcome);
  if (digest.my_role) parts.push(digest.my_role);

  return { id: "digest:" + lineIdx, text: parts.join(" "), meta: { source: "digest", lineIdx: lineIdx, digest: digest } };
}

/**
 * Convert a session's history into searchable documents.
 * Groups consecutive deltas into turns for better context.
 * Each "turn" (user message or assistant response block) becomes one document.
 */
function sessionHistoryToDocs(session) {
  var docs = [];
  var history = session.history || [];
  var sessionMeta = {
    sessionId: session.localId || session.cliSessionId,
    sessionTitle: session.title || "New Session"
  };
  var currentText = "";
  var currentType = null;
  var turnIdx = 0;

  function flushTurn() {
    var text = currentText.trim();
    if (text && text.length > 10) {
      docs.push({
        id: "session:" + sessionMeta.sessionId + ":turn:" + turnIdx,
        text: text,
        meta: {
          source: "session",
          sessionId: sessionMeta.sessionId,
          sessionTitle: sessionMeta.sessionTitle,
          turnIdx: turnIdx,
          turnType: currentType,
          snippet: text.length > 200 ? text.substring(0, 200) + "..." : text
        }
      });
      turnIdx++;
    }
    currentText = "";
    currentType = null;
  }

  for (var i = 0; i < history.length; i++) {
    var entry = history[i];
    if (!SEARCHABLE_TYPES[entry.type]) continue;
    if (!entry.text) continue;

    if (entry.type === "user_message" || entry.type === "mention_user") {
      // New turn boundary
      flushTurn();
      currentType = entry.type;
      currentText = entry.text;
    } else if (entry.type === "delta") {
      // Continuation of assistant response
      if (currentType !== "delta") flushTurn();
      currentType = "delta";
      currentText += entry.text;
    } else {
      // mention_response, debate_turn_done
      flushTurn();
      currentType = entry.type;
      currentText = entry.text;
    }
  }
  flushTurn();

  return docs;
}

/**
 * Load digests from JSONL file into doc array.
 */
function loadDigestDocs(digestFilePath, opts) {
  opts = opts || {};
  var docs = [];
  try {
    if (!fs.existsSync(digestFilePath)) return docs;
    var lines = fs.readFileSync(digestFilePath, "utf8").trim().split("\n");
    for (var i = 0; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      try {
        var entry = JSON.parse(lines[i]);
        // Date filter
        if (opts.dateFrom && entry.date && entry.date < opts.dateFrom) continue;
        if (opts.dateTo && entry.date && entry.date > opts.dateTo) continue;
        docs.push(digestToDoc(entry, i));
      } catch (e) {}
    }
  } catch (e) {}
  return docs;
}

// ==========================================================================
// 3. HIGH-LEVEL SEARCH APIs - the public interface
// ==========================================================================

/**
 * Search a mate's digests.
 * @param {string} digestFilePath
 * @param {string} query
 * @param {object} opts - { maxResults, minScore, dateFrom, dateTo }
 * @returns {Array} [{ digest, score, lineIdx }]
 */
function searchDigests(digestFilePath, query, opts) {
  opts = opts || {};
  if (!query || !query.trim()) return [];

  var docs = loadDigestDocs(digestFilePath, opts);
  if (docs.length === 0) return [];

  var index = buildIndex(docs);
  var results = searchIndex(index, query, opts.maxResults || MAX_RESULTS);

  if (opts.minScore) {
    results = results.filter(function (r) { return r.score >= opts.minScore; });
  }

  // Map back to caller-friendly format
  return results.map(function (r) {
    return { digest: r.meta.digest, score: r.score, lineIdx: r.meta.lineIdx };
  });
}

/**
 * Search a mate's session history (full conversation turns).
 * @param {Array} sessions - Array of session objects with .history, .localId, .title
 * @param {string} query
 * @param {object} opts - { maxResults, minScore }
 * @returns {Array} [{ sessionId, sessionTitle, turnIdx, turnType, snippet, score }]
 */
function searchSessions(sessions, query, opts) {
  opts = opts || {};
  if (!query || !query.trim() || !sessions || sessions.length === 0) return [];

  var docs = [];
  for (var s = 0; s < sessions.length; s++) {
    var sessionDocs = sessionHistoryToDocs(sessions[s]);
    for (var d = 0; d < sessionDocs.length; d++) {
      docs.push(sessionDocs[d]);
    }
  }

  if (docs.length === 0) return [];

  var index = buildIndex(docs);
  var results = searchIndex(index, query, opts.maxResults || MAX_RESULTS);

  if (opts.minScore) {
    results = results.filter(function (r) { return r.score >= opts.minScore; });
  }

  return results.map(function (r) {
    return {
      sessionId: r.meta.sessionId,
      sessionTitle: r.meta.sessionTitle,
      turnIdx: r.meta.turnIdx,
      turnType: r.meta.turnType,
      snippet: r.meta.snippet,
      score: r.score
    };
  });
}

/**
 * Unified mate search: digests + session history combined.
 * Returns merged, re-ranked results from both sources.
 * @param {object} opts - { digestFilePath, sessions, query, maxResults, minScore }
 * @returns {Array} [{ source: "digest"|"session", score, ... }]
 */
function searchMate(opts) {
  if (!opts || !opts.query || !opts.query.trim()) return [];
  var maxResults = opts.maxResults || MAX_RESULTS;
  var allDocs = [];

  // Collect digest docs
  if (opts.digestFilePath) {
    var digestDocs = loadDigestDocs(opts.digestFilePath);
    for (var dd = 0; dd < digestDocs.length; dd++) allDocs.push(digestDocs[dd]);
  }

  // Collect session history docs
  if (opts.sessions && opts.sessions.length > 0) {
    for (var si = 0; si < opts.sessions.length; si++) {
      var sDocs = sessionHistoryToDocs(opts.sessions[si]);
      for (var sd = 0; sd < sDocs.length; sd++) allDocs.push(sDocs[sd]);
    }
  }

  if (allDocs.length === 0) return [];

  // Build unified index across both sources and search
  var index = buildIndex(allDocs);
  var results = searchIndex(index, opts.query, maxResults);

  if (opts.minScore) {
    results = results.filter(function (r) { return r.score >= opts.minScore; });
  }

  return results.map(function (r) {
    var out = { source: r.meta.source, score: r.score };
    if (r.meta.source === "digest") {
      out.digest = r.meta.digest;
      out.lineIdx = r.meta.lineIdx;
    } else {
      out.sessionId = r.meta.sessionId;
      out.sessionTitle = r.meta.sessionTitle;
      out.turnIdx = r.meta.turnIdx;
      out.turnType = r.meta.turnType;
      out.snippet = r.meta.snippet;
    }
    return out;
  });
}

/**
 * Search for command palette (Cmd+K). Replaces substring search in server.js.
 * Accepts pre-collected session data from all projects.
 *
 * @param {Array} projectSessions - [{ projectSlug, projectTitle, projectIcon, isMate, mateId, sessions }]
 *   where sessions = [{ localId, title, history, lastActivity, hidden }]
 * @param {string} query
 * @param {object} opts - { maxResults }
 * @returns {Array} [{ projectSlug, projectTitle, projectIcon, sessionId, sessionTitle, lastActivity, matchType, snippet, score, isMate, mateId }]
 */
function searchPalette(projectSessions, query, opts) {
  opts = opts || {};
  if (!query || !query.trim()) return [];
  var maxResults = opts.maxResults || 30;

  var allDocs = [];

  for (var p = 0; p < projectSessions.length; p++) {
    var proj = projectSessions[p];
    var sessions = proj.sessions || [];

    for (var s = 0; s < sessions.length; s++) {
      var session = sessions[s];
      if (session.hidden) continue;

      // Title as a separate high-weight doc
      var title = session.title || "New Session";
      allDocs.push({
        id: "title:" + proj.projectSlug + ":" + session.localId,
        text: title + " " + title, // double weight for title
        meta: {
          source: "palette",
          projectSlug: proj.projectSlug,
          projectTitle: proj.projectTitle,
          projectIcon: proj.projectIcon || null,
          sessionId: session.localId,
          sessionTitle: title,
          lastActivity: session.lastActivity || session.createdAt || 0,
          isMate: proj.isMate || false,
          mateId: proj.mateId || null,
          matchType: "title",
          snippet: null
        }
      });

      // Content turns as docs
      var turnDocs = sessionHistoryToDocs(session);
      for (var td = 0; td < turnDocs.length; td++) {
        var turnDoc = turnDocs[td];
        allDocs.push({
          id: turnDoc.id,
          text: turnDoc.text,
          meta: {
            source: "palette",
            projectSlug: proj.projectSlug,
            projectTitle: proj.projectTitle,
            projectIcon: proj.projectIcon || null,
            sessionId: session.localId,
            sessionTitle: title,
            lastActivity: session.lastActivity || session.createdAt || 0,
            isMate: proj.isMate || false,
            mateId: proj.mateId || null,
            matchType: "content",
            snippet: turnDoc.meta.snippet
          }
        });
      }
    }
  }

  if (allDocs.length === 0) return [];

  var index = buildIndex(allDocs);
  var raw = searchIndex(index, query, maxResults * 3); // over-fetch for dedup

  // Deduplicate: keep best match per session
  var bestPerSession = {};
  for (var r = 0; r < raw.length; r++) {
    var m = raw[r].meta;
    var key = m.projectSlug + ":" + m.sessionId;
    if (!bestPerSession[key] || raw[r].score > bestPerSession[key].score) {
      bestPerSession[key] = {
        projectSlug: m.projectSlug,
        projectTitle: m.projectTitle,
        projectIcon: m.projectIcon,
        sessionId: m.sessionId,
        sessionTitle: m.sessionTitle,
        lastActivity: m.lastActivity,
        matchType: m.matchType,
        snippet: m.snippet,
        score: raw[r].score,
        isMate: m.isMate,
        mateId: m.mateId
      };
      // If we already have a title match, upgrade to "both"
    } else if (bestPerSession[key].matchType !== m.matchType) {
      bestPerSession[key].matchType = "both";
      if (m.snippet && !bestPerSession[key].snippet) {
        bestPerSession[key].snippet = m.snippet;
      }
    }
  }

  // Sort by score desc, take top results
  var deduped = Object.keys(bestPerSession).map(function (k) { return bestPerSession[k]; });
  deduped.sort(function (a, b) { return b.score - a.score; });
  return deduped.slice(0, maxResults);
}

// ==========================================================================
// 4. FORMATTERS - convert search results to context strings
// ==========================================================================

/**
 * Format search results for injection into mate mention/DM context.
 * Includes both digest and session history results.
 * @param {Array} results - output from searchMate()
 * @returns {string} Formatted context string, or "" if empty
 */
function formatForContext(results) {
  if (!results || results.length === 0) return "";

  var lines = ["\n\nRelevant past context (searched by current topic):"];

  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    var scorePct = Math.round(r.score * 10) / 10;

    if (r.source === "digest") {
      var d = r.digest;
      var line = "- [" + (d.date || "?") + "] ";
      if (d.type === "debate" && d.my_role) {
        line += "DEBATE (role: " + d.my_role + ") ";
      }
      line += (d.topic || "unknown");
      if (d.summary) line += " -- " + d.summary;
      if (d.my_position) line += " | Position: " + d.my_position;
      if (d.decisions) line += " | Decisions: " + d.decisions;
      if (d.key_quotes && d.key_quotes.length > 0) {
        line += " | Quotes: " + d.key_quotes.slice(0, 2).join("; ");
      }
      line += " (relevance: " + scorePct + ")";
      lines.push(line);
    } else if (r.source === "session") {
      var line = "- [session: " + (r.sessionTitle || "?") + "] ";
      line += (r.snippet || "(no preview)");
      line += " (relevance: " + scorePct + ")";
      lines.push(line);
    }
  }

  return lines.join("\n");
}

/**
 * Format digest search results for the memory UI panel.
 * @param {Array} results - output from searchDigests()
 * @returns {Array} [{ entry, score }]
 */
function formatForMemoryUI(results) {
  return results.map(function (r) {
    var entry = r.digest;
    entry.index = r.lineIdx;
    return { entry: entry, score: Math.round(r.score * 100) / 100 };
  });
}

module.exports = {
  // Core (exposed for testing / advanced use)
  tokenize: tokenize,
  buildIndex: buildIndex,
  searchIndex: searchIndex,

  // High-level search APIs
  searchDigests: searchDigests,
  searchSessions: searchSessions,
  searchMate: searchMate,
  searchPalette: searchPalette,

  // Formatters
  formatForContext: formatForContext,
  formatForMemoryUI: formatForMemoryUI,
};
