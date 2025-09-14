// Additional smoke tests focusing on provider tree building and config handling
const path = require("node:path");
const assert = require("node:assert");

function withMocks(run) {
  // Minimal EventEmitter compatible with extension expectations
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
  const Uri = {
    file(fp) {
      return { fsPath: fp, scheme: "file", path: fp };
    },
  };
  class ThemeIcon {
    constructor(id) {
      this.id = id;
    }
    static File = new ThemeIcon("file");
    static Folder = new ThemeIcon("folder");
  }

  const config = { ignoredMaxItems: 2000, trustEnabled: true };
  const registered = { providers: {}, commands: {} };
  const workspace = {
    workspaceFolders: [],
    isTrusted: true,
    getConfiguration: (section) => {
      if (section === "security") {
        return { get: (k) => (k === "workspace.trust.enabled" ? config.trustEnabled : undefined) };
      }
      if (section === "ignored") {
        return { get: (k, d) => (k === "maxItems" ? config.ignoredMaxItems : d) };
      }
      return { get: () => undefined };
    },
    openTextDocument: async () => ({ uri: { scheme: "file" } }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
    fs: { delete: async () => {} },
  };

  const vscode = {
    EventEmitter,
    TreeItem,
    TreeItemCollapsibleState,
    ThemeIcon,
    Uri,
    window: {
      registerTreeDataProvider: (id, provider) => {
        registered.providers[id] = provider;
        return { dispose() {} };
      },
      createTreeView: (id, options) => {
        if (options?.treeDataProvider) {
          registered.providers[id] = options.treeDataProvider;
        }
        return { dispose() {} };
      },
      showInformationMessage: () => {},
      showWarningMessage: () => {},
      showTextDocument: async () => {},
    },
    commands: {
      registerCommand: (id, fn) => {
        registered.commands[id] = fn;
        return { dispose() {} };
      },
      executeCommand: async () => {},
    },
    workspace,
    env: { clipboard: { writeText: async () => {} } },
  };

  // Stub for './git'
  const gitStub = {
    _result: { files: [], truncated: false },
    _lastMax: undefined,
    listIgnoredFiles: async (cwd, maxItems) => {
      gitStub._lastMax = maxItems;
      return gitStub._result;
    },
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
    return run({ vscode, registered, config, gitStub });
  } finally {
    Module._load = origLoad;
  }
}

function assertLabelSeq(items, expected) {
  const labels = items.map((i) => i.label);
  assert.deepStrictEqual(
    labels,
    expected,
    `labels mismatch: ${labels.join(", ")} vs ${expected.join(", ")}`,
  );
}

withMocks(({ registered, vscode, config, gitStub }) => {
  const ext = require(path.join(process.cwd(), "dist", "extension.js"));
  ext.activate({ subscriptions: [] });
  const provider = registered.providers.ignoredFilesView;

  // Setup single-root workspace
  const root = { name: "root", uri: { fsPath: "/tmp/work" } };
  vscode.workspace.workspaceFolders = [root];

  // 1) Directories first, then files at root
  gitStub._result = { files: ["a.txt", "dir2/sub/file2", "dir1/file1"], truncated: false };
  let rootItems = [];
  return (
    Promise.resolve()
      .then(() => provider.getChildren())
      .then((items) => {
        // Order: dir1, dir2, a.txt
        assertLabelSeq(items, ["dir1", "dir2", "a.txt"]);
        rootItems = items;
      })
      // 2) Children for a directory
      .then(() => provider.getChildren(rootItems[0]))
      .then((dir1Children) => {
        assertLabelSeq(dir1Children, ["file1"]);
      })
      // 3) Truncation note with configured maxItems
      .then(() => {
        config.ignoredMaxItems = 123;
        gitStub._result = { files: ["x.txt"], truncated: true };
        provider.refresh();
      })
      .then(() => provider.getChildren())
      .then((items2) => {
        assert(items2.length >= 1, "should include a note item");
        assert(
          /Showing first 123 ignored files/.test(String(items2[0].label)),
          "truncation note shows configured cap",
        );
        assert.strictEqual(gitStub._lastMax, 123, "passes configured maxItems to git layer");
      })
      // 4) Clamp maxItems upper bound (should pass 20000)
      .then(() => {
        config.ignoredMaxItems = 999999;
        gitStub._result = { files: [], truncated: false };
        provider.refresh();
      })
      .then(() => provider.getChildren())
      .then(() => {
        assert.strictEqual(gitStub._lastMax, 20000, "maxItems should be clamped to 20000");
      })
      // 5) Trust gating returns message when untrusted
      .then(() => {
        config.trustEnabled = true;
        vscode.workspace.isTrusted = false;
        provider.refresh();
      })
      .then(() => provider.getChildren())
      .then((items3) => {
        assert(items3.length === 1, "one message item when untrusted");
        assert(/untrusted/.test(String(items3[0].label)), "message mentions untrusted");
      })
  );
});
