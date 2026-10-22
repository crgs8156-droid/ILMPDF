// Where the app is, read from and written to the address hash.
// Hash changes stay inside the page: they never load anything or touch the
// network, but Safari still records them, so its Back and Forward buttons,
// ⌘[ and swipe-back all work. Plain functions only, so they can be unit-tested.
//
//   #/            the home page
//   #/sign        a tool, waiting for a file
//   #/sign/file   the same tool with a PDF loaded (the file itself is never
//                 in the address; it lives only in memory)

export type Route =
  | { kind: 'home' }
  | { kind: 'tool'; id: string; file: boolean }
  | { kind: 'missing'; path: string };

const APP = 'ILMPDF';

/** Reads a hash such as "#/sign/file". `ids` are the tool ids that exist. */
export function parseHash(hash: string, ids: readonly string[]): Route {
  const path = hash.replace(/^#\/?/, '').replace(/\/+$/, '');
  if (path === '') return { kind: 'home' };
  const [id = '', step, ...rest] = path.split('/');
  if (!ids.includes(id) || rest.length > 0 || (step !== undefined && step !== 'file')) {
    return { kind: 'missing', path };
  }
  return { kind: 'tool', id, file: step === 'file' };
}

export function toHash(route: Route): string {
  if (route.kind === 'tool') return `#/${route.id}${route.file ? '/file' : ''}`;
  if (route.kind === 'missing') return `#/${route.path}`;
  return '#/';
}

/** The route one step "up": a loaded file goes back to the picker, a tool goes home. */
export function parentOf(route: Route): Route {
  if (route.kind === 'tool' && route.file) return { kind: 'tool', id: route.id, file: false };
  return { kind: 'home' };
}

/** The browser tab title, so Safari's history and tab list can tell tools apart. */
export function titleFor(route: Route, toolName?: string): string {
  if (route.kind === 'tool' && toolName) return `${toolName} · ${APP}`;
  if (route.kind === 'missing') return `Not found · ${APP}`;
  return APP;
}

/**
 * A memory-only record of the hashes visited in this tab, used to tell a
 * Back from a new visit. Browsers do not say which one caused a hashchange,
 * so if the new hash is the one before the current entry, we treat it as Back.
 * Nothing here is saved anywhere; it is lost on reload, which is fine.
 */
export class Trail {
  private stack: string[];

  constructor(start: string) {
    this.stack = [start];
  }

  /** Records a hashchange to `hash`. Returns true when it looked like Back. */
  visit(hash: string): boolean {
    const n = this.stack.length;
    if (n > 1 && this.stack[n - 2] === hash) {
      this.stack.pop();
      return true;
    }
    if (this.stack[n - 1] !== hash) this.stack.push(hash);
    return false;
  }

  /** Records that the current entry was replaced (location.replace) by `hash`. */
  replace(hash: string): void {
    this.stack[this.stack.length - 1] = hash;
  }

  /** True when going Back in the browser would land exactly on `hash`. */
  previousIs(hash: string): boolean {
    const n = this.stack.length;
    return n > 1 && this.stack[n - 2] === hash;
  }
}
