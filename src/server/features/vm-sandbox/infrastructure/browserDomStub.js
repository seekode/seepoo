/**
 * Crée un stub léger d'élément DOM / API navigateur pour éviter les ReferenceError/TypeError
 * lorsque les constructeurs ou méthodes des classes manipulent `document` ou `window`.
 */
export function createDomElementStub(tagName = 'div') {
  const classes = new Set();
  const children = [];
  const el = {
    __seepooDomStub: true,
    tagName: String(tagName).toUpperCase(),
    id: '',
    textContent: '',
    innerHTML: '',
    value: '',
    style: {},
    dataset: {},
    children,
    classList: {
      add: (...tokens) => tokens.forEach((t) => classes.add(t)),
      remove: (...tokens) => tokens.forEach((t) => classes.delete(t)),
      toggle: (token) =>
        classes.has(token) ? (classes.delete(token), false) : (classes.add(token), true),
      contains: (token) => classes.has(token)
    },
    appendChild: (child) => {
      children.push(child);
      return child;
    },
    removeChild: (child) => child,
    addEventListener: () => {},
    removeEventListener: () => {},
    setAttribute: () => {},
    getAttribute: () => null,
    querySelector: () => createDomElementStub('div'),
    querySelectorAll: () => [],
    getElementsByClassName: () => [],
    getElementsByTagName: () => [],
    get __label() {
      const idPart = el.id ? `#${el.id}` : '';
      const clsPart = classes.size > 0 ? `.${Array.from(classes).join('.')}` : '';
      return `[HTMLElement <${String(tagName).toLowerCase()}${idPart}${clsPart}>]`;
    }
  };
  return el;
}

export function createBrowserGlobals() {
  const storageStore = new Map();
  const storageStub = {
    getItem: (k) => (storageStore.has(k) ? storageStore.get(k) : null),
    setItem: (k, v) => storageStore.set(k, String(v)),
    removeItem: (k) => storageStore.delete(k),
    clear: () => storageStore.clear()
  };

  const documentStub = {
    __seepooDomStub: true,
    __label: '[Document]',
    body: createDomElementStub('body'),
    head: createDomElementStub('head'),
    documentElement: createDomElementStub('html'),
    createElement: (tag) => createDomElementStub(tag),
    createTextNode: (text) => ({
      __seepooDomStub: true,
      __label: '[TextNode]',
      textContent: String(text)
    }),
    getElementById: (id) => {
      const stub = createDomElementStub('div');
      stub.id = id || '';
      return stub;
    },
    querySelector: () => createDomElementStub('div'),
    querySelectorAll: () => [],
    getElementsByClassName: () => [],
    getElementsByTagName: () => [],
    addEventListener: () => {},
    removeEventListener: () => {}
  };

  return {
    document: documentStub,
    localStorage: storageStub,
    sessionStorage: storageStub,
    navigator: { userAgent: 'SeePOO-Sandbox/1.0' },
    alert: () => {},
    confirm: () => true,
    prompt: () => '',
    requestAnimationFrame: (cb) => setTimeout(cb, 16),
    cancelAnimationFrame: (id) => clearTimeout(id)
  };
}
