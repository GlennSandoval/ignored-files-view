// Smoke tests for the Ignored Files view using a lightweight VS Code API mock
const path = require('path');

function createVscodeMock() {
  // Minimal EventEmitter
  class EventEmitter {
    constructor() { this._handlers = []; }
    get event() { return (listener) => { this._handlers.push(listener); }; }
    fire(value) { for (const h of this._handlers) h(value); }
  }

  class TreeItem {
    constructor(label, collapsibleState) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  }

  const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 };

  class Uri {
    static file(fp) { return { fsPath: fp, scheme: 'file', path: fp }; }
  }

  class ThemeIcon { constructor(id) { this.id = id; } static File = new ThemeIcon('file'); static Folder = new ThemeIcon('folder'); }

  const registered = {
    providers: {},
    commands: {},
  };

  const vscode = {
    EventEmitter,
    TreeItem,
    TreeItemCollapsibleState,
    ThemeIcon,
    Uri,
    window: {
      registerTreeDataProvider: (id, provider) => { registered.providers[id] = provider; return { dispose(){} }; },
      showInformationMessage: () => {},
      showWarningMessage: () => {},
      showTextDocument: async () => {},
    },
    commands: {
      registerCommand: (id, fn) => { registered.commands[id] = fn; return { dispose(){} }; },
      executeCommand: async () => {},
    },
    workspace: {
      workspaceFolders: [],
      isTrusted: true,
      getConfiguration: () => ({ get: () => true }),
      openTextDocument: async () => ({ uri: { scheme: 'file' } }),
    },
  };

  return { vscode, registered };
}

function withVscodeMock(run) {
  const { vscode, registered } = createVscodeMock();
  const Module = require('module');
  const origLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'vscode') return vscode;
    return origLoad.apply(this, arguments);
  };
  try {
    return run({ vscode, registered });
  } finally {
    Module._load = origLoad;
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed'); }

// Run smoke tests
withVscodeMock(({ registered }) => {
  const ext = require(path.join(process.cwd(), 'out', 'extension.js'));
  assert(typeof ext.activate === 'function', 'activate should be exported');
  ext.activate({ subscriptions: [] });

  // Provider registered
  const provider = registered.providers['ignoredFilesView'];
  assert(provider, 'TreeDataProvider should be registered for ignoredFilesView');
  assert(typeof provider.getChildren === 'function', 'provider.getChildren exists');

  // Commands registered
  const cmds = [
    'show-ignored.refresh',
    'show-ignored.open',
    'show-ignored.reveal',
    'show-ignored.delete',
    'show-ignored.unignore',
  ];
  for (const c of cmds) {
    assert(typeof registered.commands[c] === 'function', `command registered: ${c}`);
  }

  // Empty workspace shows message item
  return Promise.resolve(provider.getChildren()).then((items) => {
    assert(Array.isArray(items), 'getChildren should return an array');
    assert(items.length === 1, 'one message item expected for empty workspace');
    const label = items[0] && items[0].label;
    assert(typeof label === 'string' && label.length > 0, 'message item has label');
    console.log('✓ smoke: provider and commands registered; empty workspace message shown');
  });
});
