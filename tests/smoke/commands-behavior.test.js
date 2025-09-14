// Smoke tests for command behaviors: open, copyPath, delete (with trust gating)
const path = require("node:path");

function withMocks(run) {
  // Minimal EventEmitter
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

  const calls = { execute: [], info: [], warn: [], error: [], clip: [], deletes: [] };
  const behavior = { deleteConfirm: "Delete", trustEnabled: true };

  const registered = { providers: {}, commands: {} };
  const workspace = {
    workspaceFolders: [],
    isTrusted: true,
    getConfiguration: (section) => {
      if (section === "security") {
        return {
          get: (k) => (k === "workspace.trust.enabled" ? behavior.trustEnabled : undefined),
        };
      }
      if (section === "ignored") {
        return { get: (_k, d) => d, inspect: () => ({ defaultValue: 2000 }) };
      }
      return { get: () => undefined };
    },
    onDidChangeConfiguration: () => ({ dispose() {} }),
    fs: {
      delete: async (uri, opts) => {
        calls.deletes.push({ uri, opts });
      },
    },
  };

  const vscode = {
    EventEmitter,
    TreeItem,
    TreeItemCollapsibleState,
    ThemeIcon,
    Uri,
    window: {
      createTreeView: (id, options) => {
        if (options?.treeDataProvider) registered.providers[id] = options.treeDataProvider;
        return { dispose() {} };
      },
      showInformationMessage: (msg) => {
        calls.info.push(msg);
      },
      showWarningMessage: async (msg) => {
        calls.warn.push(msg);
        return behavior.deleteConfirm;
      },
      showErrorMessage: async (msg) => {
        calls.error.push(msg);
        return undefined;
      },
    },
    commands: {
      registerCommand: (id, fn) => {
        registered.commands[id] = fn;
        return { dispose() {} };
      },
      executeCommand: async (...args) => {
        calls.execute.push(args);
      },
    },
    env: { clipboard: { writeText: async (t) => calls.clip.push(t) } },
    workspace,
  };

  // Stub for './git' so provider can run without spawning real git
  const gitStub = {
    _result: { files: [], truncated: false },
    listIgnoredFiles: async () => gitStub._result,
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
    return run({ vscode, registered, calls, behavior });
  } finally {
    Module._load = origLoad;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "Assertion failed");
}

withMocks(({ registered, vscode, calls, behavior }) => {
  const ext = require(path.join(process.cwd(), "dist", "extension.js"));
  const providerMod = require(path.join(process.cwd(), "dist", "ignored-tree-data-provider.js"));
  const { FileItem, DirectoryItem } = providerMod;
  ext.activate({ subscriptions: [] });

  // Prepare a workspace folder and items
  const root = { name: "root", uri: { fsPath: "/tmp/work" } };
  vscode.workspace.workspaceFolders = [root];

  const fileItem = new FileItem(root, "a.txt");
  const dirItem = new DirectoryItem(root, "dir1");

  // open: should call vscode.open with preview
  return (
    Promise.resolve()
      .then(async () => {
        await registered.commands["show-ignored.open"](fileItem);
        assert(calls.execute.length === 1, "executeCommand called once");
        const [cmd, uri, opts] = calls.execute[0];
        assert(cmd === "vscode.open", "uses vscode.open command");
        assert(uri?.fsPath.endsWith("/tmp/work/a.txt"), "passes resource uri");
        assert(opts && opts.preview === true, "opens in preview");
      })
      // copyPath: copies absolute path and shows info
      .then(async () => {
        await registered.commands["show-ignored.copyPath"](fileItem);
        assert(calls.clip.length === 1, "clipboard write called");
        assert(calls.clip[0].endsWith("/tmp/work/a.txt"), "clipboard contains fsPath");
        assert(calls.info.length >= 1, "info message shown");
      })
      // delete: trust gating blocks when untrusted
      .then(async () => {
        behavior.trustEnabled = true;
        vscode.workspace.isTrusted = false;
        await registered.commands["show-ignored.delete"](fileItem);
        assert(
          calls.warn.some((m) => /disabled in untrusted/.test(String(m))),
          "warned about trust",
        );
        assert(calls.deletes.length === 0, "no delete when untrusted");
      })
      // delete: confirmed delete for file (non-recursive) and directory (recursive)
      .then(async () => {
        vscode.workspace.isTrusted = true;
        behavior.deleteConfirm = "Delete";
        // Spy provider.refresh
        const provider = registered.providers.ignoredFilesView;
        let refreshed = 0;
        const origRefresh = provider.refresh.bind(provider);
        provider.refresh = () => {
          refreshed++;
          origRefresh();
        };

        await registered.commands["show-ignored.delete"](fileItem);
        assert(calls.deletes.length >= 1, "delete invoked for file");
        const fileDelete = calls.deletes.pop();
        assert(fileDelete.opts.useTrash === true, "file delete uses trash");
        assert(fileDelete.opts.recursive === false, "file delete not recursive");

        await registered.commands["show-ignored.delete"](dirItem);
        const dirDelete = calls.deletes.pop();
        assert(dirDelete.opts.useTrash === true, "dir delete uses trash");
        assert(dirDelete.opts.recursive === true, "dir delete recursive");
        assert(refreshed >= 2, "provider refreshed after deletions");
      })
  );
});
