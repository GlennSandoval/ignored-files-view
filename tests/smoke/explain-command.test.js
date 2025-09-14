// Smoke test for the explain ignore rule command
const path = require("node:path");

function withMocks(run) {
  class EventEmitter {
    constructor() {
      this._handlers = [];
    }
    get event() {
      return (listener) => {
        this._handlers.push(listener);
      };
    }
    fire(value) {
      for (const h of this._handlers) h(value);
    }
  }
  class TreeItem {
    constructor(label, collapsibleState) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  }
  const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 };
  const Uri = { file: (fp) => ({ fsPath: fp, scheme: "file", path: fp }) };
  class ThemeIcon {
    constructor(id) {
      this.id = id;
    }
    static File = new ThemeIcon("file");
    static Folder = new ThemeIcon("folder");
  }

  const calls = { execute: [], info: [], opened: [] };
  const registered = { providers: {}, commands: {} };
  const workspace = {
    workspaceFolders: [],
    isTrusted: true,
    getConfiguration: () => ({ get: () => true }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
    openTextDocument: async (uri) => ({ uri }),
  };
  const vscode = {
    EventEmitter,
    TreeItem,
    TreeItemCollapsibleState,
    ThemeIcon,
    Uri,
    window: {
      createTreeView: (id, options) => {
        registered.providers[id] = options.treeDataProvider;
        return { dispose() {} };
      },
      showInformationMessage: async (msg, ...actions) => {
        calls.info.push({ msg, actions });
        // Simulate clicking "Open Rule"
        if (actions.includes("Open Rule")) return "Open Rule";
        return undefined;
      },
      showTextDocument: async (doc) => {
        calls.opened.push(doc.uri.fsPath);
        return { selection: {}, revealRange: () => {} };
      },
    },
    commands: {
      registerCommand: (id, fn) => {
        registered.commands[id] = fn;
        return { dispose() {} };
      },
      executeCommand: async (...args) => calls.execute.push(args),
    },
    workspace,
    env: { clipboard: { writeText: async () => {} } },
  };

  // Stub for './git'
  const gitStub = {
    async checkIgnoreVerbose(_cwd, rel) {
      return { source: ".gitignore", line: 2, pattern: "*.log", path: rel };
    },
    listIgnoredFiles: async () => ({ files: [], truncated: false }),
    clearIgnoredListCache: () => {},
  };

  const Module = require("node:module");
  const origLoad = Module._load;
  Module._load = function (...args) {
    const [request] = args;
    if (request === "vscode") return vscode;
    if (request === "./git" || request === "./git.js") return gitStub;
    return origLoad.apply(this, args);
  };

  try {
    return run({ vscode, registered, calls });
  } finally {
    Module._load = origLoad;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "Assertion failed");
}

withMocks(({ registered, calls, vscode }) => {
  const ext = require(path.join(process.cwd(), "dist", "extension.js"));
  const providerMod = require(path.join(process.cwd(), "dist", "ignored-tree-data-provider.js"));
  const { FileItem } = providerMod;
  ext.activate({ subscriptions: [] });

  // Workspace folder and a file item
  const root = { name: "root", uri: { fsPath: "/tmp/work" } };
  vscode.workspace.workspaceFolders = [root];
  const fileItem = new FileItem(root, "a.log");

  return Promise.resolve().then(async () => {
    await registered.commands["show-ignored.explain"](fileItem);
    // Should attempt to open .gitignore
    assert(calls.info.length >= 1, "info message shown");
    assert(
      calls.opened.some((p) => p.endsWith("/tmp/work/.gitignore")),
      "opened rule file",
    );
  });
});
