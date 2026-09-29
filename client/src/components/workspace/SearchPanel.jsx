import { useDeferredValue, useMemo, useState } from "react";
import { CaseSensitive, Regex, Search } from "lucide-react";
import { useYVersion } from "../../collab/room.js";
import { FileIcon } from "../ui/index.jsx";
import { useWorkspace } from "./context.js";

const MAX_RESULTS = 500;

function highlightMatch(text, start, length) {
  const lead = Math.max(0, start - 30);
  return (
    <>
      {lead > 0 && "…"}
      {text.slice(lead, start)}
      <mark>{text.slice(start, start + length)}</mark>
      {text.slice(start + length, start + length + 80)}
    </>
  );
}

export default function SearchPanel() {
  const { files, contentOf, openFile } = useWorkspace();
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const contentVersion = useYVersion(contentOf);
  const deferredQuery = useDeferredValue(query);
  const deferredVersion = useDeferredValue(contentVersion);

  const { groups, total, error } = useMemo(() => {
    if (!deferredQuery) return { groups: [], total: 0 };
    let re;
    try {
      const source = useRegex ? deferredQuery : deferredQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      re = new RegExp(source, caseSensitive ? "g" : "gi");
    } catch (err) {
      return { groups: [], total: 0, error: err.message };
    }
    const out = [];
    let count = 0;
    for (const file of files) {
      const text = contentOf.get(file.id)?.toString() ?? "";
      const lines = text.split("\n");
      const hits = [];
      for (let i = 0; i < lines.length && count < MAX_RESULTS; i++) {
        re.lastIndex = 0;
        const m = re.exec(lines[i]);
        if (m && m[0].length > 0) {
          hits.push({ line: i + 1, col: m.index, length: m[0].length, text: lines[i] });
          count++;
        }
      }
      if (hits.length) out.push({ file, hits });
    }
    return { groups: out, total: count };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deferredQuery, caseSensitive, useRegex, files, deferredVersion]);

  return (
    <div className="search-panel">
      <div className="panel-header">
        <span className="panel-title">Search</span>
      </div>
      <div className="search-box">
        <div className="input-with-icon">
          <Search />
          <input
            className="input input-sm"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search all files"
            autoFocus
          />
        </div>
        <button
          className={`icon-btn sm ${caseSensitive ? "is-active" : ""}`}
          onClick={() => setCaseSensitive((v) => !v)}
          data-tip="Match case"
        >
          <CaseSensitive />
        </button>
        <button
          className={`icon-btn sm ${useRegex ? "is-active" : ""}`}
          onClick={() => setUseRegex((v) => !v)}
          data-tip="Regular expression"
        >
          <Regex />
        </button>
      </div>
      <div className="search-results">
        {error && <div className="form-error">{error}</div>}
        {query && !error && (
          <div className="search-summary">
            {total === 0
              ? "No results"
              : `${total}${total >= MAX_RESULTS ? "+" : ""} result${total === 1 ? "" : "s"} in ${groups.length} file${groups.length === 1 ? "" : "s"}`}
          </div>
        )}
        {groups.map(({ file, hits }) => (
          <div key={file.id} className="search-group">
            <button className="search-file" onClick={() => openFile(file.id)}>
              <FileIcon name={file.name} />
              <span>{file.name}</span>
              <span className="muted search-path">{file.path}</span>
              <span className="search-count">{hits.length}</span>
            </button>
            {hits.map((h) => (
              <button key={`${h.line}-${h.col}`} className="search-hit" onClick={() => openFile(file.id, { line: h.line })}>
                <span className="search-ln">{h.line}</span>
                <span className="search-text">{highlightMatch(h.text, h.col, h.length)}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
