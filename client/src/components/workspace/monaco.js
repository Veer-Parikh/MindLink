import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import TsWorker from "monaco-editor/language/typescript/ts.worker.js?worker";
import CssWorker from "monaco-editor/language/css/css.worker.js?worker";
import HtmlWorker from "monaco-editor/language/html/html.worker.js?worker";
import JsonWorker from "monaco-editor/language/json/json.worker.js?worker";

// Monaco's core editor worker is only referenced as a plain URL (which Vite copies but doesn't bundle),
// and once MonacoEnvironment.getWorker exists Monaco routes *every* worker through it — so supply them all.
self.MonacoEnvironment = {
  getWorker(_workerId, label) {
    switch (label) {
      case "typescript":
      case "javascript":
        return new TsWorker();
      case "css":
      case "scss":
      case "less":
        return new CssWorker();
      case "html":
      case "handlebars":
      case "razor":
        return new HtmlWorker();
      case "json":
        return new JsonWorker();
      default:
        return new EditorWorker();
    }
  },
};

let configured = false;

export function setupMonaco() {
  if (configured) return monaco;
  configured = true;

  monaco.editor.defineTheme("mindlink", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "6b7389", fontStyle: "italic" },
      { token: "keyword", foreground: "c792ea" },
      { token: "keyword.control", foreground: "c792ea" },
      { token: "string", foreground: "a5d6a7" },
      { token: "string.escape", foreground: "89ddff" },
      { token: "number", foreground: "f78c6c" },
      { token: "regexp", foreground: "89ddff" },
      { token: "type", foreground: "ffcb6b" },
      { token: "type.identifier", foreground: "ffcb6b" },
      { token: "identifier", foreground: "d6deeb" },
      { token: "delimiter", foreground: "8c96ad" },
      { token: "tag", foreground: "f07178" },
      { token: "attribute.name", foreground: "c792ea" },
      { token: "attribute.value", foreground: "a5d6a7" },
      { token: "metatag", foreground: "82aaff" },
      { token: "variable", foreground: "d6deeb" },
      { token: "variable.predefined", foreground: "82aaff" },
    ],
    colors: {
      "editor.background": "#0b0d13",
      "editor.foreground": "#d6deeb",
      "editorLineNumber.foreground": "#3a4254",
      "editorLineNumber.activeForeground": "#9aa3b8",
      "editorCursor.foreground": "#22d3ee",
      "editor.lineHighlightBackground": "#ffffff07",
      "editor.lineHighlightBorder": "#00000000",
      "editor.selectionBackground": "#22d3ee33",
      "editor.inactiveSelectionBackground": "#22d3ee1a",
      "editor.selectionHighlightBackground": "#a78bfa1f",
      "editor.wordHighlightBackground": "#a78bfa1a",
      "editor.findMatchBackground": "#fbbf2455",
      "editor.findMatchHighlightBackground": "#fbbf2426",
      "editorIndentGuide.background1": "#ffffff0b",
      "editorIndentGuide.activeBackground1": "#ffffff22",
      "editorBracketMatch.background": "#22d3ee22",
      "editorBracketMatch.border": "#22d3ee55",
      "editorGutter.background": "#0b0d13",
      "editorWidget.background": "#141822",
      "editorWidget.border": "#ffffff1a",
      "editorSuggestWidget.background": "#141822",
      "editorSuggestWidget.border": "#ffffff1a",
      "editorSuggestWidget.selectedBackground": "#22d3ee1f",
      "editorHoverWidget.background": "#141822",
      "editorHoverWidget.border": "#ffffff1a",
      "scrollbarSlider.background": "#ffffff14",
      "scrollbarSlider.hoverBackground": "#ffffff22",
      "scrollbarSlider.activeBackground": "#ffffff2c",
      "minimap.background": "#0b0d13",
      "diffEditor.insertedTextBackground": "#4ade8024",
      "diffEditor.removedTextBackground": "#f8717126",
      "diffEditor.insertedLineBackground": "#4ade8012",
      "diffEditor.removedLineBackground": "#f8717112",
      "editorOverviewRuler.border": "#00000000",
      focusBorder: "#22d3ee66",
    },
  });

  const ts = monaco.typescript;
  if (ts) {
    const compilerOptions = {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      allowNonTsExtensions: true,
      allowJs: true,
      checkJs: false,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
      strict: false,
    };
    ts.typescriptDefaults.setCompilerOptions(compilerOptions);
    ts.javascriptDefaults.setCompilerOptions(compilerOptions);
    // Browser-runner projects import sibling files; unresolved package imports shouldn't scream.
    ts.typescriptDefaults.setDiagnosticsOptions({ diagnosticCodesToIgnore: [2307, 2792] });
  }
  return monaco;
}

export const EDITOR_OPTIONS = {
  theme: "mindlink",
  fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', Consolas, monospace",
  fontSize: 13.5,
  lineHeight: 22,
  fontLigatures: true,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  smoothScrolling: true,
  cursorSmoothCaretAnimation: "on",
  cursorBlinking: "smooth",
  renderLineHighlight: "all",
  padding: { top: 16, bottom: 16 },
  glyphMargin: true,
  folding: true,
  bracketPairColorization: { enabled: true },
  guides: { bracketPairs: "active", indentation: true },
  automaticLayout: true,
  tabSize: 2,
  stickyScroll: { enabled: false },
  fixedOverflowWidgets: true,
  scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
};

export { monaco };
