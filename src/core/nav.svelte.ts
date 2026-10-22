// The app's one shared navigation state. App.svelte starts it; tools read
// `nav.route` and call `nav.go` / `nav.up`. See router.ts for the hash format.
import { Trail, parentOf, parseHash, toHash, type Route } from './router';

class Nav {
  route = $state<Route>({ kind: 'home' });
  private ids: readonly string[] = [];
  private trail = new Trail('#/');
  private replacing = false;

  /** True on a tool page that has a PDF loaded. */
  get onFile(): boolean {
    return this.route.kind === 'tool' && this.route.file;
  }

  /** Starts following the address hash. Returns a function that stops it. */
  start(ids: readonly string[]): () => void {
    this.ids = ids;
    this.route = this.read();
    this.trail = new Trail(toHash(this.route));
    const onHash = () => {
      const route = this.read();
      if (this.replacing) this.trail.replace(toHash(route));
      else this.trail.visit(toHash(route));
      this.replacing = false;
      this.route = route;
    };
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }

  /** Opens a route as a new history entry, so Back returns here. */
  go(route: Route): void {
    location.hash = toHash(route);
  }

  /** Swaps the current history entry for `route`, without adding one. */
  replace(route: Route): void {
    const hash = toHash(route);
    if (location.hash === hash) return;
    this.replacing = true;
    location.replace(hash);
  }

  /**
   * One step up: from a loaded file to the file picker, or from a tool to
   * the home page. Uses the browser's own Back when that lands in the same
   * place, so Forward still works and the history doesn't fill with repeats.
   */
  up(): void {
    const parent = parentOf(this.route);
    if (this.trail.previousIs(toHash(parent))) history.back();
    else this.go(parent);
  }

  private read(): Route {
    return parseHash(location.hash, this.ids);
  }
}

export const nav = new Nav();
